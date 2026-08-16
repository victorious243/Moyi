(() => {
  if (window.__moyiSidebarDrawerInitialized) return;
  window.__moyiSidebarDrawerInitialized = true;

  function ensureDrawerElements() {
    const sidebar = document.querySelector('.app-sidebar, .dashboard-sidebar, .project-sidebar');
    if (!sidebar) {
      // Remove any lingering button if no sidebar on current page
      const orphanBtn = document.querySelector('.mobile-workspace-fab, .mobile-sidebar-toggle-button');
      if (orphanBtn) orphanBtn.remove();
      return;
    }

    // Ensure floating action button (FAB) exists and is mounted directly to document.body
    let toggleBtn = document.querySelector('.mobile-workspace-fab, .mobile-sidebar-toggle-button, [data-sidebar-toggle]');
    if (!toggleBtn) {
      toggleBtn = document.createElement('button');
      toggleBtn.type = 'button';
      toggleBtn.className = 'mobile-workspace-fab';
      toggleBtn.setAttribute('aria-label', 'Open Workspace Navigation Menu');
      toggleBtn.setAttribute('aria-expanded', 'false');
      toggleBtn.setAttribute('data-sidebar-toggle', 'true');
      toggleBtn.innerHTML = `
        <span class="fab-glow" aria-hidden="true"></span>
        <svg class="fab-icon" viewBox="0 0 24 24" width="22" height="22" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
          <polygon points="12 2 2 7 12 12 22 7 12 2"></polygon>
          <polyline points="2 17 12 22 22 17"></polyline>
          <polyline points="2 12 12 17 22 12"></polyline>
        </svg>
        <span class="fab-badge"></span>
      `;
      document.body.appendChild(toggleBtn);
    } else if (toggleBtn.parentElement !== document.body) {
      document.body.appendChild(toggleBtn);
    }

    // Ensure close button exists inside sidebar
    let closeBtn = sidebar.querySelector('.mobile-sidebar-close-button, [data-sidebar-close]');
    if (!closeBtn) {
      closeBtn = document.createElement('button');
      closeBtn.type = 'button';
      closeBtn.className = 'mobile-sidebar-close-button';
      closeBtn.setAttribute('aria-label', 'Close Workspace Navigation Menu');
      closeBtn.setAttribute('data-sidebar-close', 'true');
      closeBtn.innerHTML = `<span>✕</span>`;
      sidebar.prepend(closeBtn);
    }

    // Ensure backdrop exists on document.body
    let backdrop = document.querySelector('.sidebar-backdrop, [data-sidebar-backdrop]');
    if (!backdrop) {
      backdrop = document.createElement('div');
      backdrop.className = 'sidebar-backdrop';
      backdrop.setAttribute('data-sidebar-backdrop', 'true');
      document.body.appendChild(backdrop);
    } else if (backdrop.parentElement !== document.body) {
      document.body.appendChild(backdrop);
    }
  }

  function getSidebar() {
    return document.querySelector('.app-sidebar, .dashboard-sidebar, .project-sidebar');
  }

  function getToggleBtn() {
    return document.querySelector('.mobile-workspace-fab, .mobile-sidebar-toggle-button, [data-sidebar-toggle]');
  }

  function getBackdrop() {
    return document.querySelector('.sidebar-backdrop, [data-sidebar-backdrop]');
  }

  function openDrawer() {
    const sidebar = getSidebar();
    const backdrop = getBackdrop();
    const toggleBtn = getToggleBtn();
    if (!sidebar) return;

    sidebar.classList.add('drawer-open');
    if (backdrop) backdrop.classList.add('active');
    if (toggleBtn) {
      toggleBtn.setAttribute('aria-expanded', 'true');
      toggleBtn.classList.add('fab-active');
    }
    document.body.classList.add('sidebar-drawer-active');
  }

  function closeDrawer() {
    const sidebar = getSidebar();
    const backdrop = getBackdrop();
    const toggleBtn = getToggleBtn();
    if (sidebar) sidebar.classList.remove('drawer-open');
    if (backdrop) backdrop.classList.remove('active');
    if (toggleBtn) {
      toggleBtn.setAttribute('aria-expanded', 'false');
      toggleBtn.classList.remove('fab-active');
    }
    document.body.classList.remove('sidebar-drawer-active');
  }

  // Delegated Global Click Listener (survives any soft-navigation page swaps)
  document.addEventListener('click', (event) => {
    // 1. Toggle FAB clicked
    const toggleBtn = event.target.closest('.mobile-workspace-fab, .mobile-sidebar-toggle-button, [data-sidebar-toggle]');
    if (toggleBtn) {
      event.preventDefault();
      event.stopPropagation();
      const sidebar = getSidebar();
      if (sidebar && sidebar.classList.contains('drawer-open')) {
        closeDrawer();
      } else {
        openDrawer();
      }
      return;
    }

    // 2. Close button clicked
    const closeBtn = event.target.closest('.mobile-sidebar-close-button, [data-sidebar-close]');
    if (closeBtn) {
      event.preventDefault();
      event.stopPropagation();
      closeDrawer();
      return;
    }

    // 3. Backdrop clicked
    const backdrop = event.target.closest('.sidebar-backdrop, [data-sidebar-backdrop]');
    if (backdrop) {
      event.preventDefault();
      closeDrawer();
      return;
    }

    // 4. Link clicked inside sidebar
    const sidebarLink = event.target.closest('.app-sidebar a, .dashboard-sidebar a, .project-sidebar a');
    if (sidebarLink && !sidebarLink.getAttribute('target')) {
      closeDrawer();
    }
  });

  // Close on Escape key
  document.addEventListener('keydown', (event) => {
    if (event.key === 'Escape') {
      const sidebar = getSidebar();
      if (sidebar && sidebar.classList.contains('drawer-open')) {
        closeDrawer();
      }
    }
  });

  // Re-run element checks on soft navigation lifecycle events
  document.addEventListener('DOMContentLoaded', ensureDrawerElements);
  document.addEventListener('moyi:page-load', () => {
    closeDrawer();
    ensureDrawerElements();
  });
  document.addEventListener('moyi:after-page-swap', () => {
    closeDrawer();
    ensureDrawerElements();
  });

  if (document.readyState !== 'loading') {
    ensureDrawerElements();
  }
})();
