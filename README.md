# PokéClicker Desktop

A cross-platform desktop client for [PokéClicker](https://www.pokeclicker.com/).

[![total downloads](https://img.shields.io/github/downloads/RedSparr0w/Pokeclicker-Desktop/total?label=total%20downloads&style=flat-square) ![latest release downloads](https://img.shields.io/github/downloads/RedSparr0w/Pokeclicker-Desktop/latest/total?style=flat-square)](https://github.com/RedSparr0w/Pokeclicker-desktop/releases/latest)

## Features

- Windows, macOS, and Linux packages from one Electron codebase
- Offline play after the first-run game download
- Automatic game and desktop-client update checks
- Customizable Discord Rich Presence
- Native keyboard and trackpad zoom controls
- Restores window size and display mode, plus placement where supported
- Multiple game windows by launching the client a second time
- Sandboxed game renderer with no Node.js access

![PokéClicker Desktop](https://i.imgur.com/5QQfoiZ.png)

## Install

Download the latest package from [GitHub Releases](https://github.com/RedSparr0w/Pokeclicker-desktop/releases/latest):

- **Windows:** use the x64 setup executable for a normal per-user installation, or the portable executable. Administrator access is not required.
- **macOS:** use the x64 DMG on Intel Macs or the arm64 DMG on Apple Silicon Macs.
- **Linux:** use the AppImage on most distributions, the `.deb` on Debian or Ubuntu, or the `.rpm` on Fedora and related distributions.

The first launch downloads the current PokéClicker game files. After that, the game can start offline. Unsigned development or CI packages may trigger the operating system's usual unverified-developer warning.

For a Linux AppImage, make the download executable before launching it:

```sh
chmod +x pokeclicker-desktop-*.AppImage
./pokeclicker-desktop-*.AppImage
```

## Saves

The client uses PokéClicker's existing save format and does not rewrite save data. Updating or replacing the desktop wrapper does not make a save dependent on this branch. Existing Electron profile data is retained across client upgrades; browser or other-client saves can be moved with PokéClicker's built-in export and import buttons.

Keep occasional exported backups, just as you would when playing in a browser.

## Controls

- `Ctrl`/`Cmd` + `+`: zoom in
- `Ctrl`/`Cmd` + `-`: zoom out
- `Ctrl`/`Cmd` + `0`: reset zoom
- Trackpad pinch: zoom in or out

## Development

Node.js 24 and npm are the native development toolchain:

```sh
npm ci
npm run check
npm start
```

Linux development can instead run entirely in Docker, without installing Node.js on the host:

```sh
./scripts/dev.sh install
./scripts/dev.sh check
./scripts/dev.sh dev
./scripts/dev.sh package
```

The Docker commands cache npm and Electron downloads under `.cache/`. `package` produces unsigned x64 AppImage, `.deb`, and `.rpm` files in `dist/`. Windows and macOS packages are built on their native GitHub Actions runners.

Useful native packaging commands are:

```sh
npm run dist:linux -- --x64
npm run dist:windows -- --x64
npm run dist:macos -- --x64
npm run dist:macos -- --arm64
```

## Security model

Downloaded game code runs in an Electron sandbox with context isolation, web security, and no Node.js integration. Navigation outside the installed game is handed to the default browser, permissions are restricted, updates are streamed with size limits, and archives are extracted into a staging directory with path and entry validation before an atomic swap.
