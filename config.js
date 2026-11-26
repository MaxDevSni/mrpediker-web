/* Napojení na databázi Supabase.
   Doplňte údaje z Supabase → Project Settings → API.
   Klíč „anon / publishable“ je veřejný a patří sem. NIKDY sem nedávejte klíč „service_role / secret“.
   Když jsou údaje prázdné, web i admin fungují bez databáze (rezervace přes SMS/e-mail, data jen v zařízení). */
window.MP_CONFIG = {
  supabaseUrl: 'https://hgpemkwvptjxrvctasrg.supabase.co',
  supabaseKey: 'sb_publishable_jH22J_yY9qwj674hRwDp_A_CTMlx-bN'
};
