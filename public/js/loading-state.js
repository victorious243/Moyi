(() => {
  const overlay = document.querySelector('[data-loading-overlay]');
  const title = document.querySelector('[data-loading-title]');

  if (!overlay || !title) return;

  let active = false;

  const openOverlay = (message) => {
    if (active) return;
    active = true;
    title.textContent = message || 'Working through it';
    overlay.classList.add('is-visible');
    overlay.setAttribute('aria-hidden', 'false');
    document.body.classList.add('loading-active');
  };

  document.querySelectorAll('form[data-loading-state]').forEach((form) => {
    form.addEventListener('submit', () => {
      const message = form.getAttribute('data-loading-state');
      openOverlay(message);

      form.querySelectorAll('button, input[type="submit"]').forEach((control) => {
        control.disabled = true;
      });
    });
  });
})();
