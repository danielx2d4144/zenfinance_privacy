/* zenfinance — Signal / Noise interactions. Zero dependencies. */
(function () {
  "use strict";
  var reduced = window.matchMedia("(prefers-reduced-motion: reduce)").matches;

  /* sticky nav blur */
  var nav = document.getElementById("nav");
  addEventListener("scroll", function () {
    nav.classList.toggle("scrolled", scrollY > 8);
  }, { passive: true });

  /* cursor spotlight over hero */
  var hero = document.getElementById("hero");
  var spot = document.getElementById("spot");
  if (hero && spot && !reduced) {
    hero.addEventListener("pointermove", function (e) {
      var r = hero.getBoundingClientRect();
      spot.style.setProperty("--mx", ((e.clientX - r.left) / r.width * 100).toFixed(1) + "%");
      spot.style.setProperty("--my", ((e.clientY - r.top) / r.height * 100).toFixed(1) + "%");
    });
  }

  /* scroll reveals (staggered per section) */
  var io = new IntersectionObserver(function (entries) {
    entries.forEach(function (en) {
      if (!en.isIntersecting) return;
      var el = en.target;
      var siblings = [].slice.call(el.parentElement.querySelectorAll(":scope > .reveal, :scope > * > .reveal"));
      var i = Math.max(0, siblings.indexOf(el));
      el.style.transitionDelay = Math.min(i * 90, 450) + "ms";
      el.classList.add("in");
      io.unobserve(el);
    });
  }, { threshold: 0.15, rootMargin: "0px 0px -40px 0px" });
  document.querySelectorAll(".reveal").forEach(function (el) { io.observe(el); });

  /* cipher decrypt on the hero keyword */
  var GLYPHS = "!<>-_\\/[]{}—=+*^?#01zk";
  function decrypt(el, done) {
    var target = el.getAttribute("data-text");
    var frame = 0, queue = [];
    for (var i = 0; i < target.length; i++) {
      queue.push({ ch: target[i], start: Math.floor(Math.random() * 22), end: Math.floor(Math.random() * 22) + 18 });
    }
    (function step() {
      var out = "", complete = 0;
      for (var i = 0; i < queue.length; i++) {
        var q = queue[i];
        if (frame >= q.end) { complete++; out += q.ch; }
        else if (frame >= q.start) { out += GLYPHS[Math.floor(Math.random() * GLYPHS.length)]; }
        else { out += " "; }
      }
      el.textContent = out;
      if (complete === queue.length) { done && done(); return; }
      frame++;
      requestAnimationFrame(step);
    })();
  }
  var dec = document.getElementById("decrypt");
  var underline = document.getElementById("underline");
  if (dec) {
    if (reduced) { underline.classList.add("on"); }
    else {
      setTimeout(function () {
        decrypt(dec, function () { underline.classList.add("on"); });
      }, 350);
    }
  }

  /* count-up stats */
  function countUp(el) {
    var target = parseInt(el.getAttribute("data-target"), 10);
    var suffix = el.getAttribute("data-suffix") || "";
    if (reduced || target === 0) { el.textContent = target + suffix; return; }
    var t0 = null, dur = 1400;
    (function tick(ts) {
      if (!t0) t0 = ts;
      var p = Math.min((ts - t0) / dur, 1);
      var eased = 1 - Math.pow(1 - p, 3);
      el.textContent = Math.round(eased * target) + suffix;
      if (p < 1) requestAnimationFrame(tick);
    })(performance.now());
  }
  var statsIo = new IntersectionObserver(function (entries) {
    entries.forEach(function (en) {
      if (!en.isIntersecting) return;
      en.target.querySelectorAll(".count").forEach(countUp);
      statsIo.unobserve(en.target);
    });
  }, { threshold: 0.4 });
  var stats = document.getElementById("stats");
  if (stats) statsIo.observe(stats);

  /* terminal typewriter */
  function typeLine(line, cb) {
    var cmd = line.getAttribute("data-cmd");
    var out = line.getAttribute("data-out");
    var cmdSpan = document.createElement("span");
    cmdSpan.className = "cmd";
    var outSpan = document.createElement("span");
    outSpan.className = "out";
    line.appendChild(cmdSpan);
    line.appendChild(outSpan);
    if (reduced) { cmdSpan.textContent = cmd; outSpan.innerHTML = out; cb && cb(); return; }
    var i = 0;
    (function typeCmd() {
      if (i <= cmd.length) {
        cmdSpan.textContent = cmd.slice(0, i);
        i++;
        setTimeout(typeCmd, 34);
      } else {
        setTimeout(function () { outSpan.innerHTML = out; cb && cb(); }, 220);
      }
    })();
  }
  var termIo = new IntersectionObserver(function (entries) {
    entries.forEach(function (en) {
      if (!en.isIntersecting) return;
      termIo.unobserve(en.target);
      var lines = [].slice.call(en.target.querySelectorAll(".term-line"));
      var cursor = document.getElementById("termCursor");
      (function next(k) {
        if (k >= lines.length) return;
        typeLine(lines[k], function () { setTimeout(function () { next(k + 1); }, 160); });
      })(0);
      void cursor; /* cursor keeps blinking below the typed lines */
    });
  }, { threshold: 0.35 });
  var term = document.getElementById("terminal");
  if (term) termIo.observe(term);
})();
