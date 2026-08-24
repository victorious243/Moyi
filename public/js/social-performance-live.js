(() => {
  const POLL_INTERVAL_MS = 30000;

  const csrfToken = () => {
    const meta = document.querySelector('meta[name="csrf-token"]');
    if (meta && meta.content) return meta.content;
    if (document.body && document.body.dataset && document.body.dataset.csrfToken) return document.body.dataset.csrfToken;
    const match = document.cookie.match(/csrf_token=([^;]+)/);
    return match ? decodeURIComponent(match[1]) : '';
  };

  const label = (value) => String(value || '').replace(/_/g, ' ');
  const number = (value) => Number(value || 0).toLocaleString();
  const metric = (value) => value === null || value === undefined ? 'Unavailable' : Number(value).toLocaleString();
  const dateTime = (value) => value ? new Date(value).toLocaleString() : '';

  function postExposure(post) {
    return post.exposureField ? `${number(post.exposure)} ${label(post.exposureField)}` : 'Unavailable';
  }

  function setState(panel, text, good = true) {
    const state = panel.querySelector('[data-social-live-state]');
    if (!state) return;
    state.textContent = text;
    state.classList.toggle('status-success', good);
  }

  function updateTotals(dashboard) {
    const totals = dashboard.totals || {};
    document.querySelectorAll('[data-social-total]').forEach((node) => {
      const key = node.dataset.socialTotal;
      node.textContent = ['exposure', 'engagements'].includes(key) ? metric(totals[key]) : number(totals[key]);
    });
  }

  function updatePostRow(row, post) {
    row.querySelector('[data-post-title]').textContent = post.title || `${post.platform} post`;
    row.querySelector('[data-post-platform]').textContent = post.platform;
    row.querySelector('[data-post-account]').textContent = post.accountName || 'Connected account';
    row.querySelector('[data-post-published]').textContent = dateTime(post.publishedAt);
    row.querySelector('[data-post-exposure]').textContent = postExposure(post);
    row.querySelector('[data-post-engagements]').textContent = `${metric(post.engagements)} / ${metric(post.meaningfulEngagements)}`;

    const status = row.querySelector('[data-post-status]');
    status.textContent = label(post.metricsStatus || 'pending');
    status.classList.toggle('status-success', post.metricsStatus === 'active');

    row.querySelector('[data-post-fields]').textContent = (post.availableFields || []).map(label).join(', ');

    const viewLink = row.querySelector('[data-post-url]');
    if (viewLink && post.platformUrl) viewLink.href = post.platformUrl;
  }

  function applyDashboard(panel, dashboard) {
    updateTotals(dashboard);
    const updated = panel.querySelector('[data-social-live-updated]');
    if (updated) {
      updated.textContent = dashboard.window && dashboard.window.lastMetricsSyncAt
        ? `Updated ${dateTime(dashboard.window.lastMetricsSyncAt)}`
        : 'Waiting for first snapshot';
    }

    (dashboard.posts || []).forEach((post) => {
      const row = panel.querySelector(`[data-social-post-row="${post.id}"]`);
      if (row) updatePostRow(row, post);
    });
  }

  async function fetchDashboard(panel) {
    const url = panel.dataset.refreshUrl;
    if (!url) return;
    setState(panel, 'Checking metrics...', true);
    const response = await fetch(url, {
      method: 'GET',
      credentials: 'same-origin',
      headers: { Accept: 'application/json' }
    });
    if (!response.ok) throw new Error(`Metric poll failed with ${response.status}`);
    const payload = await response.json();
    applyDashboard(panel, payload);
    setState(panel, 'Live monitoring', true);
  }

  async function refreshOne(panel, form) {
    const button = form.querySelector('button[type="submit"]');
    const originalText = button ? button.textContent : '';
    if (button) {
      button.disabled = true;
      button.textContent = 'Refreshing...';
    }
    setState(panel, 'Refreshing post...', true);

    const body = new FormData(form);
    const token = csrfToken();
    if (token && !body.has('_csrf')) body.append('_csrf', token);

    try {
      const response = await fetch(form.action, {
        method: 'POST',
        credentials: 'same-origin',
        headers: {
          Accept: 'application/json',
          'X-CSRF-Token': token
        },
        body
      });
      const payload = await response.json();
      if (payload.dashboard) applyDashboard(panel, payload.dashboard);
      setState(panel, payload.success ? 'Live monitoring' : (payload.message || 'Refresh failed'), Boolean(payload.success));
    } catch (error) {
      setState(panel, 'Refresh failed', false);
    } finally {
      if (button) {
        button.disabled = false;
        button.textContent = originalText;
      }
    }
  }

  function initSocialPerformanceLive() {
    const panel = document.querySelector('[data-social-live-panel]');
    if (!panel || panel.dataset.liveInitialized === 'true') return;
    panel.dataset.liveInitialized = 'true';

    panel.addEventListener('submit', (event) => {
      const form = event.target.closest('[data-social-refresh-form]');
      if (!form) return;
      event.preventDefault();
      refreshOne(panel, form);
    });

    const timer = window.setInterval(() => {
      if (!document.body.contains(panel)) {
        window.clearInterval(timer);
        return;
      }
      fetchDashboard(panel).catch(() => setState(panel, 'Monitoring paused', false));
    }, POLL_INTERVAL_MS);

    document.addEventListener('visibilitychange', () => {
      if (!document.hidden && document.body.contains(panel)) {
        fetchDashboard(panel).catch(() => setState(panel, 'Monitoring paused', false));
      }
    });
  }

  document.addEventListener('DOMContentLoaded', initSocialPerformanceLive);
  document.addEventListener('moyi:after-page-swap', initSocialPerformanceLive);
  initSocialPerformanceLive();
})();
