(() => {
  const tableRoot = document.querySelector('[data-admin-paket]');
  const previewRoot = document.querySelector('[data-pack-preview-root]');
  if (!tableRoot) return;

  const formatter = new Intl.NumberFormat('id-ID', {
    style: 'currency',
    currency: 'IDR',
    maximumFractionDigits: 0,
  });

  const readPackFromRow = (row) => {
    const form = row.querySelector('form');
    if (!form) return null;
    return {
      id: row.getAttribute('data-pack-id') ?? '',
      sort: Number(form.querySelector('[name="sort"]')?.value ?? 0),
      name: String(form.querySelector('[name="name"]')?.value ?? ''),
      credits: Number(form.querySelector('[name="credits"]')?.value ?? 0),
      priceIdr: Number(form.querySelector('[name="priceIdr"]')?.value ?? 0),
      active: Boolean(form.querySelector('[name="active"]')?.checked),
    };
  };

  const renderPreview = () => {
    if (!previewRoot) return;
    const grid = previewRoot.querySelector('[data-pack-preview-grid]');
    const empty = previewRoot.querySelector('[data-pack-preview-empty]');
    if (!grid || !empty) return;

    const packs = [...tableRoot.querySelectorAll('[data-pack-row]')]
      .map(readPackFromRow)
      .filter(Boolean)
      .filter((p) => p.active && p.name && p.credits > 0 && p.priceIdr > 0)
      .sort((a, b) => a.sort - b.sort);

    grid.replaceChildren();
    for (const pack of packs) {
      const card = document.createElement('li');
      card.className =
        'flex flex-col rounded-kartu border border-garis bg-kartu p-4 shadow-sm';
      card.dataset.previewCard = '';
      card.dataset.packId = pack.id;
      const per = Math.round(pack.priceIdr / pack.credits);
      card.innerHTML = `
        <h4 class="text-base font-semibold text-tinta"></h4>
        <p class="mt-1 text-2xl font-bold tabular-nums text-jalur"></p>
        <p class="text-xs text-tinta-lembut">kredit</p>
        <p class="mt-2 text-lg font-bold text-tinta"></p>
        <p class="text-xs text-tinta-lembut"></p>
      `;
      card.querySelector('h4').textContent = pack.name;
      card.querySelectorAll('p')[0].textContent = String(pack.credits);
      card.querySelectorAll('p')[2].textContent = formatter.format(
        pack.priceIdr,
      );
      card.querySelectorAll('p')[3].textContent =
        `${formatter.format(per)} / kredit`;
      grid.append(card);
    }

    const has = packs.length > 0;
    grid.hidden = !has;
    empty.hidden = has;
  };

  const countActive = () =>
    [...tableRoot.querySelectorAll('[data-pack-row]')].filter(
      (row) => row.querySelector('[name="active"]')?.checked,
    ).length;

  const syncRow = (row) => {
    const creditsInput = row.querySelector('[name="credits"]');
    const priceInput = row.querySelector('[name="priceIdr"]');
    const out = row.querySelector('[data-rp-per-credit]');
    if (!creditsInput || !priceInput || !out) return;

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

  const bindRow = (row) => {
    const form = row.querySelector('form');
    if (!form) return;

    form.querySelectorAll('input').forEach((input) => {
      input.addEventListener('input', () => {
        syncRow(row);
        renderPreview();
      });
      input.addEventListener('change', () => {
        syncRow(row);
        renderPreview();
      });
    });

    form.addEventListener('submit', (event) => {
      const active = form.querySelector('[name="active"]');
      if (!active || active.checked) return;
      const activeAfter = countActive();
      if (activeAfter >= 1) return;
      event.preventDefault();
      window.alert(
        'Minimal satu paket harus aktif. Centang paket lain atau batalkan penonaktifan ini.',
      );
    });

    syncRow(row);
  };

  tableRoot.querySelectorAll('[data-pack-row]').forEach(bindRow);
  renderPreview();
})();
