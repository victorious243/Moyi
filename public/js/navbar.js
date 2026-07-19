(() => {
  const topbar = document.querySelector('.topbar');
  const menuButton = document.querySelector('.mobile-menu-button');
  const mobileMenu = document.querySelector('.mobile-menu');
  const cursorGlow = document.querySelector('.cursor-glow');
  const reduceMotion = window.matchMedia('(prefers-reduced-motion: reduce)');
  const desktopQuery = window.matchMedia('(min-width: 1024px)');
  const hoverQuery = window.matchMedia('(hover: hover) and (pointer: fine)');

  if (!topbar || !menuButton || !mobileMenu) return;

  const setMenuOpen = (isOpen) => {
    topbar.classList.toggle('nav-open', isOpen);
    menuButton.setAttribute('aria-expanded', String(isOpen));
    menuButton.setAttribute('aria-label', isOpen ? 'Close navigation menu' : 'Open navigation menu');
    mobileMenu.setAttribute('aria-hidden', String(!isOpen));
    mobileMenu.inert = !isOpen;
  };

  setMenuOpen(false);

  menuButton.addEventListener('click', () => {
    setMenuOpen(!topbar.classList.contains('nav-open'));
  });

  mobileMenu.querySelectorAll('a, button').forEach((item) => {
    item.addEventListener('click', () => setMenuOpen(false));
  });

  document.addEventListener('click', (event) => {
    if (!topbar.classList.contains('nav-open')) return;
    if (topbar.contains(event.target)) return;
    setMenuOpen(false);
  });

  document.addEventListener('keydown', (event) => {
    if (event.key === 'Escape') setMenuOpen(false);
  });

  const closeOnDesktop = () => {
    if (desktopQuery.matches) setMenuOpen(false);
  };

  desktopQuery.addEventListener('change', closeOnDesktop);
  window.addEventListener('resize', closeOnDesktop);

  if (!cursorGlow || reduceMotion.matches || !hoverQuery.matches) return;

  let currentX = window.innerWidth / 2;
  let currentY = window.innerHeight / 2;
  let targetX = currentX;
  let targetY = currentY;
  let frame = null;

  const render = () => {
    currentX += (targetX - currentX) * 0.18;
    currentY += (targetY - currentY) * 0.18;
    cursorGlow.style.transform = `translate3d(${currentX - 110}px, ${currentY - 110}px, 0)`;
    frame = requestAnimationFrame(render);
  };

  document.addEventListener('pointermove', (event) => {
    targetX = event.clientX;
    targetY = event.clientY;
    cursorGlow.classList.add('is-visible');
    if (!frame) frame = requestAnimationFrame(render);
  }, { passive: true });

  document.addEventListener('pointerleave', () => {
    cursorGlow.classList.remove('is-visible');
  });
})();
