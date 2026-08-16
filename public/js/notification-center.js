(() => {
  let isFetching = false;

  function timeAgo(dateString) {
    const date = new Date(dateString);
    const seconds = Math.floor((new Date() - date) / 1000);
    if (seconds < 60) return 'Just now';
    const minutes = Math.floor(seconds / 60);
    if (minutes < 60) return `${minutes}m ago`;
    const hours = Math.floor(minutes / 60);
    if (hours < 24) return `${hours}h ago`;
    const days = Math.floor(hours / 24);
    return `${days}d ago`;
  }

  function escapeHtml(str) {
    const div = document.createElement('div');
    div.textContent = str || '';
    return div.innerHTML;
  }

  async function fetchNotifications() {
    if (isFetching) return;
    const wrap = document.getElementById('notification-center-wrap');
    if (!wrap) return;

    isFetching = true;
    try {
      const res = await fetch('/api/notifications');
      if (!res.ok) return;
      const data = await res.json();

      const badge = document.getElementById('notification-badge');
      const list = document.getElementById('notification-list');

      if (badge) {
        if (data.unreadCount > 0) {
          badge.textContent = data.unreadCount > 99 ? '99+' : data.unreadCount;
          badge.style.display = 'flex';
        } else {
          badge.style.display = 'none';
        }
      }

      if (list) {
        if (!data.notifications || !data.notifications.length) {
          list.innerHTML = `
            <div class="notification-empty">
              <span class="empty-icon">✨</span>
              <strong>No notifications yet</strong>
              <p>Weekly executive briefings and growth alerts will appear here.</p>
            </div>
          `;
          return;
        }

        list.innerHTML = data.notifications
          .map(
            (n) => `
          <div class="notification-item ${n.isUnread ? 'is-unread' : ''}" data-id="${n._id}">
            <div class="notification-item-header">
              ${n.projectName ? `<span class="notif-project-tag">${escapeHtml(n.projectName)}</span>` : ''}
              <span class="notif-time">${timeAgo(n.createdAt)}</span>
            </div>
            <strong class="notif-title">${escapeHtml(n.title)}</strong>
            <p class="notif-summary">${escapeHtml(n.summary)}</p>
            <div class="notif-actions">
              <a href="${escapeHtml(n.ctaUrl)}" class="notif-cta-link">${escapeHtml(n.ctaLabel)} &rarr;</a>
              ${n.isUnread ? `<button type="button" class="notif-mark-read-btn" data-read-id="${n._id}" title="Mark as read">✓</button>` : ''}
            </div>
          </div>
        `
          )
          .join('');
      }
    } catch (err) {
      console.warn('Could not load notifications:', err);
    } finally {
      isFetching = false;
    }
  }

  function initNotificationCenter() {
    const wrap = document.getElementById('notification-center-wrap');
    if (!wrap) return;

    const bellBtn = document.getElementById('notification-bell-btn');
    const dropdown = document.getElementById('notification-dropdown');
    const markAllBtn = document.getElementById('mark-all-read-btn');

    if (bellBtn && dropdown) {
      bellBtn.addEventListener('click', (e) => {
        e.stopPropagation();
        const isOpen = dropdown.classList.contains('is-open');
        if (isOpen) {
          dropdown.classList.remove('is-open');
          dropdown.setAttribute('aria-hidden', 'true');
          bellBtn.setAttribute('aria-expanded', 'false');
        } else {
          dropdown.classList.add('is-open');
          dropdown.setAttribute('aria-hidden', 'false');
          bellBtn.setAttribute('aria-expanded', 'true');
          fetchNotifications();
        }
      });
    }

    if (markAllBtn) {
      markAllBtn.addEventListener('click', async (e) => {
        e.stopPropagation();
        try {
          await fetch('/api/notifications/read-all', { method: 'POST' });
          fetchNotifications();
        } catch (err) {}
      });
    }

    // Delegated click for individual mark as read
    document.addEventListener('click', async (e) => {
      const markReadBtn = e.target.closest('.notif-mark-read-btn');
      if (markReadBtn) {
        e.preventDefault();
        e.stopPropagation();
        const id = markReadBtn.getAttribute('data-read-id');
        if (id) {
          try {
            await fetch(`/api/notifications/${id}/read`, { method: 'POST' });
            fetchNotifications();
          } catch (err) {}
        }
        return;
      }

      // Close dropdown when clicking outside
      if (dropdown && dropdown.classList.contains('is-open') && !dropdown.contains(e.target) && !bellBtn.contains(e.target)) {
        dropdown.classList.remove('is-open');
        dropdown.setAttribute('aria-hidden', 'true');
        if (bellBtn) bellBtn.setAttribute('aria-expanded', 'false');
      }
    });

    document.addEventListener('keydown', (e) => {
      if (e.key === 'Escape' && dropdown && dropdown.classList.contains('is-open')) {
        dropdown.classList.remove('is-open');
        dropdown.setAttribute('aria-hidden', 'true');
        if (bellBtn) bellBtn.setAttribute('aria-expanded', 'false');
      }
    });

    // Initial fetch
    fetchNotifications();
  }

  document.addEventListener('DOMContentLoaded', initNotificationCenter);
  document.addEventListener('moyi:page-load', initNotificationCenter);
  document.addEventListener('moyi:after-page-swap', initNotificationCenter);

  if (document.readyState !== 'loading') {
    initNotificationCenter();
  }
})();
