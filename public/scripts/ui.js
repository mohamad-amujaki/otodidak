(() => {
  // Menu akun: sinkronkan aria-expanded dan tutup saat klik luar / Escape.
  for (const node of document.querySelectorAll('details.menu')) {
    if (!(node instanceof HTMLDetailsElement)) continue;
    const menu = node;
    const summary = menu.querySelector('summary');
    const sync = () =>
      summary?.setAttribute('aria-expanded', menu.open ? 'true' : 'false');
    menu.addEventListener('toggle', sync);
    sync();
    document.addEventListener('click', (event) => {
      if (menu.open && !menu.contains(event.target)) menu.open = false;
    });
    menu.addEventListener('keydown', (event) => {
      if (event.key === 'Escape' && menu.open) {
        menu.open = false;
        summary?.focus();
      }
    });
  }

  // Daftar isi mobile: tutup setelah salah satu tautan dipilih.
  for (const anchor of document.querySelectorAll(
    '.legal-toc-mobile a[href^="#"]',
  )) {
    anchor.addEventListener('click', () => {
      const details = anchor.closest('.legal-toc-mobile');
      if (details instanceof HTMLDetailsElement) details.open = false;
    });
  }

  // Polling status ringan: reload saat status keluar dari daftar tunggu.
  const poll = document.querySelector('[data-poll-url]');
  if (poll instanceof HTMLElement) {
    const url = poll.dataset.pollUrl;
    const interval = Math.max(1000, Number(poll.dataset.pollInterval) || 4000);
    const key = poll.dataset.pollKey || 'status';
    const pending = (poll.dataset.pollPending || 'draft')
      .split(',')
      .map((value) => value.trim())
      .filter(Boolean);
    let stopped = false;
    const tick = async () => {
      if (stopped) return;
      try {
        const response = await fetch(url, {
          headers: { accept: 'application/json' },
        });
        if (!response.ok) return;
        const data = await response.json();
        const status = data?.[key];
        if (typeof status === 'string' && status && !pending.includes(status)) {
          stopped = true;
          const keepTinjau =
            new URLSearchParams(location.search).get('tinjau') === '1';
          location.href = keepTinjau
            ? `${location.pathname}?tinjau=1`
            : location.href;
        }
      } catch {
        // Terus coba selama koneksi pulih.
      }
    };
    setInterval(tick, interval);
  }
})();
