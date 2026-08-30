const heading = document.querySelector('#heading');
const status = document.querySelector('#status');
const detail = document.querySelector('#detail');
const progressTrack = document.querySelector('#progress-track');
const progressBar = document.querySelector('#progress-bar');
const retry = document.querySelector('#retry');

window.__setInstallProgress = ({ phase, message, downloaded, total }) => {
  heading.textContent = phase === 'error' ? 'Setup needs your attention' : 'Preparing your game';
  status.textContent = message;
  retry.hidden = phase !== 'error';

  if (phase === 'error') {
    progressTrack.classList.add('is-error');
    progressTrack.setAttribute('aria-hidden', 'true');
    detail.textContent = 'Your existing game data was not changed.';
    return;
  }

  progressTrack.classList.remove('is-error');

  if (typeof total === 'number' && total > 0) {
    const percentage = Math.min(100, Math.round((downloaded / total) * 100));
    progressTrack.classList.remove('is-indeterminate');
    progressTrack.setAttribute('aria-hidden', 'false');
    progressTrack.setAttribute('role', 'progressbar');
    progressTrack.setAttribute('aria-valuemin', '0');
    progressTrack.setAttribute('aria-valuemax', '100');
    progressTrack.setAttribute('aria-valuenow', String(percentage));
    progressBar.style.width = `${percentage}%`;
    detail.textContent = `${formatBytes(downloaded)} of ${formatBytes(total)}`;
  } else if (typeof downloaded === 'number') {
    progressTrack.setAttribute('aria-hidden', 'false');
    progressTrack.removeAttribute('role');
    progressTrack.classList.add('is-indeterminate');
    detail.textContent = `${formatBytes(downloaded)} downloaded`;
  } else {
    progressTrack.classList.remove('is-indeterminate');
    progressBar.style.width = phase === 'ready' ? '100%' : '12%';
    detail.textContent = phase === 'extracting'
      ? 'Installing into an isolated staging directory…'
      : 'The first launch downloads the game for offline play.';
  }
};

retry.addEventListener('click', () => {
  retry.hidden = true;
  progressTrack.classList.remove('is-error');
  status.textContent = 'Retrying…';
  window.location.assign('pokeclicker-action://retry');
});

function formatBytes(bytes) {
  if (bytes < 1024 * 1024) {
    return `${(bytes / 1024).toFixed(1)} KB`;
  }
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}
