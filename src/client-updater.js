'use strict';

const { autoUpdater } = require('electron-updater');

const FIRST_CHECK_DELAY_MS = 10_000;

class ClientUpdater {
  constructor({ app, dialog, getMainWindow }) {
    this.app = app;
    this.dialog = dialog;
    this.getMainWindow = getMainWindow;
    this.promptOpen = false;
    this.timer = null;
  }

  start() {
    if (!this.app.isPackaged || process.env.POKECLICKER_DISABLE_CLIENT_UPDATES) {
      return;
    }

    autoUpdater.autoDownload = true;
    autoUpdater.autoInstallOnAppQuit = true;
    autoUpdater.on('error', (error) => {
      console.warn(`Unable to update the desktop client: ${error.message}`);
    });
    autoUpdater.on('update-downloaded', (updateInfo) => {
      void this.promptToRestart(updateInfo.version).catch((error) => {
        console.warn(`Unable to show the update prompt: ${error.message}`);
      });
    });

    this.timer = setTimeout(() => {
      autoUpdater.checkForUpdatesAndNotify().catch((error) => {
        console.warn(`Unable to check for desktop client updates: ${error.message}`);
      });
    }, FIRST_CHECK_DELAY_MS);
    this.timer.unref?.();
  }

  async promptToRestart(version) {
    if (this.promptOpen) {
      return;
    }

    this.promptOpen = true;
    try {
      const options = {
        buttons: ['Restart now', 'Later'],
        cancelId: 1,
        defaultId: 0,
        detail: 'The update will also install automatically when you quit.',
        message: `PokéClicker Desktop ${version} is ready to install.`,
        noLink: true,
        title: 'Desktop update ready',
        type: 'info',
      };
      const mainWindow = this.getMainWindow();
      const { response } = mainWindow
        ? await this.dialog.showMessageBox(mainWindow, options)
        : await this.dialog.showMessageBox(options);

      if (response === 0) {
        autoUpdater.quitAndInstall(false, true);
      }
    } finally {
      this.promptOpen = false;
    }
  }

  stop() {
    if (this.timer) {
      clearTimeout(this.timer);
      this.timer = null;
    }
  }
}

module.exports = { ClientUpdater };
