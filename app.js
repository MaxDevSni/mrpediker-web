/* Mr. Pediker – menu, rezervace, cookie lišta */
(function () {
  'use strict';
  var PHONE = '+420737307321';
  var EMAIL = 'mrpediker@seznam.cz';

  /* ---------- Menu ---------- */
  var menuBtn = document.querySelector('.menu-btn');
  var nav = document.getElementById('nav');
  if (menuBtn && nav) {
    var setMenu = function (open) {
      nav.classList.toggle('open', open);
      menuBtn.setAttribute('aria-expanded', open ? 'true' : 'false');
      menuBtn.setAttribute('aria-label', open ? 'Zavřít menu' : 'Otevřít menu');
      document.body.style.overflow = open ? 'hidden' : '';
    };
    menuBtn.addEventListener('click', function () { setMenu(!nav.classList.contains('open')); });
    nav.addEventListener('click', function (e) { if (e.target.closest('a')) setMenu(false); });
  }

  /* ---------- Cookie lišta ---------- */
  var KEY = 'mp_cookie_consent';
  var store = {
    get: function () { try { return JSON.parse(localStorage.getItem(KEY)); } catch (e) { return null; } },
    set: function (v) { try { localStorage.setItem(KEY, JSON.stringify(v)); } catch (e) {} }
  };
  function applyConsent(c) {
    // Místo pro budoucí analytiku / marketing – načítat jen když c.analytics / c.marketing === true.
    document.documentElement.dataset.analytics = c && c.analytics ? '1' : '0';
  }
  function cookieBar(showPrefs) {
    var old = document.querySelector('.cookie'); if (old) old.remove();
    var c = store.get() || { analytics: false, marketing: false };
    var el = document.createElement('div');
    el.className = 'cookie' + (showPrefs ? ' show-prefs' : '');
    el.setAttribute('role', 'dialog');
    el.setAttribute('aria-labelledby', 'ck-t');
    el.innerHTML =
      '<h2 id="ck-t">Cookies</h2>' +
      '<p>Používám jen nezbytné technické úložiště. Analytické a marketingové cookies zapnu jedině s vaším souhlasem. <a href="cookies.html">Více informací</a></p>' +
      '<div class="prefs">' +
      '<label><input type="checkbox" checked disabled> <span><b>Nezbytné</b> – vždy aktivní, nutné pro fungování webu.</span></label>' +
      '<label><input type="checkbox" id="ck-a"' + (c.analytics ? ' checked' : '') + '> <span><b>Analytické</b> – anonymní statistika návštěvnosti.</span></label>' +
      '<label><input type="checkbox" id="ck-m"' + (c.marketing ? ' checked' : '') + '> <span><b>Marketingové</b> – měření reklam na sociálních sítích.</span></label>' +
      '</div>' +
      '<div class="acts">' +
      '<button type="button" class="btn btn-line" data-a="none">Jen nezbytné</button>' +
      '<button type="button" class="btn btn-red" data-a="all">Přijmout vše</button>' +
      '<button type="button" class="btn btn-line wide" data-a="prefs">' + (showPrefs ? 'Uložit výběr' : 'Nastavení') + '</button>' +
      '</div>';
    document.body.appendChild(el);
    el.addEventListener('click', function (e) {
      var b = e.target.closest('button'); if (!b) return;
      var a = b.getAttribute('data-a'), v;
      if (a === 'all') v = { analytics: true, marketing: true };
      else if (a === 'none') v = { analytics: false, marketing: false };
      else if (a === 'prefs') {
        if (!el.classList.contains('show-prefs')) { el.classList.add('show-prefs'); b.textContent = 'Uložit výběr'; return; }
        v = { analytics: el.querySelector('#ck-a').checked, marketing: el.querySelector('#ck-m').checked };
      } else return;
      v.date = new Date().toISOString();
      store.set(v); applyConsent(v); el.remove();
    });
  }
  var saved = store.get();
  var expired = saved && saved.date && (Date.now() - new Date(saved.date).getTime() > 365 * 864e5);
  if (!saved || expired) cookieBar(false); else applyConsent(saved);
  document.addEventListener('click', function (e) {
    if (e.target.closest('[data-cookie-settings]')) { e.preventDefault(); cookieBar(true); }
  });

  /* ---------- Rezervace ---------- */
  var form = document.getElementById('bk');
  if (!form) return;

  var SERVICES = [
    { id: 'mokra', name: 'Mokrá pedikúra', time: '50–70 min', price: '690 Kč' },
    { id: 'pristrojova', name: 'Přístrojová pedikúra', time: '50–70 min', price: '790 Kč' },
    { id: 'kombinovana', name: 'Kombinovaná pedikúra', time: '50–70 min', price: '890 Kč' },
    { id: 'spa', name: 'SPA pedikúra', time: '60–70 min', price: '1 290 Kč' },
    { id: 'rovnatko', name: 'Aplikace nehtového rovnátka', time: '20–40 min', price: '650 Kč' },
    { id: 'nehty', name: 'Stříhání a zapilování nehtů', time: '', price: '250 Kč' },
    { id: 'zarostly', name: 'Ošetření zarostlého nehtu', time: '', price: '250 Kč' },
    { id: 'masaz', name: 'Masáž nohou', time: '15–20 min', price: '290 Kč' }
  ];
  // Nabízené časy – upravte podle skutečné pracovní doby.
  var TIMES = ['8:00', '9:30', '11:00', '12:30', '14:00', '15:30', '17:00', '18:30'];
  var DAYS_AHEAD = 28;
  var DN = ['Ne', 'Po', 'Út', 'St', 'Čt', 'Pá', 'So'];
  var MN = ['ledna', 'února', 'března', 'dubna', 'května', 'června', 'července', 'srpna', 'září', 'října', 'listopadu', 'prosince'];

  var state = { step: 1, service: null, day: null, time: null };
  var $ = function (s) { return form.querySelector(s); };
  var err = $('#bk-err');

  function esc(s) { return String(s).replace(/[&<>"]/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]; }); }
  function press(list, el) { list.forEach(function (b) { b.setAttribute('aria-pressed', b === el ? 'true' : 'false'); }); }

  // Služby
  var svcBox = $('#bk-services');
  SERVICES.forEach(function (s) {
    var b = document.createElement('button');
    b.type = 'button'; b.className = 'opt'; b.setAttribute('aria-pressed', 'false'); b.dataset.id = s.id;
    b.innerHTML = '<span>' + esc(s.name) + (s.time ? '<small>' + esc(s.time) + '</small>' : '') + '</span><b>' + esc(s.price) + '</b>';
    b.addEventListener('click', function () { state.service = s; press(svcBox.querySelectorAll('.opt').length ? [].slice.call(svcBox.querySelectorAll('.opt')) : [], b); err.textContent = ''; setTimeout(function () { go(2); }, 160); });
    svcBox.appendChild(b);
  });

  // Dny
  var dayBox = $('#bk-days');
  var today = new Date(); today.setHours(0, 0, 0, 0);
  for (var i = 1; i <= DAYS_AHEAD; i++) {
    var d = new Date(today); d.setDate(today.getDate() + i);
    var b = document.createElement('button');
    b.type = 'button'; b.className = 'day'; b.setAttribute('aria-pressed', 'false');
    b.setAttribute('aria-label', DN[d.getDay()] + ' ' + d.getDate() + '. ' + MN[d.getMonth()]);
    b.innerHTML = '<span>' + DN[d.getDay()] + '</span><b>' + d.getDate() + '.</b><span>' + (d.getMonth() + 1) + '.</span>';
    (function (date, btn) {
      btn.addEventListener('click', function () { state.day = date; press([].slice.call(dayBox.children), btn); err.textContent = ''; });
    })(d, b);
    dayBox.appendChild(b);
  }
  // Časy
  var timeBox = $('#bk-times');
  TIMES.forEach(function (t) {
    var b = document.createElement('button');
    b.type = 'button'; b.className = 'time'; b.textContent = t; b.setAttribute('aria-pressed', 'false');
    b.addEventListener('click', function () { state.time = t; press([].slice.call(timeBox.children), b); err.textContent = ''; });
    timeBox.appendChild(b);
  });

  function fmtDay(d) { return DN[d.getDay()] + ' ' + d.getDate() + '. ' + MN[d.getMonth()] + ' ' + d.getFullYear(); }
  function val(id) { return ($('#' + id).value || '').trim(); }

  function validate(step) {
    if (step === 1 && !state.service) return 'Vyberte prosím ošetření.';
    if (step === 2 && !state.day) return 'Vyberte prosím den.';
    if (step === 2 && !state.time) return 'Vyberte prosím čas.';
    if (step === 3) {
      if (val('f-name').length < 3) { $('#f-name').focus(); return 'Vyplňte prosím jméno a příjmení.'; }
      if (val('f-tel').replace(/\D/g, '').length < 9) { $('#f-tel').focus(); return 'Zadejte prosím platné telefonní číslo.'; }
      var m = val('f-mail'); if (m && !/^\S+@\S+\.\S+$/.test(m)) { $('#f-mail').focus(); return 'E-mail nevypadá správně.'; }
    }
    if (step === 4 && (!$('#c-terms').checked || !$('#c-start').checked)) return 'Pro odeslání potvrďte prosím oba souhlasy.';
    return '';
  }

  function message() {
    var lines = [
      'Dobrý den, rezervace z webu Mr. Pediker:',
      'Ošetření: ' + state.service.name + ' (' + state.service.price + ')',
      'Termín: ' + fmtDay(state.day) + ' v ' + state.time,
      'Jméno: ' + val('f-name'),
      'Telefon: ' + val('f-tel')
    ];
    if (val('f-mail')) lines.push('E-mail: ' + val('f-mail'));
    if (val('f-note')) lines.push('Poznámka: ' + val('f-note'));
    lines.push('Souhlasím s obchodními podmínkami a žádám o poskytnutí služby ve zvoleném termínu.');
    return lines.join('\n');
  }

  function summary() {
    var rows = [['Ošetření', state.service.name + ' · ' + state.service.price], ['Termín', fmtDay(state.day) + ', ' + state.time], ['Jméno', val('f-name')], ['Telefon', val('f-tel')]];
    if (val('f-mail')) rows.push(['E-mail', val('f-mail')]);
    if (val('f-note')) rows.push(['Poznámka', val('f-note')]);
    $('#bk-sum').innerHTML = rows.map(function (r) { return '<dt>' + esc(r[0]) + '</dt><dd>' + esc(r[1]) + '</dd>'; }).join('');
    var body = encodeURIComponent(message());
    var ios = /iPad|iPhone|iPod/.test(navigator.userAgent) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
    $('#send-sms').href = 'sms:' + PHONE + (ios ? '&' : '?') + 'body=' + body;
    $('#send-mail').href = 'mailto:' + EMAIL + '?subject=' + encodeURIComponent('Rezervace: ' + state.service.name + ' – ' + fmtDay(state.day) + ' ' + state.time) + '&body=' + body;
  }

  function go(step) {
    state.step = step;
    form.querySelectorAll('.bk-pane').forEach(function (p) { p.hidden = Number(p.dataset.step) !== step; });
    form.querySelectorAll('.bk-steps li').forEach(function (li, i) { li.classList.toggle('on', i < Math.min(step, 4)); });
    $('#bk-back').hidden = step === 1 || step === 5;
    $('#bk-next').hidden = step >= 4;
    $('.bk-nav').hidden = step === 5;
    if (step === 4) summary();
    err.textContent = '';
    var top = form.getBoundingClientRect().top + window.scrollY - 80;
    if (Math.abs(window.scrollY - top) > 40) window.scrollTo({ top: top, behavior: 'smooth' });
  }

  $('#bk-next').addEventListener('click', function () {
    var e = validate(state.step); if (e) { err.textContent = e; return; }
    go(state.step + 1);
  });
  $('#bk-back').addEventListener('click', function () { go(state.step - 1); });
  ['#send-sms', '#send-mail'].forEach(function (id) {
    $(id).addEventListener('click', function (e) {
      var m = validate(4); if (m) { e.preventDefault(); err.textContent = m; return; }
      setTimeout(function () { go(5); }, 600);
    });
  });
  $('#bk-again').addEventListener('click', function () {
    state.service = state.day = state.time = null;
    form.reset();
    form.querySelectorAll('[aria-pressed]').forEach(function (b) { b.setAttribute('aria-pressed', 'false'); });
    go(1);
  });
  form.addEventListener('submit', function (e) { e.preventDefault(); });

  // Tlačítka „Rezervovat“ u služeb předvyplní službu
  document.querySelectorAll('[data-service]').forEach(function (a) {
    a.addEventListener('click', function () {
      var btn = svcBox.querySelector('[data-id="' + a.dataset.service + '"]');
      if (btn) btn.click();
    });
  });
})();
