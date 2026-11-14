(() => {
  const format = (value) => value.toLocaleString('id-ID');
  const CONFIRM_ABOVE = 100;
  const CONFIRM_KEYS = [
    'confirm',
    'confirmDetail',
    'confirmCost',
    'confirmBalance',
    'confirmCostLabel',
    'confirmBalanceLabel',
    'confirmEffect',
    'confirmLabel',
    'confirmImpact',
  ];

  const init = (form) => {
    const rawBalance = form.getAttribute('data-credit-balance');
    const balance =
      rawBalance === null || rawBalance === '' ? null : Number(rawBalance);
    const amountInput = form.querySelector('[data-credit-amount]');
    const result = form.querySelector('[data-credit-result]');
    const preview = form.querySelector('[data-credit-preview]');
    const count = form.querySelector('[data-credit-count]');
    if (!(amountInput instanceof HTMLInputElement)) return;

    const items = () =>
      Array.from(form.querySelectorAll('[data-bulk-item]')).filter(
        (item) => item instanceof HTMLInputElement,
      );

    const selected = () => items().filter((item) => item.checked).length;

    const readAmount = () => {
      const raw = amountInput.value.trim();
      if (raw === '') return null;
      const parsed = Number(raw);
      if (!Number.isInteger(parsed) || parsed === 0) return null;
      return parsed;
    };

    const describe = () => {
      const amount = readAmount();
      const total = selected();
      if (count) count.textContent = String(total);
      if (amount === null) {
        return balance === null
          ? `Isi jumlah. ${total} pengguna dipilih.`
          : `Saldo sekarang ${format(balance)}. Isi jumlah untuk melihat saldo baru.`;
      }
      const sign = `${amount > 0 ? '+' : '\u2212'}${format(Math.abs(amount))}`;
      if (balance === null) {
        return total === 0
          ? `${sign} kredit. Pilih pengguna dulu di tabel.`
          : `${sign} kredit untuk ${total} pengguna (total ${format(amount * total)} kredit).`;
      }
      const next = balance + amount;
      const tail = next < 0 ? ' \u00b7 saldo tidak boleh negatif' : '';
      return `Saldo: ${format(balance)} \u2192 ${format(next)} (${sign})${tail}`;
    };

    const clearConfirm = () => {
      for (const key of CONFIRM_KEYS) delete form.dataset[key];
    };

    // Atribut konfirmasi disiapkan lebih dulu (bukan saat submit) karena
    // listener ConfirmDialog berjalan di fase capture sebelum submit form.
    const syncConfirm = () => {
      const amount = readAmount();
      const total = selected();
      const bulk = balance === null;
      const needsConfirm =
        amount !== null && (amount < 0 || Math.abs(amount) >= CONFIRM_ABOVE);
      if (!needsConfirm) {
        clearConfirm();
        return;
      }
      form.dataset.confirm = amount > 0 ? 'Tambah kredit?' : 'Kurangi kredit?';
      form.dataset.confirmDetail = bulk
        ? `${total} pengguna terpilih`
        : 'Penyesuaian saldo pengguna';
      form.dataset.confirmCost = String(bulk ? amount * total : amount);
      if (bulk) {
        delete form.dataset.confirmBalance;
      } else {
        form.dataset.confirmBalance = String(balance);
      }
      form.dataset.confirmCostLabel = bulk ? 'Total' : 'Jumlah';
      form.dataset.confirmBalanceLabel = 'Saldo';
      form.dataset.confirmEffect = 'apply';
      form.dataset.confirmLabel = 'Ya, terapkan';
      form.dataset.confirmImpact = bulk
        ? `Diterapkan ke ${total} pengguna dan tercatat di buku kredit.`
        : 'Tercatat di buku kredit dan tidak bisa dihapus.';
    };

    const paint = () => {
      const text = describe();
      if (result) result.textContent = text;
      if (preview) preview.textContent = text;
      syncConfirm();
    };

    for (const button of form.querySelectorAll('[data-credit-preset]')) {
      button.addEventListener('click', () => {
        const value = button.getAttribute('data-credit-preset');
        if (value === null) return;
        amountInput.value = value;
        paint();
        amountInput.focus();
      });
    }

    const selectAll = form.querySelector('[data-bulk-all]');
    if (selectAll instanceof HTMLInputElement) {
      selectAll.addEventListener('change', () => {
        for (const item of items()) item.checked = selectAll.checked;
        paint();
      });
    }
    for (const item of items()) {
      item.addEventListener('change', () => {
        if (selectAll instanceof HTMLInputElement) {
          const all = items();
          selectAll.checked =
            all.length > 0 && all.every((node) => node.checked);
        }
        paint();
      });
    }

    amountInput.addEventListener('input', paint);

    paint();
  };

  for (const form of document.querySelectorAll('[data-credit-form]')) {
    if (form instanceof HTMLFormElement) init(form);
  }
})();
