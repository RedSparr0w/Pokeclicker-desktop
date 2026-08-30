mod discord;
mod error;
mod game_update;
mod legacy;
mod protocol;
mod windows;

use std::{
    sync::{
        atomic::{AtomicBool, Ordering},
        Arc,
    },
    time::Duration,
};

use game_update::{
    GameUpdater, InstallPhase, InstallProgress, ProgressCallback, GAME_MANIFEST_URL,
};
use tauri::{AppHandle, Manager, WebviewWindow};
use tauri_plugin_dialog::{
    DialogExt, MessageDialogButtons, MessageDialogKind, MessageDialogResult,
};

const GAME_UPDATE_INTERVAL: Duration = Duration::from_secs(60 * 60);
const FIRST_UPDATE_CHECK_DELAY: Duration = Duration::from_secs(10);

fn configured_updater_public_key() -> Option<&'static str> {
    option_env!("POKECLICKER_UPDATER_PUBKEY").filter(|key| !key.trim().is_empty())
}

#[derive(Default)]
struct RuntimeFlags {
    initial_install_running: AtomicBool,
    game_update_service_started: AtomicBool,
    game_updates_disabled: AtomicBool,
    discord_started: AtomicBool,
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    let mut builder = tauri::Builder::default()
        // Tauri requires the single-instance plugin to be registered first.
        .plugin(tauri_plugin_single_instance::init(|app, _args, _cwd| {
            windows::focus_primary_window(app);

            let app = app.clone();
            std::thread::spawn(move || {
                if updater_for(&app).is_ok_and(|updater| updater.has_valid_install()) {
                    if let Err(error) = windows::create_game_window(&app, true) {
                        log::warn!("could not create alternate window: {error}");
                    }
                }
            });
        }))
        .plugin(tauri_plugin_log::Builder::new().build())
        .plugin(tauri_plugin_dialog::init())
        .manage(RuntimeFlags::default())
        .register_uri_scheme_protocol("pokeclicker", protocol::serve_game)
        .setup(|app| {
            initialize(app.handle())?;
            Ok(())
        });

    if let Some(public_key) = configured_updater_public_key() {
        builder = builder.plugin(
            tauri_plugin_updater::Builder::new()
                .pubkey(public_key)
                .build(),
        );
    }

    builder
        .run(tauri::generate_context!())
        .expect("error while running PokéClicker Desktop");
}

fn initialize(app: &AppHandle) -> error::Result<()> {
    let updater = updater_for(app)?;
    if let Err(error) = updater.recover() {
        log::warn!("could not fully clean up the game data directory: {error}");
    }

    if updater.has_valid_install() {
        let main = windows::create_game_window(app, false)?;
        start_runtime_services(app, main);
    } else {
        let setup = windows::create_setup_window(app, begin_initial_install)?;
        windows::set_progress(
            &setup,
            InstallProgress::new(InstallPhase::Checking, "Checking the latest game version…"),
        );
        begin_initial_install(app.clone());
    }

    Ok(())
}

fn begin_initial_install(app: AppHandle) {
    let flags = app.state::<RuntimeFlags>();
    if flags.initial_install_running.swap(true, Ordering::AcqRel) {
        return;
    }

    let Some(setup) = app.get_webview_window("setup") else {
        flags
            .initial_install_running
            .store(false, Ordering::Release);
        return;
    };

    let updater = match updater_for(&app) {
        Ok(updater) => updater,
        Err(error) => {
            show_install_error(&setup, &error);
            flags
                .initial_install_running
                .store(false, Ordering::Release);
            return;
        }
    };

    let progress_window = setup.clone();
    let on_progress: ProgressCallback = Arc::new(move |progress| {
        windows::set_progress(&progress_window, progress);
    });

    tauri::async_runtime::spawn(async move {
        windows::set_progress(
            &setup,
            InstallProgress::new(InstallPhase::Checking, "Checking the latest game version…"),
        );

        let result = async {
            let latest = updater.latest_version().await?;
            updater.install(latest, on_progress).await
        }
        .await;

        match result {
            Ok(()) => match windows::create_game_window(&app, false) {
                Ok(main) => {
                    windows::close_window(&app, "setup");
                    start_runtime_services(&app, main);
                }
                Err(error) => show_install_error(&setup, &error),
            },
            Err(error) => {
                log::error!("initial game installation failed: {error}");
                show_install_error(&setup, &error);
            }
        }

        app.state::<RuntimeFlags>()
            .initial_install_running
            .store(false, Ordering::Release);
    });
}

fn show_install_error(window: &WebviewWindow, error: &dyn std::fmt::Display) {
    windows::set_progress(
        window,
        InstallProgress::new(
            InstallPhase::Error,
            format!("Could not install PokéClicker: {error}"),
        ),
    );
}

fn start_runtime_services(app: &AppHandle, main: WebviewWindow) {
    let flags = app.state::<RuntimeFlags>();

    if !flags.discord_started.swap(true, Ordering::AcqRel) {
        discord::start(main);
    }

    if !flags
        .game_update_service_started
        .swap(true, Ordering::AcqRel)
    {
        start_game_update_service(app.clone());
    }

    client_update::start_if_configured(app.clone());
}

fn start_game_update_service(app: AppHandle) {
    tauri::async_runtime::spawn(async move {
        tokio::time::sleep(FIRST_UPDATE_CHECK_DELAY).await;

        loop {
            if app
                .state::<RuntimeFlags>()
                .game_updates_disabled
                .load(Ordering::Acquire)
            {
                break;
            }

            if let Err(error) = check_for_game_update(&app).await {
                log::warn!("game update check failed ({GAME_MANIFEST_URL}): {error}");
            }
            tokio::time::sleep(GAME_UPDATE_INTERVAL).await;
        }
    });
}

