(function () {
  "use strict";

  var DURATION = 380;
  var root = document.documentElement;

  function prefersReduced() {
    return window.matchMedia("(prefers-reduced-motion: reduce)").matches;
  }

  function applyTheme(next) {
    root.setAttribute("data-theme", next);
    try { localStorage.setItem("foundry.theme", next); } catch (e) {  }
    document.querySelectorAll("[data-theme-icon]").forEach(paintIcon);
  }

  function paintIcon(el) {
    el.textContent = root.getAttribute("data-theme") === "dark" ? "☀" : "☾";
  }

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

    if (!document.startViewTransition || prefersReduced()) {
      root.classList.add("theme-changing");
      applyTheme(next);
      setTimeout(function () { root.classList.remove("theme-changing"); }, DURATION);
      return;
    }

    var applied = false;
    function commit() { if (!applied) { applied = true; applyTheme(next); } }
    var vt = document.startViewTransition(commit);
    setTimeout(commit, 80);

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
    }).catch(function () {  });
  }

  function init() {
    document.querySelectorAll("[data-theme-toggle]").forEach(function (b) {

      if (b.dataset.themeWired || b.dataset.themeBound) return;
      b.dataset.themeWired = "1";
      b.dataset.themeBound = "1";
      b.addEventListener("click", toggle);
    });
    document.querySelectorAll("[data-theme-icon]").forEach(paintIcon);
  }

  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", init);
  else init();

  window.FoundryTheme = { init: init };
})();
