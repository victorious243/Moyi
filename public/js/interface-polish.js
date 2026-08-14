(() => {
  const reduceMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  const finePointer = window.matchMedia('(hover: hover) and (pointer: fine)').matches;
  const fieldSelector = [
    'input:not([type="hidden"]):not([type="checkbox"]):not([type="radio"]):not([type="submit"]):not([type="button"])',
    'textarea',
    'select'
  ].join(',');

  document.documentElement.classList.add('ui-enhanced');

  if (document.querySelector('.auth-panel')) {
    document.body.classList.add('ui-auth-view');
  }

  document.querySelectorAll('.form, .grid-form').forEach((form) => {
    form.classList.add('ui-form');

    const fields = Array.from(form.querySelectorAll(fieldSelector));
    fields.forEach((field, index) => {
      const label = field.closest('label');
      if (!label || label.contains(field) === false) return;

      label.classList.add('ui-field');
      label.style.setProperty('--ui-field-order', index);

      const syncField = () => {
        const value = field.value == null ? '' : String(field.value).trim();
        label.classList.toggle('is-filled', value.length > 0);
      };

      field.addEventListener('focus', () => label.classList.add('is-focused'));
      field.addEventListener('blur', () => {
        label.classList.remove('is-focused');
        field.classList.add('is-touched');
        syncField();
      });
      field.addEventListener('input', syncField);
      field.addEventListener('change', syncField);
      field.addEventListener('invalid', () => field.classList.add('is-touched'));
      syncField();
    });

    form.addEventListener('submit', () => {
      let isFormValid = true;
      fields.forEach((field) => {
        if (!field.validity.valid) {
          field.classList.add('is-touched');
          isFormValid = false;
        }
      });
      if (isFormValid) {
        form.classList.add('is-submitting');
        const submitBtn = form.querySelector('button[type="submit"], .button-primary');
        if (submitBtn) {
          submitBtn.classList.add('is-loading');
        }
      }
    });
  });

  const controls = Array.from(document.querySelectorAll('.button, .icon-button'));
  controls.forEach((control) => {
    control.classList.add('ui-interactive');

    if (finePointer && !reduceMotion) {
      control.addEventListener('pointermove', (event) => {
        const bounds = control.getBoundingClientRect();
        const x = event.clientX - bounds.left;
        const y = event.clientY - bounds.top;
        const magneticX = ((x / bounds.width) - 0.5) * 4;
        const magneticY = ((y / bounds.height) - 0.5) * 3;

        control.style.setProperty('--ui-pointer-x', `${x}px`);
        control.style.setProperty('--ui-pointer-y', `${y}px`);

        if (control.classList.contains('button-primary')) {
          control.style.setProperty('--ui-shift-x', `${magneticX.toFixed(2)}px`);
          control.style.setProperty('--ui-shift-y', `${magneticY.toFixed(2)}px`);
        }
      });

      control.addEventListener('pointerleave', () => {
        control.style.setProperty('--ui-shift-x', '0px');
        control.style.setProperty('--ui-shift-y', '0px');
      });
    }

    control.addEventListener('click', (event) => {
      if (reduceMotion || control.matches(':disabled, [aria-disabled="true"]')) return;

      const bounds = control.getBoundingClientRect();
      const diameter = Math.max(bounds.width, bounds.height) * 1.35;
      const ripple = document.createElement('span');
      ripple.className = 'ui-ripple';
      ripple.style.width = `${diameter}px`;
      ripple.style.height = `${diameter}px`;
      ripple.style.left = `${event.clientX - bounds.left - diameter / 2}px`;
      ripple.style.top = `${event.clientY - bounds.top - diameter / 2}px`;
      control.appendChild(ripple);
      ripple.addEventListener('animationend', () => ripple.remove(), { once: true });
    });
  });

  if (reduceMotion || !('IntersectionObserver' in window)) return;

  document.body.classList.add('ui-motion-ready');
  const revealTargets = document.querySelectorAll([
    '.auth-panel',
    '.wide-form',
    '.contact-page',
    '.page-heading',
    '.dashboard-heading',
    '.billing-hero',
    '.pricing-hero'
  ].join(','));

  const observer = new IntersectionObserver((entries) => {
    entries.forEach((entry) => {
      if (!entry.isIntersecting) return;
      entry.target.classList.add('is-ui-visible');
      observer.unobserve(entry.target);
    });
  }, { threshold: 0.08, rootMargin: '0px 0px -24px' });

  revealTargets.forEach((target) => {
    target.classList.add('ui-reveal');
    observer.observe(target);
  });
})();
