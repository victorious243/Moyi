(() => {
  function initSidebarDrawer() {
    const sidebar = document.querySelector('.app-sidebar');
    if (!sidebar) return;

    // Create or locate cool floating action button (FAB)
    let toggleBtn = document.querySelector('.mobile-workspace-fab, .mobile-sidebar-toggle-button');
    if (!toggleBtn) {
      toggleBtn = document.createElement('button');
      toggleBtn.type = 'button';
      toggleBtn.className = 'mobile-workspace-fab';
      toggleBtn.setAttribute('aria-label', 'Open Workspace Navigation Menu');
      toggleBtn.setAttribute('aria-expanded', 'false');
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
    }

    // Create or locate close button inside sidebar
    let closeBtn = sidebar.querySelector('.mobile-sidebar-close-button, [data-sidebar-close]');
    if (!closeBtn) {
      closeBtn = document.createElement('button');
      closeBtn.type = 'button';
      closeBtn.className = 'mobile-sidebar-close-button';
      closeBtn.setAttribute('aria-label', 'Close Workspace Navigation Menu');
      closeBtn.innerHTML = `<span>✕</span>`;
      sidebar.prepend(closeBtn);
    }

    // Create or locate dimmed backdrop
    let backdrop = document.querySelector('.sidebar-backdrop, [data-sidebar-backdrop]');
    if (!backdrop) {
      backdrop = document.createElement('div');
      backdrop.className = 'sidebar-backdrop';
      document.body.appendChild(backdrop);
    }

    function openDrawer() {
      sidebar.classList.add('drawer-open');
      backdrop.classList.add('active');
      toggleBtn.setAttribute('aria-expanded', 'true');
      toggleBtn.classList.add('fab-active');
      document.body.classList.add('sidebar-drawer-active');
    }

    function closeDrawer() {
      sidebar.classList.remove('drawer-open');
      backdrop.classList.remove('active');
      toggleBtn.setAttribute('aria-expanded', 'false');
      toggleBtn.classList.remove('fab-active');
      document.body.classList.remove('sidebar-drawer-active');
    }

    toggleBtn.addEventListener('click', (e) => {
      e.stopPropagation();
      if (sidebar.classList.contains('drawer-open')) {
        closeDrawer();
      } else {
        openDrawer();
      }
    });

    closeBtn.addEventListener('click', (e) => {
      e.stopPropagation();
      closeDrawer();
    });

    backdrop.addEventListener('click', () => {
      closeDrawer();
    });

    // Close on navigation link click inside drawer
    sidebar.addEventListener('click', (e) => {
      const link = e.target.closest('a');
      if (link && !link.getAttribute('target')) {
        closeDrawer();
      }
    });

    // Close on Escape key
    document.addEventListener('keydown', (e) => {
      if (e.key === 'Escape' && sidebar.classList.contains('drawer-open')) {
        closeDrawer();
      }
    });
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', initSidebarDrawer);
  } else {
    initSidebarDrawer();
  }
})();
