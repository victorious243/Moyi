(() => {
  const previous = window.__moyiContentCalendar;
  if (previous && typeof previous.destroy === 'function') previous.destroy();

  const root = document.querySelector('[data-calendar-root]');
  if (!root) return;

  const controller = new AbortController();
  const { signal } = controller;
  const projectId = root.dataset.projectId;
  const projectTimezone = root.dataset.calendarTimezone || 'UTC';
  const drawerLayer = document.querySelector('[data-calendar-drawer-layer]');
  const drawer = document.querySelector('[data-calendar-drawer]');
  const drawerContent = document.querySelector('[data-calendar-drawer-content]');
  const toastRegion = document.querySelector('[data-calendar-toasts]');
  let activeDraftId = '';
  let lastFocusedElement = null;
  let searchTimer = null;
  let detailPollTimer = null;
  let listPollTimer = null;
  let listRequest = null;
  let drawerRequest = null;
  let draggedEvent = null;
  let mobileSearchTimer = null;

  const csrfToken = () => document.querySelector('meta[name="csrf-token"]')?.content || document.body.dataset.csrfToken || '';
  const currentUrl = () => new URL(window.location.href);

  const timezoneOffsetMs = (date, timezone) => {
    const parts = new Intl.DateTimeFormat('en-CA', {
      timeZone: timezone,
      year: 'numeric', month: '2-digit', day: '2-digit',
      hour: '2-digit', minute: '2-digit', second: '2-digit',
      hourCycle: 'h23'
    }).formatToParts(date);
    const values = Object.fromEntries(parts.filter((part) => part.type !== 'literal').map((part) => [part.type, part.value]));
    return Date.UTC(Number(values.year), Number(values.month) - 1, Number(values.day), Number(values.hour), Number(values.minute), Number(values.second)) - date.getTime();
  };

  const utcForLocalSchedule = (dateKey, time) => {
    const [year, month, day] = dateKey.split('-').map(Number);
    const [hour, minute] = time.split(':').map(Number);
    const wallClock = Date.UTC(year, month - 1, day, hour, minute, 0);
    let candidate = new Date(wallClock);
    for (let index = 0; index < 3; index += 1) candidate = new Date(wallClock - timezoneOffsetMs(candidate, projectTimezone));
    return candidate;
  };

  const showToast = (message, tone = 'success') => {
    if (!toastRegion || !message) return;
    const toast = document.createElement('div');
    toast.className = `calendar-toast is-${tone}`;
    toast.setAttribute('role', tone === 'error' ? 'alert' : 'status');
    toast.textContent = message;
    toastRegion.append(toast);
    requestAnimationFrame(() => toast.classList.add('is-visible'));
    window.setTimeout(() => {
      toast.classList.remove('is-visible');
      window.setTimeout(() => toast.remove(), 220);
    }, 4200);
  };

  const showBulkResults = (payload) => {
    if (!Array.isArray(payload.results)) return;
    const host = document.querySelector('[data-calendar-message]');
    if (!host) return;
    host.replaceChildren();
    const panel = document.createElement('section');
    panel.className = 'calendar-bulk-results';
    panel.setAttribute('role', 'status');
    const heading = document.createElement('strong');
    heading.textContent = payload.message || 'Bulk operation complete.';
    const list = document.createElement('ul');
    payload.results.forEach((result) => {
      const item = document.createElement('li');
      item.className = result.ok ? 'is-success' : 'is-error';
      const title = document.createElement('strong');
      title.textContent = result.title || 'Post';
      const detail = document.createElement('span');
      detail.textContent = result.message || (result.ok ? 'Completed.' : 'Could not be completed.');
      item.append(title, detail);
      list.append(item);
    });
    panel.append(heading, list);
    host.append(panel);
  };

  const setBusy = (element, busy) => {
    if (!element) return;
    element.toggleAttribute('aria-busy', busy);
    element.querySelectorAll('button[type="submit"]').forEach((button) => {
      button.disabled = busy;
      if (busy && !button.dataset.originalLabel) button.dataset.originalLabel = button.textContent;
      if (busy) button.textContent = 'Working…';
      else if (button.dataset.originalLabel) button.textContent = button.dataset.originalLabel;
    });
  };

  const fragmentUrl = (source = currentUrl()) => {
    const url = new URL(source.href);
    url.searchParams.delete('draft');
    url.searchParams.set('fragment', '1');
    url.hash = '';
    return url;
  };

  const updateSearchAndViewControls = () => {
    const url = currentUrl();
    document.querySelectorAll('[data-calendar-search], [data-mobile-calendar-search]').forEach((search) => {
      if (document.activeElement !== search) search.value = url.searchParams.get('search') || '';
    });
    document.querySelectorAll('[data-calendar-view]').forEach((button) => {
      const active = button.dataset.calendarView === (url.searchParams.get('view') || 'list');
      button.classList.toggle('is-active', active);
      button.setAttribute('aria-pressed', String(active));
    });
  };

  const mobileDateKey = (date = new Date()) => {
    const parts = new Intl.DateTimeFormat('en-CA', {
      timeZone: projectTimezone,
      year: 'numeric', month: '2-digit', day: '2-digit'
    }).formatToParts(date);
    const values = Object.fromEntries(parts.filter((part) => part.type !== 'literal').map((part) => [part.type, part.value]));
    return `${values.year}-${values.month}-${values.day}`;
  };

  const dateFromKey = (key) => {
    const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(key || ''));
    return match ? new Date(Date.UTC(Number(match[1]), Number(match[2]) - 1, Number(match[3]), 12)) : null;
  };

  const dateKeyFromUtcDate = (date) => [
    date.getUTCFullYear(),
    String(date.getUTCMonth() + 1).padStart(2, '0'),
    String(date.getUTCDate()).padStart(2, '0')
  ].join('-');

  const addUtcDays = (date, days) => {
    const next = new Date(date);
    next.setUTCDate(next.getUTCDate() + days);
    return next;
  };

  const setMobileMode = (mobileRoot, mode) => {
    const resolved = mode === 'month' ? 'month' : 'agenda';
    mobileRoot.dataset.mobileMode = resolved;
    mobileRoot.querySelectorAll('[data-mobile-calendar-mode]').forEach((button) => {
      const active = button.dataset.mobileCalendarMode === resolved;
      button.classList.toggle('is-active', active);
      button.setAttribute('aria-pressed', String(active));
    });
    setMobileMonthExpanded(mobileRoot, resolved === 'month');
  };

  const setMobileMonthExpanded = (mobileRoot, expanded) => {
    mobileRoot.classList.toggle('is-month-expanded', expanded);
    const toggle = mobileRoot.querySelector('[data-mobile-month-toggle]');
    const navigation = mobileRoot.querySelector('[data-mobile-month-navigation]');
    if (toggle) toggle.setAttribute('aria-expanded', String(expanded));
    if (navigation) navigation.hidden = !expanded;
    renderMobileDateGrid(mobileRoot);
  };

  const renderMobileDateGrid = (mobileRoot) => {
    const grid = mobileRoot.querySelector('[data-mobile-calendar-grid]');
    if (!grid) return;
    const selectedKey = mobileRoot.dataset.selectedDate || mobileDateKey();
    const selected = dateFromKey(selectedKey) || dateFromKey(mobileDateKey());
    const anchor = dateFromKey(mobileRoot.dataset.monthAnchor) || selected;
    const expanded = mobileRoot.classList.contains('is-month-expanded');
    const todayKey = mobileDateKey();
    const postDates = new Set([...mobileRoot.querySelectorAll('[data-mobile-post-date]')].map((node) => node.dataset.mobilePostDate));
    let start;
    let length;
    if (expanded) {
      const first = new Date(Date.UTC(anchor.getUTCFullYear(), anchor.getUTCMonth(), 1, 12));
      const mondayOffset = (first.getUTCDay() + 6) % 7;
      start = addUtcDays(first, -mondayOffset);
      const last = new Date(Date.UTC(anchor.getUTCFullYear(), anchor.getUTCMonth() + 1, 0, 12));
      const covered = mondayOffset + last.getUTCDate();
      length = Math.ceil(covered / 7) * 7;
    } else {
      const mondayOffset = (selected.getUTCDay() + 6) % 7;
      start = addUtcDays(selected, -mondayOffset);
      length = 7;
    }
    const fragment = document.createDocumentFragment();
    for (let index = 0; index < length; index += 1) {
      const date = addUtcDays(start, index);
      const key = dateKeyFromUtcDate(date);
      const button = document.createElement('button');
      button.type = 'button';
      button.dataset.mobileDate = key;
      button.setAttribute('role', 'gridcell');
      button.setAttribute('aria-label', new Intl.DateTimeFormat('en-GB', {
        timeZone: 'UTC', weekday: 'long', day: 'numeric', month: 'long', year: 'numeric'
      }).format(date));
      button.setAttribute('aria-selected', String(key === selectedKey));
      button.classList.toggle('is-selected', key === selectedKey);
      button.classList.toggle('is-today', key === todayKey);
      button.classList.toggle('is-outside-month', expanded && date.getUTCMonth() !== anchor.getUTCMonth());
      const number = document.createElement('span');
      number.textContent = String(date.getUTCDate());
      button.append(number);
      if (postDates.has(key)) {
        const dot = document.createElement('i');
        dot.setAttribute('aria-hidden', 'true');
        button.append(dot);
      }
      fragment.append(button);
    }
    grid.replaceChildren(fragment);
    const monthLabel = new Intl.DateTimeFormat('en-GB', { timeZone: 'UTC', month: 'long', year: 'numeric' }).format(anchor);
    const label = mobileRoot.querySelector('[data-mobile-month-label]');
    const expandedLabel = mobileRoot.querySelector('[data-mobile-expanded-month-label]');
    if (label) label.textContent = monthLabel;
    if (expandedLabel) expandedLabel.textContent = monthLabel;
  };

  const selectMobileDate = (mobileRoot, key, { scroll = true } = {}) => {
    if (!dateFromKey(key)) return;
    mobileRoot.dataset.selectedDate = key;
    mobileRoot.dataset.monthAnchor = `${key.slice(0, 7)}-01`;
    renderMobileDateGrid(mobileRoot);
    const group = mobileRoot.querySelector(`[data-mobile-agenda-day="${key}"]`);
    const empty = mobileRoot.querySelector('[data-mobile-selected-empty]');
    const agenda = mobileRoot.querySelector('[data-mobile-agenda]');
    if (group) {
      if (empty) empty.hidden = true;
      agenda?.classList.remove('has-selected-empty');
      if (scroll) window.setTimeout(() => group.scrollIntoView({ behavior: 'smooth', block: 'start' }), 40);
    } else {
      const title = empty?.querySelector('[data-mobile-empty-title]');
      const date = dateFromKey(key);
      if (title && date) title.textContent = `No content scheduled for ${new Intl.DateTimeFormat('en-GB', { timeZone: 'UTC', day: 'numeric', month: 'short' }).format(date)}`;
      if (empty) empty.hidden = false;
      agenda?.classList.add('has-selected-empty');
    }
  };

  const initializeMobileCalendar = () => {
    const mobileRoot = document.querySelector('[data-mobile-calendar]');
    if (!mobileRoot) return;
    const selected = mobileRoot.dataset.selectedDate || mobileDateKey();
    mobileRoot.dataset.selectedDate = selected;
    mobileRoot.dataset.monthAnchor = `${selected.slice(0, 7)}-01`;
    mobileRoot.dataset.mobileMode = 'agenda';
    renderMobileDateGrid(mobileRoot);
  };

  const refreshList = async ({ url = currentUrl(), push = false, replace = false } = {}) => {
    if (listRequest) listRequest.abort();
    listRequest = new AbortController();
    const results = document.querySelector('[data-calendar-results]');
    if (!results) return;
    results.classList.add('is-updating');
    try {
      const response = await fetch(fragmentUrl(url), {
        credentials: 'same-origin',
        headers: { Accept: 'text/html' },
        signal: listRequest.signal
      });
      if (!response.ok) throw new Error('Calendar results could not be loaded.');
      results.innerHTML = await response.text();
      results.classList.remove('is-updating');
      const cleanUrl = new URL(url.href);
      cleanUrl.searchParams.delete('fragment');
      if (push) window.history.pushState({ ...(window.history.state || {}), moyiCalendarBase: true }, '', cleanUrl);
      else if (replace) window.history.replaceState({ ...(window.history.state || {}), moyiCalendarBase: true }, '', cleanUrl);
      updateSearchAndViewControls();
      initializeMobileCalendar();
      syncBulkSelection();
      scheduleListPolling();
    } catch (error) {
      if (error.name !== 'AbortError') showToast(error.message, 'error');
      results.classList.remove('is-updating');
    }
  };

  const scheduleListPolling = () => {
    window.clearTimeout(listPollTimer);
    const activeCount = Number(document.querySelector('[data-active-publish-count]')?.dataset.activePublishCount || 0);
    if (!activeCount || document.hidden) return;
    listPollTimer = window.setTimeout(async () => {
      const before = activeCount;
      await refreshList();
      const after = Number(document.querySelector('[data-active-publish-count]')?.dataset.activePublishCount || 0);
      if (before > after) showToast(after ? 'Publishing status updated.' : 'Publishing jobs completed.');
    }, 5000);
  };

  const filteredUrlFromForm = (form) => {
    const url = new URL(form.action, window.location.href);
    const data = new FormData(form);
    data.forEach((value, key) => {
      if (String(value).trim()) url.searchParams.set(key, value);
    });
    url.searchParams.delete('page');
    return url;
  };

  const openFilterPanel = (force) => {
    const panel = document.querySelector('[data-calendar-filters]');
    const buttons = [...document.querySelectorAll('[data-filter-toggle]')];
    if (!panel || !buttons.length) return;
    const open = typeof force === 'boolean' ? force : !panel.classList.contains('is-open');
    panel.classList.toggle('is-open', open);
    buttons.forEach((button) => button.setAttribute('aria-expanded', String(open)));
    document.body.classList.toggle('calendar-mobile-filter-open', open);
  };

  const loadingDrawer = () => {
    drawerContent.innerHTML = '<div class="calendar-drawer-loading" role="status"><span></span><p>Loading post details…</p></div>';
  };

  const scheduleDetailPolling = () => {
    window.clearTimeout(detailPollTimer);
    if (!activeDraftId) return;
    const hasActive = [...drawerContent.querySelectorAll('[data-publish-job-status]')].some((node) => (
      ['queued', 'preparing media', 'publishing', 'provider processing', 'retry wait'].includes(node.textContent.trim().toLowerCase())
    ));
    const hasProcessingMedia = [...drawerContent.querySelectorAll('.calendar-media-item .calendar-ui-status')].some((node) => (
      ['queued', 'processing'].includes(node.textContent.trim().toLowerCase())
    ));
    if (!hasActive && !hasProcessingMedia) return;
    detailPollTimer = window.setTimeout(async () => {
      await loadDrawer(activeDraftId, { preserveTab: true, quiet: true });
      await refreshList();
    }, hasActive ? 4000 : 6000);
  };

  const initializeDrawerControls = () => {
    const selectedTab = drawerContent.querySelector('[role="tab"][aria-selected="true"]')?.dataset.drawerTab || 'content';
    activateTab(selectedTab);
    const publishForm = drawerContent.querySelector('[data-publish-form]');
    if (publishForm) {
      const timezone = publishForm.querySelector('input[name="timeZone"]');
      if (timezone) timezone.value = Intl.DateTimeFormat().resolvedOptions().timeZone || '';
      syncPublishForm(publishForm);
    }
    const editForm = drawerContent.querySelector('form[action$="/update"]');
    if (editForm) syncCopyLimit(editForm);
    scheduleDetailPolling();
  };

  const loadDrawer = async (draftId, { preserveTab = false, quiet = false } = {}) => {
    if (!draftId) return;
    const activeTab = preserveTab ? drawerContent.querySelector('[role="tab"][aria-selected="true"]')?.dataset.drawerTab : '';
    if (drawerRequest) drawerRequest.abort();
    drawerRequest = new AbortController();
    if (!quiet) loadingDrawer();
    try {
      const response = await fetch(`/social-drafts/${encodeURIComponent(draftId)}/calendar-detail`, {
        credentials: 'same-origin',
        headers: { Accept: 'text/html' },
        signal: drawerRequest.signal
      });
      if (!response.ok) throw new Error('Post details could not be loaded.');
      drawerContent.innerHTML = await response.text();
      if (activeTab) drawerContent.querySelector(`[data-drawer-tab="${activeTab}"]`)?.click();
      initializeDrawerControls();
    } catch (error) {
      if (error.name === 'AbortError') return;
      drawerContent.innerHTML = '<div class="calendar-drawer-error" role="alert"><strong>Could not open this post</strong><p></p><button class="button" type="button" data-close-drawer>Close</button></div>';
      drawerContent.querySelector('p').textContent = error.message;
    }
  };

  const openDrawer = async (draftId, { history = true } = {}) => {
    if (!drawerLayer || !drawer || !draftId) return;
    activeDraftId = draftId;
    lastFocusedElement = document.activeElement;
    drawerLayer.hidden = false;
    document.body.classList.add('calendar-drawer-open');
    requestAnimationFrame(() => drawerLayer.classList.add('is-open'));
    drawer.focus({ preventScroll: true });
    if (history) {
      const base = currentUrl();
      window.history.replaceState({ ...(window.history.state || {}), moyiCalendarBase: true }, '', base);
      const next = currentUrl();
      next.searchParams.set('draft', draftId);
      window.history.pushState({ moyiCalendarDrawer: true, draftId }, '', next);
    }
    await loadDrawer(draftId);
  };

  const closeDrawer = ({ history = true } = {}) => {
    if (!drawerLayer || drawerLayer.hidden) return;
    window.clearTimeout(detailPollTimer);
    drawerLayer.classList.remove('is-open');
    document.body.classList.remove('calendar-drawer-open');
    activeDraftId = '';
    window.setTimeout(() => { drawerLayer.hidden = true; }, 180);
    if (history && window.history.state?.moyiCalendarDrawer) window.history.back();
    else if (history) {
      const url = currentUrl();
      url.searchParams.delete('draft');
      window.history.replaceState({ ...(window.history.state || {}), moyiCalendarBase: true }, '', url);
    }
    if (lastFocusedElement?.isConnected) lastFocusedElement.focus({ preventScroll: true });
  };

  function activateTab(name) {
    drawerContent.querySelectorAll('[data-drawer-tab]').forEach((tab) => {
      const active = tab.dataset.drawerTab === name;
      tab.setAttribute('aria-selected', String(active));
      tab.tabIndex = active ? 0 : -1;
    });
    drawerContent.querySelectorAll('[data-drawer-panel]').forEach((panel) => {
      panel.hidden = panel.dataset.drawerPanel !== name;
    });
  }

  function syncCopyLimit(form) {
    const channel = form.querySelector('[data-draft-channel]');
    const copy = form.querySelector('[data-draft-copy]');
    const limit = form.querySelector('[data-draft-copy-limit]');
    if (!channel || !copy || !limit) return;
    const update = () => {
      const isX = channel.value === 'x';
      const length = [...copy.value].length;
      limit.hidden = !isX;
      limit.textContent = isX ? `${length}/280 X character guide` : '';
      limit.classList.toggle('is-over-limit', isX && length > 280);
    };
    channel.addEventListener('change', update, { signal });
    copy.addEventListener('input', update, { signal });
    update();
  }

  function syncPublishForm(form) {
    const accountInputs = [...form.querySelectorAll('[data-publish-account]')];
    const tiktokPanel = form.querySelector('[data-platform-options="tiktok"]');
    const tiktokPrivacy = tiktokPanel?.querySelector('[data-tiktok-privacy]');
    const tiktokConsent = tiktokPanel?.querySelector('[data-tiktok-consent]');
    const creatorCache = new Map();
    let loadedTikTokKey = '';

    const fetchTikTokCreator = async (accountId) => {
      if (creatorCache.has(accountId)) return creatorCache.get(accountId);
      const endpoint = `${tiktokPanel.dataset.creatorEndpoint}?accountId=${encodeURIComponent(accountId)}`;
      const response = await fetch(endpoint, { credentials: 'same-origin', headers: { Accept: 'application/json' } });
      const payload = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(payload.message || payload.error?.message || 'TikTok posting choices could not be loaded.');
      creatorCache.set(accountId, payload);
      return payload;
    };

    const loadTikTokCreators = async (accountIds) => {
      if (!tiktokPanel || !tiktokPrivacy || !accountIds.length) return;
      const key = [...accountIds].sort().join(',');
      if (loadedTikTokKey === key) return;
      loadedTikTokKey = key;
      const status = tiktokPanel.querySelector('[data-tiktok-creator-status]');
      status.textContent = 'Loading current TikTok posting choices...';
      const previousPrivacy = tiktokPrivacy.value;
      tiktokPrivacy.innerHTML = '<option value="">Choose visibility</option>';
      try {
        const creators = await Promise.all(accountIds.map(fetchTikTokCreator));
        if (loadedTikTokKey !== key) return;
        const privacyOptions = (creators[0]?.privacyLevelOptions || []).filter((value) => (
          creators.every((creator) => (creator.privacyLevelOptions || []).includes(value))
        ));
        const labels = {
          PUBLIC_TO_EVERYONE: 'Everyone',
          MUTUAL_FOLLOW_FRIENDS: 'Friends',
          FOLLOWER_OF_CREATOR: 'Followers',
          SELF_ONLY: 'Only me'
        };
        privacyOptions.forEach((value) => {
          const option = document.createElement('option');
          option.value = value;
          option.textContent = labels[value] || value.split('_').join(' ').toLowerCase();
          tiktokPrivacy.append(option);
        });
        if (privacyOptions.includes(previousPrivacy)) tiktokPrivacy.value = previousPrivacy;
        const disabledFeatures = {
          comment: creators.some((creator) => creator.commentDisabled),
          duet: creators.some((creator) => creator.duetDisabled),
          stitch: creators.some((creator) => creator.stitchDisabled)
        };
        Object.entries(disabledFeatures).forEach(([feature, disabled]) => {
          const input = tiktokPanel.querySelector(`[data-tiktok-feature="${feature}"]`);
          if (!input) return;
          input.disabled = Boolean(disabled);
          if (disabled) input.checked = false;
        });
        const names = creators.map((creator) => creator.creatorNickname).filter(Boolean).join(', ') || 'TikTok creator';
        const durations = creators.map((creator) => Number(creator.maxVideoPostDurationSeconds || 0)).filter(Boolean);
        status.textContent = durations.length ? `${names} · videos up to ${Math.floor(Math.min(...durations) / 60)} minutes` : names;
      } catch (error) {
        if (loadedTikTokKey !== key) return;
        loadedTikTokKey = '';
        status.textContent = error.message;
      }
    };

    const sync = () => {
      accountInputs.forEach((input) => {
        const media = form.querySelector(`[data-account-media="${input.value}"]`);
        if (media) media.hidden = !input.checked;
      });
      ['tiktok', 'youtube'].forEach((platform) => {
        const panel = form.querySelector(`[data-platform-options="${platform}"]`);
        if (panel) panel.hidden = !accountInputs.some((input) => input.checked && input.dataset.platform === platform);
      });
      const selectedTikTok = accountInputs.filter((input) => input.checked && input.dataset.platform === 'tiktok');
      if (tiktokPrivacy) tiktokPrivacy.required = Boolean(selectedTikTok.length);
      if (tiktokConsent) tiktokConsent.required = Boolean(selectedTikTok.length);
      if (selectedTikTok.length) loadTikTokCreators(selectedTikTok.map((input) => input.value));
      const schedule = form.querySelector('input[name="publishMode"]:checked')?.value === 'schedule';
      const scheduleField = form.querySelector('[data-schedule-field]');
      const scheduleInput = form.querySelector('input[name="scheduledAt"]');
      if (scheduleField) scheduleField.hidden = !schedule;
      if (scheduleInput) scheduleInput.disabled = !schedule;
    };
    accountInputs.forEach((input) => input.addEventListener('change', sync, { signal }));
    form.querySelectorAll('input[name="publishMode"]').forEach((input) => input.addEventListener('change', sync, { signal }));
    tiktokPanel?.querySelector('[data-tiktok-commercial]')?.addEventListener('change', (event) => {
      const disclosures = tiktokPanel.querySelector('[data-tiktok-disclosures]');
      if (!disclosures) return;
      disclosures.hidden = !event.currentTarget.checked;
      if (!event.currentTarget.checked) disclosures.querySelectorAll('input').forEach((input) => { input.checked = false; });
    }, { signal });
    sync();
  }

  const syncBulkSelection = () => {
    const selected = [...document.querySelectorAll('[data-row-select]:checked')];
    const bar = document.querySelector('[data-calendar-bulk-bar]');
    const count = document.querySelector('[data-selected-count]');
    if (bar) bar.hidden = !selected.length;
    if (count) count.textContent = String(selected.length);
    const all = document.querySelector('[data-select-all]');
    const rows = [...document.querySelectorAll('[data-row-select]')];
    if (all) {
      all.checked = Boolean(rows.length && selected.length === rows.length);
      all.indeterminate = Boolean(selected.length && selected.length < rows.length);
    }
  };

  const submitAsync = async (form, submitter) => {
    const action = submitter?.formAction || form.action;
    const method = (submitter?.formMethod || form.method || 'post').toUpperCase();
    const data = new FormData(form);
    if (submitter?.name) data.append(submitter.name, submitter.value);
    setBusy(form, true);
    try {
      const response = await fetch(action, {
        method,
        credentials: 'same-origin',
        headers: { Accept: 'application/json', 'X-CSRF-Token': csrfToken() },
        body: data
      });
      const payload = await response.json().catch(() => ({}));
      const message = payload.message || payload.error?.message || (response.ok ? 'Calendar updated.' : 'The action could not be completed.');
      showBulkResults(payload);
      if (!response.ok || payload.ok === false) throw new Error(message);
      showToast(message);
      const deleted = submitter?.hasAttribute('data-delete-draft') || /\/delete(?:\?|$)/.test(action);
      if (deleted && activeDraftId) {
        closeDrawer({ history: false });
        const url = currentUrl();
        url.searchParams.delete('draft');
        window.history.replaceState({ moyiCalendarBase: true }, '', url);
      }
      await refreshList();
      if (activeDraftId && !deleted) await loadDrawer(activeDraftId, { preserveTab: true });
      if (form.hasAttribute('data-image-generation')) {
        window.setTimeout(() => activeDraftId && loadDrawer(activeDraftId, { preserveTab: true, quiet: true }), 8000);
      }
    } catch (error) {
      showToast(error.message, 'error');
    } finally {
      setBusy(form, false);
    }
  };

  const rescheduleEvent = async (eventNode, dropzone) => {
    const date = dropzone.dataset.dropDate;
    const time = dropzone.dataset.dropTime || eventNode.dataset.localTime;
    if (!date || !time) return;
    const scheduledFor = utcForLocalSchedule(date, time);
    const formData = new FormData();
    formData.set('scheduledFor', scheduledFor.toISOString());
    eventNode.setAttribute('aria-busy', 'true');
    try {
      const response = await fetch(`/social-drafts/${encodeURIComponent(eventNode.dataset.draftId)}/reschedule`, {
        method: 'POST',
        credentials: 'same-origin',
        headers: { Accept: 'application/json', 'X-CSRF-Token': csrfToken() },
        body: formData
      });
      const payload = await response.json().catch(() => ({}));
      if (!response.ok || payload.ok === false) throw new Error(payload.message || 'The post could not be rescheduled.');
      showToast(payload.message || 'Post rescheduled.');
      await refreshList();
      if (activeDraftId === eventNode.dataset.draftId) await loadDrawer(activeDraftId, { preserveTab: true });
    } catch (error) {
      showToast(error.message, 'error');
    } finally {
      eventNode.removeAttribute('aria-busy');
      document.querySelectorAll('.calendar-drop-active').forEach((node) => node.classList.remove('calendar-drop-active'));
    }
  };

  document.addEventListener('click', (event) => {
    const mobileRoot = event.target.closest('[data-mobile-calendar]') || document.querySelector('[data-mobile-calendar]');
    const mobileSearchToggle = event.target.closest('[data-mobile-search-toggle]');
    if (mobileSearchToggle && mobileRoot) {
      const panel = mobileRoot.querySelector('[data-mobile-search-panel]');
      const open = panel?.hidden !== false;
      if (panel) panel.hidden = !open;
      mobileSearchToggle.setAttribute('aria-expanded', String(open));
      if (open) window.setTimeout(() => panel?.querySelector('input')?.focus(), 0);
      return;
    }
    if (event.target.closest('[data-mobile-search-close]') && mobileRoot) {
      const panel = mobileRoot.querySelector('[data-mobile-search-panel]');
      if (panel) panel.hidden = true;
      mobileRoot.querySelector('[data-mobile-search-toggle]')?.setAttribute('aria-expanded', 'false');
      return;
    }
    if (event.target.closest('[data-mobile-filter-close]')) {
      openFilterPanel(false);
      return;
    }
    const mobileMode = event.target.closest('[data-mobile-calendar-mode]');
    if (mobileMode && mobileRoot) {
      setMobileMode(mobileRoot, mobileMode.dataset.mobileCalendarMode);
      return;
    }
    if (event.target.closest('[data-mobile-month-toggle]') && mobileRoot) {
      setMobileMonthExpanded(mobileRoot, !mobileRoot.classList.contains('is-month-expanded'));
      return;
    }
    const monthStep = event.target.closest('[data-mobile-month-step]');
    if (monthStep && mobileRoot) {
      const anchor = dateFromKey(mobileRoot.dataset.monthAnchor) || dateFromKey(mobileRoot.dataset.selectedDate) || new Date();
      anchor.setUTCMonth(anchor.getUTCMonth() + Number(monthStep.dataset.mobileMonthStep || 0), 1);
      mobileRoot.dataset.monthAnchor = dateKeyFromUtcDate(anchor);
      renderMobileDateGrid(mobileRoot);
      return;
    }
    const mobileDate = event.target.closest('[data-mobile-date]');
    if (mobileDate && mobileRoot) {
      selectMobileDate(mobileRoot, mobileDate.dataset.mobileDate);
      setMobileMode(mobileRoot, 'agenda');
      return;
    }
    if (event.target.closest('[data-mobile-today]') && mobileRoot) {
      selectMobileDate(mobileRoot, mobileDateKey());
      setMobileMode(mobileRoot, 'agenda');
      return;
    }
    const open = event.target.closest('[data-open-drawer]');
    if (open) {
      const row = open.closest('[data-calendar-row]');
      if (row) {
        event.preventDefault();
        openDrawer(row.dataset.draftId);
      }
      return;
    }
    if (event.target.closest('[data-close-drawer]')) {
      event.preventDefault();
      closeDrawer();
      return;
    }
    const tab = event.target.closest('[data-drawer-tab]');
    if (tab) {
      activateTab(tab.dataset.drawerTab);
      tab.focus();
      return;
    }
    const toggle = event.target.closest('[data-filter-toggle]');
    if (toggle) {
      openFilterPanel();
      return;
    }
    const filterLink = event.target.closest('[data-calendar-filter-link], [data-calendar-clear]');
    if (filterLink) {
      event.preventDefault();
      refreshList({ url: new URL(filterLink.href), push: true });
      return;
    }
    const navigation = event.target.closest('[data-calendar-navigation]');
    if (navigation) {
      event.preventDefault();
      refreshList({ url: new URL(navigation.href), push: true });
      return;
    }
    const viewButton = event.target.closest('[data-calendar-view]');
    if (viewButton) {
      const url = currentUrl();
      url.searchParams.set('view', viewButton.dataset.calendarView);
      url.searchParams.delete('page');
      refreshList({ url, push: true });
      return;
    }
    const clearSelection = event.target.closest('[data-clear-selection]');
    if (clearSelection) {
      document.querySelectorAll('[data-row-select]').forEach((input) => { input.checked = false; });
      syncBulkSelection();
      return;
    }
    const copy = event.target.closest('[data-copy-target], [data-copy-text]');
    if (copy) {
      const text = copy.dataset.copyText || document.getElementById(copy.dataset.copyTarget)?.textContent || '';
      navigator.clipboard.writeText(text).then(() => showToast('Caption copied.')).catch(() => showToast('Copy failed.', 'error'));
    }
    if (!event.target.closest('.calendar-row-menu')) {
      document.querySelectorAll('.calendar-row-menu[open]').forEach((menu) => { menu.removeAttribute('open'); });
    } else if (event.target.closest('.calendar-menu-dropdown button, .calendar-row-menu [role="menuitem"]')) {
      event.target.closest('.calendar-row-menu')?.removeAttribute('open');
    }
  }, { signal });

  document.addEventListener('change', (event) => {
    if (event.target.matches('[data-select-all]')) {
      document.querySelectorAll('[data-row-select]').forEach((input) => { input.checked = event.target.checked; });
      syncBulkSelection();
    } else if (event.target.matches('[data-row-select]')) syncBulkSelection();
    else if (event.target.matches('[data-calendar-date-picker]') && event.target.value) {
      const url = currentUrl();
      url.searchParams.set('date', event.target.value);
      url.searchParams.delete('page');
      refreshList({ url, push: true });
    }
  }, { signal });

  document.addEventListener('dragstart', (event) => {
    const calendarEvent = event.target.closest('[data-calendar-event][draggable="true"]');
    if (!calendarEvent) return;
    draggedEvent = calendarEvent;
    calendarEvent.classList.add('is-dragging');
    event.dataTransfer.effectAllowed = 'move';
    event.dataTransfer.setData('text/plain', calendarEvent.dataset.draftId);
  }, { signal });

  document.addEventListener('dragover', (event) => {
    const dropzone = event.target.closest('[data-calendar-dropzone]');
    if (!dropzone || !draggedEvent) return;
    event.preventDefault();
    event.dataTransfer.dropEffect = 'move';
    document.querySelectorAll('.calendar-drop-active').forEach((node) => node !== dropzone && node.classList.remove('calendar-drop-active'));
    dropzone.classList.add('calendar-drop-active');
  }, { signal });

  document.addEventListener('dragleave', (event) => {
    const dropzone = event.target.closest('[data-calendar-dropzone]');
    if (dropzone && !dropzone.contains(event.relatedTarget)) dropzone.classList.remove('calendar-drop-active');
  }, { signal });

  document.addEventListener('drop', (event) => {
    const dropzone = event.target.closest('[data-calendar-dropzone]');
    if (!dropzone || !draggedEvent) return;
    event.preventDefault();
    const source = draggedEvent;
    draggedEvent = null;
    source.classList.remove('is-dragging');
    rescheduleEvent(source, dropzone);
  }, { signal });

  document.addEventListener('dragend', () => {
    draggedEvent?.classList.remove('is-dragging');
    draggedEvent = null;
    document.querySelectorAll('.calendar-drop-active').forEach((node) => node.classList.remove('calendar-drop-active'));
  }, { signal });

  document.addEventListener('submit', (event) => {
    const form = event.target;
    if (form.matches('[data-calendar-filters]')) {
      event.preventDefault();
      refreshList({ url: filteredUrlFromForm(form), push: true });
      return;
    }
    const asyncAction = form.matches('[data-async-action], [data-calendar-bulk-form]') || event.submitter?.hasAttribute('data-async-action');
    if (!asyncAction) return;
    event.preventDefault();
    if (!form.checkValidity()) {
      form.reportValidity();
      return;
    }
    if (form.matches('[data-global-publish-form]')) {
      const ready = Number(form.dataset.readyCount || 0);
      const blocked = Number(form.dataset.blockedCount || 0);
      const processing = Number(form.dataset.processingCount || 0);
      if (!window.confirm(`Ready to publish: ${ready}\nBlocked: ${blocked}\nAlready processing: ${processing}\n\nQueue the ready posts now?`)) return;
    }
    if (form.matches('[data-publish-form]') && !form.querySelector('[data-publish-account]:checked')) {
      showToast('Select at least one connected account.', 'error');
      return;
    }
    submitAsync(form, event.submitter);
  }, { signal });

  document.addEventListener('input', (event) => {
    if (!event.target.matches('[data-calendar-search], [data-mobile-calendar-search]')) return;
    const isMobileSearch = event.target.matches('[data-mobile-calendar-search]');
    window.clearTimeout(isMobileSearch ? mobileSearchTimer : searchTimer);
    const timer = window.setTimeout(() => {
      const url = currentUrl();
      if (event.target.value.trim()) url.searchParams.set('search', event.target.value.trim());
      else url.searchParams.delete('search');
      url.searchParams.delete('page');
      refreshList({ url, replace: true });
    }, 350);
    if (isMobileSearch) mobileSearchTimer = timer;
    else searchTimer = timer;
  }, { signal });

  document.addEventListener('keydown', (event) => {
    if (event.key === 'Escape' && activeDraftId) {
      event.preventDefault();
      closeDrawer();
      return;
    }
    if (event.key === '/' && !/^(INPUT|TEXTAREA|SELECT)$/.test(document.activeElement?.tagName || '')) {
      event.preventDefault();
      document.querySelector('[data-calendar-search]')?.focus();
    }
    if (event.target.matches('[data-drawer-tab]') && ['ArrowLeft', 'ArrowRight'].includes(event.key)) {
      const tabs = [...drawerContent.querySelectorAll('[data-drawer-tab]')];
      const index = tabs.indexOf(event.target);
      const next = event.key === 'ArrowRight' ? (index + 1) % tabs.length : (index - 1 + tabs.length) % tabs.length;
      tabs[next].click();
    }
  }, { signal });

  const historyHandler = (event) => {
    const state = event.detail?.state || window.history.state || {};
    const url = currentUrl();
    const draftId = state.draftId || url.searchParams.get('draft') || '';
    if (state.moyiCalendarDrawer && draftId) openDrawer(draftId, { history: false });
    else {
      closeDrawer({ history: false });
      refreshList({ url });
    }
  };
  window.addEventListener('moyi:calendar-history', historyHandler, { signal });
  document.addEventListener('visibilitychange', () => { if (!document.hidden) scheduleListPolling(); }, { signal });

  const directDraftId = currentUrl().searchParams.get('draft');
  if (directDraftId) openDrawer(directDraftId, { history: false });
  else window.history.replaceState({ ...(window.history.state || {}), moyiCalendarBase: true }, '', window.location.href);
  initializeMobileCalendar();
  scheduleListPolling();

  window.__moyiContentCalendar = {
    destroy() {
      controller.abort();
      window.clearTimeout(searchTimer);
      window.clearTimeout(mobileSearchTimer);
      window.clearTimeout(detailPollTimer);
      window.clearTimeout(listPollTimer);
      if (listRequest) listRequest.abort();
      if (drawerRequest) drawerRequest.abort();
    }
  };
})();
