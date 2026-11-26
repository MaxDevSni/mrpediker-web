# Mr. Pediker – web

Web pro [mrpediker.cz](https://mrpediker.cz) – Pedikúra by Míra, Hradec Králové. Barbershop styl, optimalizováno pro telefony.

- `index.html` – úvod, služby, ceník, o mně, galerie, **online rezervace**, kontakt
- `style.css`, `app.js` – vzhled, mobilní menu, rezervační formulář, cookie lišta
- `obchodni-podminky.html`, `odstoupeni-od-smlouvy.html`, `ochrana-osobnich-udaju.html`, `cookies.html`
- `img/` – fotky, `brand/` – logo

## Rezervace
Klient vybere ošetření, den, čas a vyplní kontakt; rezervace se odešle jako předvyplněná SMS nebo e-mail na 737 307 321 / mrpediker@seznam.cz. Nabízené časy a počet dní dopředu se mění v `app.js` (`TIMES`, `DAYS_AHEAD`). Obsazenost se nekontroluje – termín platí po potvrzení.

## Doplnit
V obchodních podmínkách a ochraně osobních údajů jsou v [hranatých závorkách] údaje k doplnění (storno lhůta a poplatek, platba kartou, doba uchování, název rezervačního systému).

## Administrace (/admin)
Kalendář termínů (přesouvání, stavy, kolize, mimo směnu), směny na 5 týdnů dopředu, klienti s historií, faktury (tisk / PDF), ceník, záloha dat.
Výchozí přihlášení `admin` / `admin` – změnit v Nastavení. Data jsou uložena **jen v zařízení**, kde se admin používá (localStorage); záloha přes Nastavení → Stáhnout zálohu.

## Databáze (Supabase, zdarma)
1. Projekt na supabase.com (region Frankfurt), v SQL Editoru spustit `supabase/schema.sql`.
2. Authentication → Users → Add user (účet pro Míru), vypnout registraci nových uživatelů.
3. Do `config.js` doplnit Project URL a anon/publishable klíč.
Pak se admin přihlašuje e-mailem, data jsou společná pro všechna zařízení a online rezervace nabízí jen volné časy podle směn. Bez vyplněného `config.js` vše funguje v původním režimu.
