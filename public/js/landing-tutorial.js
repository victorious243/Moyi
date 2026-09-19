(() => {
  const facades = document.querySelectorAll('[data-youtube-facade]');

  facades.forEach((facade) => {
    facade.addEventListener('click', () => {
      const src = facade.dataset.videoSrc;
      if (!src || !src.startsWith('https://www.youtube-nocookie.com/embed/')) return;

      const iframe = document.createElement('iframe');
      iframe.src = `${src}${src.includes('?') ? '&' : '?'}autoplay=1`;
      iframe.title = 'How to use Moyi-CMO';
      iframe.allow = 'accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture; web-share';
      iframe.referrerPolicy = 'strict-origin-when-cross-origin';
      iframe.allowFullscreen = true;

      facade.replaceWith(iframe);
    }, { once: true });
  });
})();
