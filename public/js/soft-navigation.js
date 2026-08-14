(() => {
  if (window.__moyiSoftNavigationInitialized) return;
  window.__moyiSoftNavigationInitialized = true;
  document.documentElement.classList.add('js-soft-navigation');

  const sharedScriptPaths = new Set([
    '/js/navbar.js',
    '/js/interface-polish.js',
    '/js/saas-interactions.js',
    '/js/loading-state.js',
    '/js/soft-navigation.js',
    '/js/terminal-scan.js',
    '/js/scan-status.js',
    '/js/project-job-status.js',
    '/js/overflow-audit.js'
  ]);
  const prefetchedPages = new Map();
  let activeController = null;
  let navigating = false;

  const normalizePath = (url) => `${url.pathname}${url.search}`;

  const shouldSoftNavigate = (event, link) => {
    if (!link || event.defaultPrevented) return false;
    if (event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return false;
    if (link.target || link.hasAttribute('download') || link.dataset.noSoftNav === 'true') return false;

    const url = new URL(link.href, window.location.href);
    if (url.origin !== window.location.origin) return false;
    if (!/^https?:$/.test(url.protocol)) return false;
    if (url.pathname.startsWith('/tracker.js')) return false;
    if (url.pathname.startsWith('/api/')) return false;
    if (url.pathname.match(/\.(?:pdf|png|jpe?g|gif|webp|avif|zip|csv|xml|txt)$/i)) return false;
    return true;
  };

  const fetchPage = async (url, options = {}) => {
    const key = normalizePath(url);
    if (!options.signal && prefetchedPages.has(key)) return prefetchedPages.get(key);

    const response = await fetch(url.href, {
      method: 'GET',
      credentials: 'same-origin',
      headers: {
        Accept: 'text/html,application/xhtml+xml',
        'X-Moyi-Soft-Navigation': '1'
      },
      signal: options.signal
    });

    const contentType = response.headers.get('content-type') || '';
    if (!response.ok || !contentType.includes('text/html')) {
      throw new Error(`Navigation request failed with ${response.status}`);
    }

    return response.text();
  };

  const copyBodyAttributes = (nextBody) => {
    [...document.body.attributes].forEach((attribute) => {
      document.body.removeAttribute(attribute.name);
    });
    [...nextBody.attributes].forEach((attribute) => {
      document.body.setAttribute(attribute.name, attribute.value);
    });
  };

  const scriptPath = (script) => {
    if (!script.src) return '';
    const url = new URL(script.src, window.location.href);
    return `${url.pathname}${url.search}`;
  };

  const runScript = (sourceScript) => new Promise((resolve, reject) => {
    const script = document.createElement('script');
    [...sourceScript.attributes].forEach((attribute) => {
      if (attribute.name === 'defer') return;
      script.setAttribute(attribute.name, attribute.value);
    });

    if (sourceScript.src) {
      script.onload = () => resolve();
      script.onerror = () => reject(new Error(`Could not load ${sourceScript.src}`));
      script.src = sourceScript.src;
      document.body.appendChild(script);
      return;
    }

    script.textContent = sourceScript.textContent;
    document.body.appendChild(script);
    resolve();
  });

  const runPageScripts = async () => {
    const scripts = [...document.body.querySelectorAll('script')];
    for (const sourceScript of scripts) {
      const path = scriptPath(sourceScript);
      if (sourceScript.dataset.globalLoader !== undefined) continue;
      if (path && sharedScriptPaths.has(path)) continue;
      if (sourceScript.type && !['text/javascript', 'application/javascript', 'module'].includes(sourceScript.type)) continue;
      sourceScript.remove();
      await runScript(sourceScript);
    }
  };

  const loadScriptOnce = (src) => new Promise((resolve) => {
    const existing = document.querySelector(`script[src="${src}"]`);
    if (existing) return resolve();
    const script = document.createElement('script');
    script.src = src;
    script.onload = () => resolve();
    script.onerror = () => resolve();
    document.body.appendChild(script);
  });

  const runConditionalScripts = async () => {
    if (document.querySelector('[data-terminal-scan]')) await loadScriptOnce('/js/terminal-scan.js');
    if (document.querySelector('[data-live-scan]')) await loadScriptOnce('/js/scan-status.js');
    if (document.querySelector('[data-live-job]')) await loadScriptOnce('/js/project-job-status.js');
    if (new URLSearchParams(window.location.search).get('overflowAudit') === '1' || window.localStorage.getItem('moyiOverflowAudit') === '1') {
      await loadScriptOnce('/js/overflow-audit.js');
    }
  };

  const updateCurrentNav = () => {
    const current = `${window.location.pathname}${window.location.search}`;
    document.querySelectorAll('a[href]').forEach((link) => {
      const url = new URL(link.href, window.location.href);
      const isCurrent = url.origin === window.location.origin && normalizePath(url) === current;
      link.classList.toggle('active', isCurrent);
      link.classList.toggle('is-active', isCurrent);
    });
  };

  const scrollAfterNavigation = (url) => {
    if (!url.hash) {
      window.scrollTo({ top: 0, left: 0, behavior: 'auto' });
      return;
    }
    document.querySelector(url.hash)?.scrollIntoView();
  };

  const swapPage = async (html, url) => {
    const parser = new DOMParser();
    const nextDocument = parser.parseFromString(html, 'text/html');
    if (!nextDocument.body) throw new Error('Navigation response did not include a body.');

    document.dispatchEvent(new CustomEvent('moyi:before-page-swap'));
    document.title = nextDocument.title || document.title;
    copyBodyAttributes(nextDocument.body);
    document.body.innerHTML = nextDocument.body.innerHTML;
    document.dispatchEvent(new CustomEvent('moyi:page-load'));
    await runPageScripts();
    await runConditionalScripts();
    updateCurrentNav();
    scrollAfterNavigation(url);
    document.dispatchEvent(new CustomEvent('moyi:after-page-swap'));
  };

  const navigateTo = async (href, options = {}) => {
    const url = new URL(href, window.location.href);
    if (navigating && activeController) activeController.abort();
    activeController = new AbortController();
    navigating = true;
    document.documentElement.classList.add('is-soft-navigating');

    try {
      const html = await fetchPage(url, { signal: activeController.signal });
      await swapPage(html, url);
      if (!options.replace) {
        window.history.pushState({ moyiSoftNavigation: true }, '', url.href);
      }
    } catch (error) {
      if (error.name === 'AbortError') return;
      window.location.assign(url.href);
    } finally {
      navigating = false;
      document.documentElement.classList.remove('is-soft-navigating');
      activeController = null;
    }
  };

  const prefetch = async (link) => {
    const url = new URL(link.href, window.location.href);
    const key = normalizePath(url);
    if (prefetchedPages.has(key) || prefetchedPages.size > 8) return;
    try {
      prefetchedPages.set(key, await fetchPage(url));
    } catch (error) {
      prefetchedPages.delete(key);
    }
  };

  document.addEventListener('click', (event) => {
    const link = event.target.closest('a[href]');
    if (!shouldSoftNavigate(event, link)) return;

    const url = new URL(link.href, window.location.href);
    if (normalizePath(url) === normalizePath(new URL(window.location.href)) && url.hash) return;

    event.preventDefault();
    navigateTo(url.href);
  });

  document.addEventListener('pointerenter', (event) => {
    const link = event.target.closest && event.target.closest('a[href]');
    if (!link) return;
    const syntheticEvent = { button: 0, defaultPrevented: false };
    if (shouldSoftNavigate(syntheticEvent, link)) prefetch(link);
  }, true);

  window.addEventListener('popstate', () => {
    navigateTo(window.location.href, { replace: true });
  });
})();
