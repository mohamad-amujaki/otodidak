(() => {
  const root = document.querySelector('[data-admin-paket]');
  if (!root) return;

  const formatter = new Intl.NumberFormat('id-ID', {
    style: 'currency',
    currency: 'IDR',
    maximumFractionDigits: 0,
  });

  root.querySelectorAll('[data-pack-row]').forEach((row) => {
    const creditsInput = row.querySelector('[name="credits"]');
    const priceInput = row.querySelector('[name="priceIdr"]');
    const out = row.querySelector('[data-rp-per-credit]');
    if (!creditsInput || !priceInput || !out) return;

    const sync = () => {
      const credits = Number(creditsInput.value);
      const price = Number(priceInput.value);
      if (
        !Number.isFinite(credits) ||
        credits < 1 ||
        !Number.isFinite(price) ||
        price < 1
      ) {
        out.textContent = '—';
        return;
      }
      out.textContent = formatter.format(Math.round(price / credits));
    };

    creditsInput.addEventListener('input', sync);
    priceInput.addEventListener('input', sync);
  });
})();
