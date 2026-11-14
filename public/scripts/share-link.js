(() => {
  for (const button of document.querySelectorAll('[data-copy]')) {
    button.addEventListener('click', async () => {
      const value = button.getAttribute('data-copy');
      if (!value) return;
      try {
        await navigator.clipboard.writeText(value);
      } catch {
        const input = document.createElement('input');
        input.value = value;
        document.body.append(input);
        input.select();
        document.execCommand('copy');
        input.remove();
      }
      const label = button.querySelector('[data-copy-label]');
      if (label) {
        const original = label.textContent ?? 'Salin';
        label.textContent = 'Tersalin';
        setTimeout(() => {
          label.textContent = original;
        }, 1600);
      }
    });
  }
})();
