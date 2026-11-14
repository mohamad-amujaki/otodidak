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

  const previousLink = document.querySelector('a[data-lesson-prev]');
  const nextLink = document.querySelector('a[data-lesson-next]');
  const pathLink = document.querySelector('a[data-lesson-path]');

  const isTyping = (target) =>
    target instanceof HTMLElement &&
    (target.isContentEditable || target.matches('input, textarea, select'));

  const hasOpenDialog = () => Boolean(document.querySelector('dialog[open]'));

  const navigate = (link) => {
    if (!(link instanceof HTMLAnchorElement)) return false;
    window.location.assign(link.href);
    return true;
  };

  document.addEventListener('keydown', (event) => {
    if (event.defaultPrevented || event.isComposing) return;

    if (event.ctrlKey || event.metaKey) {
      if (event.key === 'Enter') {
        event.preventDefault();
        if (completeForm instanceof HTMLFormElement)
          completeForm.requestSubmit();
      }
      return;
    }

    if (event.altKey || event.shiftKey) return;
    if (isTyping(event.target)) return;
    if (hasOpenDialog()) return;

    if (event.key === 'ArrowLeft' || event.key === 'k' || event.key === 'K') {
      if (navigate(previousLink)) event.preventDefault();
      return;
    }

    if (event.key === 'ArrowRight' || event.key === 'j' || event.key === 'J') {
      if (navigate(nextLink)) event.preventDefault();
      return;
    }

    if (event.key === 'Escape') {
      if (navigate(pathLink)) event.preventDefault();
    }
  });
})();
