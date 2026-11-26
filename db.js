/* Malý klient pro Supabase (REST + přihlášení) bez dalších knihoven. */
(function () {
  'use strict';
  var C = window.MP_CONFIG || {};
  var URL_ = (C.supabaseUrl || '').replace(/\/+$/, ''), KEY = C.supabaseKey || '';
  var SKEY = 'mp_sb_session';
  var session = null;
  try { session = JSON.parse(localStorage.getItem(SKEY)); } catch (e) {}

  function headers(extra, anon) {
    var h = { apikey: KEY, 'Content-Type': 'application/json' };
    h.Authorization = 'Bearer ' + (!anon && session ? session.access_token : KEY);
    return Object.assign(h, extra || {});
  }
  function fail(r) {
    return r.text().then(function (t) {
      var m = t; try { var j = JSON.parse(t); m = j.message || j.msg || j.error_description || j.error || t; } catch (e) {}
      var err = new Error(m || ('HTTP ' + r.status)); err.status = r.status; throw err;
    });
  }
  function req(path, opt, anon) {
    opt = opt || {};
    return ensureFresh(anon).then(function () {
      return fetch(URL_ + path, { method: opt.method || 'GET', headers: headers(opt.headers, anon), body: opt.body ? JSON.stringify(opt.body) : undefined });
    }).then(function (r) {
      if (!r.ok) return fail(r);
      if (r.status === 204) return null;
      return r.text().then(function (t) { return t ? JSON.parse(t) : null; });
    });
  }
  function saveSession(s) {
    session = s ? { access_token: s.access_token, refresh_token: s.refresh_token, expires_at: Date.now() + (s.expires_in || 3600) * 1000, email: (s.user && s.user.email) || (session && session.email) } : null;
    try { if (session) localStorage.setItem(SKEY, JSON.stringify(session)); else localStorage.removeItem(SKEY); } catch (e) {}
  }
  function ensureFresh(anon) {
    if (anon || !session || Date.now() < session.expires_at - 60000) return Promise.resolve();
    return fetch(URL_ + '/auth/v1/token?grant_type=refresh_token', { method: 'POST', headers: { apikey: KEY, 'Content-Type': 'application/json' }, body: JSON.stringify({ refresh_token: session.refresh_token }) })
      .then(function (r) { if (!r.ok) { saveSession(null); var e = new Error('Přihlášení vypršelo'); e.status = 401; throw e; } return r.json(); })
      .then(saveSession);
  }

  window.MPDB = {
    enabled: !!(URL_ && KEY),
    get user() { return session && session.email; },
    loggedIn: function () { return !!session; },
    signIn: function (email, password) {
      return fetch(URL_ + '/auth/v1/token?grant_type=password', { method: 'POST', headers: { apikey: KEY, 'Content-Type': 'application/json' }, body: JSON.stringify({ email: email, password: password }) })
        .then(function (r) { return r.ok ? r.json() : fail(r); }).then(function (s) { saveSession(s); return s; });
    },
    signOut: function () {
      var s = session; saveSession(null);
      if (s) fetch(URL_ + '/auth/v1/logout', { method: 'POST', headers: { apikey: KEY, Authorization: 'Bearer ' + s.access_token } }).catch(function () {});
    },
    setPassword: function (pw) { return req('/auth/v1/user', { method: 'PUT', body: { password: pw } }); },
    select: function (table, query) { return req('/rest/v1/' + table + '?' + (query || 'select=*')); },
    upsert: function (table, rows, onConflict) {
      if (!rows.length) return Promise.resolve();
      return req('/rest/v1/' + table + '?on_conflict=' + (onConflict || 'id'), { method: 'POST', body: rows, headers: { Prefer: 'resolution=merge-duplicates,return=minimal' } });
    },
    remove: function (table, col, values) {
      if (!values.length) return Promise.resolve();
      return req('/rest/v1/' + table + '?' + col + '=in.(' + values.map(encodeURIComponent).join(',') + ')', { method: 'DELETE', headers: { Prefer: 'return=minimal' } });
    },
    rpc: function (fn, args, anon) { return req('/rest/v1/rpc/' + fn, { method: 'POST', body: args || {} }, anon); },
    selectPublic: function (table, query) { return req('/rest/v1/' + table + '?' + (query || 'select=*'), {}, true); }
  };
})();
