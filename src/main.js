'use strict';

const path = require('node:path');
const { app, dialog, session } = require('electron');
const { ClientUpdater } = require('./client-updater');
const { DiscordPresence } = require('./discord-presence');
const { GameController } = require('./game-controller');
const { GameUpdater } = require('./game-updater');
const {
  WindowManager,
  configureSessionPermissions,
} = require('./window-manager');

app.enableSandbox();

const hasSingleInstanceLock = app.requestSingleInstanceLock();

let clientUpdater = null;
let discordPresence = null;
let gameController = null;
let windowManager = null;

function getSmokeTestMode() {
  const argument = process.argv.find((value) =>
    value.startsWith('--smoke-test='),
  );
  return argument?.slice('--smoke-test='.length) ?? null;
}

function attachSmokeTest(targetWindow, mode) {
  const timeout = setTimeout(() => {
    console.error(`Smoke test timed out while waiting for the ${mode} page`);
    app.exit(1);
  }, 3 * 60 * 1000);

  targetWindow.webContents.once('render-process-gone', (_event, details) => {
    console.error(
      `Smoke test renderer exited (${details.reason}, code ${details.exitCode})`,
    );
    clearTimeout(timeout);
    app.exit(1);
  });

  targetWindow.webContents.on('did-finish-load', async () => {
    if (windowManager.mode !== mode) {
      return;
    }

    if (mode === 'game') {
      try {
        await targetWindow.webContents.executeJavaScript(`(() => {
          if (typeof App !== 'function' || typeof Save !== 'function') {
            throw new Error('The game entry point is unavailable');
          }
          if (!App.game) {
            Save.key = 'electron-smoke-test';
            localStorage.removeItem('playerelectron-smoke-test');
            localStorage.removeItem('saveelectron-smoke-test');
            localStorage.removeItem('settingselectron-smoke-test');
            document.querySelector('#saveSelector')?.remove();
            App.start();
          }
        })()`);
      } catch (error) {
        console.error(`Unable to start the game smoke test: ${error.message}`);
        clearTimeout(timeout);
        app.exit(1);
        return;
      }
    }

    setTimeout(async () => {
      try {
        if (mode === 'game') {
          await targetWindow.webContents.executeJavaScript(
            `navigator.clipboard.writeText('PokéClicker clipboard smoke test')`,
            true,
          );
        }

        const rendererState = await targetWindow.webContents.executeJavaScript(`({
          appStarted: typeof App !== 'undefined' && Boolean(App.game),
          hasBody: Boolean(document.body),
          hasSetupStatus: Boolean(document.querySelector('#status')),
          nodeProcessType: typeof globalThis.process,
          nodeRequireType: typeof globalThis.require,
          readyState: document.readyState
        })`);
        const preferences = targetWindow.webContents.getLastWebPreferences();
        const rendererIsIsolated =
          preferences.contextIsolation === true &&
          preferences.nodeIntegration === false &&
          preferences.sandbox === true &&
          preferences.webSecurity === true &&
          rendererState.nodeProcessType === 'undefined' &&
          rendererState.nodeRequireType === 'undefined';
        const pageIsReady =
          rendererState.readyState === 'complete' &&
          rendererState.hasBody &&
          (mode === 'game'
            ? rendererState.appStarted
            : rendererState.hasSetupStatus);

        if (!rendererIsIsolated || !pageIsReady) {
          throw new Error(
            `Unexpected renderer state: ${JSON.stringify({ preferences, rendererState })}`,
          );
        }

        if (mode === 'game') {
          await targetWindow.webContents.executeJavaScript(`(() => {
            localStorage.removeItem('playerelectron-smoke-test');
            localStorage.removeItem('saveelectron-smoke-test');
            localStorage.removeItem('settingselectron-smoke-test');
          })()`);
        }

        console.info(
          `Smoke test passed: ${JSON.stringify({ mode, rendererState })}`,
        );
        clearTimeout(timeout);
        app.exit(0);
      } catch (error) {
        console.error(`Smoke test failed: ${error.stack || error.message}`);
        clearTimeout(timeout);
        app.exit(1);
      }
    }, mode === 'game' ? 5_000 : 100);
  });
}

async function bootstrap() {
  app.setAppUserModelId('pokeclicker.desktop');

  const gameUpdater = new GameUpdater({ userDataPath: app.getPath('userData') });
  const smokeTestMode = getSmokeTestMode();
  if (smokeTestMode && !['game', 'setup'].includes(smokeTestMode)) {
    throw new Error(`Unknown smoke test mode: ${smokeTestMode}`);
  }
  const installedVersion =
    smokeTestMode === 'setup' ? null : await gameUpdater.getInstalledVersion();
  const setupIndexPath = path.join(
    __dirname,
    'pokeclicker-master',
    'docs',
    'index.html',
  );

  windowManager = new WindowManager({
    clientVersion: app.getVersion(),
    gameIndexPath: gameUpdater.paths.index,
    setupIndexPath,
  });
  configureSessionPermissions(session.defaultSession, windowManager.allowedRoots);
  windowManager.mode =
    smokeTestMode === 'setup' ? 'setup' : installedVersion ? 'game' : 'setup';
  const primaryWindow = windowManager.createWindow();

  if (smokeTestMode) {
    attachSmokeTest(primaryWindow, smokeTestMode);
  }
  if (smokeTestMode === 'setup') {
    return;
  }

  gameController = new GameController({
    app,
    dialog,
    updater: gameUpdater,
    windowManager,
  });
  discordPresence = new DiscordPresence({
    getMainWindow: () => windowManager?.getPrimaryWindow(),
  });
  clientUpdater = new ClientUpdater({
    app,
    dialog,
    getMainWindow: () => windowManager?.getPrimaryWindow(),
  });

  if (!smokeTestMode) {
    discordPresence.start();
    clientUpdater.start();
  }
  await gameController.start(installedVersion);
}

if (!hasSingleInstanceLock) {
  app.quit();
} else {
  app.on('second-instance', () => {
    if (!windowManager) {
      return;
    }
    windowManager.focusPrimaryWindow();
    windowManager.createWindow({ alternate: true });
  });

  app.on('activate', () => {
    if (windowManager && windowManager.getWindows().length === 0) {
      windowManager.createWindow();
    }
  });

  app.on('window-all-closed', () => {
    if (process.platform !== 'darwin') {
      app.quit();
    }
  });

  app.on('before-quit', () => {
    clientUpdater?.stop();
    discordPresence?.stop();
    gameController?.stop();
  });

  app.whenReady().then(bootstrap).catch((error) => {
    console.error('Unable to start PokéClicker Desktop:', error);
    dialog.showErrorBox(
      'PokéClicker Desktop could not start',
      error.stack || error.message,
    );
    app.exit(1);
  });
}
