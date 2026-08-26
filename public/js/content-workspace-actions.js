(function () {
  const containers = [...document.querySelectorAll('[data-mobile-workspace-actions]')];
  if (!containers.length) return;

  const closeMenu = (container) => {
    const menu = container.querySelector('[data-mobile-workspace-menu]');
    const toggle = container.querySelector('[data-mobile-workspace-toggle]');
    if (menu) menu.hidden = true;
    if (toggle) toggle.setAttribute('aria-expanded', 'false');
  };

  const closeAllMenus = (except = null) => {
    containers.forEach((container) => {
      if (container !== except) closeMenu(container);
    });
  };

  document.addEventListener('click', (event) => {
    const toggle = event.target.closest('[data-mobile-workspace-toggle]');
    if (toggle) {
      const container = toggle.closest('[data-mobile-workspace-actions]');
      const menu = container?.querySelector('[data-mobile-workspace-menu]');
      if (!container || !menu) return;
      const opening = menu.hidden;
      closeAllMenus(container);
      menu.hidden = !opening;
      toggle.setAttribute('aria-expanded', String(opening));
      return;
    }

    const openCmo = event.target.closest('[data-mobile-open-cmo]');
    if (openCmo) {
      event.preventDefault();
      const container = openCmo.closest('[data-mobile-workspace-actions]');
      closeMenu(container);
      if (window.MoyiCmoChat && typeof window.MoyiCmoChat.open === 'function') {
        window.MoyiCmoChat.open();
      } else {
        document.dispatchEvent(new CustomEvent('moyi:open-cmo-chat'));
        const drawer = document.getElementById('cmo-chat-drawer');
        if (drawer) {
          drawer.classList.add('is-open');
          drawer.setAttribute('aria-hidden', 'false');
          const input = document.getElementById('cmo-chat-input');
          if (input) setTimeout(() => input.focus(), 150);
        }
      }
      return;
    }

    const menuItem = event.target.closest('.mobile-workspace-menu-item[href]');
    if (menuItem) {
      closeMenu(menuItem.closest('[data-mobile-workspace-actions]'));
      return;
    }

    if (!event.target.closest('[data-mobile-workspace-actions]')) closeAllMenus();
  });

  document.addEventListener('keydown', (event) => {
    if (event.key === 'Escape') closeAllMenus();
  });
}());
