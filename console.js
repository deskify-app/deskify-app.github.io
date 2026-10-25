// The owner's admin console: the admin app's screens (adminapp/…/ui/*.kt) in a browser. Reads go to the Worker's owner
// routes (ops/cf-api /v1/owner/*), actions to admin-act (ops/admin-collect adminAct), both with the signed-in account's
// Firebase ID token; the servers answer the owner only (a 403 here means "not the owner"). Nothing is kept in the
// browser beyond Firebase's own sign-in.
(function () {
  'use strict';

  // The site's Firebase web app (the same project the apps and buy.html use).
  var FIREBASE = { apiKey: 'AIzaSyDo0c609Q7a_pLybp9SgHcLoa6-3zAZ8xs', authDomain: 'deskify-8bd6f.firebaseapp.com', projectId: 'deskify-8bd6f', appId: '1:247125407711:web:762b38f33f61a9d7ac766a' };
  var HUB = 'https://deskify-api.kim290.workers.dev';
  var ACT = 'https://admin-act-png74iwaya-du.a.run.app';
  var TABS = [['home', '홈'], ['users', '사용자'], ['reviews', '리뷰'], ['alerts', '알림'], ['cost', '비용'], ['ops', '운영'], ['mail', '메일'], ['pc', 'PC 배포']];

  firebase.initializeApp(FIREBASE);
  var auth = firebase.auth();
  var $ = function (id) { return document.getElementById(id); };

  // --- what was read (as Repo.kt keeps it) -----------------------------------------------------------------------
  var D = { snapshot: null, daily: [], users: [], alerts: [], reviews: [], state: null, rtdn: null, actions: [], errors: null, pc: null, config: null, configError: null, mail: null, mailError: null, loadedAt: 0 };
  var ui = { tab: 'home', q: '', filter: 'all', sort: 'seen', rfilter: 'all', rstars: 0, lowestFirst: false, limit: 300 };

  // --- words for the figures (Common.kt) ---------------------------------------------------------------------------
  function h(s) { return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]; }); }
  function num(v) { var x = typeof v === 'number' ? v : parseFloat(v); return isFinite(x) ? x : 0; }
  function n(v) { return Math.trunc(num(v)).toLocaleString('ko-KR'); }
  function w(v) { return '₩' + n(v); }
  function pct(v, d) { return (num(v) * 100).toFixed(d == null ? 1 : d) + '%'; }
  function money(v, cur) { return cur === 'USD' ? '$' + num(v).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 }) : w(v); }
  function pad(x) { return String(x).padStart(2, '0'); }
  function dateOnly(ms) { if (!(ms > 0)) return '-'; var d = new Date(ms); return d.getFullYear() + '-' + pad(d.getMonth() + 1) + '-' + pad(d.getDate()); }
  function day(ms) { if (!(ms > 0)) return '-'; var d = new Date(ms); return dateOnly(ms) + ' ' + pad(d.getHours()) + ':' + pad(d.getMinutes()); }
  function ago(ms) {
    if (!(ms > 0)) return '-';
    var d = Math.floor((Date.now() - ms) / 1000);
    if (d < 60) return '방금'; if (d < 3600) return Math.floor(d / 60) + '분 전'; if (d < 86400) return Math.floor(d / 3600) + '시간 전';
    if (d < 86400 * 30) return Math.floor(d / 86400) + '일 전'; return dateOnly(ms);
  }
  function o(v) { return v && typeof v === 'object' && !Array.isArray(v) ? v : {}; }
  function arr(v) { return Array.isArray(v) ? v : []; }
  function str(v) { return v == null ? '' : String(v); }
  function flag(cc) { return /^[A-Z]{2}$/.test(cc || '') ? String.fromCodePoint(0x1F1E6 + cc.charCodeAt(0) - 65, 0x1F1E6 + cc.charCodeAt(1) - 65) : ''; }
  var TONE = { blue: 'c-blue', green: 'c-green', amber: 'c-amber', red: 'c-red', violet: 'c-violet', muted: 'muted' };
  function chip(text, tone) { return '<span class="chip ' + (TONE[tone] || '') + '">' + h(text) + '</span>'; }
  function tile(label, value, sub, tone) { return '<div class="tile"><div class="k">' + h(label) + '</div><div class="v ' + (TONE[tone] || '') + '">' + h(value) + '</div><div class="s">' + h(sub || '') + '</div></div>'; }
  function sec(title) { return '<h2 class="sec">' + h(title) + '</h2>'; }
  function kv(rows) { return '<dl class="kv">' + rows.filter(Boolean).map(function (r) { return '<dt>' + h(r[0]) + '</dt><dd>' + h(r[1]) + '</dd>'; }).join('') + '</dl>'; }
  function planLabel(p) { return { subscription: '구독', lifetime: '평생', 'lifetime+sync': '평생+동기화', granted: '부여', trial: '체험' }[p] || '무료'; }
  function planTone(p) { return { subscription: 'violet', lifetime: 'amber', 'lifetime+sync': 'amber', granted: 'green', trial: 'blue' }[p] || 'muted'; }
  function routeName(k) { return { lan: '같은 네트워크', tcp: 'TCP 직결', pub: 'TCP 직결', rtc: 'WebRTC', relay: '중계', tunnel: '집 PC 통로' }[k] || k; }

  // --- small charts (Charts.kt's Spark / Lines / Bars, as SVG) -----------------------------------------------------
  function lines(series, height) {
    height = height || 90;
    var W = 600, all = [];
    series.forEach(function (s) { s.values.forEach(function (v) { if (v != null) all.push(num(v)); }); });
    if (!all.length) return '<div class="muted small">데이터 없음</div>';
    var max = Math.max.apply(null, all.concat([1e-9])), len = Math.max.apply(null, series.map(function (s) { return s.values.length; }));
    var paths = series.map(function (s) {
      var pts = s.values.map(function (v, i) { return v == null ? null : ((len < 2 ? W / 2 : i / (len - 1) * W).toFixed(1) + ',' + (height - 4 - num(v) / max * (height - 8)).toFixed(1)); }).filter(Boolean);
      return '<polyline fill="none" stroke="currentColor" stroke-width="2" vector-effect="non-scaling-stroke" class="' + TONE[s.tone] + '" points="' + pts.join(' ') + '"/>';
    }).join('');
    return '<svg class="chart" viewBox="0 0 ' + W + ' ' + height + '" preserveAspectRatio="none" style="height:' + height + 'px">' + paths + '</svg>';
  }
  function spark(values, tone, height) { return lines([{ values: values, tone: tone }], height); }
  function bars(values, tone, tips, height) {
    height = height || 80;
    if (!values.length) return '<div class="muted small">데이터 없음</div>';
    var max = Math.max.apply(null, values.map(num).concat([1e-9])), bw = 600 / values.length;
    return '<svg class="chart" viewBox="0 0 600 ' + height + '" preserveAspectRatio="none" style="height:' + height + 'px">' + values.map(function (v, i) {
      var bh = Math.max(num(v) / max * (height - 4), num(v) > 0 ? 2 : 0);
      return '<rect class="' + TONE[tone] + '" fill="currentColor" x="' + (i * bw + bw * 0.15).toFixed(1) + '" y="' + (height - bh).toFixed(1) + '" width="' + (bw * 0.7).toFixed(1) + '" height="' + bh.toFixed(1) + '"><title>' + h((tips && tips[i]) || '') + ' ' + h(n(v)) + '</title></rect>';
    }).join('') + '</svg>';
  }
  function legend(items) { return '<div class="legend">' + items.map(function (x) { return '<span class="' + TONE[x[1]] + '"><i></i><span class="muted">' + h(x[0]) + '</span></span>'; }).join('') + '</div>'; }
  function meter(label, used, limit) {
    var s = limit > 0 ? used / limit : 0, tone = s >= 0.8 ? 'red' : s >= 0.5 ? 'amber' : 'green';
    return '<div style="margin-top:8px"><div class="row small"><span class="grow">' + h(label) + '</span><span class="muted">' + n(used) + ' / ' + n(limit) + ' · ' + pct(s, 1) + '</span></div><div class="bar-track ' + TONE[tone] + '"><div class="bar-fill" style="width:' + Math.min(100, s * 100).toFixed(1) + '%"></div></div></div>';
  }

  // --- the servers -------------------------------------------------------------------------------------------------
  function Fail(status, msg) { this.status = status; this.message = msg; }
  function token() { var u = auth.currentUser; if (!u) return Promise.reject(new Fail(401, '로그인이 필요합니다')); return u.getIdToken(); }
  function owner(method, path, body) {
    return token().then(function (t) {
      return fetch(HUB + path, { method: method, headers: Object.assign({ authorization: 'Bearer ' + t }, body != null ? { 'content-type': 'application/json' } : {}), body: body != null ? JSON.stringify(body) : undefined });
    }).then(function (r) {
      return r.text().then(function (text) {
        if (r.status === 403) { denied(); throw new Fail(403, '관리자 계정이 아닙니다'); }
        if (!r.ok) throw new Fail(r.status, text || ('HTTP ' + r.status));
        try { return text ? JSON.parse(text) : null; } catch (e) { return null; }
      });
    });
  }
  function act(action, fields) {
    return token().then(function (t) {
      return fetch(ACT, { method: 'POST', headers: { authorization: 'Bearer ' + t, 'content-type': 'application/json' }, body: JSON.stringify(Object.assign({ action: action }, fields || {})) });
    }).then(function (r) {
      return r.text().then(function (text) {
        if (!r.ok) throw new Fail(r.status, text || ('HTTP ' + r.status));
        try { return text ? JSON.parse(text) : {}; } catch (e) { return {}; }
      });
    }, function (e) {
      // A refused preflight reads as a network error: admin-act without the console's CORS (not deployed yet).
      throw e instanceof Fail ? e : new Fail(0, '관리 함수에 닿지 못했습니다(배포 전이거나 네트워크 문제): ' + e.message);
    });
  }

  var isDenied = false;
  function denied() {
    if (isDenied) return;
    isDenied = true;
    $('tabs').hidden = true; $('refresh').hidden = true;
    $('view').hidden = false;
    $('view').innerHTML = '<div class="gate"><h1>관리자 계정이 아닙니다</h1><p class="muted">' + h((auth.currentUser || {}).email || '') + '<br>이 계정은 관리자로 등록되어 있지 않습니다.</p><button class="primary" data-a="signout">다른 계정으로</button></div>';
  }

  /** Everything again (Repo.refresh); one failing read leaves the others. */
  function refresh() {
    if (isDenied) return Promise.resolve();
    $('status').textContent = '읽는 중…';
    var jobs = [
      owner('GET', '/v1/owner/users?limit=2000').then(function (v) { if (Array.isArray(v)) D.users = v; }),
      owner('GET', '/v1/owner/doc?coll=snapshot&id=now').then(function (v) { if (v) D.snapshot = v; }),
      owner('GET', '/v1/owner/docs?coll=daily&order=id&limit=120').then(function (v) { if (Array.isArray(v)) D.daily = v.sort(function (a, b) { return str(a.day).localeCompare(str(b.day)); }); }),
      owner('GET', '/v1/owner/docs?coll=alerts&limit=200').then(function (v) { if (Array.isArray(v)) D.alerts = v; }),
      owner('GET', '/v1/owner/docs?coll=reviews&limit=500').then(function (v) { if (Array.isArray(v)) D.reviews = v; }),
      owner('GET', '/v1/owner/doc?coll=state&id=now').then(function (v) { if (v) D.state = v; }),
      owner('GET', '/v1/owner/doc?coll=rtdn&id=last').then(function (v) { if (v) D.rtdn = v; }),
      owner('GET', '/v1/owner/docs?coll=actions&limit=40').then(function (v) { if (Array.isArray(v)) D.actions = v; }),
      owner('GET', '/v1/owner/errors?hours=24').then(function (v) { if (v) D.errors = v; }),
      owner('GET', '/v1/owner/pcRelease').then(function (v) { if (v) D.pc = v; }),
    ];
    var failed = 0, firstError = '';
    return Promise.all(jobs.map(function (p) { return p.catch(function (e) { failed++; firstError = firstError || e.message; }); })).then(function () {
      if (isDenied) return;
      D.loadedAt = Date.now();
      $('status').textContent = failed ? '일부를 읽지 못했습니다: ' + String(firstError).slice(0, 60) : '갱신 ' + day(D.loadedAt).slice(11);
      render();
    });
  }
  function loadConfig() { return act('configGet').then(function (r) { D.config = o(r.params); D.configError = null; }, function (e) { D.configError = e.message; }).then(render); }
  function loadMail() { return act('mailGet').then(function (r) { D.mail = r; D.mailError = null; }, function (e) { D.mailError = e.message; }).then(render); }

  // --- dialogs -----------------------------------------------------------------------------------------------------
  function toast(msg) { var t = $('toast'); t.textContent = msg; t.hidden = false; clearTimeout(toast.t); toast.t = setTimeout(function () { t.hidden = true; }, 3500); }
  /** A question with 취소 and [ok]; resolves true when confirmed. */
  function confirmBox(title, body, ok, danger) {
    return new Promise(function (resolve) {
      var box = $('dialog'), d = box.firstElementChild;
      d.innerHTML = '<h3>' + h(title) + '</h3><div>' + body + '</div><div class="actions"><button data-x="no">취소</button><button class="' + (danger ? 'primary danger' : 'primary') + '" data-x="yes">' + h(ok || '적용') + '</button></div>';
      box.hidden = false;
      var done = function (v) { box.hidden = true; box.onclick = null; document.removeEventListener('keydown', key); resolve(v); };
      var key = function (e) { if (e.key === 'Escape') done(false); };
      document.addEventListener('keydown', key);
      box.onclick = function (e) { var x = e.target.getAttribute && e.target.getAttribute('data-x'); if (e.target === box || x === 'no') done(false); else if (x === 'yes') done(true); };
    });
  }
  /** A text box in a dialog; resolves the text, or null when cancelled. */
  function promptBox(title, help, value, multiline, maxLen, presets) {
    return new Promise(function (resolve) {
      var box = $('dialog'), d = box.firstElementChild;
      var field = multiline ? '<textarea id="pf" maxlength="' + (maxLen || 2000) + '">' + h(value) + '</textarea>' : '<input id="pf" type="text" value="' + h(value) + '" placeholder="비우면 없음">';
      d.innerHTML = '<h3>' + h(title) + '</h3>' + (help ? '<p class="muted small">' + h(help) + '</p>' : '') +
        (presets ? '<div class="chips" style="margin-bottom:8px">' + presets.map(function (p, i) { return '<button class="link" data-p="' + i + '">' + h(p[0]) + '</button>'; }).join('') + '</div>' : '') +
        field + (maxLen ? '<div class="muted small" id="pc">' + value.length + '/' + maxLen + '</div>' : '') +
        '<div class="actions"><button data-x="no">취소</button><button class="primary" data-x="yes">확인</button></div>';
      box.hidden = false;
      var f = $('pf'); f.focus();
      f.oninput = function () { if (maxLen) $('pc').textContent = f.value.length + '/' + maxLen; };
      var done = function (v) { box.hidden = true; box.onclick = null; resolve(v); };
      box.onclick = function (e) {
        var t = e.target, x = t.getAttribute && t.getAttribute('data-x'), p = t.getAttribute && t.getAttribute('data-p');
        if (p != null) { f.value = presets[+p][1].slice(0, maxLen || 2000); f.oninput(); return; }
        if (t === box || x === 'no') done(null); else if (x === 'yes') done(f.value);
      };
    });
  }
  function drawer(html) { var dr = $('drawer'); dr.firstElementChild.innerHTML = html; dr.hidden = false; }
  $('drawer').addEventListener('click', function (e) { if (e.target === $('drawer')) $('drawer').hidden = true; });

  // --- 홈 (Home.kt) ------------------------------------------------------------------------------------------------
  function homeView() {
    var s = D.snapshot;
    if (!s) return '<p class="muted">불러오는 중…</p>';
    var at = num(s.at), stale = at > 0 && Date.now() - at > 2 * 3600e3;
    var plans = o(s.plans), ads = arr(s.ads), cur = str(s.adsCurrency), usage = arr(s.usageDays);
    var costToday = num(o(usage[usage.length - 1]).cost);
    var cf = o(s.cloudflare), cfToday = o(cf.today), free = num(cf.freePerDay) || 100000;
    var share = cf.share != null ? num(cf.share) : num(cfToday.req) / free;
    var unread = D.alerts.filter(function (a) { return a.read !== true; }).length;
    var out = '<div class="row"><h1 class="title grow">Deskify</h1>' + (unread ? '<a href="#alerts">' + chip('읽지 않은 알림 ' + unread, 'red') + '</a>' : '') + '</div>' +
      '<div class="row small"><span class="dot ' + (stale ? 'c-amber' : 'c-green') + '"></span><span class="muted">' + (stale ? '수집이 멈췄을 수 있습니다 · ' + ago(at) : '수집 ' + ago(at)) + '</span><button class="link" data-a="collect">지금 전체 수집</button></div>';
    out += sec('오늘') + '<div class="tiles">' +
      tile('가입자', n(s.users), '오늘 +' + n(s.newToday) + ' · 7일 +' + n(s.new7), 'blue') +
      tile('활동 기기 · 24시간', n(s.active24), '7일 ' + n(s.active7) + ' · 폰 ' + n(s.phones) + ' · PC ' + n(s.desktops), 'green') +
      tile('유료 계정', n(s.paying), '구독 ' + n(plans.subscription) + ' · 평생 ' + n(num(plans.lifetime) + num(plans['lifetime+sync'])) + ' · 체험 ' + n(plans.trial), 'violet') +
      tile('월 반복 매출', w(s.mrr), '수수료 15% 뺀 추정 · 전환 ' + pct(s.conversion), 'amber') +
      tile('광고 · 오늘', money(o(ads[ads.length - 1]).amount, cur), '30일 ' + money(ads.reduce(function (a, x) { return a + num(x.amount); }, 0), cur), 'amber') +
      tile('서버 요청 · 오늘(UTC)', n(cfToday.req), '무료 한도 최대 ' + pct(share, 0) + ' · D1 쓰기 ' + n(cfToday.rowsWritten) + ' · 오류 ' + n(cfToday.err) + ' · GCP ' + w(costToday), share >= 0.8 || costToday > 0 ? 'red' : share >= 0.5 ? 'amber' : 'green');
    var installs = arr(s.installs);
    if (s.rating != null || s.crashYesterday != null || installs.length) {
      var last = o(installs[installs.length - 1]);
      out += tile('Play 설치 · ' + (str(last.day).slice(-5) || '-'), installs.length ? '+' + n(last.n) : '-', '활성 설치 ' + (s.activeInstalls != null ? n(s.activeInstalls) : '-'), 'green') +
        tile('평점 · 크래시', s.rating != null ? '★ ' + num(s.rating).toFixed(2) : '-', '어제 크래시율 ' + (s.crashYesterday != null ? pct(s.crashYesterday, 2) : '-') + ' · 리뷰 ' + n(o(s.reviews).total), num(s.crashYesterday) >= 0.02 ? 'red' : 'blue');
    }
    out += '</div>';
    var tele = o(s.telemetry);
    if (num(tele.sessions) > 0) {
      var sessions = num(tele.sessions), ok = num(tele.ok), fail = num(tele.fail);
      var byCount = function (m) { return Object.keys(o(m)).map(function (k) { return [k, num(m[k])]; }).sort(function (a, b) { return b[1] - a[1]; }); };
      out += sec('접속 품질 · 30일 (앱이 보낸 익명 집계)') + '<div class="panel"><div class="row" style="justify-content:space-between">' +
        '<div><div class="muted small">연결 시도</div><b>' + n(sessions) + '</b></div>' +
        '<div><div class="muted small">성공률</div><b class="' + (fail / sessions > 0.2 ? 'c-red' : 'c-green') + '">' + pct(ok / sessions) + '</b></div>' +
        '<div><div class="muted small">연결까지</div><b>' + (ok > 0 ? (num(tele.connectMs) / ok / 1000).toFixed(1) : '0') + '초</b></div></div>' +
        '<div class="row small" style="margin-top:10px;align-items:flex-start"><span class="muted" style="width:64px;flex:none">경로</span><div class="chips">' + byCount(tele.routes).map(function (x) { return chip(routeName(x[0]) + ' ' + n(x[1]) + '회', 'blue'); }).join('') + '</div></div>' +
        (Object.keys(o(tele.reasons)).length ? '<div class="row small" style="margin-top:6px;align-items:flex-start"><span class="muted" style="width:64px;flex:none">실패 원인</span><div class="chips">' + byCount(tele.reasons).slice(0, 5).map(function (x) { return chip(x[0] + ' ' + n(x[1]) + '회', 'red'); }).join('') + '</div></div>' : '') + '</div>';
    }
    var signups = arr(s.signups);
    out += '<div class="grid2"><div>' + sec('가입 · 최근 30일') + '<div class="panel">' + bars(signups.map(function (x) { return x.n; }), 'blue', signups.map(function (x) { return x.day; })) +
      '<div class="muted small">30일 ' + n(s.new30) + '명 · 그 전 30일 ' + n(s.prev30) + '명</div></div></div>' +
      '<div>' + sec('광고 수익 · 최근 30일') + '<div class="panel">' + spark(ads.map(function (x) { return x.amount; }), 'amber', 80) + '<div class="muted small">30일 ' + money(ads.reduce(function (a, x) { return a + num(x.amount); }, 0), cur) + '</div></div></div></div>';
    // (Countries.kt: countries.users = [{c, users, sessions}]; installs and ads by country stay in the app.)
    var cl = arr(o(s.countries).users).slice().sort(function (a, b) { return num(b.users) - num(a.users); }).slice(0, 16);
    if (cl.length) out += sec('국가별 유저 · 30일') + '<div class="panel chips">' + cl.map(function (x) { return chip(flag(str(x.c)) + ' ' + str(x.c) + ' ' + n(x.users) + '명' + (num(x.sessions) ? ' · 접속 ' + n(x.sessions) : ''), 'muted'); }).join('') + '</div>';
    var errs = arr(s.errors);
    if (errs.length) out += sec('수집기 오류') + '<div class="panel c-red small">' + errs.map(h).join('<br>') + '</div>';
    if (D.daily.length > 1) out += sec('활동 기기 추이') + '<div class="panel">' + spark(D.daily.map(function (x) { return x.active24; }), 'green', 90) + '<div class="muted small">' + h(D.daily[0].day) + ' ~ ' + h(D.daily[D.daily.length - 1].day) + '</div></div>';
    return out;
  }

  // --- 사용자 (Users.kt) --------------------------------------------------------------------------------------------
  var FILTERS = [['all', '전체'], ['vip', 'VIP'], ['paying', '유료'], ['sub', '구독'], ['lifetime', '평생권'], ['web', '웹 결제'], ['trial', '체험'], ['free', '무료'], ['dormant', '휴면'], ['granted', '부여'], ['blocked', '차단']];
  var SORTS = [['seen', '최근 활동'], ['joined', '최근 가입'], ['paid', '낸 금액']];
  var DORMANT = 30 * 86400e3;
  function lifetimeOf(u) { return str(u.plan).indexOf('lifetime') === 0 || u.playLifetime === true || o(u.web).lifetime === true || o(u.grant).lifetime === true; }
  function webOf(u) { var wb = o(u.web); return wb.lifetime === true || arr(wb.subs).length > 0 || num(u.paidWeb) !== 0; }
  function grantEnd(u) {
    var g = o(u.grant); if (g.lifetime === true) return '평생';
    var end = Math.max(num(g.proUntil), num(g.syncUntil)); return end > Date.now() ? dateOnly(end).slice(5) : null;
  }
  function shownUsers() {
    var q = ui.q.toLowerCase(), now = Date.now();
    var list = D.users.filter(function (u) {
      var hit = !q || str(u.email).toLowerCase().indexOf(q) >= 0 || str(u.name).toLowerCase().indexOf(q) >= 0 || str(u.uid).indexOf(ui.q) === 0 || str(u.note).toLowerCase().indexOf(q) >= 0;
      if (!hit) return false;
      var g = o(u.grant);
      switch (ui.filter) {
        case 'paying': return ['subscription', 'lifetime', 'lifetime+sync'].indexOf(u.plan) >= 0;
        case 'sub': return u.plan === 'subscription' || arr(u.subs).length > 0;
        case 'lifetime': return lifetimeOf(u);
        case 'web': return webOf(u);
        case 'trial': return u.plan === 'trial';
        case 'free': return u.plan === 'free';
        case 'granted': return u.plan === 'granted' || g.lifetime === true || num(g.proUntil) > now || num(g.syncUntil) > now;
        case 'blocked': return g.syncBlocked === true;
        case 'vip': return u.vip === true;
        case 'dormant': return num(u.lastSeen) < now - DORMANT;
        default: return true;
      }
    });
    var sort = ui.sort === 'seen' && (ui.filter === 'vip' || ui.filter === 'paying') ? 'paid' : ui.sort;
    if (sort === 'paid') list.sort(function (a, b) { return num(b.paid) - num(a.paid); });
    else if (sort === 'joined') list.sort(function (a, b) { return num(b.createdAt) - num(a.createdAt); });
    return list;
  }
  function usersView() {
    var list = shownUsers(), now = Date.now();
    var paid = list.reduce(function (a, u) { return a + num(u.paid); }, 0), withdrawn = num(o(D.snapshot).withdrawn);
    var out = '<h1 class="title">사용자</h1><input id="uq" type="search" placeholder="이메일 · 이름 · 메모 검색" value="' + h(ui.q) + '" style="margin-top:8px">' +
      '<div class="filters">' + FILTERS.map(function (f) { return '<button data-filter="' + f[0] + '" class="' + (ui.filter === f[0] ? 'on' : '') + '">' + f[1] + '</button>'; }).join('') + '</div>' +
      '<div class="filters"><span class="muted small" style="align-self:center">정렬</span>' + SORTS.map(function (f) { return '<button data-sort="' + f[0] + '" class="' + (ui.sort === f[0] ? 'on' : '') + '">' + f[1] + '</button>'; }).join('') + '</div>' +
      '<div class="muted small" style="margin:4px">' + n(list.length) + '명' + (paid > 0 ? ' · 낸 금액 ' + w(paid) + ' (정가 추정)' : '') + (withdrawn > 0 ? ' · 탈퇴 ' + n(withdrawn) + '명' : '') + '</div><div class="list">';
    out += list.slice(0, ui.limit).map(function (u) {
      var tone = planTone(u.plan), dormant = num(u.lastSeen) < now - DORMANT, ge = grantEnd(u);
      return '<div class="item" data-user="' + h(u.uid) + '"><div class="avatar ' + TONE[tone] + '">' + h((str(u.name) || str(u.email) || '?').slice(0, 1).toUpperCase()) + '</div>' +
        '<div class="grow" style="min-width:0"><div class="ellipsis">' + (u.country ? flag(u.country) + ' ' : '') + h(u.email || u.uid) + '</div>' +
        '<div class="muted small ellipsis">' + h(planLabel(u.plan) + ' · 기기 ' + n(u.deviceCount) + ' · ' + ago(num(u.lastSeen)) + (dormant ? ' · 휴면' : '') + (num(u.paid) > 0 ? ' · ' + w(u.paid) : '') + (u.note ? ' · ' + u.note : '')) + '</div></div>' +
        '<div class="chips" style="flex:none">' + (u.vip === true ? chip('VIP', 'amber') : '') + (lifetimeOf(u) && str(u.plan).indexOf('lifetime') !== 0 ? chip('평생권', 'amber') : '') + (webOf(u) ? chip('웹', 'violet') : '') +
        (ge ? chip('부여 ~' + ge, 'green') : '') + (o(u.grant).syncBlocked === true ? chip('차단', 'red') : '') + chip(planLabel(u.plan), tone) + '</div></div>';
    }).join('') + '</div>';
    if (list.length > ui.limit) out += '<p style="text-align:center"><button data-a="more">' + n(list.length - ui.limit) + '명 더 보기</button></p>';
    return out;
  }
  var GRANTS = [['pro30', 'Pro 30일', 'Pro + 동기화 30일'], ['pro365', 'Pro 1년', 'Pro + 동기화 1년'], ['lifetime', '평생', '평생 Pro'], ['sync30', '동기화 30일', '동기화 30일'], ['trial7', '체험 7일', '체험 7일 다시'], ['clear', '부여 취소', '부여 모두 취소']];
  function stateLabel(s) { return { active: '구독 중', canceled: '해지 예약', in_grace_period: '결제 유예', on_hold: '결제 보류', paused: '일시중지', expired: '만료', pending: '대기' }[s] || s || '?'; }
  function userSheet(uid, log) {
    var u = D.users.filter(function (x) { return x.uid === uid; })[0]; if (!u) return;
    var now = Date.now(), g = o(u.grant), wb = o(u.web), granted = g.lifetime === true || num(g.proUntil) > now || num(g.syncUntil) > now;
    var out = '<div class="row"><h2 class="grow" style="margin:0">' + h(u.name || u.email) + '</h2><button class="ghost" data-a="close">닫기</button></div><div class="muted">' + h(u.email) + '</div>' +
      '<div class="chips" style="margin:10px 0">' + chip(planLabel(u.plan), planTone(u.plan)) + (u.vip === true ? chip('VIP', 'amber') : '') + (num(u.lastSeen) < now - DORMANT ? chip('휴면', 'red') : '') +
      (u.sync === true ? chip('동기화', 'green') : '') + (wb.lifetime === true || arr(wb.subs).some(function (s) { return num(s.until) > now; }) ? chip('웹 결제', 'violet') : '') + (granted ? chip('관리자 부여', 'amber') : '') + (g.syncBlocked === true ? chip('동기화 차단', 'red') : '') + '</div>';
    out += '<div class="panel"><b>결제 요약</b><div class="row" style="margin-top:6px"><div class="grow"><div class="muted small">지금까지 낸 금액</div><div class="c-amber" style="font-size:1.3rem;font-weight:700">' + w(u.paid) + '</div></div>' +
      '<div class="grow"><div class="muted small">구독 결제 횟수</div><div style="font-size:1.3rem;font-weight:700">' + n(arr(u.subs).reduce(function (a, s) { return a + num(s.periods); }, 0) + (log ? log.filter(function (e) { return e.event === '구독 결제'; }).length : 0)) + '회</div></div></div>';
    var routes = []; if (arr(u.subs).length || u.playLifetime === true) routes.push('Google Play'); if (wb.lifetime === true || arr(wb.subs).length) routes.push('웹(Paddle)'); if (granted) routes.push('관리자 부여');
    out += kv([['결제 경로', routes.join(' · ') || '없음'], ['평생권', u.playLifetime === true ? '있음 (Play)' : wb.lifetime === true ? '있음 (웹)' : g.lifetime === true ? '있음 (관리자 부여)' : '없음']]
      .concat(arr(u.subs).map(function (s) { return [str(s.product).indexOf('sync') >= 0 ? '동기화 구독' : 'Pro 구독', (str(s.basePlan).indexOf('year') >= 0 ? '연' : '월') + ' · ' + stateLabel(s.state) + (num(s.expiry) > 0 ? ' · ' + dateOnly(num(s.expiry)) + '까지' : '') + (s.autoRenew === true ? ' · 자동 갱신' : ' · 갱신 안 함')]; }))
      .concat(arr(wb.subs).map(function (s) { return ['웹 ' + (s.product === 'sync' ? '동기화' : 'Pro') + ' 구독', (s.period === 'yearly' ? '연' : '월') + ' · ' + str(s.status) + (num(s.until) > 0 ? ' · ' + dateOnly(num(s.until)) + '까지' : '')]; })));
    out += '<div style="margin-top:8px"><b class="small">결제 이력</b>' + (log == null ? '<div class="muted small">불러오는 중…</div>' : !log.length ? '<div class="muted small">기록 없음</div>' : log.slice(0, 30).map(function (e) {
      var bad = /환불|해지|취소/.test(str(e.event));
      return '<div class="row small" style="padding:3px 0">' + chip(e.source === 'web' ? '웹' : 'Play', e.source === 'web' ? 'violet' : 'green') + '<span class="grow ' + (bad ? 'c-red' : '') + '">' + h(str(e.event) + (e.product ? ' · ' + str(e.product).replace(/^kremote_/, '') : '')) + '</span>' + (num(e.amount) ? '<b>' + money(e.amount, e.currency) + '</b>' : '') + '<span class="muted">' + dateOnly(num(e.at)) + '</span></div>';
    }).join('')) + '</div></div>';
    out += '<div style="margin-top:12px">' + kv([
      u.country ? ['국가', flag(u.country) + ' ' + u.country] : null, ['상태', num(u.lastSeen) < now - DORMANT ? '휴면 (30일 넘게 활동 없음)' : '활동 중'],
      ['가입', day(num(u.createdAt))], ['마지막 활동', day(num(u.lastSeen))], ['마지막 로그인', day(num(u.lastSignInAt))],
      num(u.trialEndsAt) > 0 ? ['체험 종료', day(num(u.trialEndsAt))] : null, num(u.proUntil) > 0 ? ['Pro 만료', day(num(u.proUntil))] : null, num(u.syncUntil) > 0 ? ['동기화 만료', day(num(u.syncUntil))] : null,
      num(g.proUntil) > now ? ['부여 Pro', day(num(g.proUntil))] : null, num(g.syncUntil) > now ? ['부여 동기화', day(num(g.syncUntil))] : null, ['uid', uid]]) + '</div>';
    out += '<h3 style="margin:16px 0 4px;font-size:1rem">조치</h3><p class="muted small" style="margin:0 0 8px">부여는 결제와 별개로 더해지고, plan-verify가 몇 초 안에 플랜에 반영합니다.</p><div class="chips">' +
      GRANTS.map(function (x) { return '<button data-grant="' + x[0] + '" data-label="' + h(x[2]) + '" data-uid="' + h(uid) + '">' + h(x[1]) + '</button>'; }).join('') +
      (u.vip === true ? '<button data-grant="vipOff" data-label="VIP 해제" data-uid="' + h(uid) + '">VIP 해제</button>' : '<button class="c-amber" data-grant="vip" data-label="VIP 지정 (표시용, 앱 동작은 그대로)" data-uid="' + h(uid) + '">VIP 지정</button>') +
      (g.syncBlocked === true ? '<button data-grant="syncUnblock" data-label="동기화 차단 해제" data-uid="' + h(uid) + '">차단 해제</button>' : '<button class="danger" data-grant="syncBlock" data-label="동기화 차단 (이 계정은 동기화하지 못함)" data-uid="' + h(uid) + '">동기화 차단</button>') + '</div>';
    out += '<h3 style="margin:16px 0 4px;font-size:1rem">메모</h3><textarea id="note" placeholder="이 계정에 대해 적어 둘 것" maxlength="2000">' + h(u.note) + '</textarea><p style="text-align:right;margin:6px 0"><button class="primary" data-note="' + h(uid) + '">메모 저장</button></p>';
    var devices = arr(u.devices), links = arr(u.links), purchases = arr(u.purchases);
    if (devices.length) out += '<b class="small">동기화 기기 ' + devices.length + '</b>' + devices.map(function (d) { return '<div class="muted small">· ' + h(d.name + ' (' + str(d.os) + ' ' + str(d.model) + ') · ' + ago(num(d.lastSeen))) + '</div>'; }).join('');
    if (links.length) out += '<div style="margin-top:8px"><b class="small">연결 기기 ' + links.length + '</b>' + links.map(function (d) { return '<div class="muted small">· ' + h(d.name + ' (' + str(d.kind) + ') · ' + ago(num(d.updatedAt))) + '</div>'; }).join('') + '</div>';
    if (purchases.length) out += '<div style="margin-top:8px"><b class="small">구매 ' + purchases.length + '</b>' + purchases.map(function (d) { return '<div class="muted small">· ' + h(str(d.product) + ' ' + str(d.type) + ' · ' + day(num(d.at))) + '</div>'; }).join('') + '</div>';
    drawer(out);
  }
  function openUser(uid) {
    userSheet(uid, null);
    owner('GET', '/v1/owner/docs?coll=purchaseLog&limit=200&uid=' + encodeURIComponent(uid)).then(function (log) {
      if (!$('drawer').hidden) userSheet(uid, Array.isArray(log) ? log : []);
    }, function () { if (!$('drawer').hidden) userSheet(uid, []); });
  }

  // --- 리뷰 (Reviews.kt) --------------------------------------------------------------------------------------------
  var RFILTERS = [['all', '전체'], ['todo', '답글 필요'], ['low', '1~2점'], ['mid', '3점'], ['high', '4~5점'], ['replied', '답글 단 것']];
  var TEMPLATES = [
    ['감사', '소중한 리뷰 감사합니다! 앞으로도 더 편하게 쓰실 수 있도록 계속 다듬겠습니다.'],
    ['문제 확인', '불편을 드려 죄송합니다. 말씀하신 문제를 확인하고 있습니다. 앱의 설정 → 문제 해결 → 진단 보고서 보내기로 보내 주시면 더 빨리 고칠 수 있습니다.'],
    ['고쳤음', '알려 주셔서 감사합니다. 말씀하신 문제는 최신 버전에서 고쳤습니다. 업데이트 후에도 같으면 다시 알려 주세요.'],
    ['기능 요청', '좋은 의견 감사합니다! 요청하신 기능은 다음 업데이트 후보로 올려 두었습니다.'],
    ['연결 도움', "연결이 안 되면 PC의 원격 데스크톱 허용과 방화벽(3389), 같은 Wi-Fi인지 확인해 주세요. 집 밖이라면 앱의 '집 PC를 거쳐 연결'을 써 보세요."],
  ];
  function starText(r) { var k = Math.max(0, Math.min(5, Math.round(num(r)))); return '★★★★★'.slice(0, k) + '☆☆☆☆☆'.slice(0, 5 - k); }
  function reviewsView() {
    var rv = D.reviews, now = Date.now();
    var counts = [0, 0, 0, 0, 0, 0]; rv.forEach(function (r) { var s = num(r.rating); if (s >= 1 && s <= 5) counts[s]++; });
    var avg = rv.length ? rv.reduce(function (a, r) { return a + num(r.rating); }, 0) / rv.length : 0;
    var todo = rv.filter(function (r) { return !str(r.replyText).trim(); }).length;
    var shown = rv.filter(function (r) {
      var st = num(r.rating), replied = !!str(r.replyText).trim();
      if (ui.rstars && st !== ui.rstars) return false;
      return { todo: !replied, low: st <= 2, mid: st === 3, high: st >= 4, replied: replied }[ui.rfilter] !== false;
    });
    shown.sort(ui.lowestFirst ? function (a, b) { return num(a.rating) - num(b.rating) || num(b.at) - num(a.at); } : function (a, b) { return num(b.at) - num(a.at); });
    var max = Math.max.apply(null, counts.concat([1]));
    var out = '<h1 class="title">리뷰</h1><div class="grid2"><div class="panel row" style="align-items:center"><div style="width:120px;text-align:center"><div style="font-size:2.2rem;font-weight:700">' + (rv.length ? avg.toFixed(1) : '-') + '</div><div class="stars">' + starText(avg) + '</div><div class="muted small">리뷰 ' + n(rv.length) + '개</div>' +
      (o(D.snapshot).rating != null ? '<div class="muted small">Play 평점 ★ ' + num(D.snapshot.rating).toFixed(2) + '</div>' : '') + '</div><div class="grow">' +
      [5, 4, 3, 2, 1].map(function (st) {
        var tone = st <= 2 ? 'red' : st === 3 ? 'amber' : 'green';
        return '<div class="row small" data-stars="' + st + '" style="cursor:pointer;padding:2px 0"><span style="width:28px" class="' + (ui.rstars === st ? 'c-amber' : 'muted') + '">' + st + '★</span><div class="grow bar-track ' + TONE[tone] + '" style="margin:0"><div class="bar-fill" style="width:' + (counts[st] / max * 100).toFixed(1) + '%"></div></div><span style="width:34px;text-align:right">' + counts[st] + '</span></div>';
      }).join('') + '</div></div><div class="tiles">' +
      tile('답글 필요', n(todo), '아직 답하지 않은 리뷰', todo ? 'red' : 'green') +
      tile('최근 7일', n(rv.filter(function (r) { return num(r.at) > now - 7 * 86400e3; }).length), '낮은 점수(1~2) ' + rv.filter(function (r) { return num(r.rating) <= 2 && num(r.at) > now - 7 * 86400e3; }).length + '개', 'blue') + '</div></div>';
    out += '<div class="filters">' + RFILTERS.map(function (f) { return '<button data-rfilter="' + f[0] + '" class="' + (ui.rfilter === f[0] ? 'on' : '') + '">' + f[1] + '</button>'; }).join('') +
      '<button data-a="lowest" class="' + (ui.lowestFirst ? 'on' : '') + '">' + (ui.lowestFirst ? '낮은 점수부터' : '최신순') + '</button></div><div class="muted small">' + shown.length + '개' + (ui.rstars ? ' · ' + ui.rstars + '점만' : '') + '</div>';
    if (!rv.length) out += '<p class="muted">아직 리뷰가 없거나 수집 전입니다.</p>';
    out += '<div class="panel" style="margin-top:8px">' + shown.map(function (r) {
      var replied = !!str(r.replyText).trim(), text = str(r.text) || str(r.originalText);
      return '<div class="review"><div class="row"><span class="stars ' + (num(r.rating) <= 2 ? 'c-red' : '') + '">' + starText(r.rating) + '</span><b>' + h(r.author || '익명') + '</b><span class="grow"></span>' + (replied ? '' : chip('답글 필요', 'red')) + '<span class="muted small">' + ago(num(r.at)) + '</span></div>' +
        '<div style="margin-top:4px">' + h(text) + '</div>' + (r.originalText && r.originalText !== r.text ? '<div class="muted small">' + h(r.originalText) + '</div>' : '') +
        '<div class="muted small">' + h([r.device, r.appVersion ? 'v' + r.appVersion : '', r.lang].filter(Boolean).join(' · ')) + '</div>' +
        (replied ? '<div class="reply"><div class="c-blue small">내 답글 · ' + ago(num(r.repliedAt)) + '</div>' + h(r.replyText) + '</div>' : '') +
        '<div style="text-align:right"><button class="link" data-reply="' + h(r.id) + '">' + (replied ? '답글 고치기' : '답글 달기') + '</button></div></div>';
    }).join('') + '</div>';
    return out;
  }
  function reply(id) {
    var r = D.reviews.filter(function (x) { return x.id === id; })[0]; if (!r) return;
    promptBox('리뷰에 답글', starText(r.rating) + ' ' + (str(r.text) || str(r.originalText)).slice(0, 300), str(r.replyText), true, 350, TEMPLATES).then(function (text) {
      if (text == null || !text.trim()) return;
      act('reviewReply', { reviewId: id, text: text.trim() }).then(function () {
        r.replyText = text.trim(); r.repliedAt = Date.now(); toast('답글을 올렸습니다'); render();
      }, function (e) { toast('실패: ' + e.message); });
    });
  }

  // --- 알림 (Alerts.kt) ---------------------------------------------------------------------------------------------
  function kindName(t) { return { signup: '가입', purchase: '결제', budget: '예산', review: '리뷰', crash: '크래시', error: '수집기 오류' }[t] || t; }
  function alertTone(t) { return { purchase: 'amber', budget: 'red', crash: 'red', error: 'red', signup: 'blue', review: 'violet' }[t] || 'muted'; }
  function alertsView() {
    var unread = D.alerts.filter(function (a) { return a.read !== true; }).length;
    var out = '<div class="row"><h1 class="title grow">알림</h1>' + (unread ? '<button data-a="allRead">모두 읽음</button>' : '') + '</div>';
    if (!D.alerts.length) return out + '<p class="muted">아직 없습니다. 가입·결제·리뷰·예산·크래시·수집기 오류가 생기면 여기에 쌓입니다.</p>';
    return out + '<div class="list">' + D.alerts.map(function (a) {
      var read = a.read === true;
      return '<div class="item" data-alert="' + h(a.id) + '" style="align-items:flex-start"><span class="dot ' + TONE[alertTone(a.type)] + '" style="margin-top:8px;opacity:' + (read ? 0.3 : 1) + '"></span><div class="grow"><div style="font-weight:' + (read ? 400 : 650) + '">' + h(a.title) + '</div><div class="muted small" style="white-space:pre-wrap">' + h(a.body) + '</div>' +
        '<div class="muted small">' + h(kindName(a.type)) + (a.uid ? ' · uid ' + h(a.uid) : '') + '</div></div><span class="muted small" style="white-space:nowrap">' + ago(num(a.at)) + '</span></div>';
    }).join('') + '</div>';
  }

  // --- 비용 (Cost.kt) -----------------------------------------------------------------------------------------------
  /** This month as Google bills it (Pacific time), as BillingMonth in Common.kt. */
  function billingMonth() {
    var p = new Intl.DateTimeFormat('en-US', { timeZone: 'America/Los_Angeles', year: 'numeric', month: '2-digit', day: '2-digit' }).formatToParts(new Date());
    var get = function (t) { return +p.filter(function (x) { return x.type === t; })[0].value; };
    var y = get('year'), m = get('month'), dom = get('day');
    return { dom: dom, dim: new Date(y, m, 0).getDate(), month: y + '-' + pad(m) };
  }
  function costView() {
    var s = o(D.snapshot), usage = arr(s.usageDays), b = o(s.budget), cf = o(s.cloudflare);
    var out = '<h1 class="title">비용 · 서버</h1>';
    if (Object.keys(cf).length) {
      var today = o(cf.today), free = num(cf.freePerDay) || 100000, limits = o(cf.free), days = arr(cf.days), hrs = arr(cf.hours);
      var rows = [['req', '요청'], ['hub', '허브 요청'], ['rowsRead', 'D1 읽기(행)'], ['rowsWritten', 'D1 쓰기(행)']].map(function (x) { return [x[1], num(today[x[0]]), num(limits[x[0]]) || (x[0] === 'req' ? free : 0)]; }).filter(function (x) { return x[2] > 0; });
      var share = rows.length ? Math.max.apply(null, rows.map(function (x) { return x[1] / x[2]; })) : num(today.req) / free;
      var turn = o(cf.turn);
      out += sec('Cloudflare · 오늘 (UTC 기준, 무료 한도)') + '<div class="grid2"><div class="panel"><div class="row" style="align-items:baseline"><span style="font-size:1.8rem;font-weight:700" class="' + (share >= 0.8 ? 'c-red' : share >= 0.5 ? 'c-amber' : 'c-green') + '">' + pct(share, 0) + '</span><span class="muted">가장 많이 쓴 한도</span></div>' +
        rows.map(function (x) { return meter(x[0], x[1], x[2]); }).join('') +
        (Object.keys(turn).length ? '<div class="muted small" style="margin-top:8px">TURN 중계 이번 달 ' + (num(turn.total) / 1e9).toFixed(1) + ' GB / 1,000 GB 무료 · 쓴 계정 ' + n(turn.accounts) + '</div>' : '') +
        '<div class="muted small">소켓 ' + n(today.ws) + ' · 오류 ' + n(today.err) + ' · ' + (cf.source === 'cloudflare' ? 'Cloudflare 집계' : '서버 자체 집계(일부 누락 가능)') + ' · 넘으면 유료 요금제(월 $5)</div></div>';
      var paid = o(cf.paidAt), names = { req: '요청', hub: '허브 요청', rowsRead: 'D1 읽기', rowsWritten: 'D1 쓰기' };
      out += '<div class="panel"><b class="small">유료 전환(월 $5) 예상 시점</b>';
      if (paid.collecting === true) out += '<div class="muted small">데이터가 쌓이는 중입니다. 하루치가 3일 모이면(지금 ' + n(paid.basisDays) + '일) 예측합니다.</div>';
      else if (Object.keys(paid).length) {
        var left = paid.daysLeft;
        out += '<div style="font-size:1.4rem;font-weight:700" class="' + (left == null ? 'c-green' : left <= 30 ? 'c-red' : left <= 90 ? 'c-amber' : 'c-green') + '">' + (left == null ? '증가 없음' : left <= 0 ? '지금' : left > 3650 ? '10년 넘게' : dateOnly(num(paid.at))) + (left != null && left >= 1 && left <= 3650 ? ' <span class="muted small">' + n(left) + '일 뒤</span>' : '') + '</div>' +
          '<div class="muted small">계정 ' + n(paid.atAccounts) + '명쯤에서 ' + h(names[paid.limit] || paid.limit) + ' 무료 한도를 넘습니다 (지금 ' + n(paid.accounts) + '명, 최근 30일 하루 ' + num(paid.signupsPerDay).toFixed(1) + '명 가입)</div>' +
          '<div class="muted small">계정당 하루 ' + Object.keys(names).map(function (k) { return names[k] + ' ' + num(o(paid.perAccount)[k]).toFixed(1); }).join(' · ') + '</div>' +
          '<div class="muted small">유료 요금제: 월 $5에 요청 1천만 건 · D1 읽기 250억 행 · 쓰기 5천만 행 포함</div>';
      } else out += '<div class="muted small">아직 모르는 값</div>';
      out += '</div></div>';
      out += '<div class="grid2" style="margin-top:14px"><div class="panel">' + lines([{ values: days.map(function (d) { return d.req; }), tone: 'blue' }, { values: days.map(function (d) { return d.hub; }), tone: 'violet' }], 120) + legend([['요청', 'blue'], ['허브 요청', 'violet']]) +
        '<div class="muted small">일별 요청 · ' + days.length + '일 합계 ' + n(days.reduce(function (a, d) { return a + num(d.req); }, 0)) + '</div></div>' +
        '<div class="panel">' + lines([{ values: days.map(function (d) { return d.rowsRead; }), tone: 'blue' }, { values: days.map(function (d) { return d.rowsWritten; }), tone: 'amber' }], 120) + legend([['D1 읽기(행)', 'blue'], ['D1 쓰기(행)', 'amber']]) +
        '<div class="muted small">무료 하루 읽기 500만 · 쓰기 10만</div></div></div>';
      out += '<div class="panel" style="margin-top:14px">' + spark(hrs.map(function (x) { return x.req; }), 'blue', 70) + '<div class="muted small">최근 48시간 · 시간당 요청 (최고 ' + n(Math.max.apply(null, hrs.map(function (x) { return num(x.req); }).concat([0]))) + ')</div></div>';
      var sizes = o(cf.sizes);
      if (Object.keys(sizes).length) out += sec('D1 저장 (행 수)') + '<div class="panel">' + kv([['accounts', '계정 기록'], ['telemetry', '사용 통계'], ['admin_users', '계정 카드'], ['admin_docs', '관리 데이터'], ['withdrawn', '탈퇴'], ['server_errors', '서버 오류']].map(function (x) { return [x[1], n(sizes[x[0]])]; })) + '</div>';
    }
    var bm = billingMonth(), amount = num(b.amount), cost = num(b.cost);
    var mtd = b.cost != null ? cost : usage.filter(function (d) { return str(d.day).indexOf(bm.month) === 0; }).reduce(function (a, d) { return a + num(d.cost); }, 0);
    var monthEnd = bm.dom < 2 ? null : mtd / bm.dom * bm.dim;
    var users = Math.max(1, num(s.users)), cost30 = usage.slice(-30).reduce(function (a, d) { return a + num(d.cost); }, 0);
    var bp = amount > 0 ? Math.min(999, cost / amount * 100) : 0;
    out += sec('예산 (이번 달)') + '<div class="grid2"><div class="panel"><div class="row" style="align-items:baseline"><span style="font-size:1.8rem;font-weight:700" class="' + (bp >= 80 ? 'c-red' : bp >= 50 ? 'c-amber' : 'c-green') + '">' + bp.toFixed(0) + '%</span><span class="muted">' + n(cost) + ' / ' + n(amount) + ' ' + h(b.currency || '') + '</span></div>' +
      '<div class="bar-track ' + (bp >= 80 ? 'c-red' : 'c-green') + '"><div class="bar-fill" style="width:' + Math.min(100, bp) + '%"></div></div>' +
      '<div class="muted small" style="margin-top:8px">자동 중지 ' + (b.autoStop === false ? '꺼짐' : '켜짐') + ' · 결제 ' + (b.billingEnabled === true ? '연결됨' : b.billingEnabled === false ? '해제됨' : '?') + ' · 보고 ' + ago(num(b.reportedAt)) + '</div></div><div class="tiles">' +
      (monthEnd == null ? tile('월말 예상', '—', '이번 달 첫날입니다 · 지금까지 ' + w(mtd), 'amber') : tile('월말 예상', w(monthEnd), bm.dom + '일까지 ' + w(mtd) + ' · 같은 속도면 (미국 태평양 시간 기준)', amount > 0 && monthEnd > amount ? 'red' : 'amber')) +
      tile('가입자 1명당 · 30일', w(cost30 / users), '클라우드 30일 ' + w(cost30) + ' ÷ ' + n(users) + '명', '') + '</div></div>';
    out += sec('Firestore · 일별 비용') + '<div class="panel">' + bars(usage.map(function (d) { return d.cost; }), 'red', usage.map(function (d) { return d.day; })) + '<div class="muted small">31일 합계 ' + w(usage.reduce(function (a, d) { return a + num(d.cost); }, 0)) + '</div></div>';
    return out;
  }

  // --- 운영 (Ops.kt) ------------------------------------------------------------------------------------------------
  var KNOBS = [
    ['pro_free_until', '모두에게 Pro 무료', '날짜(2026-12-31, 그날까지 한국 시간) 또는 밀리초. 비우면 끝. 심사·출시 행사용.'],
    ['update_required_below', '강제 업데이트 · 이 버전 미만', 'versionCode. 이보다 낮은 앱은 업데이트 전까지 막힙니다. 비우면 없음.'],
    ['update_suggest_below', '업데이트 권유 · 이 버전 미만', 'versionCode. 이보다 낮은 앱에 새 버전 안내를 띄웁니다.'],
    ['notice_text', '공지 배너', '폰·PC 홈 화면 맨 위에 보이는 한 줄. 비우면 없음.'],
    ['notice_url', '공지 링크', '배너를 누르면 여는 주소(선택).'],
    ['ads_enabled', '광고 켜기', '끄면 무료 사용자에게도 광고를 보이지 않습니다.', true],
    ['ad_test_devices', '광고 테스트 기기', '쉼표로 나눈 기기 ID. 이 기기들에는 테스트 광고만.'],
  ];
  function actionLabel(a) {
    var what = str(a.what), who = a.user ? ' · ' + str(a.user).slice(0, 8) + '…' : '';
    switch (a.action) {
      case 'grant': return '부여 · ' + ({ pro30: 'Pro 30일', pro365: 'Pro 1년', lifetime: '평생', sync30: '동기화 30일', sync365: '동기화 1년', trial7: '체험 7일', clear: '부여 취소', syncBlock: '동기화 차단', syncUnblock: '차단 해제', vip: 'VIP 지정', vipOff: 'VIP 해제' }[what] || what) + who;
      case 'config': return '스위치 · ' + str(a.key) + ' = ' + (str(a.value) || '(없음)');
      case 'reviewReply': return '리뷰 답글';
      case 'collect': return '지금 수집';
      case 'wipeUnused': return '12개월 미사용 데이터 정리 · ' + n(a.count) + '개';
      case 'pcRelease': return 'PC 배포 · ' + ({ current: 'v' + str(a.version) + '(으)로 바꿈', pause: '업데이트 멈춤', resume: '업데이트 재개' }[what] || what);
      default: return str(a.action);
    }
  }
  function opsView() {
    var s = o(D.snapshot), st = o(D.state), now = Date.now();
    var last = num(st.lastRunAt), full = num(st.lastFullAt), errors = arr(st.errors), rt = num(o(D.rtdn).at), budget = o(s.budget), cf = o(s.cloudflare);
    var share = cf.share != null ? num(cf.share) : num(o(cf.today).req) / 100000;
    var line = function (ok, name, value) { return '<div class="row line"><span class="dot ' + (ok === true ? 'c-green' : ok === false ? 'c-red' : 'c-amber') + '"></span><span class="grow">' + h(name) + '</span><span class="muted small">' + h(value) + '</span></div>'; };
    var out = '<h1 class="title">운영</h1><div class="grid2"><div>' + sec('상태') + '<div class="panel">' +
      line(last > now - 90 * 60e3, '수집기 (1시간마다)', last > 0 ? '마지막 ' + ago(last) + ' · 전체 ' + ago(full) : '기록 없음') +
      line(errors.length ? null : true, '수집 오류', errors.length ? errors.length + '건' : '없음') +
      errors.slice(0, 4).map(function (e) { return '<div class="muted small">· ' + h(str(e).slice(0, 160)) + '</div>'; }).join('') +
      line(rt > 0 ? true : null, 'Play 실시간 알림', rt > 0 ? '마지막 ' + ago(rt) + ' · ' + str(o(D.rtdn).what) : '아직 받은 알림 없음') +
      line(Object.keys(cf).length ? share < 0.8 : null, 'Cloudflare 무료 한도 (오늘)', Object.keys(cf).length ? '요청 ' + n(o(cf.today).req) + ' · 가장 많이 쓴 한도 ' + pct(share, 0) : '아직 모르는 값') +
      line(budget.autoStop !== false, '예산 자동 중지', budget.autoStop === false ? '꺼짐' : '켜짐') + '</div>';
    var e = o(D.errors), recent = arr(e.recent);
    out += sec('서버 오류 · 24시간') + '<div class="panel">' + (D.errors == null ? '<span class="muted">불러오는 중…</span>' : !num(e.count) ? '<div class="row"><span class="dot c-green"></span>오류 없음</div>' :
      '<div class="c-red" style="font-weight:650">' + n(e.count) + '건</div>' + recent.slice(0, 15).map(function (r) { return '<div class="line small"><div class="row"><b class="grow ellipsis">' + h(str(r.status) + ' · ' + str(r.place)) + '</b><span class="muted">' + ago(num(r.at)) + '</span></div><div class="muted" style="white-space:pre-wrap">' + h(r.msg) + '</div></div>'; }).join('')) + '</div>';
    var systems = arr(s.systems);
    if (systems.length) out += sec('시스템 계정') + '<div class="panel">' + systems.map(function (x) {
      return '<div class="line"><div class="row"><b class="grow">' + (x.url ? '<a href="' + h(x.url) + '" target="_blank" rel="noopener">' + h(x.name) + '</a>' : h(x.name)) + '</b><span class="small">' + h(x.login) + '</span></div><div class="muted small">' + h(x.use) + (x.id ? ' · ' + h(x.id) : '') + (x.note ? ' · ' + h(x.note) : '') + '</div></div>';
    }).join('') + '</div>';
    out += '</div><div>' + sec('앱 스위치 (Remote Config)');
    var params = D.config || (s.config ? o(s.config) : null);
    out += '<div class="panel"><p class="muted small" style="margin-top:0">Deskify 앱·PC판이 시작할 때 읽는 값입니다. 앱은 다음 시작(최대 1시간) 때 읽습니다.' + (D.config ? '' : D.configError ? ' <span class="err">최신 값을 읽지 못했습니다: ' + h(D.configError) + '</span>' : ' 최신 값 확인 중… (보이는 값은 마지막 수집 때의 것)') + '</p>' +
      (params == null ? '<span class="muted">불러오는 중…</span>' : KNOBS.map(function (k) {
        var v = str(params[k[0]]);
        return '<div class="row line"><div class="grow"><b class="small">' + h(k[1]) + '</b><div class="muted small">' + h(k[2]) + '</div></div>' +
          (k[3] ? '<button data-knob="' + k[0] + '" class="' + (v !== 'false' ? 'c-green' : 'muted') + '">' + (v !== 'false' ? '켬' : '끔') + '</button>' : '<button data-knob="' + k[0] + '" class="' + (v ? 'c-amber' : 'muted') + '" style="max-width:220px" title="고치기"><span class="ellipsis" style="display:block">' + h(v || '—') + '</span></button>') + '</div>';
      }).join('')) + '</div>';
    out += sec('수집기') + '<div class="panel"><p class="muted small" style="margin-top:0">1시간마다 자동으로 모읍니다. 지금 바로 모두(구매·기기 포함) 모으려면 누르십시오.</p><button data-a="collect">지금 전체 수집</button></div>';
    out += sec('최근 조치') + '<div class="panel">' + (D.actions.length ? D.actions.map(function (a) { return '<div class="row small" style="padding:3px 0"><span class="grow">' + h(actionLabel(a)) + '</span><span class="muted">' + ago(num(a.at)) + '</span></div>'; }).join('') : '<span class="muted">기록 없음</span>') + '</div></div></div>';
    return out;
  }
  function knob(key) {
    var k = KNOBS.filter(function (x) { return x[0] === key; })[0], params = D.config || o(o(D.snapshot).config), before = str(params[key]);
    var show = function (x) { return k[3] ? (x === 'false' ? '끔' : '켬') : (x ? x : '(없음)'); };
    var ask = function (after) {
      return confirmBox(k[1] + ' 바꾸기', '<p style="font-weight:650;font-size:1.05rem">' + h(show(before)) + '  →  ' + h(show(after)) + '</p><p class="muted small">모든 사용자의 Deskify 앱·PC판에 적용됩니다(다음 시작, 최대 1시간). 정말 바꿀까요?</p>', '바꾸기').then(function (yes) {
        if (!yes) return;
        act('config', { key: key, value: after }).then(function (r) { D.config = o(r.params); toast('반영했습니다. 앱은 다음 시작(최대 1시간) 때 읽습니다.'); render(); }, function (e) { toast('실패: ' + e.message); });
      });
    };
    if (k[3]) return ask(before === 'false' ? 'true' : 'false');
    promptBox(k[1], k[2], before, key === 'notice_text', 0).then(function (v) { if (v != null) ask(v.trim() || null); });
  }

  // --- 메일 (Mail.kt) -----------------------------------------------------------------------------------------------
  var MAIL_KINDS = [['welcome', '가입 환영'], ['newDevice', '새 기기'], ['thanks', '구매 감사']];
  function mailView() {
    var out = '<h1 class="title">메일</h1><p class="muted">가입 환영·새 기기 로그인·구매 감사 메일을 보내는 계정입니다. 맡은 종류가 없는 계정은 공통으로 보냅니다. 계정 추가·앱 비밀번호 변경은 관리자 앱에서 합니다(비밀번호는 이 화면에 오가지 않습니다).</p>';
    var d = D.mail;
    if (!d) return out + '<div class="panel">' + (D.mailError ? '<span class="err">불러오지 못했습니다: ' + h(D.mailError) + '</span>' : '<span class="muted">불러오는 중…</span>') + '</div>';
    var accounts = arr(d.accounts), max = num(d.max) || 450;
    out += '<div class="grid2"><div class="panel">' + MAIL_KINDS.map(function (k) {
      var own = accounts.filter(function (a) { return arr(a.kinds).indexOf(k[0]) >= 0; });
      return '<div class="row small" style="padding:2px 0"><span class="grow">' + k[1] + '</span><span class="' + (own.length ? '' : 'c-amber') + '">' + (own.length ? h(own.map(function (a) { return str(a.user).split('@')[0]; }).join(', ')) : '비어 있음 · 공통 계정이 보냄') + '</span></div>';
    }).join('') + '<div class="muted small" style="margin-top:8px">오늘(' + h(d.day) + ') 보낸 메일 ' + n(accounts.reduce(function (a, x) { return a + num(x.sent); }, 0)) + '통 · 남은 발송 ' + n(accounts.reduce(function (a, x) { return a + num(x.left); }, 0)) + '통 (계정당 하루 ' + max + ')</div></div>';
    out += '<div class="panel">' + accounts.map(function (a) {
      return '<div class="line"><div class="row"><b class="grow ellipsis">' + h(a.user) + '</b><span class="small ' + (num(a.left) < 50 ? 'c-red' : 'muted') + '">' + n(a.sent) + ' / ' + max + '</span></div>' +
        '<div class="row"><span class="muted small grow">' + h(arr(a.kinds).length ? arr(a.kinds).map(function (k) { var x = MAIL_KINDS.filter(function (m) { return m[0] === k; })[0]; return x ? x[1] : k; }).join(' · ') : '공통 (모든 종류)') + '</span><button class="link" data-mailtest="' + h(a.user) + '">시험 메일</button></div></div>';
    }).join('') + '</div></div>';
    return out;
  }

  // --- PC 배포 (PcRelease.kt) ---------------------------------------------------------------------------------------
  function cmpVer(a, b) {
    var x = str(a).split('.').map(Number), y = str(b).split('.').map(Number);
    for (var i = 0; i < Math.max(x.length, y.length); i++) { var c = (x[i] || 0) - (y[i] || 0); if (c) return c; }
    return 0;
  }
  function pcView() {
    var out = '<h1 class="title">PC 배포</h1><p class="muted">설치된 PC판이 6시간마다 확인하는 업데이트입니다. 되돌리면 아직 업데이트하지 않은 PC에만 이전 버전이 기준이 되고, 이미 새 버전인 PC는 그대로입니다(설치기는 낮은 버전으로 내려가지 않습니다). 새 버전은 scripts/pc_release.py --go가 등록합니다.</p>';
    var d = D.pc;
    if (!d) return out + '<div class="panel muted">불러오는 중…</div>';
    var st = o(d.state), current = str(st.current), paused = st.paused === true, releases = arr(d.releases), counts = o(d.counts);
    var total = Object.keys(counts).reduce(function (a, k) { return a + num(counts[k]); }, 0);
    out += '<div class="panel"><div class="row"><span class="dot ' + (!current ? 'c-amber' : paused ? 'c-red' : 'c-green') + '"></span><b class="grow" style="font-size:1.2rem">' + (current ? 'v' + h(current) : '배포 중인 버전 없음') + '</b>' +
      (current ? (paused ? chip('업데이트 멈춤', 'red') + '<button class="primary" data-pc="resume">업데이트 재개</button>' : chip('배포 중', 'green') + '<button class="danger" data-pc="pause">업데이트 멈춤</button>') : '') + '</div>' +
      '<div class="muted small" style="margin-top:6px">' + (num(st.at) ? '바뀐 때 ' + day(num(st.at)) + ' · ' : '') + '로그인한 PC ' + n(total) + '대 (최근 ' + (num(d.activeDays) || 30) + '일)' + (num(counts['']) ? ' · 버전을 보내기 전 빌드 ' + n(counts['']) + '대' : '') + '</div></div>';
    out += sec('버전') + '<div class="list">' + (releases.length ? releases.map(function (r) {
      var v = str(r.version), older = current && cmpVer(v, current) < 0;
      return '<div class="item" style="cursor:default;align-items:flex-start"><div class="grow"><div class="row"><b>v' + h(v) + '</b>' + (v === current ? chip(paused ? '멈춤' : '배포 중', paused ? 'red' : 'green') : '') + '<span class="grow"></span><span class="small">PC ' + n(counts[v]) + '대</span></div>' +
        '<div class="muted small">' + dateOnly(num(r.at)) + (num(r.size) ? ' · ' + (num(r.size) / 1048576).toFixed(1) + ' MB' : '') + (r.sha256 ? ' · sha256 ' + h(str(r.sha256).slice(0, 12)) + '…' : '') + '</div>' +
        (r.notes ? '<div class="small" style="white-space:pre-wrap">' + h(r.notes) + '</div>' : '') +
        (v !== current ? '<div style="text-align:right"><button class="link" data-pcv="' + h(v) + '">' + (older ? '되돌리기' : '이 버전으로 배포') + '</button></div>' : '') + '</div></div>';
    }).join('') : '<div class="item muted" style="cursor:default">등록된 버전이 없습니다.</div>') + '</div>';
    return out;
  }
  function pcSwitch(body, title, text) {
    confirmBox(title, '<p>' + h(text) + '</p>', '적용', body.action === 'pause').then(function (yes) {
      if (!yes) return;
      owner('POST', '/v1/owner/pcRelease', body).then(function () {
        toast('반영했습니다. PC는 다음 확인(최대 6시간) 때 따릅니다.');
        return owner('GET', '/v1/owner/pcRelease').then(function (v) { D.pc = v; render(); });
      }, function (e) { toast('실패: ' + e.message); });
    });
  }

  // --- the page ----------------------------------------------------------------------------------------------------
  var VIEWS = { home: homeView, users: usersView, reviews: reviewsView, alerts: alertsView, cost: costView, ops: opsView, mail: mailView, pc: pcView };
  function render() {
    if (isDenied || !auth.currentUser) return;
    var todo = D.reviews.filter(function (r) { return !str(r.replyText).trim(); }).length, unread = D.alerts.filter(function (a) { return a.read !== true; }).length;
    $('tabs').innerHTML = TABS.map(function (t) {
      var badge = t[0] === 'reviews' && todo ? todo : t[0] === 'alerts' && unread ? unread : 0;
      return '<a href="#' + t[0] + '" class="' + (ui.tab === t[0] ? 'on' : '') + '">' + t[1] + (badge ? '<span class="badge">' + Math.min(badge, 99) + '</span>' : '') + '</a>';
    }).join('');
    var view = $('view'), focus = document.activeElement && document.activeElement.id === 'uq' ? $('uq').selectionStart : null;
    view.innerHTML = VIEWS[ui.tab]();
    if (focus != null && $('uq')) { $('uq').focus(); $('uq').setSelectionRange(focus, focus); }
  }
  function route() {
    var t = (location.hash || '').slice(1);
    ui.tab = VIEWS[t] ? t : 'home';
    if (ui.tab === 'ops' && !D.config && !D.configError) loadConfig();
    if (ui.tab === 'mail' && !D.mail) loadMail();
    render();
    window.scrollTo(0, 0);
  }
  window.addEventListener('hashchange', route);

  document.addEventListener('input', function (e) { if (e.target.id === 'uq') { ui.q = e.target.value; ui.limit = 300; render(); } });
  document.addEventListener('click', function (e) {
    var t = e.target.closest('[data-a],[data-filter],[data-sort],[data-user],[data-grant],[data-note],[data-rfilter],[data-stars],[data-reply],[data-alert],[data-knob],[data-mailtest],[data-pc],[data-pcv]');
    if (!t) return;
    var ds = t.dataset;
    if (ds.a === 'signout') { auth.signOut(); return; }
    if (ds.a === 'close') { $('drawer').hidden = true; return; }
    if (ds.a === 'more') { ui.limit += 500; render(); return; }
    if (ds.a === 'lowest') { ui.lowestFirst = !ui.lowestFirst; render(); return; }
    if (ds.a === 'collect') {
      toast('수집 중… (몇십 초 걸립니다)');
      act('collect', { full: true }).then(function () { toast('수집했습니다'); refresh(); }, function (er) { toast('수집 응답을 받지 못했습니다. 다시 읽습니다 (' + er.message + ')'); refresh(); setTimeout(refresh, 30000); });
      return;
    }
    if (ds.a === 'allRead') {
      D.alerts.forEach(function (a) { a.read = true; }); render();
      owner('POST', '/v1/owner/alertsRead', {}).catch(function (er) { toast('실패: ' + er.message); });
      return;
    }
    if (ds.filter) { ui.filter = ds.filter; ui.limit = 300; render(); return; }
    if (ds.sort) { ui.sort = ds.sort; render(); return; }
    if (ds.user) { openUser(ds.user); return; }
    if (ds.grant) {
      var u = D.users.filter(function (x) { return x.uid === ds.uid; })[0] || {};
      confirmBox(ds.label, '<p>' + h(u.email || ds.uid) + ' 계정에 적용합니다.</p>', '적용', /Block|clear/.test(ds.grant)).then(function (yes) {
        if (!yes) return;
        act('grant', { user: ds.uid, what: ds.grant }).then(function () {
          toast('적용했습니다. 플랜은 몇 초 뒤 갱신됩니다.');
          owner('GET', '/v1/owner/users?limit=2000').then(function (v) { if (Array.isArray(v)) { D.users = v; if (!$('drawer').hidden) openUser(ds.uid); render(); } });
        }, function (er) { toast('실패: ' + er.message); });
      });
      return;
    }
    if (ds.note) {
      var text = $('note').value.trim(), uid = ds.note;
      owner('POST', '/v1/owner/note', { uid: uid, note: text }).then(function () {
        D.users.forEach(function (x) { if (x.uid === uid) x.note = text; }); toast('메모를 저장했습니다'); render();
      }, function (er) { toast('실패: ' + er.message); });
      return;
    }
    if (ds.rfilter) { ui.rfilter = ds.rfilter; render(); return; }
    if (ds.stars) { var sv = +ds.stars; ui.rstars = ui.rstars === sv ? 0 : sv; render(); return; }
    if (ds.reply) { reply(ds.reply); return; }
    if (ds.alert) {
      var a = D.alerts.filter(function (x) { return x.id === ds.alert; })[0];
      if (a && a.read !== true) { a.read = true; render(); owner('POST', '/v1/owner/doc', { coll: 'alerts', id: a.id, body: { read: true } }).catch(function () {}); }
      return;
    }
    if (ds.knob) { knob(ds.knob); return; }
    if (ds.mailtest) {
      act('mailTest', { user: ds.mailtest }).then(function () { toast('시험 메일을 보냈습니다. 내 메일함을 확인하세요.'); }, function (er) { toast('실패: ' + er.message); });
      return;
    }
    if (ds.pc) {
      var cur = str(o(o(D.pc).state).current);
      if (ds.pc === 'pause') pcSwitch({ action: 'pause' }, '업데이트 멈춤', 'PC에 새 버전 안내를 멈춥니다. 이미 받은 안내도 다음 확인 때 사라집니다.');
      else pcSwitch({ action: 'resume' }, '업데이트 재개', '모든 PC에 v' + cur + ' 업데이트를 다시 안내합니다.');
      return;
    }
    if (ds.pcv) {
      var st = o(o(D.pc).state), c = str(st.current), v = ds.pcv, older = c && cmpVer(v, c) < 0;
      pcSwitch({ action: 'current', version: v }, older ? 'v' + v + '(으)로 되돌리기' : 'v' + v + ' 배포',
        older ? 'v' + c + ' 대신 v' + v + '를 기준으로 합니다. 아직 v' + c + '을(를) 받지 않은 PC는 더 이상 안내받지 않습니다. 이미 v' + c + '인 PC는 그대로입니다.'
          : '모든 PC에 v' + v + ' 업데이트를 안내합니다.' + (st.paused === true ? ' (업데이트 멈춤은 그대로이니 재개해야 안내됩니다.)' : ''));
    }
  });

  // --- sign-in -----------------------------------------------------------------------------------------------------
  $('signin').onclick = function () {
    $('gateMsg').textContent = '';
    var p = new firebase.auth.GoogleAuthProvider(); p.setCustomParameters({ prompt: 'select_account' });
    auth.signInWithPopup(p).catch(function (e) {
      if (e.code === 'auth/popup-closed-by-user' || e.code === 'auth/cancelled-popup-request') return;
      $('gateMsg').textContent = e.code === 'auth/unauthorized-domain' ? '이 주소는 Firebase 로그인 허용 도메인에 없습니다(Firebase 콘솔 → Authentication → 설정 → 승인된 도메인).' : '로그인하지 못했습니다: ' + e.message;
    });
  };
  $('signout').onclick = function () { auth.signOut(); };
  $('refresh').onclick = function () { refresh(); };

  var timer = null;
  auth.onAuthStateChanged(function (user) {
    isDenied = false;
    clearInterval(timer);
    $('drawer').hidden = true;
    $('gate').hidden = !!user; $('view').hidden = !user; $('tabs').hidden = !user; $('refresh').hidden = !user; $('signout').hidden = !user;
    $('status').textContent = user ? (user.email || '') : '';
    if (!user) { D = { snapshot: null, daily: [], users: [], alerts: [], reviews: [], state: null, rtdn: null, actions: [], errors: null, pc: null, config: null, configError: null, mail: null, mailError: null, loadedAt: 0 }; return; }
    route();
    refresh();
    // Every two minutes while the tab is in front (as the app polls while on screen), and once on the way back.
    timer = setInterval(function () { if (!document.hidden) refresh(); }, 120000);
  });
  document.addEventListener('visibilitychange', function () { if (!document.hidden && auth.currentUser && Date.now() - D.loadedAt > 120000) refresh(); });
})();
