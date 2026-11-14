(() => {
  const reduced = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  document.querySelectorAll('[data-count-up]').forEach((el) => {
    const target = Number(el.getAttribute('data-count-up'));
    if (!Number.isFinite(target)) return;
    el.textContent = String(target);
    if (reduced || target === 0) return;
    const duration = 550;
    const start = performance.now();
    const step = (now) => {
      const t = Math.min(1, (now - start) / duration);
      const eased = 1 - (1 - t) ** 3;
      el.textContent = String(Math.round(target * eased));
      if (t < 1) requestAnimationFrame(step);
    };
    el.textContent = '0';
    requestAnimationFrame(step);
  });
})();
