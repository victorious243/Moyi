(() => {
  const root = document.querySelector('[data-live-job]');
  if (!root) return;

  const endpoint = root.getAttribute('data-live-job-endpoint');
  if (!endpoint) return;

  const statusNodes = [...root.querySelectorAll('[data-job-status]')];
  const stepNode = root.querySelector('[data-job-step]');
  const progressNode = root.querySelector('[data-job-progress]');
  const checkedNode = root.querySelector('[data-job-last-checked]');
  const errorRow = root.querySelector('[data-job-error-row]');
  const errorNode = root.querySelector('[data-job-error]');

  let active = true;
  let dots = 0;
  let timerId = null;
  let requestInFlight = false;
  let latestStatus = root.getAttribute('data-initial-job-status') || '';
  let redirected = false;

  const activeStatus = (status) => status === 'queued' || status === 'running';

  const formatTime = (date) => date.toLocaleTimeString([], {
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit'
  });

  const updateRunningStatus = () => {
    if (!statusNodes.length || !activeStatus(latestStatus)) return;
    dots = (dots + 1) % 4;
    statusNodes.forEach((node) => {
      node.textContent = `${latestStatus}${'.'.repeat(dots)}`;
    });
  };

  const setCheckedAt = () => {
    if (!checkedNode) return;
    checkedNode.textContent = formatTime(new Date());
  };

  const redirectToResult = (path) => {
    if (redirected) return;
    redirected = true;
    if (stepNode) {
      stepNode.textContent = 'Opening the finished result...';
    }
    window.setTimeout(() => {
      window.location.assign(path || window.location.href);
    }, 250);
  };

  const applyPayload = (payload) => {
    const job = payload.job || {};
    latestStatus = job.status || latestStatus;

    statusNodes.forEach((node) => {
      node.textContent = latestStatus;
    });

    if (stepNode) {
      if (latestStatus === 'failed') {
        stepNode.textContent = job.currentStep || 'The background job failed.';
      } else {
        stepNode.textContent = job.currentStep || (activeStatus(latestStatus)
          ? 'Background work is still running'
          : 'Background work is complete.');
      }
    }

    if (progressNode) {
      progressNode.textContent = typeof job.progressPercent === 'number'
        ? `${job.progressPercent}%`
        : 'n/a';
    }

    if (errorRow && errorNode) {
      const hasError = latestStatus === 'failed' && job.errorMessage;
      errorRow.hidden = !hasError;
      errorNode.textContent = hasError ? job.errorMessage : '';
    }

    setCheckedAt();

    if (latestStatus === 'completed') {
      active = false;
      redirectToResult(job.redirectTo);
      return;
    }

    if (!activeStatus(latestStatus)) {
      active = false;
    }
  };

  const fetchStatus = async () => {
    if (!active || requestInFlight || document.visibilityState !== 'visible' || redirected) return;

    requestInFlight = true;
    try {
      const response = await fetch(endpoint, {
        headers: { Accept: 'application/json' },
        cache: 'no-store'
      });
      if (!response.ok) throw new Error(`Status request failed with ${response.status}`);
      const payload = await response.json();
      applyPayload(payload);
    } catch (error) {
      if (stepNode) {
        stepNode.textContent = 'Waiting for the next job update';
      }
    } finally {
      requestInFlight = false;
      if (active && !redirected) {
        timerId = window.setTimeout(fetchStatus, 2000);
      }
    }
  };

  timerId = window.setTimeout(fetchStatus, 1200);
  window.setInterval(updateRunningStatus, 500);

  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState !== 'visible' || !active || redirected) return;
    window.clearTimeout(timerId);
    timerId = window.setTimeout(fetchStatus, 250);
  });
})();
