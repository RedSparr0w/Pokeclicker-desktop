# PokéClicker Desktop

A lightweight, cross-platform desktop client for [PokéClicker](https://www.pokeclicker.com/), built with Tauri 2 for Linux, Windows, and macOS.

[![total downloads](https://img.shields.io/github/downloads/RedSparr0w/Pokeclicker-Desktop/total?label=total%20downloads&style=flat-square) ![downloads](https://img.shields.io/github/downloads/RedSparr0w/Pokeclicker-Desktop/latest/total?style=flat-square)](https://github.com/RedSparr0w/Pokeclicker-desktop/releases/latest)

## What it does

- Downloads the current official game on first launch and keeps it available offline.
- Checks for game updates in the background and swaps builds atomically, with rollback recovery.
- Imports local saves and settings from the legacy Electron profile once, without modifying it.
- Supports multiple game windows and Discord Rich Presence.
- Uses the operating system webview instead of shipping Chromium and Node.js with the app.
- Supports signed desktop-client updates for AppImage, Windows, and macOS release builds.

The old Electron runtime and bundled game snapshot have been removed. No Node.js toolchain is required.

## Development

The standard native workflow works on Linux, Windows, and macOS after installing the [official Tauri prerequisites](https://v2.tauri.app/start/prerequisites/), [`rustup`](https://rustup.rs/), and the pinned Tauri CLI:

```bash
rustup toolchain install 1.98.0 --profile minimal --component clippy,rustfmt
cargo install tauri-cli --version 2.11.4 --locked
cargo tauri dev
```

### Linux with Docker

Docker is the only host development dependency. The helper builds a pinned Rust 1.98 / Tauri 2.11 image and keeps compilation caches under `.cache/`.

```bash
./scripts/dev.sh check
./scripts/dev.sh dev
```

The first image build downloads the Linux webview development libraries, so it takes longer than later runs. The first app launch also downloads the current PokéClicker game. Later launches work from the local copy when offline.

If Docker reports a permission error after adding your account to the `docker` group, log out and back in or restart the machine so the new group membership reaches your session.

Useful commands:

| Command | Purpose |
| --- | --- |
| `./scripts/dev.sh check` | Check formatting, run strict Clippy, and run tests |
| `./scripts/dev.sh test` | Run the Rust test suite |
| `./scripts/dev.sh dev` | Launch the client on the host Linux desktop |
| `./scripts/dev.sh package` | Build unsigned DEB, RPM, and AppImage packages |
| `./scripts/dev.sh shell` | Open a shell in the development container |
| `./scripts/dev.sh run …` | Run an arbitrary command in the container |

Linux packages are written below `.cache/target/release/bundle/`. The Docker development profile stores its app data below `.cache/home/`; deleting that directory also deletes its development-only game download and webview data.

### Native Fedora dependencies

Docker is convenient on a fresh Fedora workstation. To use the native workflow instead, install the required system packages before running the cross-platform commands above:

```bash
sudo dnf group install "c-development"
sudo dnf install webkit2gtk4.1-devel openssl-devel curl wget file \
  libappindicator-gtk3-devel librsvg2-devel libxdo-devel
```

The repository's `rust-toolchain.toml` selects the expected Rust version after `rustup` is installed.

## Architecture

- `src-tauri/` contains the Rust application, native window lifecycle, safe game installer, private asset protocol, updater, and Discord integration.
- `ui/` is the small first-run and update interface bundled with the client.
- `docker/linux.Containerfile` and `scripts/dev.sh` provide the zero-host-tooling Linux workflow.
- `.github/workflows/` checks Linux, Windows, and macOS and builds native release artifacts on their respective operating systems.

Game files are downloaded into the platform application-data directory and served through a private `pokeclicker://` protocol. Requests are path-normalized and confined to the installed game directory; the game webview is not given a general-purpose privileged command bridge.

## Why Tauri 2

Tauri keeps the installed client much smaller than Electron by using WebKitGTK on Linux, WebView2 on Windows, and WKWebView on macOS. It also provides maintained native bundling and a signature-enforcing updater. Wails is a credible alternative when Go is a project requirement, while raw Wry would require us to build much more lifecycle, packaging, and update infrastructure ourselves. For this client, Tauri is the best balance of size, security boundaries, and cross-platform maintenance.

## Releases and signed updates

Normal local packages intentionally omit the desktop auto-updater. Release artifacts enable it and must be signed with a Tauri updater key. On Linux, self-updates apply to the AppImage; DEB and RPM installations remain under package-manager control.

Generate a key pair through the development container:

```bash
mkdir -p .cache/signing
./scripts/dev.sh run cargo tauri signer generate \
  -w /workspace/.cache/signing/pokeclicker.key
```

Back up the private key and password somewhere outside the repository. Configure these GitHub Actions secrets:

- `POKECLICKER_UPDATER_PUBKEY`: contents of `pokeclicker.key.pub`
- `TAURI_SIGNING_PRIVATE_KEY`: contents of `pokeclicker.key`
- `TAURI_SIGNING_PRIVATE_KEY_PASSWORD`: the key password

Keep the public key stable across releases: already-installed clients use it to authenticate future updates. Update the version in `src-tauri/tauri.conf.json` and `src-tauri/Cargo.toml`, then push a tag such as `desktop-v2.0.0`. The release workflow builds Linux, Windows, and both macOS architectures into a draft GitHub release, including signed updater metadata.

Updater signing verifies that an update came from this project. Windows Authenticode and Apple Developer ID signing are separate production-release concerns.

## Platform validation

- Linux x86-64: runtime, offline restart, tests, DEB, RPM, and AppImage locally verified.
- Windows x86-64: native compilation and NSIS release jobs configured; runtime smoke testing still required.
- macOS Intel and Apple Silicon: native compilation and app/DMG release jobs configured; runtime smoke testing and Apple signing still required.
