/* Mr. Pediker – administrace (termíny, směny, klienti, faktury).
   Data se ukládají jen v tomto zařízení (localStorage). Zálohu stáhnete v Nastavení. */
(function () {
  'use strict';
  var KEY = 'mp_admin_v1', SESSION = 'mp_admin_session';
  var DN = ['Ne', 'Po', 'Út', 'St', 'Čt', 'Pá', 'So'];
  var DNL = ['neděle', 'pondělí', 'úterý', 'středa', 'čtvrtek', 'pátek', 'sobota'];
  var MN = ['leden', 'únor', 'březen', 'duben', 'květen', 'červen', 'červenec', 'srpen', 'září', 'říjen', 'listopad', 'prosinec'];
  var MG = ['ledna', 'února', 'března', 'dubna', 'května', 'června', 'července', 'srpna', 'září', 'října', 'listopadu', 'prosince'];
  var STATUS = { ceka: 'Čeká na potvrzení', potvrzeno: 'Potvrzeno', hotovo: 'Hotovo', neprisel: 'Nepřišel', zruseno: 'Zrušeno' };
  var DEFAULT_SERVICES = [
    ['Mokrá pedikúra', 690, 80], ['Přístrojová pedikúra', 790, 80], ['Kombinovaná pedikúra', 890, 80], ['SPA pedikúra', 1290, 80],
    ['Aplikace nehtového rovnátka', 650, 30], ['Stříhání a zapilování nehtů', 250, 20], ['Ošetření zarostlého nehtu (tamponáda)', 250, 20],
    ['Odstranění hyperkeratózy', 290, 20], ['Odstranění gel-laku na nohou', 250, 15], ['Odstranění kuřího oka', 150, 15], ['Masáž nohou', 290, 20]
  ].map(function (s) { return { name: s[0], price: s[1], dur: s[2] }; });

  /* ---------- Data ---------- */
  var db;
  function load() {
    try { db = JSON.parse(localStorage.getItem(KEY)); } catch (e) { db = null; }
    if (!db) db = {};
    db.appts = db.appts || []; db.clients = db.clients || []; db.shifts = db.shifts || {}; db.invoices = db.invoices || [];
    db.settings = Object.assign({
      name: 'Miroslav Hořčica', brand: 'Mr. Pediker – Pedikúra by Míra', ico: '05860334', addr: 'Pospíšilova 311/10, 500 03 Hradec Králové',
      email: 'mrpediker@seznam.cz', tel: '737 307 321', bank: '', prefix: 'MP', nextNo: 1, dueDays: 14,
      defFrom: '08:00', defTo: '19:00', workDays: [1, 2, 3, 4, 5], services: DEFAULT_SERVICES, pwHash: '', user: 'admin', buffer: 15
    }, db.settings || {});
    migrate(db.settings);
  }
  function migrate(st) {
    if ((st.cfgV || 1) < 2) {
      st.services.forEach(function (x) { if (/pedikúra/i.test(x.name) && (x.dur || 0) < 80) x.dur = 80; });
      if (st.buffer == null) st.buffer = 15;
      st.cfgV = 2;
    }
  }
  /* Co Míra vidí ve směnách (výchozí pracovní dny), to se uloží – web pak nabízí stejné dny. */
  function fillAuto() {
    var ch = false, t0 = today();
    for (var i = 0; i < 35; i++) {
      var ds = iso(addDays(t0, i));
      if (!db.shifts[ds]) { db.shifts[ds] = { on: db.settings.workDays.indexOf(parse(ds).getDay()) > -1, from: db.settings.defFrom, to: db.settings.defTo }; ch = true; }
    }
    return ch;
  }
  function save() { try { localStorage.setItem(KEY, JSON.stringify(db)); } catch (e) { toast('Nepodařilo se uložit – plné úložiště?'); } if (CLOUD) cloudSync(); }

  /* ---------- Cloud (Supabase) ---------- */
  var CLOUD = !!(window.MPDB && MPDB.enabled), last = null, syncing = false, again = false, syncState = 'ok', syncErr = '';
  var t5 = function (t) { return (t || '').slice(0, 5); };
  function rowsOf(d) {
    var r = {};
    r.clients = d.clients.map(function (c) { return { id: c.id, name: c.name, tel: c.tel || null, email: c.email || null, addr: c.addr || null, note: c.note || null, created_at: c.created ? c.created + 'T12:00:00Z' : new Date().toISOString() }; });
    r.appointments = d.appts.map(function (a) { return { id: a.id, client_id: a.clientId || null, service: a.service, price: +a.price || 0, date: a.date, time: a.time, dur: +a.dur || 60, status: a.status, note: a.note || null, source: a.source || 'admin' }; });
    r.shifts = Object.keys(d.shifts).map(function (k) { var x = d.shifts[k]; return { date: k, is_on: !!x.on, t_from: x.from, t_to: x.to }; });
    r.invoices = d.invoices.map(function (i) { return { id: i.id, no: i.no, date: i.date, due: i.due, client_id: i.clientId || null, client_addr: i.clientAddr || null, items: i.items, pay: i.pay, appt_ids: i.apptIds || [] }; });
    var st = Object.assign({}, d.settings); delete st.pwHash; delete st.user;
    r.settings = [{ id: 1, data: st }];
    return r;
  }
  var KEYCOL = { clients: 'id', appointments: 'id', shifts: 'date', invoices: 'id', settings: 'id' };
  var ORDER = ['settings', 'clients', 'shifts', 'appointments', 'invoices'];
  function snap(r) { var o = {}; ORDER.forEach(function (t) { o[t] = {}; r[t].forEach(function (x) { o[t][x[KEYCOL[t]]] = JSON.stringify(x); }); }); return o; }
  function cloudSync() {
    if (!last) return;
    if (syncing) { again = true; return; }
    syncing = true; setSync('busy');
    var now = snap(rowsOf(db)), chain = Promise.resolve();
    ORDER.forEach(function (t) {
      var up = [], del = [];
      Object.keys(now[t]).forEach(function (k) { if (now[t][k] !== last[t][k]) up.push(JSON.parse(now[t][k])); });
      Object.keys(last[t]).forEach(function (k) { if (!(k in now[t])) del.push(k); });
      chain = chain.then(function () { return MPDB.upsert(t, up, KEYCOL[t]); });
      if (del.length) delQueue.push([t, del]);
    });
    // mazání v opačném pořadí (faktury → termíny → … )
    chain = chain.then(function () { var q = delQueue.slice().reverse(); delQueue = []; return q.reduce(function (p, d) { return p.then(function () { return MPDB.remove(d[0], KEYCOL[d[0]], d[1]); }); }, Promise.resolve()); });
    chain.then(function () { last = now; setSync('ok'); })
      .catch(function (e) { setSync('err', e.message); if (e.status === 401) { sessionStorage.removeItem(SESSION); render(); } toast('Neuloženo do databáze: ' + e.message); })
      .then(function () { syncing = false; if (again) { again = false; cloudSync(); } });
  }
  var delQueue = [];
  function syncLabel() { return syncState === 'ok' ? '● uloženo' : syncState === 'busy' ? '● ukládám…' : '● chyba ukládání'; }
  function setSync(st, msg) {
    syncState = st; if (st === 'err') syncErr = msg || ''; if (st === 'ok') syncErr = '';
    var el = document.getElementById('sync'); if (el) { el.textContent = syncLabel(); el.style.color = st === 'err' ? '#E7C27D' : 'var(--mut)'; }
    var bn = document.getElementById('syncbanner'); if (bn) { bn.hidden = st !== 'err'; bn.querySelector('span').textContent = syncErr; }
  }
  function cloudLoad() {
    return Promise.all([MPDB.select('clients'), MPDB.select('appointments'), MPDB.select('shifts'), MPDB.select('invoices'), MPDB.select('settings')]).then(function (res) {
      var pw = db.settings.pwHash, us = db.settings.user;
      db.clients = res[0].map(function (c) { return { id: c.id, name: c.name, tel: c.tel || '', email: c.email || '', addr: c.addr || '', note: c.note || '', created: (c.created_at || '').slice(0, 10) }; });
      db.appts = res[1].map(function (a) { return { id: a.id, clientId: a.client_id, service: a.service, price: a.price, date: a.date, time: t5(a.time), dur: a.dur, status: a.status, note: a.note || '', source: a.source }; });
      db.shifts = {}; res[2].forEach(function (x) { db.shifts[x.date] = { on: x.is_on, from: t5(x.t_from), to: t5(x.t_to) }; });
      db.invoices = res[3].map(function (i) { return { id: i.id, no: i.no, date: i.date, due: i.due, clientId: i.client_id, clientAddr: i.client_addr || '', items: i.items || [], pay: i.pay, apptIds: i.appt_ids || [] }; });
      var remote = (res[4][0] && res[4][0].data) || {};
      var firstRun = !Object.keys(remote).length;
      if (!firstRun) { var v0 = remote.cfgV; db.settings = Object.assign({}, db.settings, remote); db.settings.cfgV = v0; migrate(db.settings); if (v0 !== db.settings.cfgV) firstRun = true; }
      db.settings.pwHash = pw; db.settings.user = us;
      try { localStorage.setItem(KEY, JSON.stringify(db)); } catch (e) {}
      last = snap(rowsOf(db));
      var filled = fillAuto();
      if (filled) try { localStorage.setItem(KEY, JSON.stringify(db)); } catch (e) {}
      if (firstRun) last.settings = {};
      if (firstRun || filled) cloudSync();
    });
  }
  function uid() {
    if (window.crypto && crypto.randomUUID) return crypto.randomUUID();
    return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, function (c) { var r = Math.random() * 16 | 0; return (c === 'x' ? r : (r & 3 | 8)).toString(16); });
  }

  /* ---------- Pomocné ---------- */
  var $app = document.getElementById('app'), $sheet = document.getElementById('sheet'), $toast = document.getElementById('toast');
  function esc(s) { return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]; }); }
  function pad(n) { return (n < 10 ? '0' : '') + n; }
  function iso(d) { return d.getFullYear() + '-' + pad(d.getMonth() + 1) + '-' + pad(d.getDate()); }
  function parse(s) { var p = s.split('-'); return new Date(+p[0], +p[1] - 1, +p[2]); }
  function today() { var d = new Date(); d.setHours(0, 0, 0, 0); return d; }
  function addDays(d, n) { var x = new Date(d); x.setDate(x.getDate() + n); return x; }
  function fmtD(s) { var d = parse(s); return DN[d.getDay()] + ' ' + d.getDate() + '. ' + (d.getMonth() + 1) + '.'; }
  function fmtDL(s) { var d = parse(s); return DNL[d.getDay()] + ' ' + d.getDate() + '. ' + MG[d.getMonth()] + ' ' + d.getFullYear(); }
  function fmtCZ(s) { var d = parse(s); return d.getDate() + '. ' + (d.getMonth() + 1) + '. ' + d.getFullYear(); }
  function kc(n) { return Math.round(n).toLocaleString('cs-CZ').replace(/ /g, ' ') + ' Kč'; }
  function mins(t) { var p = t.split(':'); return +p[0] * 60 + +p[1]; }
  function hm(m) { return pad(Math.floor(m / 60)) + ':' + pad(m % 60); }
  function initials(n) { return (n || '?').split(/\s+/).filter(Boolean).slice(0, 2).map(function (w) { return w[0].toUpperCase(); }).join(''); }
  function client(id) { return db.clients.find(function (c) { return c.id === id; }); }
  function toast(t) { $toast.textContent = t; $toast.classList.add('on'); clearTimeout(toast.t); toast.t = setTimeout(function () { $toast.classList.remove('on'); }, 2200); }
  function sha(s) {
    if (window.crypto && crypto.subtle) return crypto.subtle.digest('SHA-256', new TextEncoder().encode('mp-salt:' + s)).then(function (b) { return Array.from(new Uint8Array(b)).map(function (x) { return x.toString(16).padStart(2, '0'); }).join(''); });
    return Promise.resolve('plain:' + s);
  }
  function shiftOf(ds) {
    var s = db.shifts[ds];
    if (s) return s;
    var d = parse(ds);
    var on = db.settings.workDays.indexOf(d.getDay()) > -1;
    return { on: on, from: db.settings.defFrom, to: db.settings.defTo, auto: true };
  }
  function apptsOn(ds) { return db.appts.filter(function (a) { return a.date === ds; }).sort(function (a, b) { return a.time.localeCompare(b.time); }); }
  function active(a) { return a.status !== 'zruseno' && a.status !== 'neprisel'; }
  function conflicts(a) {
    var buf = +db.settings.buffer || 0, s = mins(a.time), e = s + (+a.dur || 60) + buf;
    return db.appts.filter(function (b) {
      if (b.id === a.id || b.date !== a.date || !active(b)) return false;
      var bs = mins(b.time), be = bs + (+b.dur || 60) + buf;
      return s < be && bs < e;
    });
  }
  function outOfShift(a) {
    var sh = shiftOf(a.date);
    if (!sh.on) return 'V tento den nepracuješ (volno).';
    var s = mins(a.time), e = s + (+a.dur || 60);
    if (s < mins(sh.from) || e > mins(sh.to)) return 'Termín je mimo směnu ' + sh.from + '–' + sh.to + '.';
    return '';
  }

  /* ---------- Ikony ---------- */
  var I = {
    cal: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7"><rect x="3" y="5" width="18" height="16"/><path d="M3 10h18M8 3v4M16 3v4"/></svg>',
    shift: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7"><circle cx="12" cy="12" r="9"/><path d="M12 7v5l3 2"/></svg>',
    cli: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7"><circle cx="9" cy="8" r="4"/><path d="M2 21c0-4 3-6 7-6s7 2 7 6M16 4a4 4 0 0 1 0 8M22 21c0-3-2-5-4-5.5"/></svg>',
    inv: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7"><path d="M6 2h9l5 5v15H6z"/><path d="M14 2v6h6M9 13h8M9 17h8"/></svg>',
    fin: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7"><path d="M4 20V10M10 20V4M16 20v-7M22 20H2"/></svg>',
    set: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7"><circle cx="12" cy="12" r="3"/><path d="M19 12a7 7 0 0 0-.1-1.2l2-1.6-2-3.4-2.4 1a7 7 0 0 0-2-1.2L14 3h-4l-.5 2.6a7 7 0 0 0-2 1.2l-2.4-1-2 3.4 2 1.6A7 7 0 0 0 5 12c0 .4 0 .8.1 1.2l-2 1.6 2 3.4 2.4-1a7 7 0 0 0 2 1.2L10 21h4l.5-2.6a7 7 0 0 0 2-1.2l2.4 1 2-3.4-2-1.6c.1-.4.1-.8.1-1.2z"/></svg>',
    plus: '<svg width="26" height="26" viewBox="0 0 24 24" fill="none" stroke="#F3EAD8" stroke-width="2"><path d="M12 5v14M5 12h14"/></svg>',
    l: '<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M15 6l-6 6 6 6"/></svg>',
    r: '<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M9 6l6 6-6 6"/></svg>'
  };

  /* ---------- Stav UI ---------- */
  var ui = { tab: 'cal', month: (function () { var d = today(); d.setDate(1); return d; })(), day: iso(today()), q: '', clientId: null, shiftFrom: iso(today()), finMonth: iso(today()).slice(0, 7) };

  /* ---------- Přihlášení ---------- */
  function loginView() {
    $app.innerHTML = '<div class="login"><form id="lf" autocomplete="on">' +
      '<h1>MR. PEDIKER</h1><p>Administrace salonu</p>' +
      '<div class="field"><label for="lu">' + (CLOUD ? 'E-mail' : 'Uživatel') + '</label><input id="lu" name="username" ' + (CLOUD ? 'type="email" inputmode="email" ' : '') + 'autocomplete="username" autocapitalize="none" required></div>' +
      '<div class="field"><label for="lp">Heslo</label><input id="lp" name="password" type="password" autocomplete="current-password" required></div>' +
      '<p class="err small" id="le" style="color:#E7C27D;min-height:1em;margin:0 0 10px"></p>' +
      '<button class="btn p block" type="submit">Přihlásit</button>' +
      '<p class="small muted" style="margin:16px 0 0">' + (CLOUD ? 'Data jsou uložena v zabezpečené databázi.' : 'Data jsou uložena jen v tomto zařízení.') + '</p></form></div>';
    document.getElementById('lf').addEventListener('submit', function (e) {
      e.preventDefault();
      var u = document.getElementById('lu').value.trim(), p = document.getElementById('lp').value;
      if (CLOUD) {
        document.getElementById('le').textContent = 'Přihlašuji…';
        MPDB.signIn(u, p).then(function () { return cloudLoad(); }).then(function () { sessionStorage.setItem(SESSION, '1'); render(); })
          .catch(function (er) { document.getElementById('le').textContent = er.status === 400 ? 'Špatný e-mail nebo heslo.' : 'Nepodařilo se připojit: ' + er.message; });
        return;
      }
      sha(p).then(function (h) {
        if (u === db.settings.user && h === db.settings.pwHash) {
          sessionStorage.setItem(SESSION, '1'); render();
          if (p === 'admin') setTimeout(function () { toast('Tip: změň si výchozí heslo v Nastavení'); }, 600);
        } else document.getElementById('le').textContent = 'Špatné jméno nebo heslo.';
      });
    });
  }

  /* ---------- Rámec ---------- */
  var TABS = [['cal', 'Kalendář', I.cal], ['shift', 'Směny', I.shift], ['cli', 'Klienti', I.cli], ['fin', 'Přehled', I.fin], ['inv', 'Faktury', I.inv], ['set', 'Nastavení', I.set]];
  function render() {
    if (sessionStorage.getItem(SESSION) !== '1') return loginView();
    var title = { cal: 'Kalendář', shift: 'Směny', cli: 'Klienti', fin: 'Přehled', inv: 'Faktury', set: 'Nastavení' }[ui.tab];
    var body = { cal: calView, shift: shiftView, cli: ui.clientId ? clientDetail : clientsView, fin: finView, inv: invView, set: setView }[ui.tab]();
    var t = today(), upcoming = db.appts.filter(function (a) { return a.date === iso(t) && active(a); }).length;
    $app.innerHTML =
      '<header class="top"><h1>' + title + '<small>' + DNL[t.getDay()] + ' ' + t.getDate() + '. ' + MG[t.getMonth()] + ' · dnes ' + upcoming + ' ' + (upcoming === 1 ? 'termín' : upcoming > 1 && upcoming < 5 ? 'termíny' : 'termínů') + '</small></h1>' +
      (CLOUD ? '<span id="sync" class="small" style="margin-left:auto;color:' + (syncState === 'err' ? '#E7C27D' : 'var(--mut)') + '">' + syncLabel() + '</span>' : '') + '<a class="btn sm g" href="../" title="Zpět na web">Web</a></header>' +
      (CLOUD ? '<div id="syncbanner" class="warn" style="margin:12px 16px 0"' + (syncState === 'err' ? '' : ' hidden') + '><b>Neuloženo do databáze.</b> Zkontroluj internet a zkus to znovu. <span class="small">' + esc(syncErr) + '</span> <button class="btn sm" data-act="retrySync">Zkusit znovu</button></div>' : '') +
      '<main>' + body + '</main>' +
      '<nav class="tabs" aria-label="Sekce">' + TABS.map(function (x) { return '<button type="button" data-act="tab" data-v="' + x[0] + '"' + (ui.tab === x[0] ? ' aria-current="page"' : '') + '>' + x[2] + x[1] + '</button>'; }).join('') + '</nav>' +
      (ui.tab === 'cal' ? '<button class="fab" type="button" data-act="newAppt" aria-label="Nový termín">' + I.plus + '</button>' : '') +
      (ui.tab === 'cli' && !ui.clientId ? '<button class="fab" type="button" data-act="newClient" aria-label="Nový klient">' + I.plus + '</button>' : '');
    var s = document.getElementById('q'); if (s) { s.value = ui.q; s.addEventListener('input', function () { ui.q = s.value; var pos = s.selectionStart; render(); var n = document.getElementById('q'); n.focus(); n.setSelectionRange(pos, pos); }); }
  }

  /* ---------- Kalendář ---------- */
  function calView() {
    var m = ui.month, y = m.getFullYear(), mo = m.getMonth();
    var first = new Date(y, mo, 1), start = addDays(first, -((first.getDay() + 6) % 7));
    var cells = '';
    for (var i = 0; i < 42; i++) {
      var d = addDays(start, i), ds = iso(d), sh = shiftOf(ds), list = apptsOn(ds).filter(active);
      if (i >= 35 && d.getMonth() !== mo) break;
      cells += '<button type="button" class="d' + (sh.on ? '' : ' off') + (d.getMonth() !== mo ? ' other' : '') + (ds === iso(today()) ? ' today' : '') + '" data-act="day" data-v="' + ds + '" aria-pressed="' + (ds === ui.day) + '" aria-label="' + fmtDL(ds) + ', ' + list.length + ' termínů">' +
        d.getDate() + '<span class="dots">' + list.slice(0, 6).map(function () { return '<i class="dot"></i>'; }).join('') + '</span>' +
        (sh.on ? '<span class="sh">' + sh.from.replace(':00', '') + '–' + sh.to.replace(':00', '') + '</span>' : '<span class="sh">volno</span>') + '</button>';
    }
    var day = ui.day, sh = shiftOf(day), list = apptsOn(day);
    var pending = db.appts.filter(function (a) { return a.status === 'ceka'; }).length;
    return installCard(false) + '<div class="cal-head"><button class="btn icon g" data-act="month" data-v="-1" aria-label="Předchozí měsíc">' + I.l + '</button>' +
      '<h2>' + MN[mo] + ' ' + y + '</h2><button class="btn icon g" data-act="month" data-v="1" aria-label="Další měsíc">' + I.r + '</button></div>' +
      '<div class="cal">' + ['Po', 'Út', 'St', 'Čt', 'Pá', 'So', 'Ne'].map(function (x) { return '<span class="dn">' + x + '</span>'; }).join('') + cells + '</div>' +
      '<div class="legend"><span><i style="background:var(--sf)"></i>Pracovní den</span><span><i style="background:#1b1713;border:1px solid var(--hair)"></i>Volno</span><span><i class="dot" style="border-radius:50%;background:var(--br)"></i>Termín</span></div>' +
      (pending ? '<div class="warn" style="margin-top:14px">' + pending + '× čeká na potvrzení – <button class="btn sm g" data-act="pending">Zobrazit</button></div>' : '') +
      '<div class="day-head"><h3>' + fmtDL(day) + '<br><span class="small muted" style="text-transform:none;letter-spacing:0;font-family:var(--s)">' + (sh.on ? 'Směna ' + sh.from + '–' + sh.to : 'Volno') + '</span></h3>' +
      '<div class="row"><button class="btn sm g" data-act="today">Dnes</button><button class="btn sm" data-act="editShift" data-v="' + day + '">Směna</button></div></div>' +
      (list.length ? list.map(apptRow).join('') : '<div class="empty">Žádné termíny. ' + (sh.on ? 'Klepni na <b>+</b> a přidej termín.' : '') + '</div>') +
      '<div class="row" style="margin-top:14px"><button class="btn g block" data-act="importSms">Vložit rezervaci ze SMS / e-mailu</button></div>';
  }
  function apptRow(a) {
    var c = client(a.clientId) || { name: a.name || '—' };
    return '<button type="button" class="appt st-' + a.status + '" data-act="appt" data-v="' + a.id + '">' +
      '<span class="t">' + a.time + '<small>' + (a.dur || 60) + ' min</small></span>' +
      '<span><b>' + esc(c.name) + '</b><span class="s">' + esc(a.service) + ' · ' + kc(a.price || 0) + '</span></span>' +
      '<span class="badge st-' + a.status + '">' + STATUS[a.status] + '</span></button>';
  }

  function serviceOptions(sel) {
    return db.settings.services.map(function (s, i) { return '<option value="' + i + '"' + (s.name === sel ? ' selected' : '') + '>' + esc(s.name) + ' – ' + kc(s.price) + '</option>'; }).join('') + '<option value="x"' + (sel && !db.settings.services.some(function (s) { return s.name === sel; }) ? ' selected' : '') + '>Jiná služba…</option>';
  }
  function clientOptions(sel) {
    return '<option value="">— nový klient —</option>' + db.clients.slice().sort(function (a, b) { return a.name.localeCompare(b.name, 'cs'); }).map(function (c) { return '<option value="' + c.id + '"' + (c.id === sel ? ' selected' : '') + '>' + esc(c.name) + (c.tel ? ' · ' + esc(c.tel) : '') + '</option>'; }).join('');
  }
  function apptForm(a, isNew) {
    var c = client(a.clientId);
    openSheet('<h2>' + (isNew ? 'Nový termín' : 'Upravit termín') + '<button class="close" data-act="close" aria-label="Zavřít">×</button></h2>' +
      '<form id="af">' +
      '<div class="field"><label for="a-c">Klient</label><select id="a-c">' + clientOptions(a.clientId) + '</select></div>' +
      '<div id="a-new"' + (a.clientId ? ' hidden' : '') + '><div class="two"><div class="field"><label for="a-n">Jméno</label><input id="a-n" value="' + esc(a.name || '') + '" autocomplete="off"></div>' +
      '<div class="field"><label for="a-t">Telefon</label><input id="a-t" type="tel" inputmode="tel" value="' + esc(a.tel || '') + '"></div></div></div>' +
      '<div class="field"><label for="a-s">Služba</label><select id="a-s">' + serviceOptions(a.service) + '</select></div>' +
      '<div class="two"><div class="field"><label for="a-sn">Název</label><input id="a-sn" value="' + esc(a.service || '') + '"></div>' +
      '<div class="field"><label for="a-p">Cena (Kč)</label><input id="a-p" type="number" inputmode="numeric" value="' + (a.price || '') + '"></div></div>' +
      '<div class="two"><div class="field"><label for="a-d">Datum</label><input id="a-d" type="date" value="' + a.date + '" required></div>' +
      '<div class="field"><label for="a-h">Čas</label><input id="a-h" type="time" step="300" value="' + a.time + '" required></div></div>' +
      '<div class="two"><div class="field"><label for="a-du">Délka (min)</label><input id="a-du" type="number" inputmode="numeric" value="' + (a.dur || 60) + '"></div>' +
      '<div class="field"><label for="a-st">Stav</label><select id="a-st">' + Object.keys(STATUS).map(function (k) { return '<option value="' + k + '"' + (a.status === k ? ' selected' : '') + '>' + STATUS[k] + '</option>'; }).join('') + '</select></div></div>' +
      '<div class="field"><label for="a-no">Poznámka</label><textarea id="a-no">' + esc(a.note || '') + '</textarea></div>' +
      '<div id="a-warn"></div>' +
      '<div class="actions"><button class="btn p block" type="submit">Uložit</button>' +
      (isNew ? '' : '<div class="actions two" style="margin:0"><button class="btn block" type="button" data-act="done" data-v="' + a.id + '">Hotovo</button><button class="btn block" type="button" data-act="invFromAppt" data-v="' + a.id + '">Faktura</button></div>' +
        '<div class="actions two" style="margin:0">' + (c && c.tel ? '<a class="btn g block" href="tel:' + esc(c.tel.replace(/\s/g, '')) + '">Zavolat</a><a class="btn g block" href="' + smsLink(a) + '">SMS potvrzení</a>' : '') + '</div>' +
        '<button class="btn danger block" type="button" data-act="delAppt" data-v="' + a.id + '">Smazat termín</button>') +
      '</div></form>');
    var f = document.getElementById('af');
    var sel = f.querySelector('#a-s'), cs = f.querySelector('#a-c');
    cs.addEventListener('change', function () { f.querySelector('#a-new').hidden = !!cs.value; });
    sel.addEventListener('change', function () {
      if (sel.value === 'x') return;
      var s = db.settings.services[+sel.value];
      f.querySelector('#a-sn').value = s.name; f.querySelector('#a-p').value = s.price; f.querySelector('#a-du').value = s.dur; check();
    });
    if (isNew && !a.service) sel.dispatchEvent(new Event('change'));
    function draft() {
      return { id: a.id, date: f.querySelector('#a-d').value, time: f.querySelector('#a-h').value, dur: +f.querySelector('#a-du').value || 60 };
    }
    function check() {
      var d = draft(); if (!d.date || !d.time) return;
      var w = [], o = outOfShift(d), k = conflicts(d);
      if (o) w.push(o);
      if (k.length) w.push('Kolize (včetně přestávky ' + (+db.settings.buffer || 0) + ' min) s: ' + k.map(function (x) { var cc = client(x.clientId); return x.time + ' ' + (cc ? cc.name : ''); }).join(', '));
      f.querySelector('#a-warn').innerHTML = w.length ? '<div class="warn">' + w.map(esc).join('<br>') + '</div>' : '';
    }
    ['#a-d', '#a-h', '#a-du'].forEach(function (s) { f.querySelector(s).addEventListener('change', check); });
    check();
    f.addEventListener('submit', function (e) {
      e.preventDefault();
      var cid = cs.value;
      if (!cid) {
        var n = f.querySelector('#a-n').value.trim();
        if (!n) { toast('Vyplň jméno klienta'); return; }
        var nc = { id: uid(), name: n, tel: f.querySelector('#a-t').value.trim(), email: '', addr: '', note: '', created: iso(today()) };
        db.clients.push(nc); cid = nc.id;
      }
      var wasDate = a.date + ' ' + a.time;
      Object.assign(a, {
        clientId: cid, service: f.querySelector('#a-sn').value.trim() || 'Pedikúra', price: +f.querySelector('#a-p').value || 0,
        date: f.querySelector('#a-d').value, time: f.querySelector('#a-h').value, dur: +f.querySelector('#a-du').value || 60,
        status: f.querySelector('#a-st').value, note: f.querySelector('#a-no').value.trim()
      });
      delete a.name; delete a.tel;
      if (isNew) db.appts.push(a);
      save(); closeSheet(); ui.day = a.date; ui.month = new Date(parse(a.date).getFullYear(), parse(a.date).getMonth(), 1); render();
      toast(isNew ? 'Termín přidán' : (wasDate !== a.date + ' ' + a.time ? 'Termín přesunut na ' + fmtD(a.date) + ' ' + a.time : 'Uloženo'));
    });
  }
  function smsLink(a) {
    var c = client(a.clientId); if (!c || !c.tel) return '#';
    var ios = /iPad|iPhone|iPod/.test(navigator.userAgent);
    var t = 'Dobrý den, potvrzuji termín ' + a.service + ' ' + fmtDL(a.date) + ' v ' + a.time + ', Pospíšilova 311/10, Hradec Králové. Těším se, Míra – Mr. Pediker';
    return 'sms:' + c.tel.replace(/\s/g, '') + (ios ? '&' : '?') + 'body=' + encodeURIComponent(t);
  }

  /* Import rezervace z textu SMS/e-mailu z webu */
  function importSms() {
    openSheet('<h2>Vložit rezervaci<button class="close" data-act="close" aria-label="Zavřít">×</button></h2>' +
      '<p class="small muted">Zkopíruj text SMS nebo e-mailu, který přišel z rezervace na webu, a vlož ho sem. Údaje se doplní samy.</p>' +
      '<div class="field"><label for="imp">Text zprávy</label><textarea id="imp" style="min-height:180px" placeholder="Ošetření: …&#10;Termín: …&#10;Jméno: …"></textarea></div>' +
      '<div class="actions"><button class="btn p block" data-act="doImport">Načíst</button></div>');
  }
  function doImport() {
    var t = document.getElementById('imp').value;
    function g(k) { var m = t.match(new RegExp(k + ':\\s*(.+)', 'i')); return m ? m[1].trim() : ''; }
    var svc = g('Ošetření'), term = g('Termín'), name = g('Jméno'), tel = g('Telefon'), mail = g('E-mail'), note = g('Poznámka');
    var price = 0, pm = svc.match(/\(([\d\s]+)\s*Kč\)/); if (pm) { price = +pm[1].replace(/\s/g, ''); svc = svc.replace(/\s*\(.*\)\s*$/, ''); }
    var date = '', time = '';
    var dm = term.match(/(\d{1,2})\.\s*([a-zěščřžýáíéůú]+)\s+(\d{4}).*?(\d{1,2}:\d{2})/i);
    if (dm) { var mi = MG.indexOf(dm[2].toLowerCase()); if (mi > -1) date = dm[3] + '-' + pad(mi + 1) + '-' + pad(+dm[1]); time = dm[4].length === 4 ? '0' + dm[4] : dm[4]; }
    if (!name || !date) { toast('Text se nepodařilo přečíst – zkontroluj ho'); return; }
    var c = db.clients.find(function (x) { return tel && x.tel && x.tel.replace(/\D/g, '').slice(-9) === tel.replace(/\D/g, '').slice(-9); });
    if (!c) { c = { id: uid(), name: name, tel: tel, email: mail, addr: '', note: '', created: iso(today()) }; db.clients.push(c); }
    else if (mail && !c.email) c.email = mail;
    var sv = db.settings.services.find(function (s) { return s.name.toLowerCase() === svc.toLowerCase(); });
    var a = { id: uid(), clientId: c.id, service: svc || 'Pedikúra', price: price || (sv ? sv.price : 0), date: date, time: time, dur: sv ? sv.dur : 60, status: 'ceka', note: note, source: 'web' };
    save(); closeSheet(); apptForm(a, true);
    toast('Načteno – zkontroluj a ulož');
  }

  /* ---------- Směny ---------- */
  function shiftView() {
    var start = parse(ui.shiftFrom), out = '', lastWeek = -1, hours = 0, days = 0;
    for (var i = 0; i < 35; i++) {
      var d = addDays(start, i), ds = iso(d), sh = shiftOf(ds), n = apptsOn(ds).filter(active).length;
      var wk = Math.floor((d - addDays(start, -((start.getDay() + 6) % 7))) / 6048e5);
      if (wk !== lastWeek) { out += '<div class="week-sep">Týden od ' + fmtD(iso(addDays(d, -((d.getDay() + 6) % 7)))) + '</div>'; lastWeek = wk; }
      if (sh.on) { days++; hours += (mins(sh.to) - mins(sh.from)) / 60; }
      out += '<div class="shift' + (sh.on ? '' : ' off') + '"><span class="dt">' + d.getDate() + '. ' + (d.getMonth() + 1) + '.<small>' + DN[d.getDay()] + (n ? ' · ' + n + '×' : '') + '</small></span>' +
        '<span class="tm">' + (sh.on ? '<input type="time" step="900" value="' + sh.from + '" data-shift="' + ds + '" data-k="from" aria-label="Začátek ' + ds + '"><span class="muted">–</span><input type="time" step="900" value="' + sh.to + '" data-shift="' + ds + '" data-k="to" aria-label="Konec ' + ds + '">' : '<span class="muted small">Volno' + (n ? ' – pozor, ' + n + ' termín(y)!' : '') + '</span>') + '</span>' +
        '<label class="switch" aria-label="Pracuji ' + ds + '"><input type="checkbox" data-shift="' + ds + '" data-k="on"' + (sh.on ? ' checked' : '') + '><span></span></label></div>';
    }
    return '<div class="card"><div class="row"><div class="grow"><b>Plán na 5 týdnů dopředu</b><div class="small muted">Od ' + fmtDL(ui.shiftFrom) + ' · ' + days + ' pracovních dní · ' + Math.round(hours) + ' h</div></div></div>' +
      '<div class="row" style="margin-top:12px"><button class="btn sm g" data-act="shiftNav" data-v="-7">' + I.l + ' Týden</button><button class="btn sm g" data-act="shiftNav" data-v="0">Dnes</button><button class="btn sm g" data-act="shiftNav" data-v="7">Týden ' + I.r + '</button></div></div>' +
      '<div class="h2">Rychlé nastavení</div>' +
      '<div class="card"><p class="small muted" style="margin:0 0 10px">Vyplní celý zobrazený měsíc podle vzoru. Ručně upravené dny se přepíšou.</p>' +
      '<div class="chips" id="wd">' + [1, 2, 3, 4, 5, 6, 0].map(function (x) { return '<button type="button" class="chip" data-act="wd" data-v="' + x + '" aria-pressed="' + (db.settings.workDays.indexOf(x) > -1) + '">' + DN[x] + '</button>'; }).join('') + '</div>' +
      '<div class="two" style="margin-top:10px"><div class="field"><label for="tf">Od</label><input id="tf" type="time" step="900" value="' + db.settings.defFrom + '"></div><div class="field"><label for="tt">Do</label><input id="tt" type="time" step="900" value="' + db.settings.defTo + '"></div></div>' +
      '<div class="actions two"><button class="btn p block" data-act="fillMonth">Vyplnit 5 týdnů</button><button class="btn block" data-act="copyWeek">Kopírovat 1. týden dál</button></div></div>' +
      '<div class="h2">Dny</div>' + out;
  }
  function editShiftSheet(ds) {
    var sh = shiftOf(ds);
    openSheet('<h2>Směna ' + fmtD(ds) + '<button class="close" data-act="close" aria-label="Zavřít">×</button></h2>' +
      '<div class="row" style="justify-content:space-between;margin-bottom:12px"><b>Pracuji</b><label class="switch"><input type="checkbox" id="es-on"' + (sh.on ? ' checked' : '') + '><span></span></label></div>' +
      '<div class="two"><div class="field"><label for="es-f">Od</label><input id="es-f" type="time" step="900" value="' + sh.from + '"></div><div class="field"><label for="es-t">Do</label><input id="es-t" type="time" step="900" value="' + sh.to + '"></div></div>' +
      '<div class="actions"><button class="btn p block" data-act="saveShift" data-v="' + ds + '">Uložit</button></div>');
  }

  /* ---------- Klienti ---------- */
  function clientStats(c) {
    var list = db.appts.filter(function (a) { return a.clientId === c.id; });
    var done = list.filter(function (a) { return a.status === 'hotovo'; });
    var spent = done.reduce(function (s, a) { return s + (+a.price || 0); }, 0);
    var last = done.map(function (a) { return a.date; }).sort().pop();
    var next = list.filter(function (a) { return active(a) && a.status !== 'hotovo' && a.date >= iso(today()); }).map(function (a) { return a.date + ' ' + a.time; }).sort()[0];
    return { list: list, visits: done.length, spent: spent, last: last, next: next, noshow: list.filter(function (a) { return a.status === 'neprisel'; }).length };
  }
  function clientsView() {
    var q = ui.q.toLowerCase();
    var list = db.clients.filter(function (c) { return !q || (c.name + ' ' + c.tel + ' ' + c.email).toLowerCase().indexOf(q) > -1; })
      .sort(function (a, b) { return a.name.localeCompare(b.name, 'cs'); });
    var total = db.appts.filter(function (a) { return a.status === 'hotovo'; }), m = iso(today()).slice(0, 7);
    var monthSum = total.filter(function (a) { return a.date.slice(0, 7) === m; }).reduce(function (s, a) { return s + (+a.price || 0); }, 0);
    return '<div class="stats"><div class="stat"><b>' + db.clients.length + '</b><span>Klientů</span></div><div class="stat"><b>' + total.filter(function (a) { return a.date.slice(0, 7) === m; }).length + '</b><span>Ošetření / měsíc</span></div><div class="stat"><b>' + kc(monthSum).replace(' Kč', '') + '</b><span>Kč / měsíc</span></div></div>' +
      '<input class="search" id="q" type="search" placeholder="Hledat jméno, telefon, e-mail…" aria-label="Hledat klienta">' +
      (list.length ? list.map(function (c) {
        var s = clientStats(c);
        return '<button type="button" class="client" data-act="client" data-v="' + c.id + '"><span class="av">' + initials(c.name) + '</span><span class="grow"><b>' + esc(c.name) + '</b><span class="small muted">' + esc(c.tel || '') + ' · ' + s.visits + '× · ' + (s.next ? 'příště ' + fmtD(s.next.slice(0, 10)) : s.last ? 'naposledy ' + fmtD(s.last) : 'nový') + '</span></span>' + I.r + '</button>';
      }).join('') : '<div class="empty">' + (q ? 'Nikdo neodpovídá hledání.' : 'Zatím žádní klienti. Přidají se samy s prvním termínem, nebo klepni na +.') + '</div>');
  }
  function clientDetail() {
    var c = client(ui.clientId); if (!c) { ui.clientId = null; return clientsView(); }
    var s = clientStats(c);
    var hist = s.list.slice().sort(function (a, b) { return (b.date + b.time).localeCompare(a.date + a.time); });
    return '<button class="btn sm g" data-act="back">' + I.l + ' Klienti</button>' +
      '<div class="row" style="margin:16px 0 4px;gap:14px"><span class="av" style="width:56px;height:56px;font-size:18px">' + initials(c.name) + '</span><div class="grow"><div style="font:600 22px/1.1 var(--d);letter-spacing:.04em">' + esc(c.name) + '</div><div class="small muted">Klientem od ' + fmtCZ(c.created || iso(today())) + '</div></div></div>' +
      '<div class="stats"><div class="stat"><b>' + s.visits + '</b><span>Návštěv</span></div><div class="stat"><b>' + kc(s.spent).replace(' Kč', '') + '</b><span>Kč celkem</span></div><div class="stat"><b>' + s.noshow + '</b><span>Nepřišel</span></div></div>' +
      '<div class="actions two">' + (c.tel ? '<a class="btn block" href="tel:' + esc(c.tel.replace(/\s/g, '')) + '">Zavolat</a>' : '<span></span>') + '<button class="btn p block" data-act="newApptFor" data-v="' + c.id + '">Nový termín</button></div>' +
      '<div class="h2">Kontakt</div><div class="card small">' +
      '<div>Telefon: ' + (c.tel ? esc(c.tel) : '<span class="muted">—</span>') + '</div><div>E-mail: ' + (c.email ? '<a href="mailto:' + esc(c.email) + '">' + esc(c.email) + '</a>' : '<span class="muted">—</span>') + '</div><div>Adresa (pro fakturu): ' + (c.addr ? esc(c.addr) : '<span class="muted">—</span>') + '</div></div>' +
      '<div class="h2">Poznámky (zdraví, preference)</div><div class="card small" style="white-space:pre-line">' + (c.note ? esc(c.note) : '<span class="muted">Bez poznámky</span>') + '</div>' +
      '<div class="actions two"><button class="btn g block" data-act="editClient" data-v="' + c.id + '">Upravit</button><button class="btn g block" data-act="invForClient" data-v="' + c.id + '">Faktura</button></div>' +
      '<div class="h2">Historie</div>' + (hist.length ? hist.map(function (a) { return '<div class="hist"><span>' + fmtD(a.date) + ' ' + a.time + '<br><span class="muted">' + esc(a.service) + '</span></span><span style="text-align:right">' + kc(a.price || 0) + '<br><span class="badge st-' + a.status + '">' + STATUS[a.status] + '</span></span></div>'; }).join('') : '<div class="empty">Zatím žádné návštěvy.</div>');
  }
  function clientForm(c) {
    var isNew = !c; c = c || { id: uid(), name: '', tel: '', email: '', addr: '', note: '', created: iso(today()) };
    openSheet('<h2>' + (isNew ? 'Nový klient' : 'Upravit klienta') + '<button class="close" data-act="close" aria-label="Zavřít">×</button></h2><form id="cf">' +
      '<div class="field"><label for="c-n">Jméno a příjmení</label><input id="c-n" value="' + esc(c.name) + '" required autocomplete="off"></div>' +
      '<div class="two"><div class="field"><label for="c-t">Telefon</label><input id="c-t" type="tel" inputmode="tel" value="' + esc(c.tel) + '"></div><div class="field"><label for="c-e">E-mail</label><input id="c-e" type="email" inputmode="email" value="' + esc(c.email) + '"></div></div>' +
      '<div class="field"><label for="c-a">Adresa (pro fakturu)</label><input id="c-a" value="' + esc(c.addr) + '"></div>' +
      '<div class="field"><label for="c-no">Poznámky – zdraví, alergie, preference</label><textarea id="c-no">' + esc(c.note) + '</textarea></div>' +
      '<p class="small muted">Zdravotní údaje ukládej jen se souhlasem klienta.</p>' +
      '<div class="actions"><button class="btn p block" type="submit">Uložit</button>' + (isNew ? '' : '<button class="btn danger block" type="button" data-act="delClient" data-v="' + c.id + '">Smazat klienta</button>') + '</div></form>');
    document.getElementById('cf').addEventListener('submit', function (e) {
      e.preventDefault();
      var n = document.getElementById('c-n').value.trim(); if (!n) return;
      Object.assign(c, { name: n, tel: document.getElementById('c-t').value.trim(), email: document.getElementById('c-e').value.trim(), addr: document.getElementById('c-a').value.trim(), note: document.getElementById('c-no').value.trim() });
      if (isNew) db.clients.push(c);
      save(); closeSheet(); ui.tab = 'cli'; ui.clientId = c.id; render(); toast('Uloženo');
    });
  }


  /* ---------- Přehled financí ---------- */
  function fin() {
    var f = db.settings.finance || (db.settings.finance = {});
    if (!f.fixed) f.fixed = [{ name: 'Nájem', amount: 0 }, { name: 'Energie a voda', amount: 0 }, { name: 'Sociální a zdravotní pojištění', amount: 0 }, { name: 'Telefon a internet', amount: 0 }];
    if (!f.months) f.months = {};
    if (f.goal == null) f.goal = 40000;
    return f;
  }
  function monthOf(ym) { var f = fin(); return f.months[ym] || (f.months[ym] = { items: [], hours: null, extra: 0 }); }
  function ymShift(ym, n) { var y = +ym.slice(0, 4), m = +ym.slice(5, 7) - 1 + n; var d = new Date(y, m, 1); return d.getFullYear() + '-' + pad(d.getMonth() + 1); }
  function ymLabel(ym) { return MN[+ym.slice(5, 7) - 1] + ' ' + ym.slice(0, 4); }
  function monthStats(ym) {
    var f = fin(), mo = f.months[ym] || { items: [], hours: null, extra: 0 };
    var done = db.appts.filter(function (a) { return a.date.slice(0, 7) === ym && a.status === 'hotovo'; });
    var planned = db.appts.filter(function (a) { return a.date.slice(0, 7) === ym && (a.status === 'potvrzeno' || a.status === 'ceka') && a.date >= iso(today()); });
    var revenue = done.reduce(function (s, a) { return s + (+a.price || 0); }, 0) + (+mo.extra || 0);
    var forecast = planned.reduce(function (s, a) { return s + (+a.price || 0); }, 0);
    var fixed = f.fixed.reduce(function (s, x) { return s + (+x.amount || 0); }, 0);
    var variable = mo.items.reduce(function (s, x) { return s + (+x.amount || 0); }, 0);
    var costs = fixed + variable;
    // odpracované hodiny: ručně, jinak ze směn (do dneška)
    var shiftH = 0, y = +ym.slice(0, 4), m = +ym.slice(5, 7) - 1, last = new Date(y, m + 1, 0).getDate();
    for (var d = 1; d <= last; d++) { var ds = ym + '-' + pad(d); if (ds > iso(today())) break; var sh = shiftOf(ds); if (sh.on && !sh.auto) shiftH += (mins(sh.to) - mins(sh.from)) / 60; }
    var clientH = done.reduce(function (s, a) { return s + (+a.dur || 60); }, 0) / 60;
    var hours = mo.hours != null && mo.hours !== '' ? +mo.hours : (shiftH || clientH);
    var profit = revenue - costs;
    var days = {}; done.forEach(function (a) { days[a.date] = (days[a.date] || 0) + (+a.price || 0); });
    var best = Object.keys(days).sort(function (a, b) { return days[b] - days[a]; })[0];
    return { done: done, planned: planned, revenue: revenue, forecast: forecast, fixed: fixed, variable: variable, costs: costs, hours: hours, shiftH: shiftH, clientH: clientH,
      manualH: mo.hours != null && mo.hours !== '', profit: profit, hourly: hours > 0 ? profit / hours : 0, avg: done.length ? (revenue - (+mo.extra || 0)) / done.length : avgPrice(), best: best, bestSum: best ? days[best] : 0, mo: mo };
  }
  function avgPrice() { var p = db.settings.services.slice(0, 4).map(function (x) { return +x.price || 0; }); return p.length ? p.reduce(function (a, b) { return a + b; }, 0) / p.length : 800; }
  function mood(st, goal) {
    var need = Math.max(0, Math.ceil(-st.profit / (st.avg || 1)));
    if (goal && st.revenue >= goal) return ['Cíl splněn!', 'Tenhle měsíc máš ' + kc(st.revenue) + '. Klobouk dolů – nohy Hradce jsou v dobrých rukou.'];
    if (st.profit > 0 && st.hourly >= 300) return ['Jedeš skvěle', 'Jsi v plusu ' + kc(st.profit) + ' a vyděláváš ' + kc(st.hourly) + ' za hodinu. Takhle dál.'];
    if (st.profit > 0) return ['Jsi v plusu', 'Po zaplacení všech nákladů ti zůstává ' + kc(st.profit) + '. Každý další klient jde čistě do zisku.'];
    if (st.revenue === 0 && st.costs === 0) return ['Nový měsíc, nové paty', 'Zatím tu nic není. Označ hotové termíny a zapiš náklady – přehled se spočítá sám.'];
    return ['Zatím pod nulou', 'Na pokrytí nákladů chybí ' + kc(-st.profit) + ' – to je zhruba ' + need + ' ' + (need === 1 ? 'ošetření' : need < 5 ? 'ošetření' : 'ošetření') + '. Dáš to!'];
  }
  function finView() {
    var ym = ui.finMonth, f = fin(), st = monthStats(ym), goal = +f.goal || 0;
    var md = mood(st, goal), pct = goal ? Math.min(100, Math.round(st.revenue / goal * 100)) : 0;
    var toGoal = Math.max(0, goal - st.revenue), toGoalN = Math.ceil(toGoal / (st.avg || 1));
    var prev = monthStats(ymShift(ym, -1)), diff = st.revenue - prev.revenue;
    var hist = [], maxV = 1;
    for (var i = 5; i >= 0; i--) { var k = ymShift(ym, -i), s2 = monthStats(k); hist.push([k, s2.revenue, s2.costs]); maxV = Math.max(maxV, s2.revenue, s2.costs); }
    var pos = st.profit >= 0;
    return '<div class="cal-head"><button class="btn icon g" data-act="finMonth" data-v="-1" aria-label="Předchozí měsíc">' + I.l + '</button><h2>' + ymLabel(ym) + '</h2><button class="btn icon g" data-act="finMonth" data-v="1" aria-label="Další měsíc">' + I.r + '</button></div>' +
      '<div class="hero-fin ' + (pos ? 'pos' : 'neg') + '"><div class="k">' + (pos ? 'Zisk' : 'Ztráta') + ' za měsíc</div><div class="big">' + (pos ? '+' : '−') + kc(Math.abs(st.profit)) + '</div>' +
      '<div class="mood"><b>' + md[0] + '</b><span>' + esc(md[1]) + '</span></div></div>' +
      '<div class="stats" style="grid-template-columns:repeat(2,1fr)">' +
      '<div class="stat"><b>' + kc(st.revenue).replace(' Kč', '') + '</b><span>Kč tržby</span></div>' +
      '<div class="stat"><b>' + kc(st.costs).replace(' Kč', '') + '</b><span>Kč náklady</span></div>' +
      '<div class="stat"><b>' + kc(st.hourly).replace(' Kč', '') + '</b><span>Kč / hodinu</span></div>' +
      '<div class="stat"><b>' + st.done.length + '</b><span>ošetření</span></div></div>' +
      '<div class="card"><div class="row" style="justify-content:space-between"><b>Měsíční cíl tržeb</b><span class="small muted">' + pct + ' %</span></div>' +
      '<div class="bar"><i style="width:' + pct + '%"></i></div>' +
      '<div class="small muted">' + (toGoal ? 'Do cíle ' + kc(goal) + ' chybí ' + kc(toGoal) + ' ≈ ' + toGoalN + '× ošetření' + (st.forecast ? ' · v kalendáři máš ještě ' + kc(st.forecast) : '') : 'Cíl ' + kc(goal) + ' je splněný. Zkus ho příště zvednout?') + '</div></div>' +
      '<div class="small muted" style="margin:10px 2px">' + (prev.revenue || diff ? (diff >= 0 ? '▲ o ' + kc(diff) + ' víc' : '▼ o ' + kc(-diff) + ' míň') + ' než ' + ymLabel(ymShift(ym, -1)) : '') + (st.best ? ' · nejlepší den ' + fmtD(st.best) + ' (' + kc(st.bestSum) + ')' : '') + ' · průměr na klienta ' + kc(st.avg) + '</div>' +
      '<div class="h2">Posledních 6 měsíců</div><div class="card"><div class="chart">' + hist.map(function (h) {
        return '<div class="col"><div class="bars"><i class="rv" style="height:' + Math.round(h[1] / maxV * 100) + '%" title="Tržby ' + kc(h[1]) + '"></i><i class="cs" style="height:' + Math.round(h[2] / maxV * 100) + '%" title="Náklady ' + kc(h[2]) + '"></i></div><span' + (h[0] === ym ? ' class="on"' : '') + '>' + MN[+h[0].slice(5, 7) - 1].slice(0, 3) + '</span></div>';
      }).join('') + '</div><div class="legend"><span><i style="background:var(--br)"></i>Tržby</span><span><i style="background:var(--red)"></i>Náklady</span></div></div>' +
      '<div class="h2">Kalkulačka měsíce</div>' +
      '<div class="card"><div class="calc-sec">Příjmy</div>' +
      '<div class="calc-row"><span>Hotová ošetření (' + st.done.length + '×)</span><b>' + kc(st.revenue - (+st.mo.extra || 0)) + '</b></div>' +
      '<div class="calc-row"><label for="f-extra">Další příjmy (poukazy, prodej)</label><input id="f-extra" type="number" inputmode="numeric" value="' + (+st.mo.extra || '') + '" placeholder="0" data-fin="extra"></div>' +
      '<div class="calc-sec">Pevné náklady <small>každý měsíc</small></div>' +
      f.fixed.map(function (x, k) { return '<div class="calc-row"><input class="nm" value="' + esc(x.name) + '" data-fix="' + k + '" data-f="name" aria-label="Název nákladu"><input type="number" inputmode="numeric" value="' + (+x.amount || '') + '" placeholder="0" data-fix="' + k + '" data-f="amount" aria-label="Částka"><button class="btn icon g sm" data-act="rmFix" data-v="' + k + '" aria-label="Odebrat">×</button></div>'; }).join('') +
      '<button class="btn sm g" data-act="addFix">+ Pevný náklad</button>' +
      '<div class="calc-sec">Náklady v tomto měsíci <small>materiál, nákupy</small></div>' +
      st.mo.items.map(function (x, k) { return '<div class="calc-row"><input class="nm" value="' + esc(x.name) + '" data-var="' + k + '" data-f="name" aria-label="Název nákladu"><input type="number" inputmode="numeric" value="' + (+x.amount || '') + '" placeholder="0" data-var="' + k + '" data-f="amount" aria-label="Částka"><button class="btn icon g sm" data-act="rmVar" data-v="' + k + '" aria-label="Odebrat">×</button></div>'; }).join('') +
      '<div class="row"><button class="btn sm g" data-act="addVar" data-v="Materiál">+ Materiál</button><button class="btn sm g" data-act="addVar" data-v="">+ Jiný náklad</button></div>' +
      '<div class="calc-sec">Čas</div>' +
      '<div class="calc-row"><label for="f-hours">Odpracované hodiny</label><input id="f-hours" type="number" inputmode="decimal" step="0.5" value="' + (st.manualH ? st.mo.hours : '') + '" placeholder="' + Math.round(st.hours * 10) / 10 + '" data-fin="hours"></div>' +
      '<div class="small muted" style="margin:-4px 0 6px">' + (st.manualH ? 'Zadáno ručně.' : 'Spočítáno ' + (st.shiftH ? 'ze směn do dneška' : 'z délky hotových ošetření') + ' – můžeš přepsat.') + ' S klienty: ' + Math.round(st.clientH * 10) / 10 + ' h.</div>' +
      '<div class="calc-sec">Cíl</div>' +
      '<div class="calc-row"><label for="f-goal">Měsíční cíl tržeb (Kč)</label><input id="f-goal" type="number" inputmode="numeric" step="1000" value="' + goal + '" data-fin="goal"></div>' +
      '<div class="calc-total ' + (pos ? 'pos' : 'neg') + '"><span>Příjmy ' + kc(st.revenue) + ' − náklady ' + kc(st.costs) + '</span><b>' + (pos ? '+' : '−') + kc(Math.abs(st.profit)) + '</b></div>' +
      '<div class="small muted" style="margin-top:6px">Hodinovka = zisk ÷ odpracované hodiny = ' + kc(st.hourly) + '/h. Na pokrytí nákladů potřebuješ ' + Math.ceil(st.costs / (st.avg || 1)) + ' ošetření měsíčně.</div>' +
      '<p class="small muted">Orientační výpočet bez daní. Přesné číslo ti řekne účetní.</p></div>';
  }

  /* ---------- Faktury ---------- */
  function invView() {
    var list = db.invoices.slice().sort(function (a, b) { return b.no.localeCompare(a.no); });
    var y = String(today().getFullYear()), sum = list.filter(function (i) { return i.date.slice(0, 4) === y; }).reduce(function (s, i) { return s + invTotal(i); }, 0);
    return '<div class="stats" style="grid-template-columns:1fr 1fr"><div class="stat"><b>' + list.length + '</b><span>Faktur</span></div><div class="stat"><b>' + kc(sum).replace(' Kč', '') + '</b><span>Kč v roce ' + y + '</span></div></div>' +
      '<button class="btn p block" data-act="newInv">Nová faktura</button>' +
      '<p class="small muted">Fakturu vytvoříš i přímo z termínu nebo z karty klienta. Uložíš ji jako PDF přes „Tisk / PDF“.</p>' +
      '<div class="h2">Vystavené</div>' +
      (list.length ? list.map(function (i) { var c = client(i.clientId); return '<button type="button" class="client" data-act="inv" data-v="' + i.id + '"><span class="av" style="border-radius:0">' + I.inv.replace('<svg', '<svg width="20" height="20"') + '</span><span class="grow"><b>' + esc(i.no) + ' · ' + esc(c ? c.name : i.clientName || '—') + '</b><span class="small muted">' + fmtCZ(i.date) + ' · ' + kc(invTotal(i)) + ' · ' + esc(i.pay) + '</span></span>' + I.r + '</button>'; }).join('') : '<div class="empty">Zatím žádné faktury.</div>');
  }
  function invTotal(i) { return i.items.reduce(function (s, x) { return s + (+x.qty || 0) * (+x.price || 0); }, 0); }
  function nextNo() { var y = today().getFullYear(); return db.settings.prefix + y + String(db.settings.nextNo).padStart(3, '0'); }
  function invForm(inv) {
    var isNew = !inv.no;
    if (isNew) { inv.no = nextNo(); inv.date = iso(today()); inv.due = iso(addDays(today(), +db.settings.dueDays || 14)); inv.pay = inv.pay || 'hotově'; }
    function itemRow(x, k) { return '<div class="inv-item" data-i="' + k + '"><input aria-label="Položka" value="' + esc(x.name) + '" data-f="name"><input aria-label="Počet" type="number" inputmode="decimal" value="' + x.qty + '" data-f="qty"><input aria-label="Cena za kus" type="number" inputmode="numeric" value="' + x.price + '" data-f="price"><button type="button" class="btn icon g" data-act="rmItem" data-v="' + k + '" aria-label="Odebrat" style="width:40px;min-height:44px">×</button></div>'; }
    openSheet('<h2>' + (isNew ? 'Nová faktura' : 'Faktura ' + esc(inv.no)) + '<button class="close" data-act="close" aria-label="Zavřít">×</button></h2><form id="if">' +
      '<div class="field"><label for="i-c">Odběratel</label><select id="i-c">' + db.clients.slice().sort(function (a, b) { return a.name.localeCompare(b.name, 'cs'); }).map(function (c) { return '<option value="' + c.id + '"' + (c.id === inv.clientId ? ' selected' : '') + '>' + esc(c.name) + '</option>'; }).join('') + '</select></div>' +
      '<div class="field"><label for="i-ad">Adresa odběratele (nepovinné)</label><input id="i-ad" value="' + esc(inv.clientAddr != null ? inv.clientAddr : (client(inv.clientId) || {}).addr || '') + '"></div>' +
      '<div class="two"><div class="field"><label for="i-no">Číslo</label><input id="i-no" value="' + esc(inv.no) + '"></div><div class="field"><label for="i-pay">Úhrada</label><select id="i-pay">' + ['hotově', 'kartou', 'převodem'].map(function (p) { return '<option' + (inv.pay === p ? ' selected' : '') + '>' + p + '</option>'; }).join('') + '</select></div></div>' +
      '<div class="two"><div class="field"><label for="i-d">Vystaveno</label><input id="i-d" type="date" value="' + inv.date + '"></div><div class="field"><label for="i-du">Splatnost</label><input id="i-du" type="date" value="' + inv.due + '"></div></div>' +
      '<div class="field"><label>Položky (název · ks · cena/ks)</label><div id="items">' + inv.items.map(itemRow).join('') + '</div></div>' +
      '<button type="button" class="btn sm g" data-act="addItem">+ Položka</button>' +
      '<div style="text-align:right;font:600 22px/1 var(--d);margin-top:12px" id="i-tot">' + kc(invTotal(inv)) + '</div>' +
      '<div class="actions"><button class="btn p block" type="submit">Uložit a zobrazit</button>' + (isNew ? '' : '<button class="btn danger block" type="button" data-act="delInv" data-v="' + inv.id + '">Smazat fakturu</button>') + '</div></form>');
    var f = document.getElementById('if');
    function readItems() { inv.items = [].map.call(f.querySelectorAll('.inv-item'), function (r) { return { name: r.querySelector('[data-f=name]').value, qty: +r.querySelector('[data-f=qty]').value || 0, price: +r.querySelector('[data-f=price]').value || 0 }; }); f.querySelector('#i-tot').textContent = kc(invTotal(inv)); }
    f.addEventListener('input', function (e) { if (e.target.closest('.inv-item')) readItems(); });
    f.querySelector('#i-c').addEventListener('change', function () { var c = client(this.value); f.querySelector('#i-ad').value = c ? c.addr || '' : ''; });
    f.addEventListener('click', function (e) {
      var b = e.target.closest('[data-act]'); if (!b) return;
      if (b.dataset.act === 'addItem') { readItems(); inv.items.push({ name: '', qty: 1, price: 0 }); f.querySelector('#items').insertAdjacentHTML('beforeend', itemRow(inv.items[inv.items.length - 1], inv.items.length - 1)); e.stopPropagation(); }
      if (b.dataset.act === 'rmItem') { b.closest('.inv-item').remove(); readItems(); e.stopPropagation(); }
    });
    f.addEventListener('submit', function (e) {
      e.preventDefault(); readItems();
      if (!f.querySelector('#i-c').value) { toast('Nejdřív přidej klienta'); return; }
      if (!inv.items.length) { toast('Přidej aspoň jednu položku'); return; }
      Object.assign(inv, { clientId: f.querySelector('#i-c').value, clientAddr: f.querySelector('#i-ad').value.trim(), no: f.querySelector('#i-no').value.trim(), pay: f.querySelector('#i-pay').value, date: f.querySelector('#i-d').value, due: f.querySelector('#i-du').value });
      if (isNew) { inv.id = uid(); db.invoices.push(inv); db.settings.nextNo++; }
      save(); closeSheet(); ui.tab = 'inv'; render(); invPreview(inv);
    });
  }
  function invHtml(i) {
    var c = client(i.clientId) || {}, s = db.settings;
    return '<div class="inv"><div class="hd"><div><div class="brand">MR. PEDIKER</div><div style="font-style:italic;color:#7E5B1E">Pedikúra by Míra</div></div><div style="text-align:right"><h1>FAKTURA</h1><div>č. ' + esc(i.no) + '</div></div></div>' +
      '<div class="grid"><div><h4>Dodavatel</h4><b>' + esc(s.name) + '</b><br>' + esc(s.addr) + '<br>IČO: ' + esc(s.ico) + '<br>Neplátce DPH<br>' + esc(s.tel) + ' · ' + esc(s.email) + '</div>' +
      '<div><h4>Odběratel</h4><b>' + esc(c.name || '') + '</b><br>' + esc(i.clientAddr || '') + (c.email ? '<br>' + esc(c.email) : '') + (c.tel ? '<br>' + esc(c.tel) : '') + '</div></div>' +
      '<div class="grid"><div><h4>Datum vystavení</h4>' + fmtCZ(i.date) + '<h4 style="margin-top:10px">Datum splatnosti</h4>' + fmtCZ(i.due) + '</div><div><h4>Způsob úhrady</h4>' + esc(i.pay) + (i.pay === 'převodem' && s.bank ? '<h4 style="margin-top:10px">Bankovní účet</h4>' + esc(s.bank) + '<br>Variabilní symbol: ' + esc(i.no.replace(/\D/g, '')) : '') + '</div></div>' +
      '<table><thead><tr><th>Položka</th><th class="r">Počet</th><th class="r">Cena/ks</th><th class="r">Celkem</th></tr></thead><tbody>' +
      i.items.map(function (x) { return '<tr><td>' + esc(x.name) + '</td><td class="r">' + x.qty + '</td><td class="r">' + kc(x.price) + '</td><td class="r">' + kc(x.qty * x.price) + '</td></tr>'; }).join('') +
      '</tbody></table><div class="tot">Celkem k úhradě: ' + kc(invTotal(i)) + '</div>' +
      '<div class="ft">Dodavatel není plátcem DPH. Fyzická osoba zapsaná v živnostenském rejstříku.' + (i.pay !== 'převodem' ? '<br>Uhrazeno ' + esc(i.pay) + ' dne ' + fmtCZ(i.date) + '.' : '') + '</div></div>';
  }
  function invPreview(i) {
    openSheet('<h2>Faktura ' + esc(i.no) + '<button class="close" data-act="close" aria-label="Zavřít">×</button></h2>' +
      '<div style="background:#fff;overflow:auto;max-height:52vh;border:1px solid var(--hair)"><div style="transform-origin:top left">' + invHtml(i) + '</div></div>' +
      '<div class="actions"><button class="btn p block" data-act="printInv" data-v="' + i.id + '">Tisk / uložit PDF</button>' +
      '<div class="actions two" style="margin:0"><button class="btn block" data-act="editInv" data-v="' + i.id + '">Upravit</button>' + mailInv(i) + '</div></div>');
  }
  function mailInv(i) {
    var c = client(i.clientId); if (!c || !c.email) return '<span></span>';
    var body = 'Dobrý den,\n\nv příloze posílám fakturu č. ' + i.no + ' na částku ' + kc(invTotal(i)) + '.\n\nDěkuji a těším se příště,\nMiroslav Hořčica – Mr. Pediker\n' + db.settings.tel;
    return '<a class="btn block" href="mailto:' + esc(c.email) + '?subject=' + encodeURIComponent('Faktura ' + i.no + ' – Mr. Pediker') + '&body=' + encodeURIComponent(body) + '">E-mail</a>';
  }
  function invFromAppts(cid, appts) {
    return { clientId: cid, items: appts.map(function (a) { return { name: a.service + ' (' + fmtCZ(a.date) + ')', qty: 1, price: +a.price || 0 }; }), apptIds: appts.map(function (a) { return a.id; }) };
  }

  /* ---------- Nastavení ---------- */
  function setView() {
    var s = db.settings;
    return '<div class="h2">Aplikace</div>' + installCard(true) + '<div class="h2">Údaje na fakturu</div><div class="card"><form id="sf">' +
      '<div class="field"><label for="s-n">Jméno</label><input id="s-n" value="' + esc(s.name) + '"></div>' +
      '<div class="two"><div class="field"><label for="s-i">IČO</label><input id="s-i" inputmode="numeric" value="' + esc(s.ico) + '"></div><div class="field"><label for="s-t">Telefon</label><input id="s-t" value="' + esc(s.tel) + '"></div></div>' +
      '<div class="field"><label for="s-a">Adresa</label><input id="s-a" value="' + esc(s.addr) + '"></div>' +
      '<div class="field"><label for="s-e">E-mail</label><input id="s-e" value="' + esc(s.email) + '"></div>' +
      '<div class="field"><label for="s-b">Bankovní účet (pro platbu převodem)</label><input id="s-b" value="' + esc(s.bank) + '" placeholder="123456789/0100"></div>' +
      '<div class="two"><div class="field"><label for="s-p">Prefix čísla faktury</label><input id="s-p" value="' + esc(s.prefix) + '"></div><div class="field"><label for="s-nn">Další pořadové číslo</label><input id="s-nn" type="number" value="' + s.nextNo + '"></div></div>' +
      '<div class="field"><label for="s-d">Splatnost (dní)</label><input id="s-d" type="number" value="' + s.dueDays + '"></div>' +
      '<button class="btn p block" type="submit">Uložit údaje</button></form></div>' +
      '<div class="h2">Ceník služeb</div><div class="card">' + s.services.map(function (x, k) { return '<div class="inv-item" style="grid-template-columns:1fr 80px 60px 40px" data-svc="' + k + '"><input value="' + esc(x.name) + '" data-f="name" aria-label="Služba"><input type="number" value="' + x.price + '" data-f="price" aria-label="Cena"><input type="number" value="' + x.dur + '" data-f="dur" aria-label="Minut"><button class="btn icon g" style="width:40px;min-height:44px" data-act="rmSvc" data-v="' + k + '" aria-label="Odebrat">×</button></div>'; }).join('') +
      '<div class="small muted" style="margin:4px 0 10px">Název · cena Kč · délka min (podle délky se počítají volné časy v online rezervaci)</div>' +
      '<div class="field" style="margin-top:8px"><label for="s-buf">Přestávka mezi klienty (min)</label><input id="s-buf" type="number" inputmode="numeric" min="0" max="60" step="5" value="' + (s.buffer == null ? 15 : s.buffer) + '"></div><div class="actions two"><button class="btn g block" data-act="addSvc">+ Služba</button><button class="btn p block" data-act="saveSvc">Uložit ceník</button></div></div>' +
      '<div class="h2">Přihlášení</div><div class="card"><form id="pf">' +
      (CLOUD ? '<p class="small muted" style="margin-top:0">Přihlášen jako <b>' + esc(MPDB.user || '') + '</b></p><input id="p-u" type="hidden" value="x">' : '<div class="field"><label for="p-u">Uživatel</label><input id="p-u" value="' + esc(s.user) + '" autocomplete="username" autocapitalize="none"></div>') +
      '<div class="field"><label for="p-n">Nové heslo</label><input id="p-n" type="password" autocomplete="new-password" minlength="6"></div>' +
      '<button class="btn block" type="submit">Změnit heslo</button></form></div>' +
      '<div class="h2">Záloha dat</div><div class="card"><p class="small muted" style="margin-top:0">' + (CLOUD ? 'Data se ukládají do databáze a jsou stejná na všech zařízeních. Bezplatná databáze nedělá automatické zálohy – jednou za měsíc si stáhni zálohu.' : 'Všechna data jsou jen v tomto telefonu. Pravidelně si stáhni zálohu (třeba do e-mailu nebo na Disk). Zálohou přeneseš data i do jiného zařízení.') + '</p>' +
      '<div class="actions two"><button class="btn block" data-act="export">Stáhnout zálohu</button><label class="btn block g" style="cursor:pointer">Nahrát zálohu<input type="file" id="imp-file" accept="application/json,.json" hidden></label></div>' +
      '<p class="small muted">Klientů: ' + db.clients.length + ' · termínů: ' + db.appts.length + ' · faktur: ' + db.invoices.length + '</p></div>' +
      '<div class="actions"><button class="btn g block" data-act="logout">Odhlásit</button><button class="btn danger block" data-act="wipe">Smazat všechna data</button></div>';
  }

  /* ---------- Přidat na plochu ---------- */
  var installEvt = null;
  var standalone = (window.matchMedia && matchMedia('(display-mode: standalone)').matches) || navigator.standalone === true;
  var isIOS = /iPad|iPhone|iPod/.test(navigator.userAgent) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
  window.addEventListener('beforeinstallprompt', function (e) { e.preventDefault(); installEvt = e; if (sessionStorage.getItem(SESSION) === '1') render(); });
  window.addEventListener('appinstalled', function () { installEvt = null; standalone = true; toast('Aplikace je na ploše'); render(); });
  if ('serviceWorker' in navigator && location.protocol === 'https:') navigator.serviceWorker.register('sw.js').catch(function () {});
  function installCard(inSettings) {
    if (standalone) return inSettings ? '<div class="card small muted">Administrace je spuštěná z plochy jako aplikace.</div>' : '';
    if (!inSettings && localStorage.getItem('mp_install_hide') === '1') return '';
    return '<div class="card install"><div class="row" style="gap:12px;flex-wrap:nowrap"><img src="icon-192.png" alt="" width="48" height="48" style="flex:none">' +
      '<div class="grow"><b>Přidat admin na plochu</b><div class="small muted">Otevře se jedním klepnutím jako aplikace, bez hledání v prohlížeči.</div></div>' +
      (inSettings ? '' : '<button class="close" data-act="hideInstall" aria-label="Skrýt" style="flex:none">×</button>') + '</div>' +
      '<button class="btn p block" style="margin-top:12px" data-act="install">Přidat na plochu</button></div>';
  }
  function installHelp() {
    var steps = isIOS
      ? '<ol class="steps-ol"><li>Dole v Safari klepni na <b>Sdílet</b> (čtverec se šipkou nahoru).</li><li>Sjeď níž a vyber <b>Přidat na plochu</b>.</li><li>Potvrď <b>Přidat</b> vpravo nahoře.</li></ol><p class="small muted">Funguje jen v Safari. V Chromu na iPhonu klepni na ikonu sdílení v adresním řádku.</p>'
      : '<ol class="steps-ol"><li>Vpravo nahoře v Chromu klepni na <b>⋮</b> (tři tečky).</li><li>Vyber <b>Přidat na plochu</b> nebo <b>Nainstalovat aplikaci</b>.</li><li>Potvrď <b>Přidat</b>.</li></ol>';
    openSheet('<h2>Přidat na plochu<button class="close" data-act="close" aria-label="Zavřít">×</button></h2>' + steps +
      '<p class="small muted">Na ploše se objeví ikona Mr. Pediker. Přihlášení zůstane uložené.</p><div class="actions"><button class="btn p block" data-act="close">Rozumím</button></div>');
  }

  /* ---------- Sheet ---------- */
  function openSheet(html) { $sheet.innerHTML = '<div class="panel" role="dialog" aria-modal="true">' + html + '</div>'; $sheet.hidden = false; document.body.style.overflow = 'hidden'; var f = $sheet.querySelector('input:not([type=hidden]),select,textarea'); if (f && window.innerWidth > 700) f.focus(); }
  function closeSheet() { $sheet.hidden = true; $sheet.innerHTML = ''; document.body.style.overflow = ''; }
  $sheet.addEventListener('click', function (e) { if (e.target === $sheet) closeSheet(); });
  document.addEventListener('keydown', function (e) { if (e.key === 'Escape' && !$sheet.hidden) closeSheet(); });

  /* ---------- Akce ---------- */
  document.addEventListener('click', function (e) {
    var b = e.target.closest('[data-act]'); if (!b) return;
    var v = b.dataset.v, a, c, i;
    switch (b.dataset.act) {
      case 'tab': ui.tab = v; ui.clientId = null; ui.q = ''; render(); window.scrollTo(0, 0); break;
      case 'close': closeSheet(); break;
      case 'month': ui.month = new Date(ui.month.getFullYear(), ui.month.getMonth() + +v, 1); render(); break;
      case 'day': ui.day = v; var d = parse(v); if (d.getMonth() !== ui.month.getMonth()) ui.month = new Date(d.getFullYear(), d.getMonth(), 1); render(); break;
      case 'today': ui.day = iso(today()); ui.month = new Date(today().getFullYear(), today().getMonth(), 1); render(); break;
      case 'pending': a = db.appts.filter(function (x) { return x.status === 'ceka'; }).sort(function (x, y) { return (x.date + x.time).localeCompare(y.date + y.time); })[0]; if (a) { ui.day = a.date; ui.month = new Date(parse(a.date).getFullYear(), parse(a.date).getMonth(), 1); render(); } break;
      case 'newAppt': apptForm({ id: uid(), date: ui.day, time: suggestTime(ui.day), status: 'potvrzeno', dur: (db.settings.services[0] || {}).dur || 80 }, true); break;
      case 'newApptFor': apptForm({ id: uid(), clientId: v, date: iso(addDays(today(), 1)), time: suggestTime(iso(addDays(today(), 1))), status: 'potvrzeno', dur: 60 }, true); break;
      case 'appt': a = db.appts.find(function (x) { return x.id === v; }); if (a) apptForm(a, false); break;
      case 'done': a = db.appts.find(function (x) { return x.id === v; }); a.status = 'hotovo'; save(); closeSheet(); render(); toast('Označeno jako hotovo'); break;
      case 'delAppt': if (confirm('Opravdu smazat termín?')) { db.appts = db.appts.filter(function (x) { return x.id !== v; }); save(); closeSheet(); render(); toast('Termín smazán'); } break;
      case 'invFromAppt': a = db.appts.find(function (x) { return x.id === v; }); closeSheet(); invForm(invFromAppts(a.clientId, [a])); break;
      case 'importSms': importSms(); break;
      case 'retrySync': cloudSync(); break;
      case 'install': if (installEvt) { installEvt.prompt(); installEvt.userChoice.then(function () { installEvt = null; render(); }); } else installHelp(); break;
      case 'hideInstall': localStorage.setItem('mp_install_hide', '1'); render(); break;
      case 'finMonth': ui.finMonth = ymShift(ui.finMonth, +v); render(); break;
      case 'addFix': fin().fixed.push({ name: '', amount: 0 }); save(); render(); break;
      case 'rmFix': fin().fixed.splice(+v, 1); save(); render(); break;
      case 'addVar': monthOf(ui.finMonth).items.push({ name: v || '', amount: 0 }); save(); render(); setTimeout(function () { var l = document.querySelectorAll('[data-var][data-f=amount]'); if (l.length) l[l.length - 1].focus(); }, 30); break;
      case 'rmVar': monthOf(ui.finMonth).items.splice(+v, 1); save(); render(); break;
      case 'doImport': doImport(); break;
      case 'editShift': editShiftSheet(v); break;
      case 'saveShift': db.shifts[v] = { on: document.getElementById('es-on').checked, from: document.getElementById('es-f').value || db.settings.defFrom, to: document.getElementById('es-t').value || db.settings.defTo }; save(); closeSheet(); render(); toast('Směna uložena'); break;
      case 'shiftNav': ui.shiftFrom = +v === 0 ? iso(today()) : iso(addDays(parse(ui.shiftFrom), +v)); render(); break;
      case 'wd': i = +v; var w = db.settings.workDays, k = w.indexOf(i); if (k > -1) w.splice(k, 1); else w.push(i); save(); b.setAttribute('aria-pressed', k === -1); break;
      case 'fillMonth':
        db.settings.defFrom = document.getElementById('tf').value || '08:00'; db.settings.defTo = document.getElementById('tt').value || '19:00';
        for (i = 0; i < 35; i++) { var ds = iso(addDays(parse(ui.shiftFrom), i)); db.shifts[ds] = { on: db.settings.workDays.indexOf(parse(ds).getDay()) > -1, from: db.settings.defFrom, to: db.settings.defTo }; }
        save(); render(); toast('Směny na 5 týdnů vyplněny'); break;
      case 'copyWeek':
        var st = parse(ui.shiftFrom);
        for (i = 7; i < 35; i++) { var src = shiftOf(iso(addDays(st, i % 7))); db.shifts[iso(addDays(st, i))] = { on: src.on, from: src.from, to: src.to }; }
        save(); render(); toast('První týden zkopírován na další 4'); break;
      case 'client': ui.clientId = v; render(); window.scrollTo(0, 0); break;
      case 'back': ui.clientId = null; render(); break;
      case 'newClient': clientForm(null); break;
      case 'editClient': clientForm(client(v)); break;
      case 'delClient':
        if (confirm('Smazat klienta i všechny jeho termíny?')) { db.clients = db.clients.filter(function (x) { return x.id !== v; }); db.appts = db.appts.filter(function (x) { return x.clientId !== v; }); save(); closeSheet(); ui.clientId = null; render(); toast('Klient smazán'); }
        break;
      case 'invForClient':
        var done = db.appts.filter(function (x) { return x.clientId === v && x.status === 'hotovo' && !db.invoices.some(function (iv) { return (iv.apptIds || []).indexOf(x.id) > -1; }); });
        invForm(done.length ? invFromAppts(v, done) : { clientId: v, items: [{ name: 'Pedikúra', qty: 1, price: 690 }] }); break;
      case 'newInv': if (!db.clients.length) { toast('Nejdřív přidej klienta'); break; } invForm({ clientId: db.clients[0].id, items: [{ name: db.settings.services[0].name, qty: 1, price: db.settings.services[0].price }] }); break;
      case 'inv': i = db.invoices.find(function (x) { return x.id === v; }); if (i) invPreview(i); break;
      case 'editInv': i = db.invoices.find(function (x) { return x.id === v; }); closeSheet(); invForm(i); break;
      case 'delInv': if (confirm('Smazat fakturu?')) { db.invoices = db.invoices.filter(function (x) { return x.id !== v; }); save(); closeSheet(); render(); } break;
      case 'printInv': i = db.invoices.find(function (x) { return x.id === v; }); document.getElementById('print').innerHTML = invHtml(i); var t = document.title; document.title = 'Faktura ' + i.no; window.print(); document.title = t; break;
      case 'addSvc': readSvc(); db.settings.services.push({ name: '', price: 0, dur: 30 }); render(); break;
      case 'rmSvc': readSvc(); db.settings.services.splice(+v, 1); save(); render(); break;
      case 'saveSvc': readSvc(); var bf = document.getElementById('s-buf'); if (bf) db.settings.buffer = Math.max(0, Math.min(60, +bf.value || 0)); save(); toast('Ceník a přestávka uloženy'); break;
      case 'export':
        var blob = new Blob([JSON.stringify(db, null, 1)], { type: 'application/json' }), url = URL.createObjectURL(blob), l = document.createElement('a');
        l.href = url; l.download = 'mrpediker-zaloha-' + iso(today()) + '.json'; document.body.appendChild(l); l.click(); l.remove(); setTimeout(function () { URL.revokeObjectURL(url); }, 2000); toast('Záloha stažena'); break;
      case 'logout': sessionStorage.removeItem(SESSION); if (CLOUD) { MPDB.signOut(); last = null; } render(); break;
      case 'wipe': if (confirm('Opravdu smazat VŠECHNA data? Nejde to vrátit.') && confirm('Máš zálohu? Poslední potvrzení.')) { var pw = db.settings.pwHash, u = db.settings.user; localStorage.removeItem(KEY); load(); db.settings.pwHash = pw; db.settings.user = u; save(); render(); toast('Data smazána'); } break;
    }
  });
  function readSvc() {
    [].forEach.call(document.querySelectorAll('[data-svc]'), function (r) {
      var k = +r.dataset.svc; db.settings.services[k] = { name: r.querySelector('[data-f=name]').value.trim(), price: +r.querySelector('[data-f=price]').value || 0, dur: +r.querySelector('[data-f=dur]').value || 30 };
    });
    db.settings.services = db.settings.services.filter(function (s) { return s.name; });
  }
  function suggestTime(ds) {
    var sh = shiftOf(ds), t = mins(sh.from), end = mins(sh.to);
    var list = apptsOn(ds).filter(active);
    var d0 = (db.settings.services[0] && db.settings.services[0].dur) || 80;
    for (; t + d0 <= end; t += 15) { var x = { id: '_', date: ds, time: hm(t), dur: d0 }; if (!conflicts(x).length) return hm(t); }
    return sh.from;
  }
  document.addEventListener('change', function (e) {
    var el = e.target;
    if (el.dataset && (el.dataset.fin || el.dataset.fix != null || el.dataset.var != null)) {
      var f = fin(), mo = monthOf(ui.finMonth);
      if (el.dataset.fin === 'extra') mo.extra = +el.value || 0;
      if (el.dataset.fin === 'hours') mo.hours = el.value === '' ? null : +el.value;
      if (el.dataset.fin === 'goal') f.goal = +el.value || 0;
      if (el.dataset.fix != null) { var x = f.fixed[+el.dataset.fix]; if (x) x[el.dataset.f] = el.dataset.f === 'amount' ? (+el.value || 0) : el.value; }
      if (el.dataset.var != null) { var y = mo.items[+el.dataset.var]; if (y) y[el.dataset.f] = el.dataset.f === 'amount' ? (+el.value || 0) : el.value; }
      save(); var sc = window.scrollY; render(); window.scrollTo(0, sc); return;
    }
    if (el.dataset && el.dataset.shift) {
      var ds = el.dataset.shift, sh = Object.assign({}, shiftOf(ds)); delete sh.auto;
      if (el.dataset.k === 'on') sh.on = el.checked; else sh[el.dataset.k] = el.value;
      if (sh.on && mins(sh.to) <= mins(sh.from)) { toast('Konec směny musí být po začátku'); render(); return; }
      db.shifts[ds] = sh; save();
      if (el.dataset.k === 'on') render();
    }
    if (el.id === 'imp-file' && el.files[0]) {
      var r = new FileReader();
      r.onload = function () {
        try { var data = JSON.parse(r.result); if (!data.settings || !data.appts) throw 0; if (!confirm('Nahradit současná data zálohou?')) return; localStorage.setItem(KEY, JSON.stringify(data)); load(); save(); render(); toast('Záloha nahrána'); }
        catch (x) { toast('Soubor není platná záloha'); }
      };
      r.readAsText(el.files[0]);
    }
  });
  document.addEventListener('submit', function (e) {
    if (e.target.id === 'sf') {
      e.preventDefault(); var s = db.settings, g = function (id) { return document.getElementById(id).value.trim(); };
      Object.assign(s, { name: g('s-n'), ico: g('s-i'), tel: g('s-t'), addr: g('s-a'), email: g('s-e'), bank: g('s-b'), prefix: g('s-p'), nextNo: +g('s-nn') || 1, dueDays: +g('s-d') || 14 });
      save(); toast('Uloženo');
    }
    if (e.target.id === 'pf') {
      e.preventDefault(); var u = document.getElementById('p-u').value.trim(), p = document.getElementById('p-n').value;
      if (!u) return toast('Vyplň uživatele');
      if (p && p.length < 6) return toast('Heslo musí mít aspoň 6 znaků');
      db.settings.user = u;
      if (CLOUD) {
        if (!p) return toast('Zadej nové heslo');
        MPDB.setPassword(p).then(function () { document.getElementById('p-n').value = ''; toast('Heslo změněno'); }).catch(function (er) { toast('Heslo se nezměnilo: ' + er.message); });
        return;
      }
      (p ? sha(p).then(function (h) { db.settings.pwHash = h; }) : Promise.resolve()).then(function () { save(); document.getElementById('p-n').value = ''; toast(p ? 'Heslo změněno' : 'Uloženo'); });
    }
  });

  /* ---------- Start ---------- */
  load();
  if (CLOUD) {
    if (MPDB.loggedIn()) {
      $app.innerHTML = '<div class="login"><p class="muted">Načítám…</p></div>';
      cloudLoad().then(function () { sessionStorage.setItem(SESSION, '1'); render(); }).catch(function () { sessionStorage.removeItem(SESSION); render(); });
    } else { sessionStorage.removeItem(SESSION); render(); }
    // po návratu do aplikace načíst nové rezervace z webu
    document.addEventListener('visibilitychange', function () {
      if (document.visibilityState === 'visible' && last && !syncing && $sheet.hidden && MPDB.loggedIn()) cloudLoad().then(render).catch(function () {});
    });
  } else {
    (db.settings.pwHash ? Promise.resolve() : sha('admin').then(function (h) { db.settings.pwHash = h; save(); })).then(render);
  }
})();
