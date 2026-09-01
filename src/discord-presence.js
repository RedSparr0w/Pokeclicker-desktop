'use strict';

const DiscordRPC = require('discord-rpc');

const DISCORD_CLIENT_ID = '733927271726841887';
const UPDATE_INTERVAL_MS = 15_000;

function truncate(value, fallback = undefined) {
  if (typeof value !== 'string') {
    return fallback;
  }
  const normalized = value.trim();
  return normalized.length > 1 ? normalized.slice(0, 128) : fallback;
}

function buildActivity(discordData) {
  const activity = {
    details: truncate(discordData.line1, '--'),
    instance: true,
    state: truncate(discordData.line2, '--'),
  };

  if (Number.isFinite(discordData.startTimestamp)) {
    activity.startTimestamp = discordData.startTimestamp;
  }

  const largeImageKey = truncate(discordData.largeImageKey);
  const largeImageText = truncate(discordData.largeImageText);
  const smallImageKey = truncate(discordData.smallImageKey);
  const smallImageText = truncate(discordData.smallImageText);

  if (largeImageKey) {
    activity.largeImageKey = largeImageKey;
  }
  if (largeImageKey && largeImageText) {
    activity.largeImageText = largeImageText;
  }
  if (smallImageKey) {
    activity.smallImageKey = smallImageKey;
  }
  if (smallImageKey && smallImageText) {
    activity.smallImageText = smallImageText;
  }

  return activity;
}

class DiscordPresence {
  constructor({ getMainWindow }) {
    this.client = null;
    this.getMainWindow = getMainWindow;
    this.interval = null;
    this.updateInFlight = false;
  }

  start() {
    if (this.client) {
      return;
    }

    try {
      DiscordRPC.register(DISCORD_CLIENT_ID);
      this.client = new DiscordRPC.Client({ transport: 'ipc' });
      this.client.on('ready', () => {
        void this.update();
        if (this.interval) {
          clearInterval(this.interval);
        }
        this.interval = setInterval(() => {
          void this.update();
        }, UPDATE_INTERVAL_MS);
      });
      this.client.login({ clientId: DISCORD_CLIENT_ID }).catch((error) => {
        console.info(`Discord Rich Presence is unavailable: ${error.message}`);
      });
    } catch (error) {
      console.info(`Discord Rich Presence is unavailable: ${error.message}`);
      this.client = null;
    }
  }

  async update() {
    const mainWindow = this.getMainWindow();
    if (
      this.updateInFlight ||
      !this.client ||
      !mainWindow ||
      mainWindow.isDestroyed()
    ) {
      return;
    }

    this.updateInFlight = true;
    try {
      const discordData = await mainWindow.webContents.executeJavaScript(
        `typeof DiscordRichPresence !== 'undefined'
          ? DiscordRichPresence.getRichPresenceData?.() ?? null
          : null`,
      );
      if (!discordData || typeof discordData !== 'object') {
        return;
      }

      if (!discordData.enabled) {
        await this.client.clearActivity();
        return;
      }

      await this.client.setActivity(buildActivity(discordData));
    } catch (error) {
      console.warn(`Could not update Discord Rich Presence: ${error.message}`);
    } finally {
      this.updateInFlight = false;
    }
  }

  stop() {
    if (this.interval) {
      clearInterval(this.interval);
      this.interval = null;
    }
    if (this.client) {
      const client = this.client;
      this.client = null;
      try {
        Promise.resolve(client.destroy()).catch(() => {});
      } catch {
        // Discord may already have closed its IPC transport.
      }
    }
  }
}

module.exports = {
  DiscordPresence,
  buildActivity,
};
