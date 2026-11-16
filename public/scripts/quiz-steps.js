(() => {
  const form = document.querySelector('[data-kuis]');
  if (!form) return;
  const sets = Array.prototype.filter.call(
    form.querySelectorAll('fieldset'),
    (node) => node instanceof HTMLFieldSetElement,
  );
  if (sets.length < 2) return;

  const stepper = form.querySelector('[data-quiz-stepper]');
  const counter = form.querySelector('[data-quiz-counter]');
  const dots = Array.from(form.querySelectorAll('[data-quiz-dot]'));
  const previous = form.querySelector('[data-sebelumnya]');
  const next = form.querySelector('[data-lanjut]');
  const send = form.querySelector('[data-kirim]');
  const actionBar = form.querySelector('[data-quiz-actions]');
  const mapButtons = Array.from(form.querySelectorAll('[data-quiz-jump]'));
  const answeredEl = form.querySelector('[data-quiz-answered]');
  let index = 0;

  const focusQuestion = () => {
    const target =
      sets[index]?.querySelector('[data-quiz-question]') ??
      sets[index]?.querySelector('legend');
    if (target instanceof HTMLElement) target.focus();
  };

  const paint = () => {
    sets.forEach((set, item) => {
      set.hidden = item !== index;
    });
    if (stepper) stepper.hidden = false;
    if (counter) counter.textContent = `Soal ${index + 1} dari ${sets.length}`;
    dots.forEach((dot, item) => {
      dot.classList.toggle('bg-jalur', item === index);
      dot.classList.toggle('bg-garis', item !== index);
      dot.classList.toggle('scale-125', item === index);
    });
    if (previous) previous.hidden = index === 0;
    if (next) next.hidden = index >= sets.length - 1;
    if (send) send.hidden = index < sets.length - 1;
    if (actionBar) actionBar.hidden = false;
    mapButtons.forEach((button, item) => {
      const isCurrent = item === index;
      const isAnswered = Boolean(sets[item]?.querySelector('input:checked'));
      button.classList.toggle('border-jalur', isCurrent || isAnswered);
      button.classList.toggle('bg-jalur-lembut', isCurrent);
      button.classList.toggle('text-jalur', isCurrent || isAnswered);
      button.classList.toggle('text-tinta-lembut', !isCurrent && !isAnswered);
      if (isCurrent) button.setAttribute('aria-current', 'true');
      else button.removeAttribute('aria-current');
    });
    if (answeredEl)
      answeredEl.textContent = String(
        sets.filter((set) => set.querySelector('input:checked')).length,
      );
  };

  const step = (direction) => {
    if (direction > 0) {
      const picked = sets[index]?.querySelector('input:checked');
      if (!picked) {
        const first = sets[index]?.querySelector('input');
        if (first) first.focus();
        return;
      }
    }
    index = Math.min(Math.max(index + direction, 0), sets.length - 1);
    paint();
    focusQuestion();
  };

  next?.addEventListener('click', () => step(1));
  previous?.addEventListener('click', () => step(-1));

  mapButtons.forEach((button) => {
    button.addEventListener('click', () => {
      const target = Number(button.getAttribute('data-quiz-jump'));
      if (!Number.isFinite(target)) return;
      index = Math.min(Math.max(target, 0), sets.length - 1);
      paint();
      focusQuestion();
    });
  });
  form.addEventListener('change', () => paint());

  document.addEventListener('keydown', (event) => {
    if (
      event.defaultPrevented ||
      event.metaKey ||
      event.ctrlKey ||
      event.altKey
    )
      return;
    const tag = event.target instanceof HTMLElement ? event.target.tagName : '';
    if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT') return;
    if (event.key === 'ArrowLeft') {
      event.preventDefault();
      step(-1);
    } else if (event.key === 'ArrowRight') {
      event.preventDefault();
      step(1);
    }
  });

  paint();
})();
