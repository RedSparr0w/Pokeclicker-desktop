'use strict';

const path = require('node:path');
const { pathToFileURL } = require('node:url');
const { BrowserWindow, shell } = require('electron');
const {
  isAllowedFileUrl,
  isSafeExternalUrl,
} = require('./path-policy');
const { installZoomControls } = require('./zoom');

function createWindowOptions({ alternate, iconPath, persistenceName }) {
  return {
    autoHideMenuBar: true,
    backgroundColor: '#111827',
    height: 800,
    icon: iconPath,
    minHeight: 480,
    minWidth: 640,
    name: persistenceName,
    show: false,
    title: alternate ? 'PokéClicker (alternate)' : 'PokéClicker',
    width: 1280,
    windowStatePersistence: true,
    webPreferences: {
      allowRunningInsecureContent: false,
      backgroundThrottling: false,
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      spellcheck: false,
      webSecurity: true,
      webviewTag: false,
    },
  };
}

class WindowManager {
  constructor({ clientVersion, gameIndexPath, setupIndexPath }) {
    this.allowedRoots = [
      path.dirname(gameIndexPath),
      path.dirname(setupIndexPath),
    ];
    this.clientVersion = clientVersion;
    this.gameIndexPath = gameIndexPath;
    this.iconPath = path.join(__dirname, 'icon.png');
    this.mainWindow = null;
    this.mode = 'setup';
    this.nextAlternateWindowId = 1;
    this.setupIndexPath = setupIndexPath;
    this.windows = new Set();
  }

  createWindow({ alternate = false } = {}) {
    const persistenceName = alternate
      ? `pokeclicker-alternate-${this.nextAlternateWindowId++}`
      : 'pokeclicker-main';
    const targetWindow = new BrowserWindow(
      createWindowOptions({
        alternate,
        iconPath: this.iconPath,
        persistenceName,
      }),
    );

    this.windows.add(targetWindow);
    if (!alternate || !this.mainWindow) {
      this.mainWindow = targetWindow;
    }

    this.configureWindow(targetWindow);
    void this.loadCurrentMode(targetWindow);
    return targetWindow;
  }

  configureWindow(targetWindow) {
    const { webContents } = targetWindow;

    installZoomControls(targetWindow);

    targetWindow.once('ready-to-show', () => {
      if (!targetWindow.isDestroyed()) {
        targetWindow.show();
      }
    });

    targetWindow.on('page-title-updated', (event) => {
      event.preventDefault();
    });

    targetWindow.on('closed', () => {
      this.windows.delete(targetWindow);
      if (this.mainWindow === targetWindow) {
        this.mainWindow = this.getFirstWindow();
      }
    });

    targetWindow.on('unresponsive', () => {
      console.warn('A PokéClicker window became unresponsive');
    });

    webContents.on('will-attach-webview', (event) => {
      event.preventDefault();
    });

    webContents.on('will-navigate', (event, navigationUrl) => {
      if (isAllowedFileUrl(navigationUrl, this.allowedRoots)) {
        return;
      }

      event.preventDefault();
      this.openExternal(navigationUrl);
    });

    webContents.setWindowOpenHandler(({ url }) => {
      this.openExternal(url);
      return { action: 'deny' };
    });

    webContents.on('did-finish-load', () => {
      if (!isAllowedFileUrl(webContents.getURL(), [path.dirname(this.gameIndexPath)])) {
        return;
      }

      const versionLiteral = JSON.stringify(this.clientVersion);
      void webContents
        .executeJavaScript(
          `if (typeof DiscordRichPresence !== 'undefined') { DiscordRichPresence.clientVersion = ${versionLiteral}; }`,
        )
        .catch(() => {});
    });

    webContents.on('render-process-gone', (_event, details) => {
      console.error(`Game renderer exited (${details.reason})`);
    });

    webContents.on('console-message', (details) => {
      if (details.level !== 'error') {
        return;
      }

      const location = details.sourceId
        ? ` (${details.sourceId}:${details.lineNumber})`
        : '';
      console.error(`Renderer error: ${details.message}${location}`);
    });
  }

  openExternal(targetUrl) {
    if (!isSafeExternalUrl(targetUrl)) {
      return;
    }

    void shell.openExternal(targetUrl).catch((error) => {
      console.warn(`Unable to open external URL ${targetUrl}:`, error);
    });
  }

  getFirstWindow() {
    for (const targetWindow of this.windows) {
      if (!targetWindow.isDestroyed()) {
        return targetWindow;
      }
    }
    return null;
  }

  getPrimaryWindow() {
    if (this.mainWindow && !this.mainWindow.isDestroyed()) {
      return this.mainWindow;
    }
    return this.getFirstWindow();
  }

  getWindows() {
    return [...this.windows].filter(
      (targetWindow) => !targetWindow.isDestroyed(),
    );
  }

  focusPrimaryWindow() {
    const targetWindow = this.getPrimaryWindow();
    if (!targetWindow) {
      return false;
    }
    if (targetWindow.isMinimized()) {
      targetWindow.restore();
    }
    targetWindow.show();
    targetWindow.focus();
    return true;
  }

  async loadCurrentMode(targetWindow) {
    const targetPath =
      this.mode === 'game' ? this.gameIndexPath : this.setupIndexPath;
    try {
      await targetWindow.loadURL(pathToFileURL(targetPath).href);
    } catch (error) {
      if (!targetWindow.isDestroyed()) {
        console.error(`Unable to load ${targetPath}:`, error);
      }
    }
  }

  async setMode(mode) {
    this.mode = mode;
    await Promise.all(this.getWindows().map((window) => this.loadCurrentMode(window)));
  }

  loadGame() {
    return this.setMode('game');
  }

  loadSetup() {
    return this.setMode('setup');
  }

  reloadGame() {
    return this.loadGame();
  }

  setProgress(progress) {
    for (const targetWindow of this.getWindows()) {
      targetWindow.setProgressBar(progress);
    }
  }

  sendSetupStatus(message, progress = null, detail = '') {
    const args = [message, progress, detail]
      .map((value) => JSON.stringify(value))
      .join(',');

    for (const targetWindow of this.getWindows()) {
      const { webContents } = targetWindow;
      if (
        !isAllowedFileUrl(webContents.getURL(), [
          path.dirname(this.setupIndexPath),
        ])
      ) {
        continue;
      }
      void webContents
        .executeJavaScript(`globalThis.setStatus?.(${args})`)
        .catch(() => {});
    }
  }
}

function configureSessionPermissions(electronSession, allowedRoots) {
  const allowedPermissions = new Set([
    'clipboard-sanitized-write',
    'notifications',
  ]);
  const canUsePermission = (webContents, permission) =>
    allowedPermissions.has(permission) &&
    Boolean(webContents) &&
    isAllowedFileUrl(webContents.getURL(), allowedRoots);

  electronSession.setPermissionCheckHandler((webContents, permission) =>
    canUsePermission(webContents, permission),
  );
  electronSession.setPermissionRequestHandler(
    (webContents, permission, callback) => {
      callback(canUsePermission(webContents, permission));
    },
  );
}

module.exports = {
  WindowManager,
  configureSessionPermissions,
  createWindowOptions,
};
