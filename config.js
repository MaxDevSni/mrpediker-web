/* Napojení na databázi Supabase.
   Doplňte údaje z Supabase → Project Settings → API.
   Klíč „anon / publishable“ je veřejný a patří sem. NIKDY sem nedávejte klíč „service_role / secret“.
   Když jsou údaje prázdné, web i admin fungují bez databáze (rezervace přes SMS/e-mail, data jen v zařízení). */
window.MP_CONFIG = {
  supabaseUrl: '',   // např. 'https://abcdefgh.supabase.co'
  supabaseKey: ''    // anon / publishable klíč
};
