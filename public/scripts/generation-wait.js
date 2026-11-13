(() => {
  const roots = document.querySelectorAll('[data-generation-wait]');
  for (const root of roots) {
    const jobId = root.dataset.jobId || '';
    const intervalMs = Math.max(2, Number(root.dataset.interval || 4)) * 1000;
    const timeoutMs = Math.max(15, Number(root.dataset.timeout || 120)) * 1000;
    const doneHref = root.dataset.doneHref || window.location.href;
    const loading = root.querySelector('[data-wait-loading]');
    const failed = root.querySelector('[data-wait-failed]');
    const timeoutBox = root.querySelector('[data-wait-timeout]');
    const elapsedEl = root.querySelector('[data-elapsed]');
    const codeEl = root.querySelector('[data-wait-code]');
    const startedAt = Date.now();
    let finished = false;
    let elapsedTimer = 0;

    const stopTimer = () => {
      if (elapsedTimer) window.clearInterval(elapsedTimer);
      elapsedTimer = 0;
    };

    const goToDone = () => {
      if (finished) return;
      finished = true;
      stopTimer();
      window.location.assign(doneHref);
    };

    const showFailed = (code) => {
      if (finished) return;
      finished = true;
      stopTimer();
      root.setAttribute('aria-busy', 'false');
      if (loading) loading.hidden = true;
      if (failed) {
        failed.hidden = false;
        failed.classList.remove('hidden');
        failed.classList.add('flex');
      }
      if (codeEl) codeEl.textContent = code ? `Kode: ${code}` : '';
    };

    for (const button of root.querySelectorAll('[data-wait-reload]')) {
      button.addEventListener('click', () => window.location.reload());
    }

    elapsedTimer = window.setInterval(() => {
      if (finished) {
        stopTimer();
        return;
      }
      const seconds = Math.round((Date.now() - startedAt) / 1000);
      if (elapsedEl) elapsedEl.textContent = `${seconds} detik`;
      if (timeoutBox && Date.now() - startedAt >= timeoutMs) {
        timeoutBox.hidden = false;
        timeoutBox.classList.remove('hidden');
      }
    }, 1000);

    if (!jobId) {
      window.setTimeout(() => window.location.reload(), intervalMs);
      continue;
    }

    const poll = async () => {
      if (finished) return;
      try {
        const response = await fetch(`/api/jobs/${encodeURIComponent(jobId)}`, {
          headers: { accept: 'application/json' },
          cache: 'no-store',
        });
        if (response.status === 404) {
          showFailed();
          return;
        }
        if (!response.ok) throw new Error(String(response.status));
        const job = await response.json();
        if (job.status === 'succeeded') {
          goToDone();
          return;
        }
        if (job.status === 'failed') {
          showFailed(job.errorCode);
          return;
        }
      } catch {
        // gangguan jaringan sesaat: lanjutkan polling
      }
      if (!finished) window.setTimeout(poll, intervalMs);
    };

    window.setTimeout(poll, intervalMs);
  }
})();
