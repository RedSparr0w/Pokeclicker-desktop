'use strict';

(() => {
  const statusElement = document.querySelector('#status');
  const detailElement = document.querySelector('#detail');
  const progressTrack = document.querySelector('#progress-track');
  const progressBar = document.querySelector('#progress-bar');

  globalThis.setStatus = (message, progress = null, detail = '') => {
    statusElement.textContent = message;
    detailElement.textContent = detail;

    if (Number.isFinite(progress)) {
      const boundedProgress = Math.min(100, Math.max(0, progress));
      progressTrack.classList.remove('indeterminate');
      progressTrack.setAttribute('aria-valuenow', String(boundedProgress));
      progressBar.style.width = `${boundedProgress}%`;
    } else {
      progressTrack.classList.add('indeterminate');
      progressTrack.removeAttribute('aria-valuenow');
      progressBar.style.removeProperty('width');
    }
  };
})();
