/**
 * Intro sequence: a stylised storyboard of how Foundry works.
 *
 * Five scenes, about fourteen seconds, entirely inline SVG driven by CSS
 * keyframes. Figures are silhouettes on purpose — a recognisable character with
 * a face would need an artist, and pretending otherwise would look worse than
 * a clean abstraction.
 *
 * Rules it follows:
 *   - Never runs for prefers-reduced-motion.
 *   - Skippable at any moment, and dismissed for good afterwards.
 *   - Never blocks the board: the overlay is removed and the page is usable
 *     the moment it ends.
 *   - No network requests, no video, no external assets.
 */
(function () {
  'use strict';

  var KEY = 'foundry.intro.seen';
  var reduced = window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches;

  // Reduced motion, or already seen: do nothing at all.
  if (reduced || localStorage.getItem(KEY) === '1') return;

  var LIME = '#d8ff5f';
  var INK = '#0e1013';
  var FILL = '#1b1f24';
  var MID = '#2b323a';
  var PALE = '#8f8d86';
  var PAPER = '#e9e6dc';

  /** A walking figure: head, body, two legs. No face, by design. */
  function figure(x, colour, cls) {
    return '<g class="fig ' + cls + '" transform="translate(' + x + ',0)">'
      + '<circle cx="0" cy="0" r="13" fill="' + colour + '"/>'
      + '<path d="M-11 18 q11 -7 22 0 l4 40 q-15 6 -30 0 z" fill="' + colour + '"/>'
      + '<rect x="-10" y="58" width="8" height="34" rx="4" fill="' + colour + '"/>'
      + '<rect x="2" y="58" width="8" height="34" rx="4" fill="' + colour + '"/>'
      + '</g>';
  }

  var SCENES = [
    {
      caption: 'Somewhere on campus, a card slips out of a pocket.',
      svg:
        '<g class="intro__camera">'
        // sky wash
        + '<rect width="1120" height="630" fill="' + INK + '"/>'
        + '<rect width="1120" height="300" fill="#12161b"/>'
        // campus buildings
        + '<rect x="60"  y="150" width="150" height="230" fill="' + FILL + '"/>'
        + '<rect x="240" y="110" width="190" height="270" fill="' + MID + '"/>'
        + '<rect x="470" y="170" width="130" height="210" fill="' + FILL + '"/>'
        + '<rect x="640" y="130" width="220" height="250" fill="' + MID + '"/>'
        + '<rect x="900" y="180" width="160" height="200" fill="' + FILL + '"/>'
        // windows
        + '<g fill="#3a4450">'
        + '<rect x="80"  y="180" width="26" height="30"/><rect x="130" y="180" width="26" height="30"/>'
        + '<rect x="270" y="150" width="30" height="34"/><rect x="330" y="150" width="30" height="34"/>'
        + '<rect x="270" y="210" width="30" height="34"/><rect x="330" y="210" width="30" height="34"/>'
        + '<rect x="680" y="170" width="30" height="34"/><rect x="750" y="170" width="30" height="34"/>'
        + '<rect x="930" y="220" width="26" height="30"/>'
        + '</g>'
        // trees
        + '<g fill="#1f2a22">'
        + '<circle cx="420" cy="300" r="52"/><rect x="414" y="330" width="12" height="60"/>'
        + '<circle cx="850" cy="310" r="44"/><rect x="845" y="335" width="10" height="55"/>'
        + '</g>'
        // ground + path
        + '<rect y="380" width="1120" height="250" fill="#141a18"/>'
        + '<path d="M0 470 h1120" stroke="#1d2622" stroke-width="3"/>'
        + '<path d="M0 520 q280 -18 560 0 t560 0" stroke="#1a221e" stroke-width="26" fill="none"/>'
        // the student, walking
        + '<g transform="translate(0,392)">' + figure(120, '#e9e6dc', 'fig--walk fig--bob') + '</g>'
        // the card falls
        + '<g class="card--fall" transform="translate(150,470)">'
        + '<rect x="-22" y="-15" width="44" height="30" rx="4" fill="' + PAPER + '"/>'
        + '<rect x="-22" y="-15" width="44" height="9" rx="4" fill="' + LIME + '"/>'
        + '<rect x="-14" y="0" width="20" height="3" fill="#b9b4a6"/>'
        + '<rect x="-14" y="7" width="26" height="3" fill="#b9b4a6"/>'
        + '</g>'
        + '</g>'
    },
    {
      caption: 'Someone else is walking the same path — and stops.',
      svg:
        '<g class="intro__camera">'
        + '<rect width="1120" height="630" fill="' + INK + '"/>'
        + '<rect width="1120" height="300" fill="#12161b"/>'
        + '<rect x="80"  y="160" width="170" height="220" fill="' + FILL + '"/>'
        + '<rect x="300" y="120" width="200" height="260" fill="' + MID + '"/>'
        + '<rect x="560" y="170" width="150" height="210" fill="' + FILL + '"/>'
        + '<rect x="760" y="140" width="240" height="240" fill="' + MID + '"/>'
        + '<g fill="#3a4450">'
        + '<rect x="330" y="160" width="30" height="34"/><rect x="400" y="160" width="30" height="34"/>'
        + '<rect x="800" y="180" width="30" height="34"/><rect x="870" y="180" width="30" height="34"/>'
        + '</g>'
        + '<g fill="#1f2a22"><circle cx="530" cy="300" r="50"/><rect x="524" y="330" width="12" height="60"/></g>'
        + '<rect y="380" width="1120" height="250" fill="#141a18"/>'
        + '<path d="M0 470 h1120" stroke="#1d2622" stroke-width="3"/>'
        + '<path d="M0 520 q280 -18 560 0 t560 0" stroke="#1a221e" stroke-width="26" fill="none"/>'
        // the card, on the ground
        + '<g transform="translate(300,566)">'
        + '<rect x="-22" y="-15" width="44" height="30" rx="4" fill="' + PAPER + '"/>'
        + '<rect x="-22" y="-15" width="44" height="9" rx="4" fill="' + LIME + '"/>'
        + '<rect x="-14" y="0" width="20" height="3" fill="#b9b4a6"/>'
        + '</g>'
        // second student arrives and stops
        + '<g transform="translate(0,392)">' + figure(1180, '#e9e6dc', 'fig--enter fig--bob') + '</g>'
        // the card lifts
        + '<g class="card--lift" transform="translate(300,566)">'
        + '<rect x="-22" y="-15" width="44" height="30" rx="4" fill="' + PAPER + '"/>'
        + '<rect x="-22" y="-15" width="44" height="9" rx="4" fill="' + LIME + '"/>'
        + '<rect x="-14" y="0" width="20" height="3" fill="#b9b4a6"/>'
        + '</g>'
        + '</g>'
    },
    {
      caption: 'She posts what she found on Foundry.',
      svg:
        '<rect width="1120" height="630" fill="#0b0d10"/>'
        + '<g class="beat beat--on" transform="translate(340,150)">'
        + '<rect width="440" height="330" rx="18" fill="#15181d" stroke="#242a31" stroke-width="2"/>'
        + '<rect x="24" y="26" width="180" height="14" rx="7" fill="' + LIME + '"/>'
        + '<rect x="24" y="66" width="392" height="120" rx="12" fill="#1d222a"/>'
        + '<circle cx="70" cy="126" r="18" fill="#2b323a"/>'
        + '<rect x="104" y="106" width="120" height="10" rx="5" fill="#39424c"/>'
        + '<rect x="104" y="128" width="80" height="10" rx="5" fill="#39424c"/>'
        + '<rect x="24" y="208" width="260" height="12" rx="6" fill="#2b323a"/>'
        + '<rect x="24" y="232" width="320" height="12" rx="6" fill="#232931"/>'
        + '<rect x="24" y="272" width="150" height="38" rx="19" fill="' + LIME + '"/>'
        + '<rect x="196" y="272" width="150" height="38" rx="19" fill="none" stroke="#39424c" stroke-width="2"/>'
        + '</g>'
        + '<text x="560" y="540" text-anchor="middle" fill="' + PALE
        + '" font-family="system-ui,sans-serif" font-size="20">Found: Student ID Card · Main Block</text>'
    },
    {
      caption: 'He sees it, and claims it with a message.',
      svg:
        '<rect width="1120" height="630" fill="#0b0d10"/>'
        + '<g class="beat beat--pulse" transform="translate(180,140)">'
        + '<rect width="400" height="300" rx="18" fill="#15181d" stroke="' + LIME + '" stroke-width="2"/>'
        + '<rect x="24" y="24" width="150" height="12" rx="6" fill="' + LIME + '"/>'
        + '<rect x="24" y="58" width="352" height="96" rx="12" fill="#1d222a"/>'
        + '<circle cx="66" cy="106" r="16" fill="#2b323a"/>'
        + '<rect x="96" y="90" width="110" height="9" rx="4" fill="#39424c"/>'
        + '<rect x="24" y="186" width="352" height="40" rx="20" fill="' + LIME + '"/>'
        + '<text x="200" y="212" text-anchor="middle" fill="' + INK
        + '" font-family="system-ui,sans-serif" font-size="17" font-weight="600">Claim this item</text>'
        + '</g>'
        // the message bubble
        + '<g class="beat beat--on" transform="translate(640,180)">'
        + '<rect width="330" height="150" rx="18" fill="#1d222a"/>'
        + '<path d="M40 150 l-18 34 l40 -34 z" fill="#1d222a"/>'
        + '<rect x="26" y="30" width="250" height="11" rx="5" fill="#39424c"/>'
        + '<rect x="26" y="56" width="270" height="11" rx="5" fill="#39424c"/>'
        + '<rect x="26" y="96" width="180" height="11" rx="5" fill="' + LIME + '"/>'
        + '</g>'
        + '<text x="806" y="290" text-anchor="middle" fill="' + PALE
        + '" font-family="system-ui,sans-serif" font-size="18">"Meet me at the library?"</text>'
    },
    {
      caption: 'They meet in the library. The card goes home.',
      svg:
        '<g class="intro__camera">'
        + '<rect width="1120" height="630" fill="#0f1114"/>'
        + '<rect width="1120" height="630" fill="#121518"/>'
        // warm library light
        + '<circle cx="560" cy="180" r="220" fill="#1a1c16" opacity=".8"/>'
        // bookshelves
        + '<g fill="#171b1f">'
        + '<rect x="40" y="90" width="210" height="420" rx="6"/>'
        + '<rect x="870" y="90" width="210" height="420" rx="6"/>'
        + '</g>'
        + '<g stroke="#232a30" stroke-width="3">'
        + '<path d="M40 180 h210 M40 270 h210 M40 360 h210 M40 450 h210"/>'
        + '<path d="M870 180 h210 M870 270 h210 M870 360 h210 M870 450 h210"/>'
        + '</g>'
        + '<g fill="#20272d">'
        + '<rect x="58" y="130" width="16" height="48"/><rect x="80" y="122" width="14" height="56"/>'
        + '<rect x="100" y="134" width="18" height="44"/><rect x="126" y="126" width="12" height="52"/>'
        + '<rect x="890" y="128" width="16" height="50"/><rect x="912" y="120" width="14" height="58"/>'
        + '<rect x="934" y="132" width="18" height="46"/>'
        + '</g>'
        // floor
        + '<rect y="500" width="1120" height="130" fill="#14171a"/>'
        // table
        + '<rect x="400" y="430" width="320" height="18" rx="6" fill="#2a2f26"/>'
        + '<rect x="430" y="448" width="14" height="60" fill="#22271f"/>'
        + '<rect x="676" y="448" width="14" height="60" fill="#22271f"/>'
        // two figures facing each other
        + '<g transform="translate(0,330)">' + figure(452, '#e9e6dc', '') + '</g>'
        + '<g transform="translate(0,330) scale(-1,1) translate(-1120,0)">' + figure(452, '#cfd6c8', '') + '</g>'
        // the card, handed over
        + '<g class="check--pop" transform="translate(560,415)">'
        + '<rect x="-24" y="-16" width="48" height="32" rx="4" fill="' + PAPER + '"/>'
        + '<rect x="-24" y="-16" width="48" height="10" rx="4" fill="' + LIME + '"/>'
        + '</g>'
        // the tick
        + '<g class="check--pop" transform="translate(560,250)">'
        + '<circle r="42" fill="none" stroke="' + LIME + '" stroke-width="5"/>'
        + '<path d="M-18 2 l13 14 l24 -28" fill="none" stroke="' + LIME
        + '" stroke-width="6" stroke-linecap="round" stroke-linejoin="round"/>'
        + '</g>'
        + '</g>'
    }
  ];

  var TIMINGS = [4200, 4200, 3600, 3600, 5000];

  // ---- build the overlay ----
  var root = document.createElement('div');
  root.className = 'intro';
  root.setAttribute('role', 'dialog');
  root.setAttribute('aria-label', 'How Foundry works');

  var stage = document.createElement('div');
  stage.className = 'intro__stage';

  var sceneEls = SCENES.map(function (scene) {
    var d = document.createElement('div');
    d.className = 'intro__scene';
    d.innerHTML = '<svg class="intro__svg" viewBox="0 0 1120 630" '
      + 'preserveAspectRatio="xMidYMid slice" aria-hidden="true">' + scene.svg + '</svg>';
    stage.appendChild(d);
    return d;
  });

  var caption = document.createElement('p');
  caption.className = 'intro__caption';
  stage.appendChild(caption);

  var dots = document.createElement('div');
  dots.className = 'intro__dots';
  var dotEls = SCENES.map(function () {
    var dot = document.createElement('span');
    dot.className = 'intro__dot';
    dots.appendChild(dot);
    return dot;
  });
  stage.appendChild(dots);

  var skip = document.createElement('button');
  skip.type = 'button';
  skip.className = 'intro__skip';
  skip.textContent = 'Skip intro';
  stage.appendChild(skip);

  root.appendChild(stage);
  document.body.appendChild(root);

  // ---- run it ----
  var index = 0;
  var timer = null;
  var finished = false;

  function show(i) {
    sceneEls.forEach(function (el, n) { el.classList.toggle('intro__scene--on', n === i); });
    dotEls.forEach(function (el, n) { el.classList.toggle('intro__dot--on', n === i); });
    caption.classList.remove('intro__caption--on');
    caption.textContent = SCENES[i].caption;
    // let the fade happen before the words arrive
    setTimeout(function () {
      if (!finished) caption.classList.add('intro__caption--on');
    }, 260);
  }

  function step() {
    if (finished) return;
    if (index >= SCENES.length) { finish(); return; }
    show(index);
    timer = setTimeout(function () { index += 1; step(); }, TIMINGS[index]);
  }

  function finish() {
    if (finished) return;
    finished = true;
    if (timer) clearTimeout(timer);
    localStorage.setItem(KEY, '1');
    root.classList.add('intro--out');
    setTimeout(function () { root.remove(); }, 500);
  }

  skip.addEventListener('click', finish);
  document.addEventListener('keydown', function (e) {
    if (e.key === 'Escape') finish();
  });

  // Escape is a normal way out, so make sure focus is not trapped behind it.
  skip.focus({ preventScroll: true });

  step();
})();
