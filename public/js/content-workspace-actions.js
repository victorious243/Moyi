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
      document.getElementById('cmo-chat-trigger-btn')?.click();
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
