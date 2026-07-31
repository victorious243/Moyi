(function () {
  const params = new URLSearchParams(window.location.search);
  const enabled = params.get('overflowAudit') === '1' || window.localStorage.getItem('moyiOverflowAudit') === '1';
  if (!enabled) return;

  if (params.get('overflowAudit') === '1') {
    window.localStorage.setItem('moyiOverflowAudit', '1');
  }
  if (params.get('overflowAudit') === '0') {
    window.localStorage.removeItem('moyiOverflowAudit');
    return;
  }

  function selectorFor(element) {
    if (!element || element === document.documentElement) return 'html';
    if (element.id) return `#${element.id}`;
    const className = String(element.className || '').trim().split(/\s+/).filter(Boolean).slice(0, 3).join('.');
    return `${element.tagName.toLowerCase()}${className ? `.${className}` : ''}`;
  }

  function auditOverflow() {
    const viewportWidth = document.documentElement.clientWidth;
    const offenders = [];
    document.querySelectorAll('.is-overflowing').forEach((element) => element.classList.remove('is-overflowing'));

    document.querySelectorAll('body *').forEach((element) => {
      const rect = element.getBoundingClientRect();
      const horizontalEscape = rect.left < -1 || rect.right > viewportWidth + 1;
      const internalOverflow = element.scrollWidth > element.clientWidth + 1;
      if (!horizontalEscape && !internalOverflow) return;
      if (rect.width <= 0 || rect.height <= 0) return;

      element.classList.add('is-overflowing');
      offenders.push({
        selector: selectorFor(element),
        text: String(element.textContent || '').replace(/\s+/g, ' ').trim().slice(0, 90),
        left: Math.round(rect.left),
        right: Math.round(rect.right),
        width: Math.round(rect.width),
        scrollWidth: element.scrollWidth,
        clientWidth: element.clientWidth
      });
    });

    document.documentElement.dataset.overflowAudit = offenders.length ? String(offenders.length) : 'clear';
    if (offenders.length) console.table(offenders.slice(0, 40));
    else console.info('Moyi overflow audit: no horizontal overflow detected.');
  }

  window.addEventListener('load', () => {
    auditOverflow();
    setTimeout(auditOverflow, 750);
  });
  window.addEventListener('resize', () => window.requestAnimationFrame(auditOverflow));
})();
