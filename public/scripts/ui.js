(() => {
  const confirmMessage = (element) =>
    element instanceof HTMLElement ? element.dataset.confirm : undefined;

  // Konfirmasi untuk form: pesan bisa ada di form atau tombol submit.
  document.addEventListener(
    'submit',
    (event) => {
      const form = event.target;
      if (!(form instanceof HTMLFormElement)) return;
      const message = confirmMessage(event.submitter) ?? confirmMessage(form);
      if (message && !window.confirm(message)) event.preventDefault();
    },
    true,
  );

  // Konfirmasi untuk tautan/tombol di luar form.
  document.addEventListener('click', (event) => {
    const target = event.target;
    if (!(target instanceof Element)) return;
    const trigger = target.closest('[data-confirm]');
    if (!trigger || trigger.closest('form')) return;
    const message = confirmMessage(trigger);
    if (message && !window.confirm(message)) {
      event.preventDefault();
      event.stopImmediatePropagation();
    }
  });

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
