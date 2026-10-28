// Deskify info and policy pages (preview of the new design). Loaded in <head> without defer: the language is set before
// the first paint; the language menu and the bar's backdrop start at DOMContentLoaded. No inline script needed (CSP 'self').
(function () {
  var root = document.documentElement;
  var koen = root.classList.contains("koen");

  // Language: ?lang= from the apps (their UI language) for this visit, else #en, else the visitor's last choice,
  // else the browser's first supported language (ko, en, ja, zh: any Chinese reads 简体中文), else English.
  // Policy pages (html.koen, Korean + English only): a Korean reader sent to #en reads English.
  var pick = function (s) { s = String(s || "").toLowerCase(); return /^(ko|en|ja|zh)/.test(s) ? s.slice(0, 2) : ""; };
  var q = /[?&]lang=([A-Za-z-]+)/.exec(location.search);
  var lang = q ? pick(q[1]) : !koen && location.hash === "#en" ? "en" : "";
  if (!lang) { try { lang = pick(localStorage.getItem("lang")); } catch (e) {} }
  var nav = navigator.languages && navigator.languages.length ? navigator.languages : [navigator.language];
  for (var i = 0; !lang && i < nav.length; i++) lang = pick(nav[i]);
  lang = lang || "en";
  if (koen && lang === "ko" && location.hash === "#en" && !q) lang = "en";
  root.setAttribute("data-lang", lang);
  root.lang = lang === "zh" ? "zh-CN" : lang;
  root.classList.add("js");

  function start() {
    // Page titles per language come from the <title> element's data-title-* attributes.
    var t = document.querySelector("title");
    var m = document.getElementById("lang");
    function apply(l) {
      root.setAttribute("data-lang", l); root.lang = l === "zh" ? "zh-CN" : l;
      if (m) m.value = l;
      var s = t && t.getAttribute("data-title-" + l);
      if (s) document.title = s;
    }
    if (m) m.addEventListener("change", function () { try { localStorage.setItem("lang", m.value); } catch (e) {} apply(m.value); });
    apply(root.getAttribute("data-lang"));

    // The bar gets its backdrop once the page has moved.
    var bar = document.querySelector(".nav");
    if (bar) {
      // Over the dark title band (info pages) the bar keeps its dark look; elsewhere it takes the page's (.light).
      var bands = document.querySelectorAll(".page-hero");
      var onTop = function () {
        bar.classList.toggle("scrolled", window.scrollY > 8);
        var dark = false;
        for (var i = 0; i < bands.length; i++) { var r = bands[i].getBoundingClientRect(); if (r.height && r.top <= 26 && r.bottom > 26) dark = true; }
        bar.classList.toggle("light", !dark);
      };
      onTop();
      window.addEventListener("scroll", onTop, { passive: true });
    }
  }

  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", start);
  else start();
})();