async fn check_for_game_update(app: &AppHandle) -> error::Result<()> {
    let updater = updater_for(app)?;
    let installed = updater.installed_version()?;
    let latest = updater.latest_version().await?;
    if latest <= installed {
        return Ok(());
    }

    let choice = app
        .dialog()
        .message(format!(
            "PokéClicker {latest} is available (installed: {installed}).\n\nWould you like to download it now?"
        ))
        .title("PokéClicker update available")
        .kind(MessageDialogKind::Info)
        .buttons(MessageDialogButtons::YesNoCancelCustom(
            "Update now".into(),
            "Remind me later".into(),
            "Disable for this session".into(),
        ))
        .blocking_show_with_result();

    match choice {
        MessageDialogResult::Yes | MessageDialogResult::Ok => {
            install_game_update(app, updater, latest).await?;
        }
        MessageDialogResult::Custom(ref value) if value == "Update now" => {
            install_game_update(app, updater, latest).await?;
        }
        MessageDialogResult::Custom(ref value) if value == "Disable for this session" => {
            app.state::<RuntimeFlags>()
                .game_updates_disabled
                .store(true, Ordering::Release);
        }
        _ => {}
    }

    Ok(())
}

async fn install_game_update(
    app: &AppHandle,
    updater: GameUpdater,
    latest: semver::Version,
) -> error::Result<()> {
    let progress_window = windows::create_update_window(app)?;
    let callback_window = progress_window.clone();
    let on_progress: ProgressCallback = Arc::new(move |progress| {
        windows::set_progress(&callback_window, progress);
    });

    let result = updater.install(latest.clone(), on_progress).await;
    windows::close_window(app, "updater");

    if let Err(error) = result {
        app.dialog()
            .message(format!(
                "The game update could not be installed. Your existing game data is unchanged.\n\n{error}"
            ))
            .title("PokéClicker update failed")
            .kind(MessageDialogKind::Error)
            .blocking_show();
        return Err(error);
    }

    let reload = app
        .dialog()
        .message(format!(
            "PokéClicker {latest} was installed successfully. Reload the game now?"
        ))
        .title("PokéClicker updated")
        .kind(MessageDialogKind::Info)
        .buttons(MessageDialogButtons::OkCancelCustom(
            "Reload now".into(),
            "Later".into(),
        ))
        .blocking_show_with_result();

    if matches!(reload, MessageDialogResult::Ok | MessageDialogResult::Yes)
        || matches!(reload, MessageDialogResult::Custom(ref value) if value == "Reload now")
    {
        windows::reload_game_windows(app);
    }

    Ok(())
}

fn updater_for(app: &AppHandle) -> error::Result<GameUpdater> {
    GameUpdater::new(app.path().app_data_dir()?)
}

mod client_update {
    use std::{
        sync::atomic::{AtomicBool, Ordering},
        time::Duration,
    };

    use tauri::{AppHandle, Url};
    use tauri_plugin_dialog::{
        DialogExt, MessageDialogButtons, MessageDialogKind, MessageDialogResult,
    };
    use tauri_plugin_updater::UpdaterExt;

    const DEFAULT_CLIENT_UPDATE_ENDPOINT: &str =
        "https://github.com/RedSparr0w/Pokeclicker-desktop/releases/latest/download/latest.json";
    static STARTED: AtomicBool = AtomicBool::new(false);

    pub fn start_if_configured(app: AppHandle) {
        if super::configured_updater_public_key().is_none()
            || !platform_supports_self_update()
            || STARTED.swap(true, Ordering::AcqRel)
        {
            return;
        }

        tauri::async_runtime::spawn(async move {
            tokio::time::sleep(Duration::from_secs(30)).await;
            if let Err(error) = check(&app).await {
                log::debug!("client update check failed: {error}");
            }
        });
    }

    async fn check(app: &AppHandle) -> Result<(), Box<dyn std::error::Error + Send + Sync>> {
        let endpoint = Url::parse(client_update_endpoint())?;
        let updater = app
            .updater_builder()
            .endpoints(vec![endpoint])?
            .timeout(Duration::from_secs(20))
            .build()?;
        let Some(update) = updater.check().await? else {
            return Ok(());
        };

        let install = app
            .dialog()
            .message(format!(
                "A new desktop client ({}) is available. Install it now?",
                update.version
            ))
            .title("PokéClicker Desktop update")
            .kind(MessageDialogKind::Info)
            .buttons(MessageDialogButtons::OkCancelCustom(
                "Install and restart".into(),
                "Later".into(),
            ))
            .blocking_show_with_result();

        let accepted = matches!(install, MessageDialogResult::Ok | MessageDialogResult::Yes)
            || matches!(install, MessageDialogResult::Custom(ref value) if value == "Install and restart");
        if accepted {
            update.download_and_install(|_, _| {}, || {}).await?;
            app.request_restart();
        }
        Ok(())
    }

    fn client_update_endpoint() -> &'static str {
        option_env!("POKECLICKER_UPDATER_ENDPOINT")
            .filter(|endpoint| !endpoint.trim().is_empty())
            .unwrap_or(DEFAULT_CLIENT_UPDATE_ENDPOINT)
    }

    fn platform_supports_self_update() -> bool {
        // Tauri's Linux updater artifact is the AppImage. DEB and RPM installs
        // must be upgraded by their package manager instead of replacing the
        // executable in /usr/bin.
        #[cfg(target_os = "linux")]
        {
            std::env::var_os("APPIMAGE").is_some()
        }

        #[cfg(not(target_os = "linux"))]
        {
            true
        }
    }
}
