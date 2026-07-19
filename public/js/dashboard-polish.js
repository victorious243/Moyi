(() => {
  const reduceMotion = window.matchMedia('(prefers-reduced-motion: reduce)');
  const finePointer = window.matchMedia('(hover: hover) and (pointer: fine)');
  const main = document.querySelector('.dashboard-main');

  if (!main || reduceMotion.matches || !finePointer.matches) return;

  let frame = null;
  let pointerX = 0;
  let pointerY = 0;

  const updateSpotlight = () => {
    main.style.setProperty('--mx', `${pointerX}px`);
    main.style.setProperty('--my', `${pointerY}px`);
    frame = null;
  };

  main.addEventListener('pointermove', (event) => {
    const rect = main.getBoundingClientRect();
    pointerX = event.clientX - rect.left;
    pointerY = event.clientY - rect.top;
    if (!frame) frame = requestAnimationFrame(updateSpotlight);
  }, { passive: true });

  document.querySelectorAll('[data-tilt]').forEach((card) => {
    card.addEventListener('pointermove', (event) => {
      const rect = card.getBoundingClientRect();
      const x = (event.clientX - rect.left) / rect.width;
      const y = (event.clientY - rect.top) / rect.height;
      const rotateY = (x - 0.5) * 5;
      const rotateX = (0.5 - y) * 5;
      card.style.setProperty('--card-x', `${x * 100}%`);
      card.style.setProperty('--card-y', `${y * 100}%`);
      card.style.transform = `perspective(900px) rotateX(${rotateX}deg) rotateY(${rotateY}deg) translateY(-4px) scale(1.012)`;
    }, { passive: true });

    card.addEventListener('pointerleave', () => {
      card.style.transform = '';
    });
  });

  document.querySelectorAll('.magnetic-button').forEach((button) => {
    button.addEventListener('pointermove', (event) => {
      const rect = button.getBoundingClientRect();
      const x = event.clientX - rect.left - rect.width / 2;
      const y = event.clientY - rect.top - rect.height / 2;
      button.style.transform = `translate(${x * 0.06}px, ${y * 0.08}px) translateY(-2px)`;
    }, { passive: true });

    button.addEventListener('pointerleave', () => {
      button.style.transform = '';
    });
  });
})();
