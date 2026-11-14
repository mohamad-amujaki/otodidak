(() => {
  const sheet = document.getElementById('tinjau-sheet');
  if (!(sheet instanceof HTMLDialogElement)) return;

  const scroller = sheet.querySelector('[data-tinjau-scroll]');
  const openers = document.querySelectorAll('[data-open-tinjau]');
  for (const opener of openers) {
    opener.addEventListener('click', () => sheet.showModal());
  }
  const closers = sheet.querySelectorAll('[data-close-tinjau]');
  for (const closer of closers) {
    closer.addEventListener('click', () => sheet.close());
  }
  sheet.addEventListener('click', (event) => {
    if (event.target === sheet) sheet.close();
  });
  for (const form of sheet.querySelectorAll('form')) {
    form.addEventListener('submit', () => {
      if (!(scroller instanceof HTMLElement)) return;
      try {
        sessionStorage.setItem('tinjau-scroll', String(scroller.scrollTop));
      } catch {
        // Storage can be unavailable; the sheet still works without it.
      }
    });
  }
  const confirm = document.getElementById('konfirmasi-tinjau');
  const approve = document.getElementById('setujui-jalur-btn');
  if (confirm instanceof HTMLInputElement && approve instanceof HTMLButtonElement) {
    const sync = () => {
      approve.disabled = !confirm.checked;
    };
    confirm.addEventListener('change', sync);
    sync();
  }
  if (sheet.dataset.open === 'true') {
    sheet.showModal();
    if (scroller instanceof HTMLElement) {
      try {
        const saved = sessionStorage.getItem('tinjau-scroll');
        if (saved !== null) {
          scroller.scrollTop = Number(saved);
          sessionStorage.removeItem('tinjau-scroll');
        }
      } catch {
        // Ignore storage failures.
      }
    }
  }
})();
