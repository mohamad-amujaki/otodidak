(() => {
  const progressBar = document.getElementById('reading-progress');
  const progressWrap = document.getElementById('reading-progress-wrap');
  const content = document.getElementById('lesson-content');
  const completeForm = document.getElementById('complete-form');

  if (progressBar && content) {
    const reduced = window.matchMedia(
      '(prefers-reduced-motion: reduce)',
    ).matches;
    if (reduced) progressBar.classList.remove('transition-[width]');

    const setProgress = (value) => {
      const pct = Math.round(Math.min(100, Math.max(0, value)));
      progressBar.style.width = `${pct}%`;
      if (progressWrap) progressWrap.setAttribute('aria-valuenow', String(pct));
    };

    const updateProgress = () => {
      const rect = content.getBoundingClientRect();
      const contentTop = window.scrollY + rect.top;
      const contentHeight = content.offsetHeight;
      const viewport = window.innerHeight;
      const scrollable = contentHeight - viewport;
      if (scrollable <= 0) {
        setProgress(100);
        return;
      }
      const scrolled = window.scrollY - contentTop;
      setProgress((scrolled / scrollable) * 100);
    };

    window.addEventListener('scroll', updateProgress, { passive: true });
    window.addEventListener('resize', updateProgress, { passive: true });
    updateProgress();
  }

  document.addEventListener('keydown', (e) => {
    if (e.target instanceof HTMLElement && e.target.matches('input, textarea'))
      return;

    if ((e.ctrlKey || e.metaKey) && e.key === 'Enter') {
      e.preventDefault();
      if (completeForm instanceof HTMLFormElement) completeForm.requestSubmit();
    }

    if (e.key === 'ArrowLeft') {
      e.preventDefault();
      window.history.back();
    }

    if (e.key === 'Escape') {
      e.preventDefault();
      const backLink = document.querySelector('a[href^="/jalur/"]');
      if (backLink instanceof HTMLAnchorElement) backLink.click();
    }
  });
})();
