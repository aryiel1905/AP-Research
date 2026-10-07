(() => {
  'use strict';

  if (!window.gsap || matchMedia('(prefers-reduced-motion: reduce)').matches) return;
  if (window.ScrollTrigger) window.gsap.registerPlugin(window.ScrollTrigger);

  const CONFIGS = [
    { id: 'apr-sqm-panel', scroller: '.sqm-body', hero: '.sqm-section-heading', cards: '.sqm-chart-card', text: '.sqm-status' },
    { id: 'apr-pvcg-panel', scroller: '.pvcg-body', hero: '.pvcg-section-heading', cards: '.pvcg-current', text: '.pvcg-status' },
    { id: 'apr-yip-market-data-panel-host', scroller: '.scroll', hero: '.section-heading', cards: '.metric-card', text: null },
    { id: 'apr-rea-panel', scroller: '.rea-body', hero: '.rea-section-heading', cards: '.rea-table', text: '.rea-period-content' },
    { id: 'apr-abs-panel', scroller: '.abs-body', hero: '.abs-section-heading', cards: '.abs-stat-card', text: '.abs-method' }
  ];

  function animatePanel(config) {
    const root = document.getElementById(config.id);
    if (!root || root.dataset.aphMotionReady === '1') return false;
    const scope = root.shadowRoot || root;
    const scroller = scope.querySelector(config.scroller);
    const hero = scope.querySelector(config.hero);
    if (!scroller || !hero) return false;

    root.dataset.aphMotionReady = '1';
    window.gsap.from(root, {
      x: 42,
      opacity: 0,
      duration: .82,
      ease: 'power3.out',
      clearProps: 'opacity,transform'
    });
    window.gsap.from(hero.children, {
      y: 22,
      opacity: 0,
      scale: .96,
      duration: .78,
      stagger: .07,
      ease: 'power3.out',
      delay: .12,
      clearProps: 'opacity,transform'
    });

    if (!window.ScrollTrigger) return true;
    scope.querySelectorAll(config.cards).forEach(card => {
      window.gsap.fromTo(card,
        { scale: .82, opacity: .22 },
        {
          scale: 1,
          opacity: 1,
          ease: 'none',
          scrollTrigger: {
            trigger: card,
            scroller,
            start: 'top 94%',
            end: 'top 62%',
            scrub: true
          }
        }
      );
    });

    if (config.text) scope.querySelectorAll(config.text).forEach(text => {
      window.gsap.fromTo(text,
        { opacity: .1 },
        {
          opacity: 1,
          ease: 'none',
          scrollTrigger: {
            trigger: text,
            scroller,
            start: 'top 96%',
            end: 'top 72%',
            scrub: true
          }
        }
      );
    });
    return true;
  }

  function scan() {
    for (const config of CONFIGS) animatePanel(config);
  }

  scan();
  const observer = new MutationObserver(scan);
  observer.observe(document.documentElement, { childList: true, subtree: true });
  setTimeout(scan, 400);
  setTimeout(scan, 1200);
  setTimeout(() => {
    scan();
    observer.disconnect();
  }, 4200);
})();
