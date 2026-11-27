/**
 * Theme toggle with three effects working together:
 *
 *   1. The new palette spreads out of the button as a growing circle.
 *   2. The old page crossfades away over 500ms underneath it.
 *   3. The icon rotates and flips while the colours change.
 *
 * The circle uses the View Transitions API. Where that is unavailable, or where
 * the visitor has asked for reduced motion, it falls back to a plain crossfade
 * and finally to an instant switch - the theme must always change, even when
 * the animation cannot run.
 */
(function () {
  "use strict";

  /* Tuned down from 500ms. A theme switch is a small state change and half a
     second reads as lag; 380ms is still clearly animated but feels immediate.
     The fade-out is shorter still (see the CSS) so the circle leads the eye. */
  var DURATION = 380;
  var root = document.documentElement;

  function prefersReduced() {
    return window.matchMedia("(prefers-reduced-motion: reduce)").matches;
  }

  function applyTheme(next) {
    root.setAttribute("data-theme", next);
    try { localStorage.setItem("foundry.theme", next); } catch (e) { /* private mode */ }
    document.querySelectorAll("[data-theme-icon]").forEach(paintIcon);
  }

  function paintIcon(el) {
    el.textContent = root.getAttribute("data-theme") === "dark" ? "☀" : "☾";
  }

  /** Spin and flip the icon, so the change is felt as well as seen. */
  function spinIcon(button) {
    var icon = button.querySelector("[data-theme-icon]");
    if (!icon || prefersReduced() || !icon.animate) return;
    icon.animate(
      [
        { transform: "rotate(0deg) scale(1)" },
        { transform: "rotate(180deg) scale(0.72)" },
        { transform: "rotate(360deg) scale(1)" }
      ],
      { duration: DURATION, easing: "cubic-bezier(.4,0,.2,1)" }
    );
  }

  /** Circle origin and radius that covers the whole viewport from the button. */
  function circleFrom(button) {
    var r = button.getBoundingClientRect();
    var x = r.left + r.width / 2;
    var y = r.top + r.height / 2;
    var far = Math.hypot(
      Math.max(x, window.innerWidth - x),
      Math.max(y, window.innerHeight - y)
    );
    return { x: x, y: y, r: far };
  }

  function toggle(event) {
    var button = event.currentTarget;
    var next = root.getAttribute("data-theme") === "dark" ? "light" : "dark";
    var c = circleFrom(button);

    spinIcon(button);

    // No View Transitions, or the visitor asked for less motion: switch at once
    // and let the CSS transition on colours carry the change.
    if (!document.startViewTransition || prefersReduced()) {
      root.classList.add("theme-changing");
      applyTheme(next);
      setTimeout(function () { root.classList.remove("theme-changing"); }, DURATION);
      return;
    }

    var vt = document.startViewTransition(function () { applyTheme(next); });

    // The circle is drawn on the incoming snapshot, so the new palette is what
    // expands. The outgoing snapshot fades underneath it.
    vt.ready.then(function () {
      root.animate(
        {
          clipPath: [
            "circle(0px at " + c.x + "px " + c.y + "px)",
            "circle(" + c.r + "px at " + c.x + "px " + c.y + "px)"
          ]
        },
        {
          duration: DURATION,
          easing: "cubic-bezier(.4,0,.2,1)",
          pseudoElement: "::view-transition-new(root)"
        }
      );
    }).catch(function () { /* the theme already changed */ });
  }

  function init() {
    document.querySelectorAll("[data-theme-toggle]").forEach(function (b) {
      /* api.js's initTheme may have bound this button already, under its own
         flag. Two handlers flip the attribute twice and cancel each other out. */
      if (b.dataset.themeWired === "1" || b.dataset.themeBound === "1") return;
      b.dataset.themeWired = "1";
      b.dataset.themeBound = "1";
      b.addEventListener("click", toggle);
    });
    document.querySelectorAll("[data-theme-icon]").forEach(paintIcon);
  }

  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", init);
  else init();

  // expose for pages that build their header later
  window.FoundryTheme = { init: init };
})();
