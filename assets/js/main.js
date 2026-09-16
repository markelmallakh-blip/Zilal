/* ==========================================================================
   Zilal — home page interactions
   One rAF loop drives every scroll-linked piece; each module reports whether
   it is still easing so the loop can sleep when nothing moves.
   ========================================================================== */
(() => {
  const reduceMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  const clamp = (v, min = 0, max = 1) => Math.min(max, Math.max(min, v));
  const easeInOut = t => (t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2);
  // frame-rate independent lerp: `rate` is the share covered per 60fps frame
  const damp = (from, to, rate, dt) => from + (to - from) * (1 - Math.pow(1 - rate, dt / 16.67));

  /* ------------------------------------------------------------------ loop */
  const modules = [];
  let rafId = 0;
  let lastFrame = 0;

  function frame(now) {
    const dt = lastFrame ? Math.min(now - lastFrame, 100) : 16.67;
    lastFrame = now;
    let busy = false;
    for (const m of modules) busy = m.update(dt) || busy;
    if (busy) {
      rafId = requestAnimationFrame(frame);
    } else {
      rafId = 0;
      lastFrame = 0;
    }
  }
  function wake() {
    if (!rafId) rafId = requestAnimationFrame(frame);
  }
  function layoutAll() {
    for (const m of modules) if (m.layout) m.layout();
    wake();
  }

  /* ---------------------------------------------------------- mask lines */
  // Wraps each line of a [data-mask] element so the orange bar can wipe it in.
  // Explicit <span> children are lines; [data-split] text is broken into lines
  // by measuring where the words wrap.
  function buildLine(text) {
    const line = document.createElement('span');
    line.className = 'mask-line';
    const inner = document.createElement('span');
    inner.className = 'mask-line__text';
    inner.textContent = text;
    line.appendChild(inner);
    return line;
  }

  function splitMask(el) {
    if (el.hasAttribute('data-split')) {
      const text = el.dataset.text || el.textContent.trim().replace(/\s+/g, ' ');
      el.dataset.text = text;
      el.textContent = '';
      const words = text.split(' ').map(word => {
        const span = document.createElement('span');
        span.textContent = `${word} `;
        span.style.display = 'inline'; // beats `[data-mask] > span { display: block }`
        el.appendChild(span);
        return span;
      });
      const lines = [];
      let top = null;
      words.forEach(span => {
        if (top === null || Math.abs(span.offsetTop - top) > 2) {
          lines.push([]);
          top = span.offsetTop;
        }
        lines[lines.length - 1].push(span.textContent);
      });
      el.textContent = '';
      lines.forEach(line => el.appendChild(buildLine(line.join('').trim())));
    } else if (!el.querySelector('.mask-line')) {
      [...el.children].forEach(child => {
        child.classList.add('mask-line');
        const inner = document.createElement('span');
        inner.className = 'mask-line__text';
        while (child.firstChild) inner.appendChild(child.firstChild);
        child.appendChild(inner);
      });
    }
  }

  // number lines across every mask in a block so title and text cascade
  function staggerMasks() {
    const blocks = new Map();
    masks.forEach(el => {
      const block = el.closest('.why-copy, .why-intro, .section-head, .contact__head') || el;
      if (!blocks.has(block)) blocks.set(block, []);
      blocks.get(block).push(el);
    });
    blocks.forEach(els => {
      let i = 0;
      els.forEach(el => el.querySelectorAll('.mask-line').forEach(line => line.style.setProperty('--i', i++)));
    });
  }

  const masks = [...document.querySelectorAll('[data-mask]')];
  const resplit = () => {
    masks.filter(el => el.hasAttribute('data-split')).forEach(splitMask);
    staggerMasks();
  };

  /* ------------------------------------------------- hero → about stage */
  function heroStage() {
    const stage = document.querySelector('[data-scroll-stage]');
    if (!stage) return null;

    const video = stage.querySelector('[data-scroll-video]');
    const heroPanel = stage.querySelector('[data-panel="hero"]');
    const heroItems = [...heroPanel.querySelectorAll('[data-reveal]')];
    const aboutPanel = stage.querySelector('[data-panel="about"]');
    const aboutItems = [...aboutPanel.querySelectorAll('[data-reveal]')];

    // choreography, in stage progress units
    const HERO_OUT = { start: 0.06, span: 0.26, stagger: 0.04, shift: -48 };
    const ABOUT_IN = { start: 0.46, span: 0.28, stagger: 0.06, shift: 56 };

    let current = 0;
    let duration = 0;

    const readProgress = () => {
      const distance = stage.offsetHeight - window.innerHeight;
      return distance > 0 ? clamp(-stage.getBoundingClientRect().top / distance) : 0;
    };

    function setItem(el, local, shift) {
      const t = easeInOut(local);
      el.style.opacity = String(t);
      el.style.transform = reduceMotion ? 'none' : `translate3d(0, ${(1 - t) * shift}px, 0)`;
    }

    function render(p) {
      heroItems.forEach((el, i) => {
        setItem(el, 1 - clamp((p - HERO_OUT.start - i * HERO_OUT.stagger) / HERO_OUT.span), HERO_OUT.shift);
      });
      aboutItems.forEach((el, i) => {
        setItem(el, clamp((p - ABOUT_IN.start - i * ABOUT_IN.stagger) / ABOUT_IN.span), ABOUT_IN.shift);
      });
      aboutPanel.classList.toggle('is-active', p >= 0.45);
      heroPanel.style.pointerEvents = p > 0.3 ? 'none' : '';

      if (duration) {
        // stop a hair before the end so the last frame never flashes black
        const time = p * (duration - 0.04);
        if (!video.seeking && Math.abs(video.currentTime - time) > 0.008) video.currentTime = time;
      }
    }

    function onReady() {
      duration = video.duration || 0;
      video.pause();
      render(current);
    }
    video.pause();
    if (video.readyState >= 1) onReady();
    else video.addEventListener('loadedmetadata', onReady, { once: true });

    // iOS Safari only paints seeks after the element has played once
    video.play()
      .then(() => {
        video.pause();
        if (duration) video.currentTime = current * (duration - 0.04);
      })
      .catch(() => {});

    current = readProgress();
    render(current);

    return {
      update(dt) {
        const target = readProgress();
        if (current === target) return false;
        current = damp(current, target, 0.14, dt);
        if (Math.abs(target - current) < 0.0005) current = target;
        render(current);
        return current !== target;
      },
    };
  }

  /* --------------------------------------- why choose: horizontal gallery */
  function whyGallery() {
    const section = document.querySelector('[data-why]');
    if (!section) return null;

    const pin = section.querySelector('.why__pin');
    const track = section.querySelector('[data-why-track]');
    const bar = section.querySelector('[data-why-bar]');
    const mq = window.matchMedia('(max-width: 900px)');

    const TRACK_W = 4821;   // Figma track width, px
    const CONTENT_H = 640;  // tallest tile, px

    const readVar = (el, name) => parseFloat(getComputedStyle(el).getPropertyValue(name)) || 0;
    const items = [...track.querySelectorAll('.why-item')].map(el => ({
      el,
      x: readVar(el, '--x'),
      w: readVar(el, '--w'),
      img: el.querySelector('img'),
      depth: parseFloat(el.dataset.depth) || 1,
      masks: [...el.querySelectorAll('[data-mask]')],
      isIntro: el.classList.contains('why-intro'),
    }));

    let enabled = false;
    let k = 1;
    let vw = window.innerWidth;
    let distance = 0;
    let current = 0;
    let dirty = true;

    function layout() {
      enabled = !mq.matches;
      if (!enabled) {
        section.style.height = '';
        track.style.transform = '';
        items.forEach(it => {
          it.el.style.transform = '';
          if (it.img) it.img.style.transform = '';
        });
        return;
      }
      vw = window.innerWidth;
      const vh = pin.clientHeight;
      // 1 at the Figma viewport (885 tall); tiles scale with the window height
      k = clamp((vh - 245) / CONTENT_H, 0.6, 1.25);
      const top = Math.max(104, (vh - CONTENT_H * k) / 2 + 56 * k);
      track.style.setProperty('--k', k);
      track.style.setProperty('--top', `${top}px`);
      distance = Math.max(0, TRACK_W * k - vw);
      section.style.height = `${vh + distance}px`;
      dirty = true;
    }

    function render() {
      track.style.transform = `translate3d(${-current}px, 0, 0)`;
      if (bar) bar.style.transform = `scaleX(${distance ? current / distance : 0})`;

      for (const it of items) {
        const left = it.x * k - current;
        const width = it.w * k;
        const offset = (left + width / 2 - vw / 2) / vw; // about -1 … 1 while on screen

        if (!reduceMotion && it.depth !== 1) {
          it.el.style.transform = `translate3d(${-offset * (it.depth - 1) * vw * 0.6}px, 0, 0)`;
        }
        if (it.img && !reduceMotion) {
          it.img.style.transform = `translate3d(${-offset * width * 0.16}px, 0, 0)`;
        }
        if (it.isIntro) continue;
        // copy is wiped in as it crosses 82% of the viewport, and replays when scrolled back
        for (const m of it.masks) {
          if (left < vw * 0.82) m.classList.add('is-revealed');
          else if (left > vw * 1.02) m.classList.remove('is-revealed');
        }
      }
    }

    return {
      layout,
      update(dt) {
        if (!enabled) return false;
        const target = clamp(-section.getBoundingClientRect().top, 0, distance);
        if (current === target && !dirty) return false;
        current = reduceMotion ? target : damp(current, target, 0.1, dt);
        if (Math.abs(target - current) < 0.3) current = target;
        dirty = false;
        render();
        return current !== target;
      },
      get enabled() { return enabled; },
    };
  }

  /* ------------------------------------------------------ vertical parallax */
  function parallax() {
    const els = [...document.querySelectorAll('[data-parallax]')];
    if (!els.length || reduceMotion) return null;
    return {
      update() {
        const vh = window.innerHeight;
        for (const el of els) {
          const box = el.parentElement.getBoundingClientRect();
          if (box.bottom < -100 || box.top > vh + 100) continue;
          const offset = (box.top + box.height / 2 - vh / 2) * parseFloat(el.dataset.parallax);
          el.style.transform = `translate3d(0, ${-offset}px, 0)`;
        }
        return false;
      },
    };
  }

  /* ------------------------------------------------- stacked project cards */
  // Each card is sticky; as the next one slides over it, the covered card
  // scales down and blurs (--stack goes 0 → 1).
  function projectStack() {
    const cards = [...document.querySelectorAll('.project-card')];
    const mq = window.matchMedia('(max-width: 900px)');
    if (cards.length < 2 || reduceMotion) return null;
    return {
      update() {
        if (mq.matches) return false;
        for (let i = 0; i < cards.length - 1; i++) {
          const card = cards[i].getBoundingClientRect();
          const next = cards[i + 1].getBoundingClientRect();
          const covered = clamp((card.top + card.height - next.top) / card.height);
          cards[i].style.setProperty('--stack', covered.toFixed(3));
        }
        return false;
      },
    };
  }

  /* --------------------------------------------------------- reveal on view */
  function revealOnView(why) {
    const inTrackCopy = el => el.closest('.why-copy');
    const once = [
      ...document.querySelectorAll('[data-reveal-up], [data-journey], [data-draw]'),
      ...masks.filter(el => !inTrackCopy(el)),
    ];
    // gallery copy is driven by the gallery on desktop and by this observer on mobile
    const trackCopy = masks.filter(inTrackCopy);

    if (!('IntersectionObserver' in window)) {
      [...once, ...trackCopy].forEach(el => el.classList.add('is-revealed'));
      return;
    }

    // siblings that enter together cascade
    document.querySelectorAll('.projects__list, .contact__head').forEach(group => {
      group.querySelectorAll('[data-reveal-up]').forEach((el, i) => el.style.setProperty('--i', i));
    });

    const io = new IntersectionObserver(entries => {
      entries.forEach(entry => {
        if (!entry.isIntersecting) return;
        entry.target.classList.add('is-revealed');
        io.unobserve(entry.target);
      });
    }, { rootMargin: '0px 0px -12% 0px' });
    once.forEach(el => io.observe(el));

    const mobileIo = new IntersectionObserver(entries => {
      if (why && why.enabled) return;
      entries.forEach(entry => { if (entry.isIntersecting) entry.target.classList.add('is-revealed'); });
    }, { rootMargin: '0px 0px -12% 0px' });
    trackCopy.forEach(el => mobileIo.observe(el));
  }

  /* ----------------------------------------------------- solutions switcher */
  function solutions() {
    const items = [...document.querySelectorAll('[data-solution]')];
    const images = [...document.querySelectorAll('[data-solution-img]')];
    if (!items.length || !('IntersectionObserver' in window)) return;

    const setActive = index => {
      items.forEach(el => el.classList.toggle('is-active', el.dataset.solution === index));
      images.forEach(el => el.classList.toggle('is-active', el.dataset.solutionImg === index));
    };
    const io = new IntersectionObserver(entries => {
      entries.forEach(entry => { if (entry.isIntersecting) setActive(entry.target.dataset.solution); });
    }, { rootMargin: '-50% 0px -50% 0px' });
    items.forEach(el => io.observe(el));
  }

  /* ---------------------------------------------------------- partner grid */
  function partners() {
    const toggle = document.querySelector('[data-partners-toggle]');
    const grid = document.querySelector('[data-partners]');
    if (!toggle || !grid) return;
    toggle.addEventListener('click', () => {
      const open = grid.classList.toggle('is-expanded');
      toggle.setAttribute('aria-expanded', String(open));
      toggle.querySelector('span').textContent = open ? 'Show Less' : 'Show More';
    });
  }

  /* ------------------------------------------------ auto-scrolling rails */
  // The card set is cloned so the track can loop seamlessly; it drifts left,
  // eases to a stop while hovered, and can be dragged with a mouse or finger.
  function marquees() {
    return [...document.querySelectorAll('[data-marquee]')].map(rail => {
      const track = rail.firstElementChild;
      const originals = [...track.children];
      originals.forEach(card => {
        const clone = card.cloneNode(true);
        clone.setAttribute('aria-hidden', 'true');
        clone.querySelectorAll('a').forEach(a => a.setAttribute('tabindex', '-1'));
        track.appendChild(clone);
      });

      const SPEED = reduceMotion ? 0 : 0.045; // px per ms
      let x = 0;
      let speed = SPEED;
      let hovering = false;
      let dragging = false;
      let dragStart = 0;
      let dragX = 0;
      let moved = false;
      let loop = 1;

      const measure = () => { loop = track.scrollWidth / 2; };
      rail.addEventListener('pointerenter', e => { if (e.pointerType === 'mouse') hovering = true; });
      rail.addEventListener('pointerleave', () => { hovering = false; wake(); });
      rail.addEventListener('pointerdown', e => {
        dragging = true;
        moved = false;
        dragStart = e.clientX;
        dragX = x;
      });
      rail.addEventListener('pointermove', e => {
        if (!dragging) return;
        const dx = e.clientX - dragStart;
        if (!moved && Math.abs(dx) > 4) {
          moved = true;
          rail.setPointerCapture(e.pointerId); // only once it is really a drag, so links still click
        }
        x = dragX + dx;
        wake();
      });
      const release = () => { dragging = false; wake(); };
      rail.addEventListener('pointerup', release);
      rail.addEventListener('pointercancel', release);
      rail.addEventListener('click', e => { if (moved) e.preventDefault(); }, true);

      return {
        layout: measure,
        update(dt) {
          const box = rail.getBoundingClientRect();
          const visible = box.bottom > 0 && box.top < window.innerHeight;
          speed = damp(speed, hovering || dragging ? 0 : SPEED, 0.06, dt);
          if (!dragging) x -= speed * dt;
          if (x <= -loop) { x += loop; dragX += loop; }
          if (x > 0) { x -= loop; dragX -= loop; }
          track.style.transform = `translate3d(${x}px, 0, 0)`;
          // keep ticking while on screen and moving
          return visible && (speed > 0.001 || dragging);
        },
      };
    });
  }

  /* ---------------------------------------------------------------- init */
  masks.forEach(splitMask);
  staggerMasks();

  const why = whyGallery();
  [heroStage(), why, parallax(), projectStack(), ...marquees()].forEach(m => { if (m) modules.push(m); });

  revealOnView(why);
  solutions();
  partners();

  // header gains a solid backing once the video stage has scrolled away
  const header = document.querySelector('.site-header');
  const stageEl = document.querySelector('[data-scroll-stage]');
  const syncHeader = () => {
    if (header && stageEl) header.classList.toggle('is-solid', stageEl.getBoundingClientRect().bottom < 92);
  };

  layoutAll();
  syncHeader();
  window.addEventListener('scroll', () => { wake(); syncHeader(); }, { passive: true });

  let resizeTimer = 0;
  let lastWidth = window.innerWidth;
  window.addEventListener('resize', () => {
    clearTimeout(resizeTimer);
    resizeTimer = setTimeout(() => {
      if (window.innerWidth !== lastWidth) {
        lastWidth = window.innerWidth;
        resplit();
      }
      layoutAll();
    }, 120);
  });

  // web fonts change where lines wrap
  if (document.fonts && document.fonts.ready) {
    document.fonts.ready.then(() => {
      resplit();
      layoutAll();
    });
  }
})();
