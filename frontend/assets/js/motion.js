/* Motion layer: scroll reveals, pointer-driven 3D card tilt, and the intro.
 *
 * Every effect degrades to nothing. If this file fails to load, or the visitor
 * prefers reduced motion, the page is fully readable and static.
 */
(function () {
  'use strict';

  var reduced = window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches;

  /* ---------- scroll reveal ---------- */
  function initReveal() {
    var nodes = [].slice.call(document.querySelectorAll('.rv'));
    if (!nodes.length) return;
    if (reduced || !('IntersectionObserver' in window)) {
      nodes.forEach(function (n) { n.classList.add('is-in'); });
      return;
    }
    // Above-the-fold content is revealed at once. Waiting for the observer
    // leaves the first screen blank if it is slow or never fires.
    nodes.forEach(function (n) {
      var r = n.getBoundingClientRect();
      if (r.top < window.innerHeight && r.bottom > 0) n.classList.add('is-in');
    });

    var io = new IntersectionObserver(function (entries) {
      entries.forEach(function (e) {
        if (e.isIntersecting) { e.target.classList.add('is-in'); io.unobserve(e.target); }
      });
    }, { rootMargin: '0px 0px -12% 0px', threshold: 0.12 });
    nodes.forEach(function (n) { io.observe(n); });
  }

  /* ---------- 3D card tilt ---------- */
  function initTilt() {
    if (reduced || !window.matchMedia('(hover: hover)').matches) return;
    [].slice.call(document.querySelectorAll('.card')).forEach(function (card) {
      var raf = null;
      function move(e) {
        if (raf) return;
        raf = requestAnimationFrame(function () {
          var r = card.getBoundingClientRect();
          var px = (e.clientX - r.left) / r.width - 0.5;
          var py = (e.clientY - r.top) / r.height - 0.5;
          card.style.setProperty('--ry', (px * 12).toFixed(2) + 'deg');
          card.style.setProperty('--rx', (-py * 12).toFixed(2) + 'deg');
          raf = null;
        });
      }
      card.addEventListener('mouseenter', function () { card.classList.add('tilt'); });
      card.addEventListener('mousemove', move);
      card.addEventListener('mouseleave', function () {
        card.classList.remove('tilt');
        card.style.removeProperty('--rx');
        card.style.removeProperty('--ry');
      });
    });
  }

  /* ---------- cinematic intro: once per session, always skippable ---------- */
  function initIntro() {
    var el = document.getElementById('intro');
    if (!el) return;
    var seen = false;
    try { seen = sessionStorage.getItem('foundry.intro') === 'seen'; } catch (e) {}
    if (reduced || seen) { el.setAttribute('data-done', 'true'); return; }

    el.setAttribute('data-run', 'true');
    document.body.style.overflow = 'hidden';

    function finish() {
      if (el.getAttribute('data-done') === 'true') return;
      el.setAttribute('data-done', 'true');
      document.body.style.overflow = '';
      try { sessionStorage.setItem('foundry.intro', 'seen'); } catch (e) {}
    }
    // Never hold the visitor for more than 2.2 seconds.
    var timer = setTimeout(finish, 1800);
    el.addEventListener('click', function () { clearTimeout(timer); finish(); });
    document.addEventListener('keydown', function (e) {
      if (e.key === 'Escape' || e.key === 'Enter') { clearTimeout(timer); finish(); }
    });
  }

  function boot() {
    // Only now may the stylesheet hide anything.
    document.documentElement.classList.add('motion-on');
    initReveal();
    initTilt();
    initIntro();
    // Belt and braces: if anything above failed, show the page anyway.
    setTimeout(function () {
      [].slice.call(document.querySelectorAll('.rv')).forEach(function (n) {
        n.classList.add('is-in');
      });
      var el = document.getElementById('intro');
      if (el) el.setAttribute('data-done', 'true');
      document.body.style.overflow = '';
    }, 2600);
  }
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', boot);
  } else { boot(); }
})();
