'use strict';

const MIN_ZOOM = 0.5;
const MAX_ZOOM = 3;
const ZOOM_STEP = 0.1;

function clampZoom(zoomFactor) {
  return Math.min(MAX_ZOOM, Math.max(MIN_ZOOM, zoomFactor));
}

function roundZoom(zoomFactor) {
  return Math.round(zoomFactor * 10) / 10;
}

function nextZoomFactor(currentZoom, direction) {
  if (direction === 'reset') {
    return 1;
  }

  const delta = direction === 'in' ? ZOOM_STEP : -ZOOM_STEP;
  return clampZoom(roundZoom(currentZoom + delta));
}

function getKeyboardZoomDirection(input) {
  if (input.type !== 'keyDown' || (!input.control && !input.meta)) {
    return null;
  }

  if (input.key === '+' || input.key === '=' || input.code === 'NumpadAdd') {
    return 'in';
  }
  if (input.key === '-' || input.code === 'NumpadSubtract') {
    return 'out';
  }
  if (input.key === '0' || input.code === 'Numpad0') {
    return 'reset';
  }

  return null;
}

function installZoomControls(targetWindow) {
  targetWindow.webContents.on('before-input-event', (event, input) => {
    const direction = getKeyboardZoomDirection(input);
    if (direction === null) {
      return;
    }

    const currentZoom = targetWindow.webContents.getZoomFactor();
    targetWindow.webContents.setZoomFactor(
      nextZoomFactor(currentZoom, direction),
    );
    event.preventDefault();
  });

  targetWindow.webContents.on('zoom-changed', (event, direction) => {
    if (direction !== 'in' && direction !== 'out') {
      return;
    }

    const currentZoom = targetWindow.webContents.getZoomFactor();
    targetWindow.webContents.setZoomFactor(
      nextZoomFactor(currentZoom, direction),
    );
    event.preventDefault();
  });
}

module.exports = {
  MAX_ZOOM,
  MIN_ZOOM,
  getKeyboardZoomDirection,
  installZoomControls,
  nextZoomFactor,
};
