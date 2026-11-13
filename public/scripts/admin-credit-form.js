(() => {
  const format = (value) => value.toLocaleString('id-ID');

  const init = (form) => {
    const rawBalance = form.getAttribute('data-credit-balance');
    const balance =
      rawBalance === null || rawBalance === '' ? null : Number(rawBalance);
    const amountInput = form.querySelector('[data-credit-amount]');
    const result = form.querySelector('[data-credit-result]');
    const preview = form.querySelector('[data-credit-preview]');
    const count = form.querySelector('[data-credit-count]');
    const confirmBox = form.querySelector('[data-credit-confirm]');
    const confirmText = form.querySelector('[data-credit-confirm-text]');
    const confirmYes = form.querySelector('[data-credit-confirm-yes]');
    const confirmNo = form.querySelector('[data-credit-confirm-no]');
    if (!(amountInput instanceof HTMLInputElement)) return;

    const CONFIRM_ABOVE = 100;
    let confirmed = false;

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

    const paint = () => {
      const text = describe();
      if (result) result.textContent = text;
      if (preview) preview.textContent = text;
    };

    const closeConfirm = () => {
      if (confirmBox) confirmBox.classList.add('hidden');
      confirmed = false;
    };

    for (const button of form.querySelectorAll('[data-credit-preset]')) {
      button.addEventListener('click', () => {
        const value = button.getAttribute('data-credit-preset');
        if (value === null) return;
        amountInput.value = value;
        closeConfirm();
        paint();
        amountInput.focus();
      });
    }

    const selectAll = form.querySelector('[data-bulk-all]');
    if (selectAll instanceof HTMLInputElement) {
      selectAll.addEventListener('change', () => {
        for (const item of items()) item.checked = selectAll.checked;
        closeConfirm();
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
        closeConfirm();
        paint();
      });
    }

    amountInput.addEventListener('input', () => {
      closeConfirm();
      paint();
    });

    confirmNo?.addEventListener('click', () => {
      closeConfirm();
      amountInput.focus();
    });

    confirmYes?.addEventListener('click', () => {
      confirmed = true;
      form.requestSubmit();
    });

    form.addEventListener('submit', (event) => {
      const amount = readAmount();
      if (amount === null || confirmed) return;
      if (amount > 0 && amount < CONFIRM_ABOVE) return;
      event.preventDefault();
      if (confirmBox && confirmText) {
        const verb = amount > 0 ? 'Menambah' : 'Mengurangi';
        const total = selected();
        const scope =
          balance === null ? ` untuk ${total} pengguna terpilih` : '';
        confirmText.textContent = `${verb} ${format(Math.abs(amount))} kredit${scope}.`;
        confirmBox.classList.remove('hidden');
        if (confirmYes instanceof HTMLElement) confirmYes.focus();
      }
    });

    paint();
  };

  for (const form of document.querySelectorAll('[data-credit-form]')) {
    if (form instanceof HTMLFormElement) init(form);
  }
})();
