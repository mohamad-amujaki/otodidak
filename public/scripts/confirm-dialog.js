(() => {
  const dialog = document.getElementById('konfirmasi');

  if (
    !(dialog instanceof HTMLDialogElement) ||
    typeof dialog.showModal !== 'function'
  ) {
    // Browser lama: tetap konfirmasi sebelum submit agar aksi tidak lolos diam-diam.
    document.addEventListener(
      'submit',
      (event) => {
        const form = event.target;
        if (!(form instanceof HTMLFormElement)) return;
        const submitter = event.submitter;
        const message =
          (submitter instanceof HTMLElement ? submitter.dataset.confirm : '') ||
          form.dataset.confirm;
        if (message && !window.confirm(message)) event.preventDefault();
      },
      true,
    );
    return;
  }

  const pick = (selector) => dialog.querySelector(selector);
  const titleEl = pick('[data-konfirmasi-judul]');
  const detailEl = pick('[data-konfirmasi-detail]');
  const costWrap = pick('[data-konfirmasi-biaya]');
  const costEl = pick('[data-konfirmasi-cost]');
  const balanceEl = pick('[data-konfirmasi-saldo]');
  const impactEl = pick('[data-konfirmasi-dampak]');
  const warnEl = pick('[data-konfirmasi-peringatan]');
  const iconEl = pick('[data-konfirmasi-ikon]');
  const cancelBtn = pick('[data-konfirmasi-batal]');
  const actionBtn = pick('[data-konfirmasi-aksi]');
  const closeBtn = pick('[data-konfirmasi-tutup]');

  let pending = null;
  let lastTrigger = null;

  const format = (value) => value.toLocaleString('id-ID');
  const setText = (element, text) => {
    if (!(element instanceof HTMLElement)) return;
    element.textContent = text;
    element.hidden = !text;
  };

  const open = (trigger, job) => {
    const data = trigger.dataset;
    pending = job;
    lastTrigger = trigger;

    setText(titleEl, data.confirm || 'Konfirmasi');
    setText(detailEl, data.confirmDetail || '');
    setText(impactEl, data.confirmImpact || '');

    const cost = Number(data.confirmCost);
    const balance = Number(data.confirmBalance);
    const hasCost = Number.isFinite(cost) && cost > 0;
    if (costWrap instanceof HTMLElement) costWrap.hidden = !hasCost;
    if (hasCost) {
      setText(costEl, `${format(cost)} kredit`);
      const hasBalance = Number.isFinite(balance);
      setText(
        balanceEl,
        hasBalance ? `${format(balance)} → ${format(balance - cost)}` : '—',
      );
      const drained = hasBalance && balance - cost <= 0;
      setText(warnEl, drained ? 'Sisa saldo setelah ini: 0 kredit.' : '');
    } else {
      setText(warnEl, '');
    }

    const danger = data.confirmKind === 'danger';
    if (actionBtn instanceof HTMLElement) {
      actionBtn.textContent =
        data.confirmLabel || (danger ? 'Hapus' : 'Lanjutkan');
      actionBtn.classList.toggle('bg-jalur', !danger);
      actionBtn.classList.toggle('bg-bahaya', danger);
    }
    if (iconEl instanceof HTMLElement) {
      iconEl.classList.toggle('bg-jalur-lembut', !danger);
      iconEl.classList.toggle('text-jalur', !danger);
      iconEl.classList.toggle('bg-bahaya/10', danger);
      iconEl.classList.toggle('text-bahaya', danger);
    }

    dialog.showModal();
    const safe = cancelBtn instanceof HTMLElement ? cancelBtn : actionBtn;
    if (safe instanceof HTMLElement) safe.focus();
  };

  const close = () => {
    pending = null;
    if (dialog.open) dialog.close();
  };

  const confirm = () => {
    const job = pending;
    pending = null;
    dialog.close();
    if (!job) return;
    if (job.kind === 'link') {
      window.location.assign(job.href);
      return;
    }
    const submitter =
      job.submitter instanceof HTMLElement ? job.submitter : undefined;
    job.form.dataset.confirmBypass = '1';
    job.form.requestSubmit(submitter);
    for (const button of job.form.querySelectorAll('button')) {
      if (button instanceof HTMLButtonElement) button.disabled = true;
    }
  };

  document.addEventListener(
    'submit',
    (event) => {
      const form = event.target;
      if (!(form instanceof HTMLFormElement)) return;
      if (form.dataset.confirmBypass === '1') {
        delete form.dataset.confirmBypass;
        return;
      }
      const submitter = event.submitter;
      const message =
        (submitter instanceof HTMLElement ? submitter.dataset.confirm : '') ||
        form.dataset.confirm;
      if (!message) return;
      if (!supported) {
        if (!window.confirm(message)) event.preventDefault();
        return;
      }
      event.preventDefault();
      const trigger =
        submitter instanceof HTMLElement && submitter.dataset.confirm
          ? submitter
          : form;
      open(trigger, { kind: 'form', form, submitter });
    },
    true,
  );

  document.addEventListener('click', (event) => {
    const target = event.target;
    if (!(target instanceof Element)) return;
    const link = target.closest('a[data-confirm]');
    if (!(link instanceof HTMLAnchorElement) || link.closest('form')) return;
    const href = link.getAttribute('href');
    if (!href) return;
    if (!supported) {
      if (!window.confirm(link.dataset.confirm ?? '')) event.preventDefault();
      return;
    }
    event.preventDefault();
    open(link, { kind: 'link', href });
  });

  cancelBtn?.addEventListener('click', close);
  closeBtn?.addEventListener('click', close);
  actionBtn?.addEventListener('click', confirm);

  dialog.addEventListener('cancel', () => {
    pending = null;
  });
  dialog.addEventListener('close', () => {
    pending = null;
    if (lastTrigger instanceof HTMLElement) lastTrigger.focus();
  });
  dialog.addEventListener('click', (event) => {
    if (event.target === dialog) close();
  });
})();
