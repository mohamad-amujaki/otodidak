(() => {
  document.querySelectorAll('.chapter-nav-drawer a[href]').forEach((anchor) => {
    anchor.addEventListener('click', () => {
      const details = anchor.closest('.chapter-nav-drawer');
      if (details instanceof HTMLDetailsElement) details.open = false;
    });
  });
})();
