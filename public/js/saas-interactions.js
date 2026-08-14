(() => {
  const reduceMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;

  const initSaasInteractions = () => {
    document.querySelectorAll('form[data-loading-state]:not([data-saas-busy-bound])').forEach((form) => {
      form.dataset.saasBusyBound = 'true';
    form.addEventListener('submit', () => {
      form.setAttribute('aria-busy', 'true');
      form.querySelectorAll('button[type="submit"], input[type="submit"]').forEach((button) => {
        button.setAttribute('aria-busy', 'true');
      });
    }, { once: true });
  });

    document.querySelectorAll('details:not([data-saas-details-bound])').forEach((details) => {
      details.dataset.saasDetailsBound = 'true';
    details.addEventListener('toggle', () => {
      details.classList.toggle('is-open', details.open);
    });
  });

    if (reduceMotion) return;

    document.querySelectorAll('.panel, .content-card, .project-card, .social-connect-card, .metrics article, .studio-summary > div').forEach((element) => {
      if (element.dataset.saasHoverBound) return;
      element.dataset.saasHoverBound = 'true';
    element.addEventListener('pointerenter', () => element.classList.add('is-hovered'), { passive: true });
    element.addEventListener('pointerleave', () => element.classList.remove('is-hovered'), { passive: true });
  });
  };

  initSaasInteractions();
  document.addEventListener('moyi:page-load', initSaasInteractions);
})();
