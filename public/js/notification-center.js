(() => {
  let isFetching = false;

  function getCsrfToken() {
    const meta = document.querySelector('meta[name="csrf-token"]');
    if (meta && meta.getAttribute('content')) {
      return meta.getAttribute('content');
    }
    if (document.body && document.body.dataset && document.body.dataset.csrfToken) {
      return document.body.dataset.csrfToken;
    }
    const match = document.cookie.match(/csrf_token=([^;]+)/);
    return match ? decodeURIComponent(match[1]) : '';
  }

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

      const badges = document.querySelectorAll('.notification-badge, #notification-badge');
      const list = document.getElementById('notification-list');

      badges.forEach((badge) => {
        if (data.unreadCount > 0) {
          badge.textContent = data.unreadCount > 99 ? '99+' : data.unreadCount;
          badge.style.display = 'flex';
        } else {
          badge.style.display = 'none';
        }
      });

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

  // Document-level event delegation for instant click response
  document.addEventListener('click', async (e) => {
    // Bell button toggle
    const bellBtn = e.target.closest('#notification-bell-btn, .notification-bell-btn');
    if (bellBtn) {
      e.preventDefault();
      e.stopPropagation();
      const dropdown = document.getElementById('notification-dropdown');
      if (!dropdown) return;
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
      return;
    }

    // Mark all read button
    const markAllBtn = e.target.closest('#mark-all-read-btn, .mark-all-read-btn');
    if (markAllBtn) {
      e.preventDefault();
      e.stopPropagation();
      const csrfToken = getCsrfToken();
      try {
        await fetch('/api/notifications/read-all', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'X-CSRF-Token': csrfToken
          },
          body: JSON.stringify({ _csrf: csrfToken })
        });
        fetchNotifications();
      } catch (err) {}
      return;
    }

    // Mark single notification as read
    const markReadBtn = e.target.closest('.notif-mark-read-btn');
    if (markReadBtn) {
      e.preventDefault();
      e.stopPropagation();
      const id = markReadBtn.getAttribute('data-read-id');
      if (id) {
        const csrfToken = getCsrfToken();
        try {
          await fetch(`/api/notifications/${id}/read`, {
            method: 'POST',
            headers: {
              'Content-Type': 'application/json',
              'X-CSRF-Token': csrfToken
            },
            body: JSON.stringify({ _csrf: csrfToken })
          });
          fetchNotifications();
        } catch (err) {}
      }
      return;
    }

    // Click outside dropdown closes it
    const dropdown = document.getElementById('notification-dropdown');
    if (dropdown && dropdown.classList.contains('is-open')) {
      if (!dropdown.contains(e.target)) {
        dropdown.classList.remove('is-open');
        dropdown.setAttribute('aria-hidden', 'true');
        const bell = document.getElementById('notification-bell-btn');
        if (bell) bell.setAttribute('aria-expanded', 'false');
      }
    }
  });

  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') {
      const dropdown = document.getElementById('notification-dropdown');
      if (dropdown && dropdown.classList.contains('is-open')) {
        dropdown.classList.remove('is-open');
        dropdown.setAttribute('aria-hidden', 'true');
        const bell = document.getElementById('notification-bell-btn');
        if (bell) bell.setAttribute('aria-expanded', 'false');
      }
    }
  });

  document.addEventListener('DOMContentLoaded', fetchNotifications);
  document.addEventListener('moyi:page-load', fetchNotifications);
  document.addEventListener('moyi:after-page-swap', fetchNotifications);

  if (document.readyState !== 'loading') {
    fetchNotifications();
  }
})();
