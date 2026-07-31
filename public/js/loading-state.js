(() => {
  const overlay = document.querySelector('[data-loading-overlay]');
  const title = document.querySelector('[data-loading-title]');
  const domain = document.querySelector('[data-loading-domain]');
  const copy = document.querySelector('[data-loading-copy]');
  const stages = Array.from(document.querySelectorAll('[data-loading-stage]'));

  if (!overlay || !title) return;

  let active = false;
  let stageTimer;

  const scanStages = [
    {
      title: 'Opening the public crawl',
      copy: 'Connecting securely and confirming the pages Moyi can inspect.'
    },
    {
      title: 'Reading your website',
      copy: 'Collecting titles, descriptions, headings, and page structure.'
    },
    {
      title: 'Finding growth signals',
      copy: 'Separating critical issues, warnings, and useful opportunities.'
    },
    {
      title: 'Building your signal score',
      copy: 'Turning the crawl evidence into a focused public report.'
    }
  ];

  const showScanStage = (index) => {
    const stage = scanStages[index];
    title.textContent = stage.title;
    if (copy) copy.textContent = stage.copy;
    stages.forEach((item, itemIndex) => {
      item.classList.toggle('is-active', itemIndex === index);
      item.classList.toggle('is-complete', itemIndex < index);
    });
  };

  const applyCustomLoadingState = (form, message) => {
    title.textContent = message || 'Moyi is working';
    if (domain) domain.textContent = form.getAttribute('data-loading-domain') || 'your request';
    if (copy) {
      copy.textContent = form.getAttribute('data-loading-copy') || 'Please keep this page open while Moyi finishes the job.';
    }

    const customStages = String(form.getAttribute('data-loading-stages') || '')
      .split(',')
      .map((stage) => stage.trim())
      .filter(Boolean)
      .slice(0, stages.length);

    stages.forEach((item, index) => {
      item.classList.toggle('is-active', index === 0);
      item.classList.remove('is-complete');
      const label = item.querySelector('span');
      if (label && customStages[index]) label.textContent = customStages[index];
    });

    if (customStages.length) {
      let stageIndex = 0;
      stageTimer = window.setInterval(() => {
        stageIndex = Math.min(stageIndex + 1, customStages.length - 1);
        stages.forEach((item, itemIndex) => {
          item.classList.toggle('is-active', itemIndex === stageIndex);
          item.classList.toggle('is-complete', itemIndex < stageIndex);
        });
        if (stageIndex === customStages.length - 1) window.clearInterval(stageTimer);
      }, 1600);
    }
  };

  const openOverlay = (message, form) => {
    if (active) return;
    active = true;
    if (stageTimer) window.clearInterval(stageTimer);

    if (form && form.matches('[data-terminal-scan]')) {
      const input = form.querySelector('input[name="websiteUrl"]');
      if (domain && input && input.value.trim()) domain.textContent = input.value.trim();
      let stageIndex = 0;
      showScanStage(stageIndex);
      stageTimer = window.setInterval(() => {
        stageIndex = Math.min(stageIndex + 1, scanStages.length - 1);
        showScanStage(stageIndex);
        if (stageIndex === scanStages.length - 1) window.clearInterval(stageTimer);
      }, 1350);
    } else if (form && (form.hasAttribute('data-loading-domain') || form.hasAttribute('data-loading-copy') || form.hasAttribute('data-loading-stages'))) {
      applyCustomLoadingState(form, message);
    } else {
      title.textContent = message || 'Moyi is working';
      if (domain) domain.textContent = 'your request';
    }

    overlay.classList.add('is-visible');
    overlay.setAttribute('aria-hidden', 'false');
    document.body.classList.add('loading-active');
  };

  document.querySelectorAll('form[data-loading-state]').forEach((form) => {
    form.addEventListener('submit', () => {
      const message = form.getAttribute('data-loading-state');
      openOverlay(message, form);

      form.querySelectorAll('button, input[type="submit"]').forEach((control) => {
        control.disabled = true;
      });
    });
  });
})();
