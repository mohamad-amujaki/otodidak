(() => {
  const root = document.querySelector('[data-admin-ai]');
  if (!root) return;

  const form = root.querySelector('[data-ai-form]');
  const textarea = root.querySelector('[data-prompt]');
  const counter = root.querySelector('[data-prompt-count]');
  const max = Number(root.dataset.promptMax ?? '8000');
  const taskCode = root.dataset.taskCode ?? '';
  const baselineModel = root.dataset.modelName ?? '';
  const baselineUrl = root.dataset.baseUrl ?? '';
  const dialog = root.querySelector('[data-ai-confirm-dialog]');
  const confirmInput = root.querySelector('[data-ai-confirm-input]');
  const confirmBtn = root.querySelector('[data-ai-confirm-go]');
  const confirmHint = root.querySelector('[data-ai-confirm-hint]');

  const formatCount = (len) =>
    `${len.toLocaleString('id-ID')} / ${max.toLocaleString('id-ID')} karakter`;

  const syncCounter = () => {
    if (!textarea || !counter) return;
    const len = textarea.value.length;
    counter.textContent = formatCount(len);
    const hot = len > max * 0.9;
    counter.classList.toggle('text-bahaya', hot);
    counter.classList.toggle('text-tinta-lembut', !hot);
  };

  const mirror = root.querySelector('[data-prompt-mirror]');
  const seedEl = root.querySelector('[data-prompt-seed]');
  const diffMeta = root.querySelector('[data-prompt-diff-meta]');

  const syncCompare = () => {
    if (!textarea || !mirror) return;
    mirror.textContent = textarea.value;
    if (!diffMeta || !seedEl) return;
    const current = textarea.value.trim();
    const seed = seedEl.textContent?.trim() ?? '';
    if (current === seed) {
      diffMeta.textContent = 'Identik dengan prompt bawaan.';
      diffMeta.classList.remove('text-bahaya');
      diffMeta.classList.add('text-jalur');
      return;
    }
    const delta = current.length - seed.length;
    const deltaLabel =
      delta === 0
        ? 'panjang sama'
        : delta > 0
          ? `${delta.toLocaleString('id-ID')} karakter lebih panjang`
          : `${Math.abs(delta).toLocaleString('id-ID')} karakter lebih pendek`;
    diffMeta.textContent = `Berbeda dari bawaan (${deltaLabel}).`;
    diffMeta.classList.remove('text-jalur');
    diffMeta.classList.add('text-bahaya');
  };

  const onPromptInput = () => {
    syncCounter();
    syncCompare();
  };

  textarea?.addEventListener('input', onPromptInput);
  syncCounter();
  syncCompare();

  const modelFieldsChanged = () => {
    if (!form) return false;
    const modelName = form.querySelector('[name="modelName"]')?.value ?? '';
    const baseUrl = form.querySelector('[name="baseUrl"]')?.value ?? '';
    return modelName !== baselineModel || baseUrl !== baselineUrl;
  };

  const resetDialog = () => {
    if (confirmInput) confirmInput.value = '';
    if (confirmBtn) confirmBtn.disabled = true;
  };

  confirmInput?.addEventListener('input', () => {
    if (!confirmBtn || !confirmInput) return;
    const ok = confirmInput.value.trim() === taskCode;
    confirmBtn.disabled = !ok;
    if (confirmHint) {
      confirmHint.hidden = ok;
    }
  });

  dialog?.addEventListener('close', () => {
    resetDialog();
  });

  confirmBtn?.addEventListener('click', () => {
    if (!form || confirmBtn.disabled) return;
    form.dataset.confirmed = '1';
    dialog?.close();
    form.requestSubmit();
  });

  form?.addEventListener('submit', (event) => {
    const submitter = event.submitter;
    if (
      submitter instanceof HTMLButtonElement &&
      submitter.name === 'aksi' &&
      submitter.value === 'reset-prompt'
    ) {
      return;
    }
    if (form.dataset.confirmed === '1') {
      delete form.dataset.confirmed;
      return;
    }
    if (!modelFieldsChanged() || !dialog) return;
    event.preventDefault();
    resetDialog();
    if (confirmHint) confirmHint.hidden = false;
    dialog.showModal();
  });
})();
