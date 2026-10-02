/* ==========================================================================
   Zilal — site interactions
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

  /* --------------------------------------------- observer root */
  // Observe against this document's own viewport. The default (implicit) root
  // is the top-level window, so inside a frame — an embed, a preview — every
  // rootMargin trigger would be measured against the wrong box.
  const IO_ROOT = (() => {
    try { new IntersectionObserver(() => {}, { root: document }); return document; } catch (_) { return null; }
  })();

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
      const block = el.closest('.why-copy, .why-intro, .section-head, .head, .quote__copy, [data-mask-group]') || el;
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
    let vw = document.documentElement.clientWidth; // visible width, excluding a classic scrollbar
    let distance = 0;
    let hold = 0;
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
      vw = document.documentElement.clientWidth;
      const vh = pin.clientHeight;
      // 1 at the Figma viewport (885 tall); tiles scale with the window height
      k = clamp((vh - 245) / CONTENT_H, 0.6, 1.25);
      const top = Math.max(104, (vh - CONTENT_H * k) / 2 + 56 * k);
      track.style.setProperty('--k', k);
      track.style.setProperty('--top', `${top}px`);
      // scroll until the right-most item (the last copy block) ends exactly
      // one side gutter from the window edge — 60px on desktop
      const gutter = parseFloat(getComputedStyle(document.documentElement).getPropertyValue('--gutter')) || 60;
      const contentRight = Math.max(...items.map(it => it.x + it.w));
      distance = Math.max(0, contentRight * k - (vw - gutter));
      // extra scroll at the end keeps the last panel pinned for a beat
      // (and lets the eased track settle) before the page moves on
      hold = Math.round(vh * 0.4);
      section.style.height = `${vh + distance + hold}px`;
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
    // Home's project cards and the projects page's [data-stack] list: each
    // card gets its deck index (--i, offsets it a little lower than the one
    // before) and a --stack value for how much of it the next card covers.
    const decks = [
      () => [...document.querySelectorAll('.project-card')],
      () => [...document.querySelectorAll('[data-stack] > .pcard:not(.is-hidden)')],
    ];
    const mq = window.matchMedia('(max-width: 900px)');
    if (reduceMotion || !decks.some(get => get().length > 1)) return null;
    return {
      update() {
        if (mq.matches) return false;
        decks.forEach(get => {
          const cards = get();
          cards.forEach((c, i) => {
            c.style.setProperty('--i', i);
            const next = cards[i + 1];
            if (!next) { c.style.setProperty('--stack', 0); return; }
            const box = c.getBoundingClientRect();
            const covered = clamp((box.bottom - next.getBoundingClientRect().top) / box.height);
            c.style.setProperty('--stack', covered.toFixed(3));
          });
        });
        return false;
      },
    };
  }

  /* --------------------------------------------------------- reveal on view */
  function revealOnView(why) {
    const inTrackCopy = el => el.closest('.why-copy');
    const once = [
      ...document.querySelectorAll('[data-reveal-up], [data-journey], [data-draw], [data-wipe], [data-stagger], [data-count]'),
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
        if (entry.target.hasAttribute('data-count')) countUp(entry.target);
        io.unobserve(entry.target);
      });
    }, { root: IO_ROOT, rootMargin: '0px 0px -12% 0px' });
    once.forEach(el => io.observe(el));

    const mobileIo = new IntersectionObserver(entries => {
      if (why && why.enabled) return;
      entries.forEach(entry => { if (entry.isIntersecting) entry.target.classList.add('is-revealed'); });
    }, { root: IO_ROOT, rootMargin: '0px 0px -12% 0px' });
    trackCopy.forEach(el => mobileIo.observe(el));

    // falling tags wait until most of the group is on screen, so the drop is seen
    const dropIo = new IntersectionObserver(entries => {
      entries.forEach(entry => {
        if (!entry.isIntersecting) return;
        entry.target.classList.add('is-revealed');
        dropIo.unobserve(entry.target);
      });
    }, { root: IO_ROOT, threshold: 0.7 });
    document.querySelectorAll('[data-drop]').forEach(el => dropIo.observe(el));
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
    }, { root: IO_ROOT, rootMargin: '-50% 0px -50% 0px' });
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


  /* ----------------------------------------------------------- count up */
  function countUp(el) {
    const end = parseFloat(el.dataset.count);
    const suffix = el.dataset.suffix || '';
    if (reduceMotion || !end) return;
    const start = performance.now();
    const DURATION = 1600;
    const step = now => {
      const t = clamp((now - start) / DURATION);
      el.textContent = Math.round(end * (1 - Math.pow(1 - t, 3))) + suffix;
      if (t < 1) requestAnimationFrame(step);
    };
    requestAnimationFrame(step);
  }

  /* ------------------------------------------------ image parallax ([data-px]) */
  // Images sit oversized in a clipping frame and drift against the scroll.
  function imageParallax() {
    const imgs = [...document.querySelectorAll('[data-px]')];
    if (!imgs.length || reduceMotion) return null;
    return {
      update() {
        const vh = window.innerHeight;
        for (const img of imgs) {
          const box = img.parentElement.getBoundingClientRect();
          if (box.bottom < -50 || box.top > vh + 50) continue;
          // -1 when the frame's centre is at the bottom of the viewport, +1 at the top
          const progress = clamp((vh / 2 - (box.top + box.height / 2)) / (vh / 2 + box.height / 2), -1, 1);
          const shift = progress * box.height * parseFloat(img.dataset.px || 0.1);
          img.style.transform = `translate3d(0, ${shift.toFixed(1)}px, 0)`;
        }
        return false;
      },
    };
  }

  /* ------------------------------------------------ page transition curtain */
  function pageTransitions() {
    const root = document.documentElement;
    // lift the curtain as soon as the document is parsed (script is deferred)
    requestAnimationFrame(() => requestAnimationFrame(() => root.classList.add('page-ready')));
    // coming back through the bfcache should not leave the curtain down
    window.addEventListener('pageshow', e => {
      if (e.persisted) { root.classList.remove('page-leaving'); root.classList.add('page-ready'); }
    });
    if (reduceMotion) return;

    document.addEventListener('click', e => {
      const a = e.target.closest('a[href]');
      if (!a || e.defaultPrevented || e.button !== 0 || e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) return;
      if (a.target && a.target !== '_self') return;
      const url = new URL(a.href, location.href);
      if (url.origin !== location.origin || !/\.html$|\/$/.test(url.pathname)) return;
      if (url.pathname === location.pathname && url.hash) return;
      e.preventDefault();
      root.classList.remove('page-ready');
      root.classList.add('page-leaving');
      setTimeout(() => { location.href = url.href; }, 520);
    });
  }

  /* -------------------------------------------------------- mobile menu */
  function mobileMenu() {
    const btn = document.querySelector('[data-menu-toggle]');
    const nav = document.querySelector('.site-nav');
    if (!btn) return;

    const set = open => {
      document.body.classList.toggle('menu-open', open);
      btn.setAttribute('aria-expanded', String(open));
      btn.setAttribute('aria-label', open ? 'Close menu' : 'Open menu');
    };
    const isOpen = () => document.body.classList.contains('menu-open');

    btn.addEventListener('click', () => set(!isOpen()));
    // tapping a link, the veil, or Escape closes the panel again
    nav?.addEventListener('click', e => { if (e.target.closest('a')) set(false); });
    document.addEventListener('click', e => {
      if (isOpen() && !e.target.closest('.site-nav') && !e.target.closest('[data-menu-toggle]')) set(false);
    });
    document.addEventListener('keydown', e => { if (e.key === 'Escape' && isOpen()) set(false); });
    window.matchMedia('(min-width: 1101px)').addEventListener('change', e => { if (e.matches) set(false); });
  }

  /* ----------------------------------------------- demo forms (static site) */
  function demoForms() {
    document.querySelectorAll('[data-fake-form]').forEach(form => {
      form.addEventListener('submit', e => {
        e.preventDefault();
        if (!form.checkValidity()) { form.reportValidity(); return; }
        form.classList.add('is-sent');
        const note = form.querySelector('[data-form-note]');
        if (note) note.hidden = false;
        form.reset();
        setTimeout(() => form.classList.remove('is-sent'), 4000);
      });
    });
  }

  /* ------------------------------------------------ filter tabs / accordions */
  function filters() {
    // Projects: pill tabs filter the cards by category
    document.querySelectorAll('[data-filter-tabs]').forEach(tabs => {
      const list = document.querySelector(tabs.dataset.filterTabs);
      if (!list) return;
      tabs.addEventListener('click', e => {
        const btn = e.target.closest('[data-filter]');
        if (!btn) return;
        tabs.querySelectorAll('[data-filter]').forEach(b => b.setAttribute('aria-pressed', String(b === btn)));
        const key = btn.dataset.filter;
        list.querySelectorAll('[data-cat]').forEach(card => {
          const show = key === 'all' || card.dataset.cat === key;
          card.classList.toggle('is-hidden', !show);
        });
        wake();
      });
    });

    // Spare parts: accordion groups + checkbox filtering by part type
    document.querySelectorAll('[data-accordion]').forEach(group => {
      const btn = group.querySelector('[data-accordion-btn]');
      btn.addEventListener('click', () => {
        const open = group.classList.toggle('is-open');
        btn.setAttribute('aria-expanded', String(open));
      });
    });
    const parts = document.querySelector('[data-parts]');
    const boxes = [...document.querySelectorAll('[data-part-filter]')];
    if (parts && boxes.length) {
      const apply = () => {
        const on = boxes.filter(b => b.checked).map(b => b.value);
        parts.querySelectorAll('[data-type]').forEach(card => {
          card.classList.toggle('is-hidden', on.length > 0 && !on.includes(card.dataset.type));
        });
      };
      boxes.forEach(b => b.addEventListener('change', apply));
      apply();
    }
  }

  /* -------------------------------------------------------- gallery slider */
  // Buttons step the slides; a horizontal drag does too. While dragging the
  // slides follow the pointer with resistance (--drag), then spring back.
  function galleries() {
    document.querySelectorAll('[data-gallery]').forEach(g => {
      const slides = [...g.querySelectorAll('[data-slide]')];
      let index = 1;
      const render = () => slides.forEach((s, i) => {
        const pos = (i - index + slides.length) % slides.length;
        s.dataset.pos = pos === 0 ? 'center' : pos === 1 ? 'next' : pos === slides.length - 1 ? 'prev' : 'hidden';
      });
      const step = d => { index = (index + d + slides.length) % slides.length; render(); };
      g.querySelector('[data-gallery-prev]')?.addEventListener('click', () => step(-1));
      g.querySelector('[data-gallery-next]')?.addEventListener('click', () => step(1));

      // drag follows the pointer 1:1; on release a long drag or a quick flick
      // moves one slide, and the slides glide on from where they were let go
      let startX = null, dx = 0, lastX = 0, lastT = 0, v = 0;
      g.addEventListener('pointerdown', e => {
        if (e.target.closest('button')) return;
        startX = lastX = e.clientX; lastT = performance.now(); dx = 0; v = 0;
        g.classList.add('is-dragging');
      });
      g.addEventListener('pointermove', e => {
        if (startX === null) return;
        dx = e.clientX - startX;
        const now = performance.now();
        v = (e.clientX - lastX) / Math.max(1, now - lastT); // px per ms
        lastX = e.clientX; lastT = now;
        if (Math.abs(dx) > 4) g.setPointerCapture(e.pointerId);
        g.style.setProperty('--drag', `${dx}px`);
      });
      const end = () => {
        if (startX === null) return;
        startX = null;
        g.classList.remove('is-dragging');
        const flick = Math.abs(v) > 0.45 && Math.sign(v) === Math.sign(dx);
        if (Math.abs(dx) > g.clientWidth * 0.08 || flick) step(dx < 0 ? 1 : -1);
        g.style.setProperty('--drag', '0px');
      };
      g.addEventListener('pointerup', end);
      g.addEventListener('pointercancel', end);
      g.addEventListener('dragstart', e => e.preventDefault());
      render();
    });
  }

  /* ------------------------------------------------- draggable rails */
  // [data-drag-rail]: drag (mouse or touch) with momentum on release; past
  // either end the track stretches like a rubber band and springs back.
  function dragRails() {
    return [...document.querySelectorAll('[data-drag-rail]')].map(rail => {
      const track = rail.firstElementChild;
      let x = 0, v = 0, min = 0;
      let dragging = false, startX = 0, startPos = 0, lastX = 0, lastT = 0, moved = false;
      const measure = () => { min = Math.min(0, rail.clientWidth - track.scrollWidth); x = clamp(x, min, 0); };
      // resistance beyond the edges: the further out, the stiffer
      const rubber = (pos) => {
        if (pos > 0) return pos * 0.35;
        if (pos < min) return min + (pos - min) * 0.35;
        return pos;
      };
      rail.addEventListener('pointerdown', e => {
        dragging = true; moved = false; v = 0;
        startX = lastX = e.clientX; lastT = performance.now(); startPos = x;
        rail.classList.add('is-dragging');
      });
      rail.addEventListener('pointermove', e => {
        if (!dragging) return;
        const dx = e.clientX - startX;
        if (!moved && Math.abs(dx) > 4) { moved = true; rail.setPointerCapture(e.pointerId); }
        const now = performance.now();
        v = (e.clientX - lastX) / Math.max(1, now - lastT) * 16.67; // px per frame
        lastX = e.clientX; lastT = now;
        x = rubber(startPos + dx);
        wake();
      });
      const release = () => { if (!dragging) return; dragging = false; rail.classList.remove('is-dragging'); wake(); };
      rail.addEventListener('pointerup', release);
      rail.addEventListener('pointercancel', release);
      rail.addEventListener('click', e => { if (moved) { e.preventDefault(); e.stopPropagation(); } }, true);
      rail.addEventListener('dragstart', e => e.preventDefault());

      return {
        layout: measure,
        update(dt) {
          if (!dragging) {
            const f = dt / 16.67;
            if (x > 0 || x < min) {
              // out of bounds: spring back to the nearest edge
              const edge = x > 0 ? 0 : min;
              x = damp(x, edge, 0.18, dt);
              v = 0;
              if (Math.abs(x - edge) < 0.3) x = edge;
            } else if (Math.abs(v) > 0.05) {
              x += v * f;
              v *= Math.pow(0.94, f);
            } else {
              v = 0;
            }
          }
          track.style.transform = `translate3d(${x}px, 0, 0)`;
          return dragging || Math.abs(v) > 0.05 || x > 0 || x < min;
        },
      };
    });
  }

  /* ------------------------------------------------ elastic "Drag" cursor */
  // Over any carousel a red "‹ Drag ›" disc replaces the pointer. It trails
  // the mouse on a spring, stretches along its direction of travel and
  // squeezes while pressed. Mouse/trackpad only; touch keeps native swipes.
  function dragCursor() {
    if (!window.matchMedia('(hover: hover) and (pointer: fine)').matches) return null;
    const zones = '[data-marquee], [data-drag-rail], [data-gallery]';
    if (!document.querySelector(zones)) return null;
    const el = document.createElement('div');
    el.className = 'drag-cursor';
    el.setAttribute('aria-hidden', 'true');
    el.innerHTML = '<span class="drag-cursor__disc"><svg viewBox="0 0 10 10"><path d="M6.5 2 3.5 5l3 3"/></svg>Drag<svg viewBox="0 0 10 10"><path d="M3.5 2l3 3-3 3"/></svg></span>';
    document.body.appendChild(el);
    document.documentElement.classList.add('has-drag-cursor');

    let tx = 0, ty = 0, x = 0, y = 0, vx = 0, vy = 0;
    let active = false, pressed = false, shown = 0, press = 0;
    document.addEventListener('pointermove', e => {
      if (e.pointerType !== 'mouse') return;
      tx = e.clientX; ty = e.clientY;
      const over = !!e.target.closest(zones) && !e.target.closest('button');
      if (over && !active && shown < 0.01) { x = tx; y = ty; }
      active = over;
      wake();
    }, { passive: true });
    document.addEventListener('pointerdown', () => { pressed = true; wake(); });
    document.addEventListener('pointerup', () => { pressed = false; wake(); });
    document.addEventListener('pointerleave', () => { active = false; wake(); });

    return {
      update(dt) {
        const f = Math.min(dt / 16.67, 3);
        // spring: stiffness pulls toward the mouse, damping bleeds speed
        const k = reduceMotion ? 1 : 0.16, d = reduceMotion ? 0 : 0.72;
        vx = (vx + (tx - x) * k) * d; vy = (vy + (ty - y) * k) * d;
        if (reduceMotion) { x = tx; y = ty; } else { x += vx * f; y += vy * f; }
        shown = damp(shown, active ? 1 : 0, 0.2, dt);
        press = damp(press, pressed && active ? 1 : 0, 0.3, dt);
        const speed = Math.hypot(vx, vy);
        const stretch = reduceMotion ? 0 : Math.min(speed / 70, 0.3);
        const angle = Math.atan2(vy, vx) * 180 / Math.PI;
        const scale = shown * (1 - press * 0.18);
        el.style.transform = `translate3d(${x}px, ${y}px, 0) rotate(${angle}deg) scale(${scale * (1 + stretch)}, ${scale * (1 - stretch * 0.5)})`;
        el.firstChild.style.transform = `rotate(${-angle}deg)`;
        el.classList.toggle('is-pressed', press > 0.5);
        return shown > 0.001 || active || speed > 0.05;
      },
    };
  }

  /* ---------------------------------------------- contact form → thank you */
  // A valid submit swaps the form for the thank-you state and plays its
  // celebration (envelope pops, wobbles and floats; confetti bursts out).
  function contactForm() {
    const form = document.querySelector('[data-contact-form]');
    const thanks = document.querySelector('[data-contact-thanks]');
    if (!form || !thanks) return;
    form.addEventListener('submit', e => {
      e.preventDefault();
      form.querySelectorAll('.field').forEach(f => {
        const el = f.querySelector('input, select, textarea');
        f.classList.toggle('is-invalid', !!el && !el.checkValidity());
      });
      if (!form.checkValidity()) { form.reportValidity(); return; }
      form.hidden = true;
      thanks.hidden = false;
      void thanks.offsetWidth; // restart the animations from the first frame
      thanks.classList.add('is-celebrating');
      thanks.focus({ preventScroll: true });
      const top = thanks.getBoundingClientRect().top;
      if (top < 80 || top > window.innerHeight * .6) {
        window.scrollTo({ top: window.scrollY + top - 120, behavior: reduceMotion ? 'auto' : 'smooth' });
      }
    });
    form.addEventListener('input', e => e.target.closest('.field')?.classList.remove('is-invalid'));
  }

  /* ------------------------------------------------- blog: copy post link */
  function copyLink() {
    document.querySelectorAll('[data-copy-link]').forEach(btn => btn.addEventListener('click', async () => {
      try { await navigator.clipboard.writeText(location.href); } catch (_) { return; }
      btn.classList.add('is-copied');
      btn.setAttribute('aria-label', 'Link copied');
      setTimeout(() => { btn.classList.remove('is-copied'); btn.setAttribute('aria-label', 'Copy link'); }, 1800);
    }));
  }

  /* ------------------------------------------------- spare parts filter */
  // Checked boxes narrow the grid: OR within a group (any ticked brand),
  // AND across groups (category and brand). On phones the panel is a bottom
  // sheet; the frosted bar that opens it shows only while the grid is in view.
  function partsFilter() {
    const root = document.querySelector('[data-parts]');
    if (!root) return;
    const sheet = root.querySelector('[data-sheet]');
    const inputs = [...sheet.querySelectorAll('input[type="checkbox"]')];
    const parts = [...root.querySelectorAll('.part')];
    const counts = [...root.querySelectorAll('[data-parts-count]')];
    const badge = root.querySelector('[data-filter-badge]');
    const bar = root.querySelector('[data-parts-bar]');
    const openBtn = root.querySelector('[data-sheet-open]');

    const apply = () => {
      const picked = group => inputs.filter(i => i.name === group && i.checked).map(i => i.value);
      const cats = picked('cat'), brands = picked('brand');
      let shown = 0;
      parts.forEach(p => {
        const ok = (!cats.length || cats.includes(p.dataset.cat)) && (!brands.length || brands.includes(p.dataset.brand));
        p.classList.toggle('is-hidden', !ok);
        if (ok) shown++;
      });
      counts.forEach(c => { c.textContent = shown; });
      const active = cats.length + brands.length;
      badge.textContent = active;
      badge.hidden = !active;
    };
    inputs.forEach(i => i.addEventListener('change', apply));
    root.querySelectorAll('[data-filter-clear]').forEach(b => b.addEventListener('click', () => {
      inputs.forEach(i => { i.checked = false; });
      apply();
    }));

    const setOpen = open => {
      document.body.classList.toggle('sheet-open', open);
      openBtn.setAttribute('aria-expanded', String(open));
      if (open) sheet.querySelector('.spp-filter__close').focus({ preventScroll: true });
      else openBtn.focus({ preventScroll: true });
    };
    openBtn.addEventListener('click', () => setOpen(true));
    root.querySelectorAll('[data-sheet-close]').forEach(b => b.addEventListener('click', () => {
      if (document.body.classList.contains('sheet-open')) setOpen(false);
    }));
    document.addEventListener('keydown', e => {
      if (e.key === 'Escape' && document.body.classList.contains('sheet-open')) setOpen(false);
    });
    window.matchMedia('(min-width: 769px)').addEventListener('change', e => {
      if (e.matches) document.body.classList.remove('sheet-open');
    });

    if ('IntersectionObserver' in window) {
      new IntersectionObserver(([entry]) => bar.classList.toggle('is-visible', entry.isIntersecting), { root: IO_ROOT })
        .observe(root.querySelector('.spp__grid'));
    } else {
      bar.classList.add('is-visible');
    }
    apply();
  }

  /* --------------------------------------------- chamfered shapes, rounded */
  // A CSS polygon() can't round its corners, so cut-corner tiles came out
  // sharp in some places and half-rounded (border-radius on the uncut corners
  // only) in others. Each element's polygon is read once from its --shape and
  // redrawn as a path() at its real pixel size, with the same --chamfer-r on
  // every corner. --shape-0 gets the same commands collapsed into the first
  // cut, so the reveal wipe can still interpolate between the two.
  function chamfers() {
    const els = [...document.querySelectorAll('.chamfer, .chamfer-soft, .ab-vision-media, .why-media--hero, .products__badge')];
    if (!els.length || !window.ResizeObserver || !CSS.supports('clip-path', 'path("M0 0")')) return;
    const parse = poly => {
      const m = poly && poly.match(/polygon\((.*)\)/);
      if (!m) return null;
      return m[1].split(',').map(pair => pair.trim().split(/\s+/).map(v => parseFloat(v) / (v.endsWith('%') ? 100 : 1)));
    };
    const fmt = n => Math.round(n * 100) / 100;
    // corners are rounded with a quadratic curve through the vertex, inset r
    // along both edges (capped at half of the shorter edge)
    const path = (pts, r) => {
      const n = pts.length;
      let d = '';
      for (let i = 0; i < n; i++) {
        const p = pts[i], prev = pts[(i - 1 + n) % n], next = pts[(i + 1) % n];
        const lenIn = Math.hypot(p[0] - prev[0], p[1] - prev[1]) || 1;
        const lenOut = Math.hypot(next[0] - p[0], next[1] - p[1]) || 1;
        const ri = Math.min(r, lenIn / 2), ro = Math.min(r, lenOut / 2);
        const a = [p[0] + (prev[0] - p[0]) * ri / lenIn, p[1] + (prev[1] - p[1]) * ri / lenIn];
        const b = [p[0] + (next[0] - p[0]) * ro / lenOut, p[1] + (next[1] - p[1]) * ro / lenOut];
        d += `${i ? 'L' : 'M'}${fmt(a[0])} ${fmt(a[1])}Q${fmt(p[0])} ${fmt(p[1])} ${fmt(b[0])} ${fmt(b[1])}`;
      }
      return `path("${d}Z")`;
    };
    const shapes = new Map();
    els.forEach(el => {
      const pts = parse(getComputedStyle(el).getPropertyValue('--shape'));
      if (pts) shapes.set(el, pts);
    });
    const draw = el => {
      const pts = shapes.get(el);
      const w = el.offsetWidth, h = el.offsetHeight;
      if (!pts || !w || !h) return;
      const r = parseFloat(getComputedStyle(el).getPropertyValue('--chamfer-r')) || 12;
      const px = pts.map(([x, y]) => [x * w, y * h]);
      el.style.setProperty('--shape', path(px, r));
      // collapsed start: every point folded onto the first cut edge
      const [p0, p1] = px;
      el.style.setProperty('--shape-0', path(px.map((_, i) => (i % 3 === 0 || i === px.length - 1 ? p0 : p1)), 0));
    };
    const ro = new ResizeObserver(entries => entries.forEach(e => draw(e.target)));
    shapes.forEach((_, el) => { draw(el); ro.observe(el); });
  }

  /* ---------------------------------------------------------------- init */
  chamfers();
  partsFilter();
  contactForm();
  copyLink();
  masks.forEach(splitMask);
  staggerMasks();

  const why = whyGallery();
  [heroStage(), why, parallax(), imageParallax(), projectStack(), ...marquees(), ...dragRails(), dragCursor()].forEach(m => { if (m) modules.push(m); });

  pageTransitions();
  revealOnView(why);
  solutions();
  partners();
  mobileMenu();
  demoForms();
  filters();
  galleries();

  // header gains a solid backing once the video stage has scrolled away
  const header = document.querySelector('.site-header');
  const stageEl = document.querySelector('[data-scroll-stage]');
  const firstSection = document.querySelector('main > section');
  const syncHeader = () => {
    if (!header) return;
    // home: after the video stage; inner pages: once the dark hero has scrolled under the header
    const edge = stageEl || firstSection;
    header.classList.toggle('is-solid', !!edge && edge.getBoundingClientRect().bottom < 92);
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
