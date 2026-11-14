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

  paint();
})();
