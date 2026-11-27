-- Mr. Pediker – databáze pro web a administraci (Supabase / PostgreSQL)
-- Spusťte celé v Supabase: SQL Editor → New query → vložit → Run.

-- ---------- Tabulky ----------
create table if not exists public.clients (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  tel text,
  email text,
  addr text,
  note text,
  created_at timestamptz not null default now()
);

create table if not exists public.appointments (
  id uuid primary key default gen_random_uuid(),
  client_id uuid references public.clients(id) on delete cascade,
  service text not null,
  price integer not null default 0,
  date date not null,
  time time not null,
  dur integer not null default 60,
  status text not null default 'ceka' check (status in ('ceka','potvrzeno','hotovo','neprisel','zruseno')),
  note text,
  source text not null default 'admin',
  created_at timestamptz not null default now()
);
create index if not exists appointments_date_idx on public.appointments(date);

create table if not exists public.shifts (
  date date primary key,
  is_on boolean not null default true,
  t_from time not null default '08:00',
  t_to time not null default '19:00'
);

create table if not exists public.invoices (
  id uuid primary key default gen_random_uuid(),
  no text not null unique,
  date date not null,
  due date not null,
  client_id uuid references public.clients(id) on delete set null,
  client_addr text,
  items jsonb not null default '[]',
  pay text not null default 'hotově',
  appt_ids jsonb not null default '[]',
  created_at timestamptz not null default now()
);

create table if not exists public.settings (
  id integer primary key default 1 check (id = 1),
  data jsonb not null default '{}'
);
insert into public.settings (id, data) values (1, '{}') on conflict do nothing;

-- ---------- Zabezpečení (Row Level Security) ----------
-- Přihlášený administrátor (Míra) smí vše. Návštěvník webu nesmí číst nic osobního.
alter table public.clients enable row level security;
alter table public.appointments enable row level security;
alter table public.shifts enable row level security;
alter table public.invoices enable row level security;
alter table public.settings enable row level security;

drop policy if exists "admin vse" on public.clients;
create policy "admin vse" on public.clients for all to authenticated using (true) with check (true);
drop policy if exists "admin vse" on public.appointments;
create policy "admin vse" on public.appointments for all to authenticated using (true) with check (true);
drop policy if exists "admin vse" on public.shifts;
create policy "admin vse" on public.shifts for all to authenticated using (true) with check (true);
drop policy if exists "admin vse" on public.invoices;
create policy "admin vse" on public.invoices for all to authenticated using (true) with check (true);
drop policy if exists "admin vse" on public.settings;
create policy "admin vse" on public.settings for all to authenticated using (true) with check (true);
-- Směny (kdy Míra pracuje) neobsahují osobní údaje – web je smí číst.
drop policy if exists "web cte smeny" on public.shifts;
create policy "web cte smeny" on public.shifts for select to anon using (true);

-- Oprávnění (řádky dál omezuje RLS výše)
grant usage on schema public to anon, authenticated;
grant select, insert, update, delete on public.clients, public.appointments, public.shifts, public.invoices, public.settings to authenticated;
grant select on public.shifts to anon;
revoke all on public.clients, public.appointments, public.invoices, public.settings from anon;

-- ---------- Funkce pro web ----------
-- Obsazené časy (bez jmen) pro zobrazení volných termínů.
drop function if exists public.busy_slots(date, date);
create or replace function public.busy_slots(d_from date, d_to date)
returns table (slot_date date, slot_time time, slot_dur integer)
language sql security definer set search_path = public as $$
  select a.date, a.time, a.dur from public.appointments a
  where a.date between d_from and d_to and a.status not in ('zruseno','neprisel');
$$;

-- Online rezervace z webu: ověří směnu a kolizi, založí klienta a termín se stavem „čeká“.
create or replace function public.book(
  p_name text, p_tel text, p_email text, p_service text, p_price integer,
  p_date date, p_time time, p_dur integer, p_note text)
returns uuid
language plpgsql security definer set search_path = public as $$
declare s record; cid uuid; aid uuid; buf integer;
begin
  select coalesce((data->>'buffer')::int, 15) into buf from public.settings where id = 1;
  buf := coalesce(buf, 15);
  if length(coalesce(trim(p_name),'')) < 3 or length(regexp_replace(coalesce(p_tel,''),'\D','','g')) < 9 then
    raise exception 'Neplatné jméno nebo telefon';
  end if;
  if p_date <= current_date or p_date > current_date + 60 then raise exception 'Neplatné datum'; end if;
  select * into s from public.shifts where date = p_date;
  if not found or not s.is_on or p_time < s.t_from or (p_time + make_interval(mins => p_dur)) > s.t_to then
    raise exception 'V tento čas se neordinuje';
  end if;
  if exists (select 1 from public.appointments a
             where a.date = p_date and a.status not in ('zruseno','neprisel')
               and p_time < a.time + make_interval(mins => a.dur + buf)
               and a.time < p_time + make_interval(mins => p_dur + buf)) then
    raise exception 'Termín je už obsazený';
  end if;
  select id into cid from public.clients
   where right(regexp_replace(tel,'\D','','g'),9) = right(regexp_replace(p_tel,'\D','','g'),9) limit 1;
  if cid is null then
    insert into public.clients(name, tel, email) values (trim(p_name), trim(p_tel), nullif(trim(p_email),'')) returning id into cid;
  end if;
  insert into public.appointments(client_id, service, price, date, time, dur, status, note, source)
  values (cid, left(p_service,120), greatest(p_price,0), p_date, p_time, least(greatest(p_dur,15),240), 'ceka', left(p_note,1000), 'web')
  returning id into aid;
  return aid;
end $$;

-- Směny pro web (jen data a časy, bez osobních údajů).
drop function if exists public.public_shifts(date, date);
create or replace function public.public_shifts(d_from date, d_to date)
returns table (shift_date date, is_on boolean, t_from time, t_to time)
language sql security definer set search_path = public as $$
  select s.date, s.is_on, s.t_from, s.t_to from public.shifts s where s.date between d_from and d_to order by s.date;
$$;
revoke all on function public.public_shifts from public;
grant execute on function public.public_shifts to anon, authenticated;

-- Veřejné nastavení pro web: délky služeb a přestávka mezi klienty (bez osobních údajů).
create or replace function public.public_settings()
returns jsonb language sql security definer set search_path = public as $$
  select jsonb_build_object('buffer', coalesce((data->>'buffer')::int, 15), 'services', coalesce(data->'services', '[]'::jsonb))
  from public.settings where id = 1;
$$;
revoke all on function public.public_settings from public;
grant execute on function public.public_settings to anon, authenticated;

revoke all on function public.book from public;
revoke all on function public.busy_slots from public;
grant execute on function public.book to anon, authenticated;
grant execute on function public.busy_slots to anon, authenticated;

-- Načíst nové tabulky do API
notify pgrst, 'reload schema';
