(() => {
  const root = document.querySelector('[data-live-scan]');
  if (!root) return;

  const endpoint = root.getAttribute('data-live-scan-endpoint');
  if (!endpoint) return;

  const statusNodes = [...root.querySelectorAll('[data-scan-status]')];
  const stepNode = root.querySelector('[data-scan-step]');
  const currentUrlNode = root.querySelector('[data-scan-current-url]');
  const currentUrlRow = root.querySelector('[data-scan-current-url-row]');
  const checkedNode = root.querySelector('[data-scan-last-checked]');
  const issueStateNode = root.querySelector('[data-issue-state]');
  const competitorStateNode = root.querySelector('[data-competitor-state]');
  const metrics = {
    pagesScanned: root.querySelector('[data-scan-metric="pagesScanned"]'),
    pagesFound: root.querySelector('[data-scan-metric="pagesFound"]'),
    failedPagesCount: root.querySelector('[data-scan-metric="failedPagesCount"]'),
    criticalCount: root.querySelector('[data-scan-metric="criticalCount"]'),
    warningCount: root.querySelector('[data-scan-metric="warningCount"]'),
    opportunityCount: root.querySelector('[data-scan-metric="opportunityCount"]')
  };
  const issuesBody = root.querySelector('[data-scan-issues-body]');
  const issuesEmpty = root.querySelector('[data-scan-issues-empty]');
  const competitorBody = root.querySelector('[data-scan-competitor-body]');
  const pagesBody = root.querySelector('[data-scan-pages-body]');
  const pagesEmpty = root.querySelector('[data-scan-pages-empty]');

  let active = true;
  let dots = 0;
  let timerId = null;
  let requestInFlight = false;
  let latestStatus = root.getAttribute('data-initial-scan-status') || '';

  const escapeHtml = (value) => String(value || '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');

  const formatTime = (date) => date.toLocaleTimeString([], {
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit'
  });

  const activeStatus = (status) => status === 'pending' || status === 'running';
  const completeStatusLabel = (status) => {
    if (status === 'cancelled') return 'Scan stopped. Partial findings may remain visible below.';
    if (status === 'failed') return 'Scan failed. Review the error message below.';
    return 'Scan complete. Review the findings below.';
  };
  const startedActive = activeStatus(latestStatus);

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

  const renderIssues = (data) => {
    if (!issuesBody || !issuesEmpty) return;

    if (!data.issues.length) {
      issuesBody.innerHTML = '';
      issuesEmpty.hidden = false;
      issuesEmpty.textContent = activeStatus(data.scan.status)
        ? 'No issues recorded yet. Findings will appear here as soon as the audit stage finishes.'
        : 'No issues recorded for this scan.';
      return;
    }

    issuesEmpty.hidden = true;
    issuesBody.innerHTML = data.issues.map((issue) => `
      <tr>
        <td><span class="status">${escapeHtml(issue.severity)}</span></td>
        <td>${escapeHtml(issue.title)}</td>
        <td><a href="${escapeHtml(issue.url)}" target="_blank" rel="noreferrer">${escapeHtml(issue.url)}</a></td>
        <td>${escapeHtml(issue.recommendation)}</td>
      </tr>
    `).join('');
  };

  const renderCompetitors = (data) => {
    if (!competitorBody || !competitorStateNode) return;

    if (activeStatus(data.scan.status)) {
      competitorStateNode.hidden = false;
      competitorStateNode.textContent = 'Competitor identification and comparison opportunities are still being prepared for this scan.';
      competitorBody.innerHTML = '';
      return;
    }

    if (!data.competitors.length) {
      competitorStateNode.hidden = false;
      competitorStateNode.textContent = 'No competitors were identified from this project yet. The scan pipeline will retry discovery on the next scan if none are tracked.';
      competitorBody.innerHTML = '';
      return;
    }

    if (!data.competitorInsights.length) {
      competitorStateNode.hidden = false;
      competitorStateNode.textContent = 'Competitors are tracked, but no comparison opportunities are available yet.';
      competitorBody.innerHTML = '';
      return;
    }

    competitorStateNode.hidden = true;
    competitorBody.innerHTML = data.competitorInsights.map((insight) => `
      <article class="recommendation-card">
        <span class="status">${escapeHtml(insight.category.replace(/_/g, ' '))} / Priority ${escapeHtml(insight.priority)}</span>
        <h2>${escapeHtml(insight.title)}</h2>
        <p><strong>What they do better:</strong> ${escapeHtml(insight.insight)}</p>
        <p><strong>What to improve:</strong> ${escapeHtml(insight.opportunity)}</p>
      </article>
    `).join('');
  };

  const renderPages = (data) => {
    if (!pagesBody || !pagesEmpty) return;

    if (!data.pages.length) {
      pagesBody.innerHTML = '';
      pagesEmpty.hidden = false;
      pagesEmpty.textContent = activeStatus(data.scan.status)
        ? 'Pages will appear here while the scan is working through the site.'
        : 'No pages were saved for this scan.';
      return;
    }

    pagesEmpty.hidden = true;
    pagesBody.innerHTML = data.pages.map((page) => `
      <tr>
        <td>${escapeHtml(page.statusCode)}</td>
        <td><a href="${escapeHtml(page.url)}" target="_blank" rel="noreferrer">${escapeHtml(page.title || page.url)}</a></td>
        <td>${escapeHtml(page.metaDescription || 'Missing')}</td>
        <td>${escapeHtml((page.h1 || []).join(' | ') || 'Missing')}</td>
        <td>${escapeHtml(page.wordCount)}</td>
        <td>${escapeHtml(page.imagesMissingAlt)}</td>
      </tr>
    `).join('');
  };

  const applyPayload = (data) => {
    latestStatus = data.scan.status;

    statusNodes.forEach((node) => {
      node.textContent = latestStatus;
    });

    if (stepNode) {
      stepNode.textContent = data.scan.currentStep || (activeStatus(latestStatus)
        ? 'Working through the scan'
        : completeStatusLabel(latestStatus));
    }

    if (currentUrlNode) {
      currentUrlNode.textContent = data.scan.currentUrl || '';
    }
    if (currentUrlRow) {
      currentUrlRow.hidden = !data.scan.currentUrl;
    }

    if (issueStateNode) {
      issueStateNode.textContent = `${data.issueSummary.issueCount} issues`;
    }

    Object.entries(metrics).forEach(([key, node]) => {
      if (!node) return;
      if (key in data.issueSummary) {
        node.textContent = data.issueSummary[key];
        return;
      }
      if (key in data) {
        node.textContent = data[key];
        return;
      }
      if (key in data.scan) {
        node.textContent = data.scan[key];
      }
    });

    renderIssues(data);
    renderCompetitors(data);
    renderPages(data);
    setCheckedAt();

    if (!activeStatus(latestStatus)) {
      active = false;
      statusNodes.forEach((node) => {
        node.textContent = latestStatus;
      });
      if (startedActive && latestStatus === 'completed') {
        window.location.reload();
      }
    }
  };

  const fetchStatus = async () => {
    if (!active || requestInFlight || document.visibilityState !== 'visible') return;

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
        stepNode.textContent = 'Waiting for the next scan update';
      }
    } finally {
      requestInFlight = false;
      if (active) {
        timerId = window.setTimeout(fetchStatus, 2000);
      }
    }
  };

  timerId = window.setTimeout(fetchStatus, 1200);
  window.setInterval(updateRunningStatus, 500);

  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState !== 'visible' || !active) return;
    window.clearTimeout(timerId);
    timerId = window.setTimeout(fetchStatus, 250);
  });
})();
