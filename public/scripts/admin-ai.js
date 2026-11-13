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

  textarea?.addEventListener('input', syncCounter);
  syncCounter();

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
