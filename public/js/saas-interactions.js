(() => {
  const reduceMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;

  document.querySelectorAll('form[data-loading-state]').forEach((form) => {
    form.addEventListener('submit', () => {
      form.setAttribute('aria-busy', 'true');
      form.querySelectorAll('button[type="submit"], input[type="submit"]').forEach((button) => {
        button.setAttribute('aria-busy', 'true');
      });
    }, { once: true });
  });

  document.querySelectorAll('details').forEach((details) => {
    details.addEventListener('toggle', () => {
      details.classList.toggle('is-open', details.open);
    });
  });

  if (reduceMotion) return;

  document.querySelectorAll('.panel, .content-card, .project-card, .social-connect-card, .metrics article, .studio-summary > div').forEach((element) => {
    element.addEventListener('pointerenter', () => element.classList.add('is-hovered'), { passive: true });
    element.addEventListener('pointerleave', () => element.classList.remove('is-hovered'), { passive: true });
  });
})();
