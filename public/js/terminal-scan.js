(() => {
  const form = document.querySelector('[data-terminal-scan]');
  const consolePanel = document.querySelector('[data-terminal-console]');

  if (!form || !consolePanel) return;

  form.addEventListener('submit', () => {
    consolePanel.classList.add('is-scanning');
    form.querySelector('button').textContent = 'Scanning';
  });
})();
