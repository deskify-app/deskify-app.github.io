// PREVIEW (local only) of the front page, second pass. Loaded in <head> without defer: the language is set before the
// first paint; the rest starts at DOMContentLoaded. No libraries; the motion is CSS transforms driven by a few custom
// properties set here (--h on the first screen, --g and data-scene on the scroll sequence). Reduced motion: none of it.
(function () {
  var root = document.documentElement;

  // Language: ?lang= from the apps for this visit, else #en, else the visitor's last choice, else the browser's first
  // supported language (ko, en, ja, zh), else English.
  var pick = function (s) { s = String(s || "").toLowerCase(); return /^(ko|en|ja|zh)/.test(s) ? s.slice(0, 2) : ""; };
  var q = /[?&]lang=([A-Za-z-]+)/.exec(location.search);
  var lang = q ? pick(q[1]) : location.hash === "#en" ? "en" : "";
  if (!lang) { try { lang = pick(localStorage.getItem("lang")); } catch (e) {} }
  var nav = navigator.languages && navigator.languages.length ? navigator.languages : [navigator.language];
  for (var i = 0; !lang && i < nav.length; i++) lang = pick(nav[i]);
  lang = lang || "en";
  root.setAttribute("data-lang", lang);
  root.lang = lang === "zh" ? "zh-CN" : lang;
  root.classList.add("js");
  var reduce = window.matchMedia && matchMedia("(prefers-reduced-motion: reduce)").matches;
  // The pinned sequence only with motion allowed; otherwise the six scenes stand one under another.
  if (!reduce) root.classList.add("motion");

  var titles = { ko: "Deskify · 원격 데스크톱 · SSH", en: "Deskify · Remote Desktop · SSH", ja: "Deskify · リモート デスクトップ · SSH", zh: "Deskify · 远程桌面 · SSH" };

  function start() {
    var m = document.getElementById("lang");
    function apply(l) { root.setAttribute("data-lang", l); root.lang = l === "zh" ? "zh-CN" : l; m.value = l; if (titles[l]) document.title = titles[l]; }
    m.addEventListener("change", function () { try { localStorage.setItem("lang", m.value); } catch (e) {} apply(m.value); });
    apply(root.getAttribute("data-lang"));

    var bar = document.querySelector(".nav");
    var hero = document.querySelector(".hero2");
    var track = document.querySelector(".seq-track");
    var scenes = track ? track.querySelectorAll("[data-scene]") : [];
    var count = track ? track.querySelectorAll(".sq-cap").length : 0;
    var ticks = track ? track.querySelectorAll(".sq-ticks i") : [];
    var win = document.querySelector(".win-window");
    var darks = document.querySelectorAll(".hero2, .seq, .win");
    var current = -1;

    function show(n) {
      if (n === current) return;
      current = n;
      track.setAttribute("data-at", n);
      for (var a = 0; a < scenes.length; a++) scenes[a].classList.toggle("on", +scenes[a].getAttribute("data-scene") === n);
      for (var b = 0; b < ticks.length; b++) ticks[b].classList.toggle("on", b <= n);
    }

    var ticking = false;
    function frame() {
      ticking = false;
      var vh = window.innerHeight, y = window.scrollY;
      bar.classList.toggle("scrolled", y > 8);
      // The bar takes the dark look over the dark bands (first screen, sequence, Windows), the page's look elsewhere.
      var dark = false;
      for (var d = 0; d < darks.length; d++) { var dr = darks[d].getBoundingClientRect(); if (dr.top <= 26 && dr.bottom > 26) dark = true; }
      bar.classList.toggle("light", !dark);
      if (reduce) return;
      // First screen: 0 at the top, 1 when it has scrolled away (the scene flattens and the devices spread).
      if (hero) hero.style.setProperty("--h", Math.max(0, Math.min(1, y / (hero.offsetHeight || 1))).toFixed(3));
      if (track) {
        var r = track.getBoundingClientRect();
        // --g: the screen grows while the track's top travels from the bottom of the view to the top.
        var g = Math.max(0, Math.min(1, (vh - r.top) / vh));
        track.style.setProperty("--g", g.toFixed(3));
        // one scene per screen height of scrolling once the track is pinned
        var p = -r.top / vh;
        // while a page turn runs, the scene it is heading for is already on (the crossfade rides with the move)
        if (pager && pager.scene() >= 0) show(pager.scene());
        else show(Math.max(0, Math.min(count - 1, Math.floor(p + 0.35))));
      }
      if (win) {
        var w = win.getBoundingClientRect();
        win.style.setProperty("--p", Math.max(0, Math.min(1, (vh - w.top) / (vh / 2 + w.height / 2))).toFixed(3));
      }
      if (pager) pager.frame();
    }
    function ask() { if (!ticking) { ticking = true; requestAnimationFrame(frame); } }
    // JS paging only with a mouse / trackpad (fine pointer that can hover) and motion allowed; touch screens keep
    // native scrolling with the CSS proximity snap
    var fine = window.matchMedia && matchMedia("(hover: hover) and (pointer: fine)").matches;
    var pager = reduce || !fine ? null : makePager(ask);
    if (track) show(0);
    frame();
    window.addEventListener("scroll", ask, { passive: true });
    window.addEventListener("resize", ask);
  }

  // Paging (fourth pass, desktop only): one gesture = one stop. A wheel flick or a key press turns exactly one page with a
  // 650 ms ease-out scroll, then input stays locked until the gesture has died down (trackpad inertia never skips a
  // stop). Stops are the full-viewport sections and the six scenes; a section taller than the view scrolls freely
  // inside and pages on the next gesture once its edge is reached. CSS scroll-snap stays as the fallback without JS;
  // html.paging switches it off so the two never fight. Reduced motion: no pager at all (normal scroll + CSS snap).
  function makePager(ask) {
    root.classList.add("paging");
    var SEL = ".hero2, .seq-intro, .sq-snaps i, .more, .win, .web, .safe, .plans, .closing";
    var DUR = 650, QUIET = 160, THRESH = 36;
    var snaps = Array.prototype.slice.call(document.querySelectorAll(".sq-snaps i"));
    var stops = [], anim = null, needQuiet = false, lastWheel = 0, prevA = 0, lastDir = 0, acc = 0;
    var settleT = 0, dots = null, dotBtns = [];
    var now = function () { return window.performance ? performance.now() : Date.now(); };

    // Phones: the URL bar hides and shows while scrolling, changing innerHeight by ~56 px. The stops are sized in svh, so
    // the edges are measured against the small viewport (a 100svh probe) and do not move when the bar does.
    var probe = document.createElement("div");
    probe.setAttribute("aria-hidden", "true");
    probe.style.position = "absolute"; probe.style.top = "0"; probe.style.left = "0"; probe.style.width = "0";
    probe.style.visibility = "hidden"; probe.style.pointerEvents = "none";
    probe.style.height = "100vh"; probe.style.height = "100svh";
    document.body.appendChild(probe);
    function measure() {
      var y = window.scrollY, ih = window.innerHeight, max = document.documentElement.scrollHeight - ih, out = [];
      var vh = Math.min(ih, probe.offsetHeight || ih);
      var els = document.querySelectorAll(SEL);
      for (var i = 0; i < els.length; i++) {
        var r = els[i].getBoundingClientRect();
        if (!r.height) continue;
        var top = out.length ? Math.min(max, Math.round(r.top + y)) : 0; // the first stop is the top of the page (bar included)
        var end = Math.min(max, Math.max(top, Math.round(r.top + y + r.height - vh)));
        if (out.length && Math.abs(out[out.length - 1].top - top) < 2) continue;
        out.push({ el: els[i], top: top, end: end, free: end - top > 2, scene: snaps.indexOf(els[i]) });
      }
      // the last stop always reaches the very bottom (the footer): a small remainder is folded into the stop itself
      // (it lands showing the footer), a larger one scrolls freely
      var last = out[out.length - 1];
      if (last && max > last.end + 2) {
        if (max - last.end < vh * 0.25 && !last.free) last.top = max;
        last.end = max; last.free = last.end - last.top > 2;
      }
      stops = out;
      return out;
    }
    var TOL = 3; // px: fractional scroll positions on high-DPI phones still count as "at the edge"
    function at(y) { for (var i = 0; i < stops.length; i++) if (y >= stops[i].top - TOL && y <= stops[i].end + TOL) return i; return -1; }
    function nearest(y) {
      var best = 0, bd = Infinity;
      for (var i = 0; i < stops.length; i++) { var s = stops[i], d = y < s.top ? s.top - y : y > s.end ? y - s.end : 0; if (d < bd) { bd = d; best = i; } }
      return best;
    }
    function scrollTo(y) { try { window.scrollTo({ top: y, left: 0, behavior: "instant" }); } catch (e) { window.scrollTo(0, y); } }

    function animateTo(y, scene, dur, isPage) {
      var from = window.scrollY;
      anim = { from: from, to: y, t0: now(), dur: dur, scene: scene, page: isPage };
      if (Math.abs(y - from) < 1) { anim = null; if (isPage) needQuiet = true; ask(); return; }
      var mine = anim;
      requestAnimationFrame(function step() {
        if (anim !== mine) return;
        var t = Math.min(1, (now() - mine.t0) / mine.dur), e = 1 - Math.pow(1 - t, 3);
        scrollTo(mine.from + (mine.to - mine.from) * e);
        if (t < 1) { requestAnimationFrame(step); return; }
        anim = null;
        if (mine.page) needQuiet = true;
        ask();
      });
      ask();
    }
    function goStop(i, toEnd) { var s = stops[i]; animateTo(toEnd ? s.end : s.top, s.scene, DUR, true); }
    function page(dir) {
      measure();
      var y = window.scrollY, i;
      if (dir > 0) { for (i = 0; i < stops.length; i++) if (stops[i].top > y + 2) { goStop(i, false); return true; } }
      else { for (i = stops.length - 1; i >= 0; i--) if (stops[i].end < y - 2) { goStop(i, true); return true; } }
      return false;
    }
    // Free scroll inside a tall section, clamped to its edges; returns true when the edge stopped it.
    function freeBy(d, s, smooth) {
      var base = anim && !anim.page ? anim.to : window.scrollY;
      var t = Math.max(s.top, Math.min(s.end, base + d));
      // within the edge tolerance counts as the edge (the same 2 px inside() uses), so the rest of the gesture stops
      var edge = d > 0 ? (t >= s.end - TOL ? s.end : -1) : (t <= s.top + TOL ? s.top : -1);
      if (edge >= 0) t = edge;
      if (!smooth && !anim && Math.abs(d) < 50) scrollTo(t);
      else animateTo(t, -1, smooth ? 380 : 240, false);
      return edge >= 0;
    }
    // Where the pointer is over something that scrolls by itself in that direction, leave the wheel to it.
    function innerScroll(t, d) {
      for (var el = t; el && el !== document.body && el !== root; el = el.parentElement) {
        if (el.nodeType !== 1 || el.scrollHeight <= el.clientHeight + 1) continue;
        var oy = getComputedStyle(el).overflowY;
        if (oy !== "auto" && oy !== "scroll") continue;
        if (d > 0 ? el.scrollTop + el.clientHeight < el.scrollHeight - 1 : el.scrollTop > 0) return true;
      }
      return false;
    }
    function inside(s, y, dir) { return s && s.free && (dir > 0 ? y < s.end - TOL : y > s.top + TOL); }

    window.addEventListener("wheel", function (e) {
      if (e.ctrlKey || e.defaultPrevented) return;
      var d = e.deltaY * (e.deltaMode === 1 ? 16 : e.deltaMode === 2 ? window.innerHeight : 1);
      if (!d || Math.abs(e.deltaX) > Math.abs(d) || innerScroll(e.target, d)) return;
      var t = now(), gap = t - lastWheel, a = Math.abs(d), dir = d > 0 ? 1 : -1;
      var rising = a > prevA * 2 + 6, flip = dir !== lastDir;
      lastWheel = t; prevA = a; lastDir = dir;
      e.preventDefault();
      if (anim && anim.page) return;
      // after a page turn (or an edge stop) the rest of the gesture is swallowed: a pause, a new flick (deltas rising
      // again instead of decaying) or the other direction starts the next gesture
      if (needQuiet) { if (gap > QUIET || rising || flip) needQuiet = false; else return; }
      if (gap > QUIET || flip) acc = 0;
      measure();
      var y = anim ? anim.to : window.scrollY, s = stops[at(y)];
      if (inside(s, y, dir)) { if (freeBy(d, s, false)) needQuiet = true; acc = 0; return; }
      acc += d;
      if (Math.abs(acc) < THRESH) return;
      acc = 0;
      page(dir);
    }, { passive: false });

    document.addEventListener("keydown", function (e) {
      if (e.defaultPrevented || e.altKey || e.ctrlKey || e.metaKey) return;
      var k = e.key, tg = e.target, tag = tg && tg.tagName;
      if (tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT" || (tg && tg.isContentEditable)) return;
      var dir = 0, big = true;
      if (k === "PageDown" || (k === " " && !e.shiftKey)) dir = 1;
      else if (k === "PageUp" || (k === " " && e.shiftKey)) dir = -1;
      else if (k === "ArrowDown") { dir = 1; big = false; }
      else if (k === "ArrowUp") { dir = -1; big = false; }
      else if (k !== "Home" && k !== "End") return;
      if (k === " " && (tag === "BUTTON" || tag === "A" || tag === "SUMMARY")) return;
      e.preventDefault();
      if (anim && anim.page) return;
      measure();
      if (k === "Home") { goStop(0, false); return; }
      if (k === "End") { goStop(stops.length - 1, true); return; }
      var y = anim ? anim.to : window.scrollY, s = stops[at(y)];
      if (inside(s, y, dir)) freeBy(dir * (big ? window.innerHeight * 0.85 : 120), s, true);
      else page(dir);
    });

    // Touch screens are not handled here at all: phones and tablets (coarse pointer) get no pager — native scrolling
    // with CSS proximity snap (home2.css) — and a touch on a desktop with a mouse just scrolls natively too.

    // Anything that leaves the page between stops (scrollbar drag, a resize) settles on the nearest one — or on the
    // stop holding the keyboard focus. Never while a finger is on the screen (touch on a hybrid laptop).
    var touching = false;
    window.addEventListener("touchstart", function () { touching = true; anim = null; }, { passive: true });
    var lastTouch = 0;
    window.addEventListener("touchend", function () { touching = false; lastTouch = now(); }, { passive: true });
    window.addEventListener("touchcancel", function () { touching = false; }, { passive: true });
    function settle() {
      if (anim || touching || now() - lastTouch < 1500) return; // native touch momentum is left alone
      measure();
      var y = window.scrollY;
      if (!stops.length || at(y) >= 0) return;
      var k = nearest(y), f = document.activeElement;
      if (f && f !== document.body) for (var i = 0; i < stops.length; i++) if (stops[i].el.contains(f)) { k = i; break; }
      var s = stops[k];
      animateTo(Math.max(s.top, Math.min(s.end, y)), s.scene, 380, false);
    }
    function scheduleSettle() { clearTimeout(settleT); settleT = setTimeout(settle, 160); }

    // Anchors (#features, #windows, #web, #plans, the logo's #top) and Back/Forward land on their stop.
    function stopFor(id) {
      var el = id && document.getElementById(id);
      if (!el) return -1;
      measure();
      if (el.classList.contains("nav")) return 0;
      for (var i = 0; i < stops.length; i++) if (stops[i].el === el || el.contains(stops[i].el)) return i;
      return -1;
    }
    document.addEventListener("click", function (e) {
      var a = e.target.closest && e.target.closest('a[href^="#"]');
      if (!a || e.defaultPrevented || e.button) return;
      var id = a.getAttribute("href").slice(1);
      if (id === "main") return; // the skip link keeps its focus behaviour
      var k = stopFor(id);
      if (k < 0) return;
      e.preventDefault();
      goStop(k, false);
      if (location.hash !== "#" + id) try { history.pushState(null, "", "#" + id); } catch (er) {}
    });
    window.addEventListener("popstate", function () { var k = stopFor(location.hash.slice(1)); goStop(k < 0 ? 0 : k, false); });

    // The dots on the right edge (desktop): where you are, click to go.
    function buildDots() {
      if (!dots) {
        dots = document.createElement("div");
        dots.className = "pager-dots";
        dots.setAttribute("aria-hidden", "true");
        dots.addEventListener("click", function (e) {
          var b = e.target.closest("button");
          if (b) { measure(); var i = +b.getAttribute("data-i"); if (stops[i]) goStop(i, false); }
        });
        document.body.appendChild(dots);
      }
      dots.textContent = "";
      dotBtns = [];
      for (var i = 0; i < stops.length; i++) {
        var b = document.createElement("button");
        b.type = "button"; b.tabIndex = -1; b.setAttribute("data-i", i);
        dots.appendChild(b); dotBtns.push(b);
      }
    }

    var cur = -1;
    return {
      scene: function () { return anim && anim.page ? anim.scene : -1; },
      frame: function () {
        measure();
        if (dotBtns.length !== stops.length) { buildDots(); cur = -1; }
        var y = window.scrollY, k = anim && anim.page ? at(anim.to) : at(y);
        if (k < 0) k = nearest(y);
        if (k !== cur) { if (dotBtns[cur]) dotBtns[cur].classList.remove("on"); if (dotBtns[k]) dotBtns[k].classList.add("on"); cur = k; }
        if (!anim && !touching) scheduleSettle();
      }
    };
  }

  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", start);
  else start();
})();
