'use strict';

const { isNewerVersion } = require('./game-updater');

const FIRST_UPDATE_CHECK_DELAY_MS = 10_000;
const UPDATE_CHECK_INTERVAL_MS = 60 * 60 * 1000;

function formatMegabytes(bytes) {
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
}

class GameController {
  constructor({ app, dialog, updater, windowManager }) {
    this.app = app;
    this.checkInProgress = false;
    this.currentVersion = null;
    this.dialog = dialog;
    this.stopped = false;
    this.updateChecksDisabled = false;
    this.updateTimer = null;
    this.updater = updater;
    this.windowManager = windowManager;
  }

  async start(installedVersion = undefined) {
    this.currentVersion =
      installedVersion === undefined
        ? await this.updater.getInstalledVersion()
        : installedVersion;

    if (this.currentVersion) {
      if (this.windowManager.mode !== 'game') {
        await this.windowManager.loadGame();
      }
    } else {
      if (this.windowManager.mode !== 'setup') {
        await this.windowManager.loadSetup();
      }
      const installed = await this.installInitialGame();
      if (!installed) {
        return;
      }
    }

    this.scheduleUpdateCheck(FIRST_UPDATE_CHECK_DELAY_MS);
  }

  stop() {
    this.stopped = true;
    if (this.updateTimer) {
      clearTimeout(this.updateTimer);
      this.updateTimer = null;
    }
  }

  async showMessage(options) {
    const parentWindow = this.windowManager.getPrimaryWindow();
    if (parentWindow) {
      return this.dialog.showMessageBox(parentWindow, options);
    }
    return this.dialog.showMessageBox(options);
  }

  scheduleUpdateCheck(delayMs) {
    if (this.stopped || this.updateChecksDisabled) {
      return;
    }

    if (this.updateTimer) {
      clearTimeout(this.updateTimer);
    }
    this.updateTimer = setTimeout(async () => {
      try {
        await this.checkForUpdate();
      } finally {
        this.scheduleUpdateCheck(UPDATE_CHECK_INTERVAL_MS);
      }
    }, delayMs);
    this.updateTimer.unref?.();
  }

  async installInitialGame() {
    while (!this.stopped) {
      try {
        this.currentVersion = await this.installGame();
        await this.windowManager.loadGame();
        return true;
      } catch (error) {
        console.error('Unable to install PokéClicker:', error);
        this.windowManager.setProgress(-1);
        this.windowManager.sendSetupStatus(
          'The download could not be completed.',
          null,
          error.message,
        );

        const { response } = await this.showMessage({
          buttons: ['Retry', 'Quit'],
          cancelId: 1,
          defaultId: 0,
          detail: error.message,
          message: 'PokéClicker could not be downloaded or installed.',
          noLink: true,
          title: 'Initial setup failed',
          type: 'error',
        });
        if (response !== 0) {
          this.app.quit();
          return false;
        }
      }
    }
    return false;
  }

  async installGame() {
    try {
      return await this.updater.install({
        onProgress: (progress) => this.reportInstallProgress(progress),
        onWarning: (message, error) => console.warn(message, error),
      });
    } finally {
      this.windowManager.setProgress(-1);
    }
  }

  reportInstallProgress(progress) {
    switch (progress.phase) {
      case 'download': {
        const downloadedBytes = progress.downloadedBytes ?? 0;
        const totalBytes = progress.totalBytes ?? null;
        const ratio = totalBytes ? downloadedBytes / totalBytes : 2;
        this.windowManager.setProgress(ratio);
        this.windowManager.sendSetupStatus(
          'Downloading PokéClicker…',
          totalBytes ? Math.round(ratio * 100) : null,
          totalBytes
            ? `${formatMegabytes(downloadedBytes)} of ${formatMegabytes(totalBytes)}`
            : formatMegabytes(downloadedBytes),
        );
        break;
      }
      case 'extract':
        this.windowManager.setProgress(2);
        this.windowManager.sendSetupStatus(
          'Extracting game files…',
          null,
          progress.extractedFiles
            ? `${progress.extractedFiles.toLocaleString()} files`
            : '',
        );
        break;
      case 'validate':
        this.windowManager.setProgress(2);
        this.windowManager.sendSetupStatus('Verifying the download…');
        break;
      case 'install':
        this.windowManager.setProgress(2);
        this.windowManager.sendSetupStatus('Installing the update…');
        break;
      case 'complete':
        this.windowManager.setProgress(-1);
        this.windowManager.sendSetupStatus('Ready to play.', 100);
        break;
      default:
        break;
    }
  }

  async checkForUpdate() {
    if (
      this.checkInProgress ||
      this.stopped ||
      this.updateChecksDisabled ||
      !this.currentVersion
    ) {
      return;
    }

    this.checkInProgress = true;
    try {
      const latestVersion = await this.updater.getLatestVersion();
      if (!isNewerVersion(latestVersion, this.currentVersion)) {
        return;
      }

      const { response } = await this.showMessage({
        buttons: ['Update now', 'Remind me later', "Don't ask again"],
        cancelId: 1,
        defaultId: 0,
        detail: 'The game remains available offline after the update.',
        message: `PokéClicker ${latestVersion} is available.`,
        noLink: true,
        title: 'Game update available',
        type: 'info',
      });

      if (response === 2) {
        this.updateChecksDisabled = true;
        return;
      }
      if (response !== 0) {
        return;
      }

      await this.installAvailableUpdate(latestVersion);
    } catch (error) {
      console.info(`Unable to check for PokéClicker updates: ${error.message}`);
    } finally {
      this.checkInProgress = false;
    }
  }

  async installAvailableUpdate(expectedVersion) {
    while (!this.stopped) {
      try {
        const installedVersion = await this.installGame();
        this.currentVersion = installedVersion;

        const { response } = await this.showMessage({
          buttons: ['Reload now', 'Later'],
          cancelId: 1,
          defaultId: 0,
          detail:
            installedVersion === expectedVersion
              ? undefined
              : `The downloaded branch currently reports version ${installedVersion}.`,
          message: `PokéClicker ${installedVersion} was installed successfully.`,
          noLink: true,
          title: 'Game update installed',
          type: 'info',
        });
        if (response === 0) {
          await this.windowManager.reloadGame();
        }
        return;
      } catch (error) {
        console.error('Unable to update PokéClicker:', error);
        const { response } = await this.showMessage({
          buttons: ['Retry', 'Later'],
          cancelId: 1,
          defaultId: 0,
          detail: error.message,
          message: 'The game update could not be installed.',
          noLink: true,
          title: 'Game update failed',
          type: 'error',
        });
        if (response !== 0) {
          return;
        }
      }
    }
  }
}

module.exports = {
  GameController,
  formatMegabytes,
};
