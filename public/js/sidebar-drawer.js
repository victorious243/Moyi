(() => {
  function initSidebarDrawer() {
    const sidebar = document.querySelector('.app-sidebar');
    if (!sidebar) return;

    // Create or locate floating trigger button
    let toggleBtn = document.querySelector('.mobile-sidebar-toggle-button');
    if (!toggleBtn) {
      toggleBtn = document.createElement('button');
      toggleBtn.type = 'button';
      toggleBtn.className = 'mobile-sidebar-toggle-button';
      toggleBtn.setAttribute('aria-label', 'Open Workspace Navigation Menu');
      toggleBtn.setAttribute('aria-expanded', 'false');
      toggleBtn.innerHTML = `
        <span class="toggle-icon">⚡</span>
        <span class="toggle-text">Menu</span>
      `;
      document.body.appendChild(toggleBtn);
    }

    // Create or locate close button inside sidebar
    let closeBtn = sidebar.querySelector('.mobile-sidebar-close-button');
    if (!closeBtn) {
      closeBtn = document.createElement('button');
      closeBtn.type = 'button';
      closeBtn.className = 'mobile-sidebar-close-button';
      closeBtn.setAttribute('aria-label', 'Close Workspace Navigation Menu');
      closeBtn.innerHTML = `<span>✕</span>`;
      sidebar.prepend(closeBtn);
    }

    // Create or locate dimmed backdrop
    let backdrop = document.querySelector('.sidebar-backdrop');
    if (!backdrop) {
      backdrop = document.createElement('div');
      backdrop.className = 'sidebar-backdrop';
      document.body.appendChild(backdrop);
    }

    function openDrawer() {
      sidebar.classList.add('drawer-open');
      backdrop.classList.add('active');
      toggleBtn.setAttribute('aria-expanded', 'true');
      document.body.classList.add('sidebar-drawer-active');
    }

    function closeDrawer() {
      sidebar.classList.remove('drawer-open');
      backdrop.classList.remove('active');
      toggleBtn.setAttribute('aria-expanded', 'false');
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

    // Close on item click inside drawer
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
