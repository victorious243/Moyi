(() => {
  const reduceMotion = window.matchMedia('(prefers-reduced-motion: reduce)');
  const desktopQuery = window.matchMedia('(min-width: 1024px)');
  const hoverQuery = window.matchMedia('(hover: hover) and (pointer: fine)');

  const currentTopbar = () => document.querySelector('.topbar');

  const setMenuOpen = (isOpen) => {
    const topbar = currentTopbar();
    const menuButton = document.querySelector('.mobile-menu-button');
    const mobileMenu = document.querySelector('.mobile-menu');
    if (!topbar || !menuButton || !mobileMenu) return;

    topbar.classList.toggle('nav-open', isOpen);
    menuButton.setAttribute('aria-expanded', String(isOpen));
    menuButton.setAttribute('aria-label', isOpen ? 'Close navigation menu' : 'Open navigation menu');
    mobileMenu.setAttribute('aria-hidden', String(!isOpen));
    mobileMenu.inert = !isOpen;
  };

  const closeOnDesktop = () => {
    if (desktopQuery.matches) setMenuOpen(false);
  };

  const initNavbar = () => {
    const topbar = currentTopbar();
    const menuButton = document.querySelector('.mobile-menu-button');
    const mobileMenu = document.querySelector('.mobile-menu');
    if (!topbar || !menuButton || !mobileMenu) return;

    setMenuOpen(false);

    if (!menuButton.dataset.navBound) {
      menuButton.dataset.navBound = 'true';
      menuButton.addEventListener('click', () => {
        setMenuOpen(!topbar.classList.contains('nav-open'));
      });
    }

    mobileMenu.querySelectorAll('a, button').forEach((item) => {
      if (item.dataset.navCloseBound) return;
      item.dataset.navCloseBound = 'true';
      item.addEventListener('click', () => setMenuOpen(false));
    });
  };

  if (!window.__moyiNavbarDocumentBound) {
    window.__moyiNavbarDocumentBound = true;
    document.addEventListener('click', (event) => {
      const topbar = currentTopbar();
      if (!topbar || !topbar.classList.contains('nav-open')) return;
      if (topbar.contains(event.target)) return;
      setMenuOpen(false);
    });

    document.addEventListener('keydown', (event) => {
      if (event.key === 'Escape') setMenuOpen(false);
    });

    desktopQuery.addEventListener('change', closeOnDesktop);
    window.addEventListener('resize', closeOnDesktop);
  }

  if (!window.__moyiCursorGlowBound && !reduceMotion.matches && hoverQuery.matches) {
    window.__moyiCursorGlowBound = true;
    let currentX = window.innerWidth / 2;
    let currentY = window.innerHeight / 2;
    let targetX = currentX;
    let targetY = currentY;
    let frame = null;

    const render = () => {
      const cursorGlow = document.querySelector('.cursor-glow');
      if (!cursorGlow) {
        frame = null;
        return;
      }
      currentX += (targetX - currentX) * 0.18;
      currentY += (targetY - currentY) * 0.18;
      cursorGlow.style.transform = `translate3d(${currentX - 110}px, ${currentY - 110}px, 0)`;
      frame = requestAnimationFrame(render);
    };

    document.addEventListener('pointermove', (event) => {
      const cursorGlow = document.querySelector('.cursor-glow');
      if (!cursorGlow) return;
      targetX = event.clientX;
      targetY = event.clientY;
      cursorGlow.classList.add('is-visible');
      if (!frame) frame = requestAnimationFrame(render);
    }, { passive: true });

    document.addEventListener('pointerleave', () => {
      document.querySelector('.cursor-glow')?.classList.remove('is-visible');
    });
  }

  initNavbar();
  document.addEventListener('moyi:page-load', initNavbar);
})();
