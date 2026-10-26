// 웹 원격 (remote.html): this browser drives the user's own Deskify PC (D:\deskify\docs\Deskify-웹원격-설계.md).
//
// 1. Google sign-in (Firebase, the site's registered web config), then this browser joins the account as a device
//    (kind "web": a random id and the key the hub hands out once, kept in this browser's storage). Like any new device
//    it waits until one of the account's devices allows it ("허용", or "이번만 허용": gone when the session ends).
// 2. The account's PCs (GET /v1/web/pcs). Connecting starts the account's one web session (POST /v1/web/session: a
//    second one anywhere ends the first), then an offer note through the hub; the PC answers when it allows browsers.
// 3. WebRTC with STUN only first. No direct path: once more through a relay (TURN from relay-ice: Pro, an hour a day,
//    held to data-saving quality), else a plain word that this network can't reach the PC.
// 4. One data channel: H.264 (Annex-B) from the PC into WebCodecs' VideoDecoder → a canvas; mouse, wheel, keys and text
//    back as JSON. Wire format: see windows/Deskify.Avalonia/Companion/WebRemote.cs.
(function () {
  'use strict';
  var FIREBASE = { apiKey: 'AIzaSyDo0c609Q7a_pLybp9SgHcLoa6-3zAZ8xs', authDomain: 'deskify-8bd6f.firebaseapp.com', projectId: 'deskify-8bd6f', appId: '1:247125407711:web:762b38f33f61a9d7ac766a' };
  var HUB = 'https://deskify-api.kim290.workers.dev';
  var RELAY_ICE = 'https://asia-northeast3-deskify-8bd6f.cloudfunctions.net/relay-ice';
  // STUN only for the first try (free; no relay): a direct path wins whenever one exists.
  var STUN = [{ urls: 'stun:stun.l.google.com:19302' }, { urls: 'stun:stun.cloudflare.com:3478' }];
  var WAIT_POLL_MS = 4000;
  var ANSWER_MS = 60000;
  var OPEN_MS = 15000;
  var FRAME = 1, JSONMSG = 2, AUDIO = 3, FILECHUNK = 4;

  firebase.initializeApp(FIREBASE);
  var auth = firebase.auth();
  var $ = function (id) { return document.getElementById(id); };
  var lang = function () { return document.documentElement.getAttribute('data-lang') === 'en' ? 'en' : 'ko'; };
  var T = function (ko, en) { return lang() === 'en' ? en : ko; };

  $('lang').textContent = lang() === 'en' ? '한국어' : 'English';
  $('lang').onclick = function () {
    var next = lang() === 'en' ? 'ko' : 'en';
    try { localStorage.setItem('lang', next); } catch (e) {}
    document.documentElement.setAttribute('data-lang', next); document.documentElement.lang = next;
    $('lang').textContent = next === 'en' ? '한국어' : 'English';
  };

  // --- screens ------------------------------------------------------------------------------------------------
  var SECTIONS = ['gate', 'wait', 'pcs', 'connecting', 'ended'];
  function show(id) {
    SECTIONS.forEach(function (s) { $(s).hidden = s !== id; });
    $('session').hidden = true; $('main').hidden = false; $('top').hidden = false;
  }

  // --- this browser as a device ---------------------------------------------------------------------------------
  var me = null;         // { id, key }
  var skew = 0;          // the hub's clock less this one (from the device answer's lastSeen)
  var lastToken = '';    // for the goodbye sent while the page closes (no time to ask Firebase then)
  function storeKey(uid) { return 'deskify.web.' + uid; }
  function loadMe(uid) {
    try { var v = JSON.parse(localStorage.getItem(storeKey(uid)) || 'null'); if (v && v.id) return v; } catch (e) {}
    return null;
  }
  function saveMe(uid) { try { localStorage.setItem(storeKey(uid), JSON.stringify(me)); } catch (e) {} }
  function newId() {
    var b = new Uint8Array(12); crypto.getRandomValues(b);
    return 'web-' + Array.prototype.map.call(b, function (x) { return ('0' + x.toString(16)).slice(-2); }).join('');
  }
  /** "Chrome · Windows": what the account's devices see when asked about this browser. */
  function browserName() {
    var ua = navigator.userAgent, b = 'Browser', os = '';
    if (/Edg\//.test(ua)) b = 'Edge'; else if (/OPR\//.test(ua)) b = 'Opera'; else if (/SamsungBrowser/.test(ua)) b = 'Samsung Internet';
    else if (/Firefox\//.test(ua)) b = 'Firefox'; else if (/Chrome\//.test(ua)) b = 'Chrome'; else if (/Safari\//.test(ua)) b = 'Safari';
    if (/Windows/.test(ua)) os = 'Windows'; else if (/Android/.test(ua)) os = 'Android'; else if (/iPhone|iPad/.test(ua)) os = 'iOS';
    else if (/Mac OS X/.test(ua)) os = 'macOS'; else if (/CrOS/.test(ua)) os = 'ChromeOS'; else if (/Linux/.test(ua)) os = 'Linux';
    return { name: os ? b + ' · ' + os : b, model: b, os: os };
  }

  async function api(method, path, body, keepalive) {
    var t = auth.currentUser ? await auth.currentUser.getIdToken() : lastToken;
    lastToken = t;
    var headers = { authorization: 'Bearer ' + t, 'x-deskify-keys': '1' };
    if (me && me.key) headers['x-deskify-device'] = me.id + '.' + me.key;
    if (body !== undefined) headers['content-type'] = 'application/json';
    var r = await fetch(HUB + path, { method: method, headers: headers, body: body !== undefined ? JSON.stringify(body) : undefined, keepalive: !!keepalive });
    var text = await r.text(), json = null;
    try { json = text ? JSON.parse(text) : null; } catch (e) {}
    return { status: r.status, body: json };
  }

  var waitTimer = null, waitTick = null, expiresAt = 0;
  async function register(uid) {
    var info = browserName();
    for (var tries = 0; tries < 2; tries++) {
      if (!me) { me = { id: newId(), key: '' }; saveMe(uid); }
      var r = await api('PUT', '/v1/devices/' + encodeURIComponent(me.id), { name: info.name, model: info.model, os: info.os, kind: 'web' });
      // The hub holds a key for this id that this browser lost (storage cleared): a new id, asked about anew.
      if (r.status === 401) { me = null; continue; }
      // No app let in on this account: nobody could let this browser in (a browser is never an account's first device).
      if (r.status === 412) { me = null; try { localStorage.removeItem(storeKey(uid)); } catch (e) {} throw new Error(T('이 계정에 등록된 PC가 없습니다. PC에 Deskify를 설치하고 같은 구글 계정으로 로그인하십시오.', 'This account has no PC yet. Install Deskify on your PC and sign in there with the same Google account.')); }
      if (r.status === 409) throw new Error(T('이 계정에 브라우저가 너무 많습니다. 폰이나 PC의 Deskify에서 쓰지 않는 브라우저를 빼 주십시오.', 'Too many browsers on this account. Remove unused ones in Deskify on your phone or PC.'));
      if (r.status !== 200 || !r.body) throw new Error('HTTP ' + r.status);
      if (r.body.key) { me.key = r.body.key; saveMe(uid); }
      if (r.body.lastSeen) skew = r.body.lastSeen - Date.now();
      return r.body;
    }
    throw new Error(T('이 브라우저를 등록하지 못했습니다', 'Could not register this browser'));
  }

  async function start(user) {
    $('who').textContent = user.email || '';
    $('signout').hidden = false;
    me = loadMe(user.uid);
    $('waitName').textContent = browserName().name;
    try {
      var d = await register(user.uid);
      if (d.approved) return listPcs(d);
      waitFor(user.uid, d);
    } catch (e) { show('gate'); $('gateMsg').textContent = e.message; }
  }

  function stopWait() { clearInterval(waitTimer); clearInterval(waitTick); waitTimer = waitTick = null; }

  /** Waiting to be let in: the countdown of the request, and a look every few seconds. */
  function waitFor(uid, d) {
    show('wait');
    stopWait();
    expiresAt = d.expiresAt || 0;
    $('waitMsg').textContent = ''; $('askAgain').hidden = true; $('waitSpin').hidden = false;
    // Someone tried to keep this browser for good, but the account has its five devices: said here, still waiting
    // (이번만 허용 can still let it in).
    var full = function (dev) {
      if (dev && dev.full) $('waitMsg').textContent = T('이 계정에 기기가 5대라 이 브라우저를 계속 허용할 수는 없습니다. 허용하는 기기에서 "이번만 허용"을 누르거나, 기기 하나를 지운 뒤 다시 허용해 주십시오.', 'This account already has 5 devices, so this browser can\'t be allowed for good. Choose "Allow this once" on the other device, or remove a device there and allow again.');
    };
    full(d);
    var paint = function () {
      var left = expiresAt ? expiresAt - (Date.now() + skew) : 0;
      if (expiresAt && left <= 0) {
        $('waitLeft').textContent = T('요청이 만료되었습니다. 다시 요청하면 이 계정의 기기에 다시 알립니다.', 'The request expired. Ask again to tell the account\'s devices once more.');
        $('askAgain').hidden = false; $('waitSpin').hidden = true;
        return;
      }
      var s = Math.ceil(left / 1000);
      $('waitLeft').textContent = expiresAt ? T('요청은 ', 'The request expires in ') + Math.floor(s / 60) + ':' + ('0' + (s % 60)).slice(-2) + T(' 뒤 만료됩니다', '') : '';
    };
    paint();
    waitTick = setInterval(paint, 1000);
    waitTimer = setInterval(async function () {
      if (document.hidden) return;
      try {
        var r = await api('GET', '/v1/devices/' + encodeURIComponent(me.id));
        if (r.status === 404) {
          // Turned away (or the request was never answered and the device removed): a fresh start asks again.
          stopWait(); me = null; try { localStorage.removeItem(storeKey(uid)); } catch (e) {}
          $('waitMsg').textContent = T('다른 기기에서 이 브라우저를 거절했습니다.', 'Another device turned this browser away.');
          $('askAgain').hidden = false; $('waitSpin').hidden = true;
          return;
        }
        if (r.status === 200 && r.body && r.body.approved) { stopWait(); listPcs(r.body); return; }
        if (r.status === 200) full(r.body);
        if (r.body && r.body.expiresAt && r.body.expiresAt !== expiresAt) expiresAt = r.body.expiresAt;
      } catch (e) {}
    }, WAIT_POLL_MS);
  }

  $('askAgain').onclick = async function () {
    var u = auth.currentUser; if (!u) return;
    $('askAgain').disabled = true;
    try { var d = await register(u.uid); if (d.approved) listPcs(d); else waitFor(u.uid, d); }
    catch (e) { $('waitMsg').textContent = e.message; }
    $('askAgain').disabled = false;
  };

  // --- the account's PCs ------------------------------------------------------------------------------------------
  var pcsTimer = null, lastPc = null, onceDevice = false;
  async function listPcs(d) {
    show('pcs');
    if (d) onceDevice = !!d.once;
    $('onceNote').hidden = !onceDevice;
    $('pcsMsg').textContent = '';
    var r = await api('GET', '/v1/web/pcs');
    if (r.status === 403) { $('pcsMsg').textContent = T('이 브라우저는 더 이상 허용되어 있지 않습니다. 다시 허용받아 주십시오.', 'This browser is no longer allowed. Get it allowed again.'); return reallow(); }
    if (r.status !== 200) { $('pcsMsg').textContent = 'HTTP ' + r.status; return; }
    var list = $('pcList'); list.innerHTML = '';
    if (!r.body.length) list.innerHTML = '<p class="rm-muted">' + T('이 계정에 등록된 PC가 없습니다. PC에서 Deskify에 로그인해 주십시오.', 'No PC on this account yet. Sign in to Deskify on the PC.') + '</p>';
    r.body.sort(function (a, b) { return (b.live - a.live) || (b.at - a.at); }).forEach(function (pc) {
      var row = document.createElement('div'); row.className = 'rm-pc';
      var dot = document.createElement('span'); dot.className = 'dot' + (pc.live ? ' on' : '');
      var t = document.createElement('div'); t.className = 't';
      var b = document.createElement('b'); b.textContent = pc.name || pc.id;
      var s = document.createElement('small');
      s.textContent = !pc.web ? T('브라우저 원격이 꺼져 있습니다 (PC의 설정 → 모바일 기기)', 'Browser remote is off (Settings → Mobile devices on the PC)')
        : pc.live ? T('켜져 있음', 'On') : T('꺼져 있거나 오프라인', 'Off or offline');
      t.appendChild(b); t.appendChild(s);
      var go = document.createElement('button'); go.className = 'rm-primary'; go.type = 'button';
      go.textContent = T('연결', 'Connect');
      go.disabled = !pc.web;
      go.onclick = function () { connect(pc); };
      row.appendChild(dot); row.appendChild(t); row.appendChild(go);
      list.appendChild(row);
    });
    clearTimeout(pcsTimer);
    pcsTimer = setTimeout(function () { if (!$('pcs').hidden) listPcs(); }, 15000);
  }
  $('reload').onclick = function () { listPcs(); };
  $('forget').onclick = async function () {
    if (!me || !confirm(T('이 브라우저를 계정에서 뺄까요?', 'Remove this browser from the account?'))) return;
    await api('DELETE', '/v1/devices/' + encodeURIComponent(me.id));
    var u = auth.currentUser; if (u) try { localStorage.removeItem(storeKey(u.uid)); } catch (e) {}
    me = null; auth.signOut();
  };
  /** This browser's allowance ended ("이번만" used up, or taken off): it asks again. */
  async function reallow() {
    var u = auth.currentUser; if (!u) return show('gate');
    try { var d = await register(u.uid); if (d.approved) listPcs(d); else waitFor(u.uid, d); } catch (e) { $('pcsMsg').textContent = e.message; }
  }

  // --- connecting ----------------------------------------------------------------------------------------------------
  var S = null;  // the session: { pc, session, peer, dc, relay, until, left, ... }
  var cancelled = false;

  function step(text) { $('connStep').textContent = text; }

  async function connect(pc) {
    lastPc = pc; cancelled = false;
    clearTimeout(pcsTimer);
    $('pcsInfo').hidden = true;
    if (!('VideoDecoder' in window)) return ended(T('이 브라우저로는 화면을 볼 수 없습니다', 'This browser can\'t show the screen'),
      T('WebCodecs를 지원하지 않습니다. 최신 Chrome·Edge·Safari(16.4 이상)·Firefox(130 이상)를 사용해 주십시오.', 'It has no WebCodecs. Use a recent Chrome, Edge, Safari (16.4+) or Firefox (130+).'));
    show('connecting');
    $('connTitle').textContent = T(pc.name + '에 연결하는 중', 'Connecting to ' + pc.name);
    step(T('웹 원격을 시작하는 중…', 'Starting web remote…'));
    var r = await api('POST', '/v1/web/session', { pc: pc.id });
    if (r.status === 403) return reallow();
    if (r.status !== 200) return ended(T('연결하지 못했습니다', 'Could not connect'), 'HTTP ' + r.status);
    S = { pc: pc, session: r.body.session };
    var first = await attempt(false);
    if (cancelled) return;
    if (first === 'ok') return;
    if (first !== 'nopath') return;
    // No direct path: a relay, if this account may use one now.
    step(T('직접 연결이 안 되어 중계 서버로 다시 시도하는 중…', 'No direct path; trying through a relay…'));
    var ice;
    try {
      var t = await auth.currentUser.getIdToken();
      var rr = await fetch(RELAY_ICE, { method: 'POST', headers: { authorization: 'Bearer ' + t, 'content-type': 'application/json' }, body: JSON.stringify({ web: true, session: S.session }) });
      ice = rr.ok ? await rr.json() : { iceServers: [], reason: 'http' };
    } catch (e) { ice = { iceServers: [], reason: 'http' }; }
    var noPath = T('이 네트워크에서는 PC와 직접 연결할 수 없습니다 (회사·학교망 등). 다른 네트워크에서 시도해 주십시오.', 'This network can\'t reach the PC directly (office or school networks, for example). Try from another network.');
    if (!ice.iceServers || !ice.iceServers.length) {
      endSession('norelay');
      var why = ice.reason === 'daily' ? T('오늘 중계 연결 시간(1시간)을 다 썼습니다. 직접 연결되는 네트워크에서는 계속 쓸 수 있습니다.', 'Today\'s relay time (1 hour) is used up. Networks with a direct path still work.')
        : ice.reason === 'plan' ? noPath + ' ' + T('(중계 연결은 Pro 기능입니다)', '(Relayed connections are a Pro feature.)')
        : ice.reason === 'cap' ? noPath + ' ' + T('(중계 서버가 오늘 한도에 도달했습니다)', '(The relay has reached today\'s limit.)')
        : noPath;
      return ended(T('연결할 수 없습니다', 'Can\'t connect'), why);
    }
    S.until = Date.now() + (ice.ttl || 0) * 1000;
    S.left = ice.left || 0;
    var second = await attempt(true, STUN.concat(ice.iceServers));
    if (cancelled || second === 'ok') return;
    if (second === 'nopath') { endSession('nopath'); ended(T('연결할 수 없습니다', 'Can\'t connect'), noPath); }
  }

  $('connCancel').onclick = function () { cancelled = true; closePeer(); endSession('cancel'); listPcs(); };

  function waitGathered(peer) {
    return new Promise(function (res) {
      if (peer.iceGatheringState === 'complete') return res();
      var done = function () { if (peer.iceGatheringState === 'complete') { peer.removeEventListener('icegatheringstatechange', done); res(); } };
      peer.addEventListener('icegatheringstatechange', done);
      // Enough candidates by then (a STUN server that doesn't answer mustn't hold the offer up).
      setTimeout(res, relayGatherMs);
    });
  }
  var relayGatherMs = 3000;

  /** One try: 'ok' (open, session running), 'nopath' (answered but no way through), or 'fail' (said why already). */
  async function attempt(relay, servers) {
    var peer = new RTCPeerConnection({ iceServers: servers || STUN });
    var dc = peer.createDataChannel('deskify-web', { ordered: true });
    dc.binaryType = 'arraybuffer';
    S.peer = peer; S.dc = dc; S.relay = relay;
    relayGatherMs = relay ? 5000 : 3000;
    await peer.setLocalDescription(await peer.createOffer());
    step(relay ? T('중계 서버로 연결하는 중…', 'Connecting through the relay…') : T('PC에 연결을 요청하는 중…', 'Asking the PC…'));
    await waitGathered(peer);
    if (cancelled) return 'fail';
    var noteId = (crypto.randomUUID ? crypto.randomUUID() : newId());
    var put = await api('PUT', '/v1/notes/' + noteId, { from: me.id, to: S.pc.id, kind: 'webRemote', session: S.session, sdp: peer.localDescription.sdp, relay: relay, at: Date.now() });
    if (put.status === 409) { closePeer(); ended(T('연결이 끝났습니다', 'Connection ended'), T('다른 곳에서 새 웹 원격이 시작되었습니다.', 'A new web remote session started somewhere else.')); return 'fail'; }
    if (put.status === 403) { closePeer(); reallow(); return 'fail'; }
    if (put.status !== 200) { closePeer(); ended(T('연결하지 못했습니다', 'Could not connect'), 'HTTP ' + put.status); return 'fail'; }
    step(T('PC의 응답을 기다리는 중…', 'Waiting for the PC…'));
    var answer = null, refused = null, until = Date.now() + ANSWER_MS;
    while (!answer && !refused && Date.now() < until && !cancelled) {
      var g = await api('GET', '/v1/notes/' + noteId + '?wait=answer&ms=25000');
      if (g.status === 200 && g.body) { refused = g.body.refused || null; answer = g.body.answer || null; }
      else if (g.status === 404) break;
    }
    api('DELETE', '/v1/notes/' + noteId).catch(function () {});
    if (cancelled) return 'fail';
    if (refused || !answer) {
      closePeer(); endSession(refused || 'timeout');
      var text = refused === 'off' ? T('이 PC에서 "브라우저에서 이 PC 원격 허용"이 꺼져 있습니다. PC의 Deskify → 설정 → 모바일 기기에서 켜 주십시오.', 'Browser remote is off on this PC. Turn it on in Deskify → Settings → Mobile devices on the PC.')
        : refused === 'plan' ? T('웹 원격은 Deskify Pro 기능입니다.', 'Web remote is a Deskify Pro feature.')
        : refused === 'check' ? T('이 브라우저의 허용이 끝났거나 다른 곳에서 새 웹 원격이 시작되었습니다.', 'This browser\'s allowance ended, or a new web remote session started elsewhere.')
        : T('PC가 응답하지 않습니다. PC가 켜져 있고 Deskify가 실행 중인지 확인해 주십시오.', 'The PC didn\'t answer. Check that it is on and Deskify is running.');
      ended(T('연결하지 못했습니다', 'Could not connect'), text);
      return 'fail';
    }
    await peer.setRemoteDescription({ type: 'answer', sdp: answer });
    step(T('연결하는 중…', 'Connecting…'));
    var open = await new Promise(function (res) {
      var t = setTimeout(function () { res(false); }, relay ? OPEN_MS + 5000 : OPEN_MS);
      dc.onopen = function () { clearTimeout(t); res(true); };
      peer.oniceconnectionstatechange = function () { if (peer.iceConnectionState === 'failed') { clearTimeout(t); res(false); } };
    });
    if (cancelled) return 'fail';
    if (!open) { closePeer(); return 'nopath'; }
    await begin();
    return 'ok';
  }

  /** Whether the path chosen goes through a relay (either end's candidate). */
  async function relayed(peer) {
    try {
      var stats = await peer.getStats(), pair = null, byId = {};
      stats.forEach(function (s) { byId[s.id] = s; });
      stats.forEach(function (s) { if (s.type === 'transport' && s.selectedCandidatePairId) pair = byId[s.selectedCandidatePairId]; });
      if (!pair) stats.forEach(function (s) { if (s.type === 'candidate-pair' && s.state === 'succeeded' && (s.nominated || s.selected)) pair = pair || s; });
      if (!pair) return false;
      var l = byId[pair.localCandidateId], r = byId[pair.remoteCandidateId];
      S.rtt = pair.currentRoundTripTime;
      return (l && l.candidateType === 'relay') || (r && r.candidateType === 'relay');
    } catch (e) { return false; }
  }

  function closePeer() {
    if (!S) return;
    try { S.dc && S.dc.close(); } catch (e) {}
    try { S.peer && S.peer.close(); } catch (e) {}
  }
  function endSession(why, keepalive) {
    if (!S || S.ended) return;
    S.ended = true;
    api('POST', '/v1/web/end', { session: S.session, why: why }, keepalive).catch(function () {});
  }

  // --- the session ---------------------------------------------------------------------------------------------------
  var canvas = $('screen'), ctx2d = canvas.getContext('2d');
  var decoder = null, codec = '', needKey = true, frameParts = [], frameBytes = 0, frameKey = false, frameTs = 0;
  var stream = { w: 0, h: 0, mw: 0, mh: 0 };
  var counters = { frames: 0, bytes: 0, at: performance.now() };
  var statsTimer = null, pingTimer = null, sizeTimer = null;
  var touchMode = matchMedia('(pointer: coarse)').matches;

  function send(o) { if (S && S.dc && S.dc.readyState === 'open') S.dc.send(new TextEncoder().encode(JSON.stringify(o))); }

  async function begin() {
    $('main').hidden = true; $('top').hidden = true; $('session').hidden = false;
    $('barName').textContent = S.pc.name;
    S.relay = S.relay || await relayed(S.peer);
    paintRelay();
    needKey = true; codec = ''; stream = { w: 0, h: 0, mw: 0, mh: 0 };
    $('notice').hidden = true;
    sound.on = false; sound.chosen = false; paintSound();
    resetZoom(); noPageZoom(true);
    S.dc.onmessage = onMessage;
    S.dc.onclose = function () { if (S && !S.ended) lost(); };
    S.peer.oniceconnectionstatechange = function () { if (S && S.peer.iceConnectionState === 'failed' && !S.ended) lost(); };
    var size = viewSize();
    send({ t: 'hello', w: size.w, h: size.h, relay: !!S.relay, until: S.until || 0, q: $('quality').value, v: 1 });
    canvas.focus();
    clearInterval(statsTimer); clearInterval(pingTimer);
    statsTimer = setInterval(paintStats, 1000);
    // RTT, and whether the path moved to or off a relay (ICE may switch after it starts).
    pingTimer = setInterval(async function () {
      send({ t: 'ping', at: performance.now() });
      var r = await relayed(S.peer);
      if (r !== !!S.relay && S.dc && S.dc.readyState === 'open') {
        S.relay = r; send({ t: 'relay', on: r }); paintRelay();
        // Over a relay the sound goes off (its data counts), unless it was turned on by hand.
        if (r && sound.on && !sound.chosen) setSound(false, false);
      }
    }, 2000);
  }

  function paintRelay() {
    var b = $('relayBadge');
    if (!S.relay) { b.hidden = true; return; }
    b.hidden = false;
    var left = S.until ? Math.max(0, Math.round((S.until - Date.now()) / 60000)) : null;
    b.textContent = T('중계 연결 (데이터 절약 화질)', 'Relayed (data-saving quality)') + (left != null ? T(' · 오늘 남은 중계 ', ' · relay left today ') + left + T('분', ' min') : '');
  }

  function viewSize() {
    var r = $('stage').getBoundingClientRect(), k = window.devicePixelRatio || 1;
    return { w: Math.round(r.width * k), h: Math.round(r.height * k) };
  }
  window.addEventListener('resize', function () {
    if (!S || $('session').hidden) return;
    clearTimeout(sizeTimer);
    sizeTimer = setTimeout(function () { var s = viewSize(); send({ t: 'size', w: s.w, h: s.h }); }, 400);
  });

  function onMessage(e) {
    var b = new Uint8Array(e.data);
    if (!b.length) return;
    counters.bytes += b.length; window.__rmBytes = (window.__rmBytes || 0) + b.length;
    if (b[0] === FRAME) return onFramePart(b);
    if (b[0] === AUDIO) return onAudio(b);
    if (b[0] !== JSONMSG) return;
    var m; try { m = JSON.parse(new TextDecoder().decode(b.subarray(1))); } catch (x) { return; }
    switch (m.t) {
      case 'hello':
        stream.w = m.w; stream.h = m.h; stream.mw = m.mw; stream.mh = m.mh;
        S.relay = !!m.relay || S.relay; paintRelay();
        var sel = $('monitor');
        sel.hidden = !(m.monitors && m.monitors.length > 1);
        sel.innerHTML = '';
        (m.monitors || []).forEach(function (i) { var o = document.createElement('option'); o.value = i; o.textContent = T('모니터 ', 'Monitor ') + (i + 1); sel.appendChild(o); });
        sel.value = m.monitor;
        needKey = true;
        // What else the PC does: the clipboard, files to it, its sound (on by default on a direct path only).
        $('btnClip').hidden = !m.clip; $('btnFile').hidden = !m.files; $('btnSnd').hidden = !m.sound || !('AudioDecoder' in window);
        // The secure desktop (lock/sign-in screen, UAC) through the PC's service helper: say so, offer Ctrl+Alt+Del, no files/sound/clipboard there.
        S.secure = !!m.secure;
        $('optCad').hidden = !m.secure;
        if (m.secure) { $('btnClip').hidden = true; $('btnFile').hidden = true; $('btnSnd').hidden = true; }
        $('secure').hidden = !m.secure;
        if (!$('btnSnd').hidden && !sound.chosen && sound.on !== !S.relay) setSound(!S.relay, false);
        break;
      case 'clip': gotClip(m.s || ''); break;
      case 'snd': sound.rate = m.rate || 48000; break;
      case 'fdone': fileDone(m.id, T('PC의 받기 폴더에 저장했습니다: ', 'Saved in the PC\'s receive folder: ') + m.name); break;
      case 'ferr': fileDone(m.id, m.message || T('PC에 저장하지 못했습니다', 'Couldn\'t save it on the PC')); break;
      case 'size': stream.w = m.w; stream.h = m.h; needKey = true; break;
      case 'cur': moveCursor(m); break;
      case 'curs': setCursor(m); break;
      case 'pong': S.rttPing = performance.now() - m.at; break;
      case 'error': toast(m.message, 8000); break;
      // The PC's session isn't drawing its screen (its remote desktop window minimized or disconnected): said until it is again.
      case 'drawing': $('notice').textContent = m.message || ''; $('notice').hidden = !!m.on; break;
      case 'bye':
        S.byeWhy = m.why;
        var why = m.why === 'replaced' ? T('다른 곳에서 새 웹 원격을 시작해 이 연결이 끝났습니다.', 'A new web remote session started elsewhere, so this one ended.')
          : m.why === 'pc' ? T('PC에서 연결을 끊었습니다.', 'The PC disconnected.')
          : m.why === 'relayTime' ? T('오늘 중계 연결 시간(1시간)을 다 썼습니다. 직접 연결되는 네트워크에서는 계속 쓸 수 있습니다.', 'Today\'s relay time (1 hour) is used up. Networks with a direct path still work.')
          : T('연결이 끝났습니다.', 'The connection ended.');
        finish(T('연결이 끝났습니다', 'Connection ended'), why, false);
        break;
    }
  }

  // A frame comes in parts: [1][flags: 1 key, 2 first, 4 last][u32 frame][i64 µs] + bytes.
  function onFramePart(b) {
    var flags = b[1];
    var dv = new DataView(b.buffer, b.byteOffset, b.byteLength);
    if (flags & 2) { frameParts = []; frameBytes = 0; frameKey = !!(flags & 1); frameTs = Number(dv.getBigInt64(6)); }
    frameParts.push(b.subarray(14)); frameBytes += b.length - 14;
    if (!(flags & 4)) return;
    var data = new Uint8Array(frameBytes), at = 0;
    frameParts.forEach(function (p) { data.set(p, at); at += p.length; });
    frameParts = [];
    decode(data, frameKey, frameTs);
  }

  /** "avc1.PPCCLL" from the stream's own SPS (profile, constraints, level), so the decoder is set up for exactly it. */
  function codecOf(data) {
    for (var i = 0; i + 7 < data.length; i++) {
      if (data[i] === 0 && data[i + 1] === 0 && (data[i + 2] === 1 || (data[i + 2] === 0 && data[i + 3] === 1))) {
        var n = data[i + 2] === 1 ? i + 3 : i + 4;
        if ((data[n] & 0x1f) === 7) return 'avc1.' + [data[n + 1], data[n + 2], data[n + 3]].map(function (x) { return ('0' + x.toString(16)).slice(-2); }).join('').toUpperCase();
      }
    }
    return '';
  }

  function decode(data, key, ts) {
    if (needKey && !key) return;
    if (key) {
      var c = codecOf(data);
      if (c && (c !== codec || !decoder || decoder.state !== 'configured')) {
        try { if (decoder && decoder.state !== 'closed') decoder.close(); } catch (e) {}
        decoder = new VideoDecoder({ output: draw, error: function (e) { console.warn('decoder', e); needKey = true; codec = ''; send({ t: 'key' }); } });
        decoder.configure({ codec: c, optimizeForLatency: true });
        codec = c;
      }
      needKey = false;
    }
    if (!decoder || decoder.state !== 'configured') { needKey = true; return; }
    // Falling behind (a slow device): skip to the next key frame rather than show the past late.
    if (!key && decoder.decodeQueueSize > 4) { needKey = true; send({ t: 'key' }); return; }
    try { decoder.decode(new EncodedVideoChunk({ type: key ? 'key' : 'delta', timestamp: ts, data: data })); }
    catch (e) { needKey = true; send({ t: 'key' }); }
  }

  function draw(frame) {
    if (canvas.width !== frame.displayWidth || canvas.height !== frame.displayHeight) { canvas.width = frame.displayWidth; canvas.height = frame.displayHeight; }
    ctx2d.drawImage(frame, 0, 0);
    frame.close();
    counters.frames++; window.__rmFrames = (window.__rmFrames || 0) + 1;
    placeCursor();
  }

  function paintStats() {
    var now = performance.now(), dt = (now - counters.at) / 1000;
    var fps = Math.round(counters.frames / dt), kbps = Math.round(counters.bytes * 8 / 1000 / dt);
    counters = { frames: 0, bytes: 0, at: now };
    var rtt = S && S.rttPing ? Math.round(S.rttPing) : S && S.rtt ? Math.round(S.rtt * 1000) : null;
    $('stats').textContent = fps + ' fps · ' + kbps + ' kbps' + (rtt != null ? ' · ' + rtt + ' ms' : '');
    if (S && S.relay) paintRelay();
  }

  // The picture as drawn inside the canvas box (object-fit: contain): where pointer positions map from.
  function picture() {
    var r = canvas.getBoundingClientRect();
    var w = canvas.width || 16, h = canvas.height || 9;
    var k = Math.min(r.width / w, r.height / h), dw = w * k, dh = h * k;
    return { x: r.left + (r.width - dw) / 2, y: r.top + (r.height - dh) / 2, w: dw, h: dh };
  }
  function norm(cx, cy) {
    var p = picture();
    return { x: Math.min(1, Math.max(0, (cx - p.x) / p.w)), y: Math.min(1, Math.max(0, (cy - p.y) / p.h)) };
  }

  // --- the PC's mouse pointer: as this page's own cursor for a mouse; drawn over the picture for touch ------------------
  var cur = { x: 0, y: 0, v: true, img: null, hx: 0, hy: 0, w: 0, h: 0 };
  function setCursor(m) {
    var url = 'data:image/png;base64,' + m.b64;
    cur.hx = m.hx; cur.hy = m.hy;
    var img = new Image();
    img.onload = function () { cur.w = img.width; cur.h = img.height; placeCursor(); };
    img.src = url; $('cursor').src = url;
    if (!touchMode) canvas.style.cursor = 'url(' + url + ') ' + m.hx + ' ' + m.hy + ', default';
  }
  function moveCursor(m) { cur.x = m.x; cur.y = m.y; cur.v = m.v; placeCursor(); }
  function placeCursor() {
    var el = $('cursor');
    if (!touchMode || !cur.v || !cur.w) { el.hidden = true; return; }
    var p = picture(), st = $('stage').getBoundingClientRect();
    var k = stream.mw ? p.w / stream.mw : 1;
    el.hidden = false;
    el.style.width = cur.w * k + 'px'; el.style.height = cur.h * k + 'px';
    el.style.left = (p.x - st.left + cur.x * p.w) + 'px'; el.style.top = (p.y - st.top + cur.y * p.h) + 'px';
  }

  // --- input -------------------------------------------------------------------------------------------------------------
  var BUTTONS = ['l', 'm', 'r'];
  var moveQueued = null;
  function sendMove(x, y) {
    // One move per animation frame at most (a 1000 Hz mouse would flood the channel).
    var first = !moveQueued;
    moveQueued = { x: x, y: y };
    if (first) requestAnimationFrame(function () { var m = moveQueued; moveQueued = null; if (m) send({ t: 'pm', a: 'move', x: m.x, y: m.y }); });
  }

  canvas.addEventListener('contextmenu', function (e) { e.preventDefault(); });
  canvas.addEventListener('pointerdown', function (e) {
    gesture();
    if (e.pointerType === 'touch') return touchStart(e);
    touchMode = false; placeCursor();
    canvas.focus();
    canvas.setPointerCapture(e.pointerId);
    var p = norm(e.clientX, e.clientY);
    send({ t: 'pm', a: 'down', b: BUTTONS[e.button] || 'l', x: p.x, y: p.y });
    e.preventDefault();
  });
  canvas.addEventListener('pointermove', function (e) {
    if (e.pointerType === 'touch') return touchMove(e);
    var p = norm(e.clientX, e.clientY); sendMove(p.x, p.y);
  });
  canvas.addEventListener('pointerup', function (e) {
    if (e.pointerType === 'touch') return touchEnd(e);
    var p = norm(e.clientX, e.clientY);
    send({ t: 'pm', a: 'up', b: BUTTONS[e.button] || 'l', x: p.x, y: p.y });
  });
  canvas.addEventListener('pointercancel', function (e) { if (e.pointerType === 'touch') touchEnd(e, true); });

  // Wheel: whole notches (120 on Windows) from what the browser reports, in pixels or lines.
  var wheelAcc = { y: 0, x: 0 };
  canvas.addEventListener('wheel', function (e) {
    e.preventDefault();
    var k = e.deltaMode === 1 ? 33 : e.deltaMode === 2 ? 400 : 1;
    wheelAcc.y += e.deltaY * k; wheelAcc.x += e.deltaX * k;
    var ny = Math.trunc(wheelAcc.y / 100), nx = Math.trunc(wheelAcc.x / 100);
    if (ny) { wheelAcc.y -= ny * 100; send({ t: 'wheel', n: -ny }); }
    if (nx) { wheelAcc.x -= nx * 100; send({ t: 'wheel', n: nx, h: true }); }
  }, { passive: false });

  // Touch: tap = click, hold = right click, one finger moving = drag with the left button, two fingers = the wheel.
  var touches = {}, tState = null;
  function touchStart(e) {
    touchMode = true; canvas.style.cursor = 'default';
    e.preventDefault();
    touches[e.pointerId] = { x: e.clientX, y: e.clientY };
    var ids = Object.keys(touches);
    if (ids.length === 1) {
      var p = norm(e.clientX, e.clientY);
      tState = { mode: 'tap', x0: e.clientX, y0: e.clientY, p: p, at: Date.now() };
      tState.hold = setTimeout(function () {
        if (tState && tState.mode === 'tap') { tState.mode = 'done'; send({ t: 'pm', a: 'move', x: p.x, y: p.y }); send({ t: 'pm', a: 'down', b: 'r', x: p.x, y: p.y }); send({ t: 'pm', a: 'up', b: 'r', x: p.x, y: p.y }); if (navigator.vibrate) navigator.vibrate(20); }
      }, 600);
    } else if (ids.length === 2 && tState) {
      clearTimeout(tState.hold);
      if (tState.mode === 'drag') send({ t: 'pm', a: 'up', b: 'l', x: tState.p.x, y: tState.p.y });
      var a = touches[ids[0]], b = touches[ids[1]];
      // Two fingers: a pinch (their distance changes) zooms this view, else moving them together is the wheel.
      tState = { mode: 'two', y: (a.y + b.y) / 2, x: (a.x + b.x) / 2, acc: 0, accx: 0, d0: Math.hypot(a.x - b.x, a.y - b.y), v0: { k: view.k, x: view.x, y: view.y } };
      tState.cx0 = tState.x; tState.cy0 = tState.y;
    }
  }
  function touchMove(e) {
    if (!touches[e.pointerId] || !tState) return;
    touches[e.pointerId] = { x: e.clientX, y: e.clientY };
    if (tState.mode === 'two' || tState.mode === 'zoom') {
      var tw = Object.keys(touches); if (tw.length < 2) return;
      var p1 = touches[tw[0]], p2 = touches[tw[1]], cx = (p1.x + p2.x) / 2, cy = (p1.y + p2.y) / 2, d = Math.hypot(p1.x - p2.x, p1.y - p2.y);
      if (tState.mode === 'two') {
        if (Math.abs(d - tState.d0) > 24) tState.mode = 'zoom';
        else if (Math.hypot(cx - tState.cx0, cy - tState.cy0) > 12) {
          tState.mode = 'scroll'; tState.x = cx; tState.y = cy;
          var m = norm(cx, cy); send({ t: 'pm', a: 'move', x: m.x, y: m.y });
          return;
        } else return;
      }
      zoomTo(tState.v0, tState.d0 ? d / tState.d0 : 1, tState.cx0, tState.cy0, cx, cy);
      return;
    }
    if (tState.mode === 'scroll') {
      var ids = Object.keys(touches); if (ids.length < 2) return;
      var a = touches[ids[0]], b = touches[ids[1]], y = (a.y + b.y) / 2, x = (a.x + b.x) / 2;
      tState.acc += y - tState.y; tState.accx += x - tState.x; tState.y = y; tState.x = x;
      var n = Math.trunc(tState.acc / 40); if (n) { tState.acc -= n * 40; send({ t: 'wheel', n: n }); }
      var nx = Math.trunc(tState.accx / 40); if (nx) { tState.accx -= nx * 40; send({ t: 'wheel', n: -nx, h: true }); }
      return;
    }
    var p = norm(e.clientX, e.clientY);
    if (tState.mode === 'tap' && Math.hypot(e.clientX - tState.x0, e.clientY - tState.y0) > 10) {
      clearTimeout(tState.hold);
      tState.mode = 'drag';
      send({ t: 'pm', a: 'move', x: tState.p.x, y: tState.p.y });
      send({ t: 'pm', a: 'down', b: 'l', x: tState.p.x, y: tState.p.y });
    }
    if (tState.mode === 'drag') { tState.p = p; sendMove(p.x, p.y); }
  }
  function touchEnd(e, cancel) {
    delete touches[e.pointerId];
    if (!tState) return;
    clearTimeout(tState.hold);
    if (tState.mode === 'tap' && !cancel) {
      var p = tState.p;
      send({ t: 'pm', a: 'move', x: p.x, y: p.y }); send({ t: 'pm', a: 'down', b: 'l', x: p.x, y: p.y }); send({ t: 'pm', a: 'up', b: 'l', x: p.x, y: p.y });
    } else if (tState.mode === 'drag') send({ t: 'pm', a: 'up', b: 'l', x: tState.p.x, y: tState.p.y });
    if (!Object.keys(touches).length) { if (tState.mode === 'zoom' && view.k < 1.05) resetZoom(); tState = null; }
    else if (tState.mode !== 'scroll' && tState.mode !== 'zoom' && tState.mode !== 'two') tState = null;
  }

  // Keys: each physical key by its code (the PC's own keyboard layout and IME make the letters, Korean included).
  function inSession() { return S && !S.ended && !$('session').hidden; }
  document.addEventListener('keydown', function (e) {
    if (!inSession() || document.activeElement === $('ime') || e.target.tagName === 'SELECT') return;
    e.preventDefault();
    if (e.repeat && e.code.indexOf('Shift') === 0) return;
    gesture();
    // Ctrl+V: this device's clipboard goes to the PC first (where the browser lets the page read it), then the V.
    if (e.code === 'KeyV' && e.ctrlKey && !e.repeat && navigator.clipboard && navigator.clipboard.readText) {
      skipVUp = true;
      // (Ctrl may be let go before the clipboard is read, a permission prompt say: held again around the V.)
      pushClip(false).then(function () {
        send({ t: 'k', code: 'ControlLeft', down: true }); send({ t: 'k', code: 'KeyV', down: true }); send({ t: 'k', code: 'KeyV', down: false });
        if (!ctrlNow) send({ t: 'k', code: 'ControlLeft', down: false });
      });
      return;
    }
    if (e.code.indexOf('Control') === 0) ctrlNow = true;
    send({ t: 'k', code: e.code, down: true });
  });
  var skipVUp = false, ctrlNow = false;
  document.addEventListener('keyup', function (e) {
    if (!inSession() || document.activeElement === $('ime') || e.target.tagName === 'SELECT') return;
    e.preventDefault();
    if (e.code === 'KeyV' && skipVUp) { skipVUp = false; return; }
    if (e.code.indexOf('Control') === 0) ctrlNow = false;
    send({ t: 'k', code: e.code, down: false });
  });
  // Keys held when the page loses focus would stay down on the PC.
  window.addEventListener('blur', function () { if (inSession()) send({ t: 'release' }); });

  // The on-screen keyboard (phones): typed text goes as text, finished compositions too; Backspace and Enter as keys.
  var ime = $('ime'), composing = false;
  $('btnKbd').onclick = function () { ime.value = ''; ime.focus(); };
  ime.addEventListener('compositionstart', function () { composing = true; });
  ime.addEventListener('compositionend', function (e) { composing = false; if (e.data) send({ t: 'text', s: e.data }); ime.value = ''; });
  ime.addEventListener('beforeinput', function (e) {
    if (e.inputType === 'deleteContentBackward' && !composing) { e.preventDefault(); tap('Backspace'); }
    else if (e.inputType === 'insertLineBreak' || e.inputType === 'insertParagraph') { e.preventDefault(); tap('Enter'); }
  });
  ime.addEventListener('input', function (e) {
    if (composing || e.isComposing) return;
    if (e.inputType === 'insertText' && e.data) send({ t: 'text', s: e.data });
    ime.value = '';
  });
  ime.addEventListener('keydown', function (e) {
    // A hardware key while the on-screen keyboard is up: the special ones still reach the PC.
    if (['Backspace', 'Enter', 'Tab', 'Escape', 'ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown', 'Delete', 'Home', 'End'].indexOf(e.key) >= 0 && !composing) { e.preventDefault(); tap(e.code || e.key); }
  });
  function tap(code) { send({ t: 'k', code: code, down: true }); send({ t: 'k', code: code, down: false }); }

  // --- zoom (phones: a pinch) --------------------------------------------------------------------------------------------
  // This view only, uniformly (the picture keeps the monitor's shape): the canvas scaled and moved inside the stage.
  // Positions sent to the PC come from the canvas's box as drawn (picture()), so input stays where the finger is.
  var view = { k: 1, x: 0, y: 0 };
  function applyZoom() {
    canvas.style.transform = view.k === 1 && !view.x && !view.y ? '' : 'translate(' + view.x + 'px,' + view.y + 'px) scale(' + view.k + ')';
    placeCursor();
  }
  function resetZoom() { view = { k: 1, x: 0, y: 0 }; applyZoom(); }
  /** From [v0] (the view when the pinch began): [scale] times as large, the point under (cx0, cy0) now under (cx, cy). */
  function zoomTo(v0, scale, cx0, cy0, cx, cy) {
    var st = $('stage').getBoundingClientRect();
    var k = Math.min(6, Math.max(1, v0.k * scale));
    // The stage point under the fingers when it began, in the canvas's own (unscaled) pixels.
    var px = (cx0 - st.left - v0.x) / v0.k, py = (cy0 - st.top - v0.y) / v0.k;
    var x = cx - st.left - px * k, y = cy - st.top - py * k;
    // Never past the stage's edges.
    x = Math.min(0, Math.max(st.width - st.width * k, x)); y = Math.min(0, Math.max(st.height - st.height * k, y));
    view = { k: k, x: x, y: y };
    applyZoom();
  }
  window.addEventListener('resize', function () { if (view.k !== 1) resetZoom(); });
  /** In a session, the page itself doesn't zoom (the pinch zooms the PC's picture instead). */
  function noPageZoom(on) {
    var m = document.querySelector('meta[name=viewport]');
    if (m) m.setAttribute('content', 'width=device-width, initial-scale=1, viewport-fit=cover' + (on ? ', maximum-scale=1, user-scalable=no' : ''));
  }

  // --- the PC's sound: AAC frames → WebCodecs AudioDecoder → Web Audio, a little ahead of the clock -----------------------
  var sound = { on: false, chosen: false, ctx: null, dec: null, at: 0, rate: 48000 };
  function audioCtx() {
    if (!sound.ctx) { try { sound.ctx = new (window.AudioContext || window.webkitAudioContext)(); } catch (e) { return null; } }
    if (sound.ctx.state === 'suspended') sound.ctx.resume().catch(function () {});
    return sound.ctx;
  }
  /** On or off ([chosen]: by the 소리 button; else the default, on for a direct path, off over a relay). */
  function setSound(on, chosen) {
    sound.on = on; if (chosen) sound.chosen = true;
    paintSound();
    send({ t: 'snd', on: on });
    if (on) audioCtx(); else closeAudioDecoder();
  }
  function paintSound() { $('btnSnd').setAttribute('aria-pressed', sound.on ? 'true' : 'false'); }
  $('btnSnd').onclick = function () { setSound(!sound.on, true); canvas.focus(); };
  function closeAudioDecoder() { try { if (sound.dec && sound.dec.state !== 'closed') sound.dec.close(); } catch (e) {} sound.dec = null; }
  // [3][i64 µs] + one AAC frame (ADTS: no description needed).
  function onAudio(b) {
    if (!sound.on || !('AudioDecoder' in window) || b.length < 10) return;
    if (!audioCtx()) return;
    if (!sound.dec || sound.dec.state === 'closed') {
      sound.dec = new AudioDecoder({ output: playAudio, error: function (e) { console.warn('audio', e); sound.dec = null; } });
      sound.dec.configure({ codec: 'mp4a.40.2', sampleRate: sound.rate, numberOfChannels: 2 });
    }
    var ts = Number(new DataView(b.buffer, b.byteOffset, b.byteLength).getBigInt64(1));
    try { sound.dec.decode(new EncodedAudioChunk({ type: 'key', timestamp: ts, data: b.subarray(9) })); } catch (e) {}
  }
  function playAudio(data) {
    var ctx = sound.ctx;
    if (!ctx || !sound.on) { data.close(); return; }
    var n = data.numberOfFrames, ch = data.numberOfChannels, buf = ctx.createBuffer(ch, n, data.sampleRate);
    for (var c = 0; c < ch; c++) { var a = new Float32Array(n); data.copyTo(a, { planeIndex: c, format: 'f32-planar' }); buf.copyToChannel(a, c); }
    data.close();
    window.__rmAudio = (window.__rmAudio || 0) + 1;
    // A small cushion against the network's jitter; a backlog (too far ahead) starts over at the cushion.
    var now = ctx.currentTime;
    if (sound.at < now + 0.02 || sound.at > now + 0.4) sound.at = now + 0.08;
    var src = ctx.createBufferSource(); src.buffer = buf; src.connect(ctx.destination); src.start(sound.at);
    sound.at += buf.duration;
  }

  // --- the clipboard's text, both ways ---------------------------------------------------------------------------------
  // PC → here: written to this device's clipboard (or at the next tap/key, when the browser wants a gesture for it).
  // Here → PC: before Ctrl+V reaches the PC, with the button (phones), and when this tab comes back to the front (where
  // the browser already lets the page read it).
  var clip = { last: '', pending: null };
  function gotClip(s) { if (!s || s === clip.last) return; clip.last = s; writeClip(s); }
  function writeClip(s) {
    if (!navigator.clipboard || !navigator.clipboard.writeText) return;
    navigator.clipboard.writeText(s).then(function () { if (clip.pending === s) clip.pending = null; }, function () { clip.pending = s; });
  }
  /** A tap or key in the session: what waits for this device's clipboard goes now, and stopped sound resumes. */
  function gesture() {
    if (clip.pending) writeClip(clip.pending);
    if (sound.on) audioCtx();
  }
  async function pushClip(asked) {
    if (!navigator.clipboard || !navigator.clipboard.readText) {
      if (asked) toast(T('이 브라우저는 페이지가 클립보드를 읽지 못하게 합니다.', 'This browser doesn\'t let pages read the clipboard.'), 4000);
      return false;
    }
    try {
      var s = await navigator.clipboard.readText();
      if (s && (asked || s !== clip.last)) { clip.last = s; send({ t: 'clip', s: s }); if (asked) toast(T('클립보드를 PC로 보냈습니다', 'Clipboard sent to the PC'), 2000); }
      return true;
    } catch (e) {
      if (asked) toast(T('클립보드를 읽지 못했습니다. 브라우저가 허락하지 않았습니다.', 'Couldn\'t read the clipboard: the browser didn\'t allow it.'), 4000);
      return false;
    }
  }
  $('btnClip').onclick = function () { pushClip(true); canvas.focus(); };
  window.addEventListener('focus', function () {
    if (!inSession() || !navigator.permissions || !navigator.permissions.query) return;
    navigator.permissions.query({ name: 'clipboard-read' }).then(function (p) { if (p.state === 'granted') pushClip(false); }).catch(function () {});
  });

  // --- files to the PC (its receive folder: the same as the phones' sends) -----------------------------------------------
  // fs{id, name, size}, then [4][u32 id] + up to 32 KB at a time (waiting while the channel holds 1 MB), fe{id}; the PC
  // answers fdone or ferr. One file at a time; over a relay 100 MB at most (its data is the free allowance).
  var files = { seq: 0, busy: false, queue: [], wait: {} };
  var RELAY_FILE_MAX = 100 * 1024 * 1024;
  $('btnFile').onclick = function () { $('fileIn').value = ''; $('fileIn').click(); };
  $('fileIn').onchange = function () { sendFiles($('fileIn').files); canvas.focus(); };
  var stage = $('stage'), dragDepth = 0;
  stage.addEventListener('dragenter', function (e) { if (!inSession() || $('btnFile').hidden) return; e.preventDefault(); dragDepth++; $('drop').hidden = false; });
  stage.addEventListener('dragover', function (e) { if (inSession() && !$('btnFile').hidden) e.preventDefault(); });
  stage.addEventListener('dragleave', function () { if (--dragDepth <= 0) { dragDepth = 0; $('drop').hidden = true; } });
  stage.addEventListener('drop', function (e) {
    e.preventDefault(); dragDepth = 0; $('drop').hidden = true;
    if (inSession() && !$('btnFile').hidden && e.dataTransfer && e.dataTransfer.files.length) sendFiles(e.dataTransfer.files);
  });
  async function sendFiles(list) {
    for (var i = 0; i < list.length; i++) files.queue.push(list[i]);
    if (files.busy) return;
    files.busy = true;
    try { while (files.queue.length && inSession()) await sendFile(files.queue.shift()); }
    finally { files.busy = false; $('xfer').hidden = true; }
  }
  async function sendFile(f) {
    if (S.relay && f.size > RELAY_FILE_MAX) { toast(T('중계 연결에서는 100MB가 넘는 파일을 보낼 수 없습니다: ', 'Over a relay, files over 100 MB can\'t be sent: ') + f.name, 6000); return; }
    var id = ++files.seq, CH = 32 * 1024, at = 0;
    send({ t: 'fs', id: id, name: f.name, size: f.size });
    paintXfer(f.name, 0, f.size);
    while (at < f.size) {
      if (!inSession()) return;
      while (S.dc.bufferedAmount > 1024 * 1024 && inSession()) await bufferLow();
      var part = new Uint8Array(await f.slice(at, at + CH).arrayBuffer());
      var msg = new Uint8Array(5 + part.length);
      msg[0] = FILECHUNK; new DataView(msg.buffer).setUint32(1, id); msg.set(part, 5);
      try { S.dc.send(msg); } catch (e) { return; }
      at += part.length;
      paintXfer(f.name, at, f.size);
    }
    send({ t: 'fe', id: id });
    var said = await new Promise(function (res) { files.wait[id] = res; setTimeout(function () { res(null); }, 60000); });
    delete files.wait[id];
    toast(said || T('PC가 파일을 받았는지 확인하지 못했습니다: ', 'Couldn\'t confirm that the PC got it: ') + f.name, 5000);
  }
  function bufferLow() {
    return new Promise(function (res) {
      var dc = S.dc; dc.bufferedAmountLowThreshold = 256 * 1024;
      var done = function () { dc.removeEventListener('bufferedamountlow', done); res(); };
      dc.addEventListener('bufferedamountlow', done); setTimeout(done, 1000);
    });
  }
  function fileDone(id, text) { var w = files.wait[id]; if (w) w(text); else toast(text, 5000); }
  function paintXfer(name, done, size) {
    var pct = size ? Math.floor(done * 100 / size) : 100;
    $('xfer').hidden = false;
    $('xferText').textContent = T('PC로 보내는 중 · ', 'Sending to the PC · ') + name + ' · ' + pct + '%';
    $('xferBar').style.width = pct + '%';
  }

  // --- the bar -------------------------------------------------------------------------------------------------------
  $('btnFull').onclick = async function () {
    var el = $('session');
    if (document.fullscreenElement) { await document.exitFullscreen(); return; }
    try {
      await el.requestFullscreen({ navigationUI: 'hide' });
      // Full screen on a desktop browser: Esc, Alt+Tab and the Windows key go to the PC too (hold Esc to leave).
      if (navigator.keyboard && navigator.keyboard.lock) navigator.keyboard.lock().catch(function () {});
    } catch (e) {}
    canvas.focus();
  };
  $('quality').onchange = function () { send({ t: 'q', mode: $('quality').value }); canvas.focus(); };
  $('keys').onchange = function () { var v = $('keys').value; $('keys').value = ''; if (v) send({ t: 'combo', what: v }); canvas.focus(); };
  $('monitor').onchange = function () { send({ t: 'mon', i: Number($('monitor').value) }); canvas.focus(); };
  $('btnHang').onclick = function () { send({ t: 'bye' }); finish(T('연결을 끊었습니다', 'Disconnected'), '', true); };

  function toast(text, ms) {
    var t = $('toast'); t.textContent = text; t.hidden = false;
    clearTimeout(t._h); t._h = setTimeout(function () { t.hidden = true; }, ms || 4000);
  }

  /** The connection dropped (not ended by either side). */
  function lost() { finish(T('연결이 끊겼습니다', 'Connection lost'), T('네트워크가 바뀌었거나 PC가 응답하지 않습니다.', 'The network changed or the PC stopped answering.'), true); }

  function finish(title, text, tellHub) {
    if (!S) return;
    clearInterval(statsTimer); clearInterval(pingTimer);
    if (tellHub) endSession('browser'); else S.ended = true;
    closePeer();
    try { if (decoder && decoder.state !== 'closed') decoder.close(); } catch (e) {}
    decoder = null; codec = '';
    if (document.fullscreenElement) document.exitFullscreen().catch(function () {});
    $('notice').hidden = true; $('xfer').hidden = true;
    closeAudioDecoder(); files.queue = [];
    noPageZoom(false);
    // Back to the PCs (connect again from there), with what happened above the list. A browser let in "이번만" stays in
    // until its page closes; one taken off meanwhile is asked about again (listPcs sees the 403).
    $('pcsInfo').textContent = title + (text ? ' · ' + text : ''); $('pcsInfo').hidden = false;
    listPcs();
  }

  function ended(title, text) {
    $('endTitle').textContent = title; $('endText').textContent = text || '';
    show('ended');
  }
  // (A browser let in "이번만" and taken off meanwhile is asked about again: connect and listPcs see the 403.)
  $('again').onclick = function () { if (lastPc) connect(lastPc); };
  $('toList').onclick = function () { listPcs(); };

  // Closing the page ends the session at once (the PC hangs up) and, for a browser let in "이번만", its time on the
  // account (why 'page': the hub takes it off even when the session had ended before).
  window.addEventListener('pagehide', function () {
    var live = S && !S.ended;
    if (live) send({ t: 'bye' });
    if (!live && !onceDevice) return;
    if (S) S.ended = true;
    api('POST', '/v1/web/end', { session: S ? S.session : '', why: 'page' }, true).catch(function () {});
  });

  // A local copy only (http://localhost): the session part driven by a test harness over a connection it made itself
  // (no sign-in, no hub), to check the media path against the PC app's --dev-web-offer.
  if (location.hostname === 'localhost' || location.hostname === '127.0.0.1') {
    window.__rmDev = {
      offer: async function (relay) {
        var peer = new RTCPeerConnection({ iceServers: STUN });
        var dc = peer.createDataChannel('deskify-web', { ordered: true });
        dc.binaryType = 'arraybuffer';
        S = { pc: { id: 'dev', name: 'dev PC' }, session: 'dev', peer: peer, dc: dc, relay: !!relay, ended: false };
        await peer.setLocalDescription(await peer.createOffer());
        await waitGathered(peer);
        return peer.localDescription.sdp;
      },
      answer: async function (sdp) {
        await S.peer.setRemoteDescription({ type: 'answer', sdp: sdp });
        await new Promise(function (res) { if (S.dc.readyState === 'open') res(); else S.dc.onopen = res; });
        await begin();
        return true;
      },
      send: send,
      // A file made here, sent as if picked (the files path), and what the clipboard, sound and zoom did.
      sendText: function (name, text) { sendFiles([new File([text], name)]); },
      extras: function () { return { audio: window.__rmAudio || 0, clip: clip.last, zoom: canvas.style.transform, sound: sound.on, buttons: ['btnSnd', 'btnClip', 'btnFile'].map(function (b) { return $(b).hidden ? '' : b; }).join(','), toast: $('toast').hidden ? '' : $('toast').textContent }; },
      // A message as if from the PC (frame parts, JSON), for checking the decoder without a screen to capture.
      inject: function (bytes) { onMessage({ data: bytes.buffer }); },
      state: function () { return { codec: codec, w: canvas.width, h: canvas.height, stream: stream, relay: S && S.relay, stats: $('stats').textContent, badge: $('relayBadge').hidden ? '' : $('relayBadge').textContent, ended: $('ended').hidden ? '' : $('endText').textContent, frames: window.__rmFrames || 0, bytes: window.__rmBytes || 0, cursor: canvas.style.cursor.slice(0, 40) }; },
    };
  }

  // --- sign-in -----------------------------------------------------------------------------------------------------------
  $('signin').onclick = function () {
    var p = new firebase.auth.GoogleAuthProvider(); p.setCustomParameters({ prompt: 'select_account' });
    $('gateMsg').textContent = '';
    auth.signInWithPopup(p).catch(function (e) { if (e && e.code !== 'auth/popup-closed-by-user') $('gateMsg').textContent = e.message || String(e); });
  };
  $('signout').onclick = function () { stopWait(); auth.signOut(); };
  auth.onAuthStateChanged(function (u) {
    if (!u) { stopWait(); $('who').textContent = ''; $('signout').hidden = true; me = null; return show('gate'); }
    u.getIdToken().then(function (t) { lastToken = t; });
    start(u);
  });
})();
