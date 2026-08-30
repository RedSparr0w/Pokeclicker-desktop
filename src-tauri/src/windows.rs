use std::sync::atomic::{AtomicU64, Ordering};

use tauri::{
    utils::config::{BackgroundThrottlingPolicy, WebviewUrl},
    webview::{NewWindowResponse, PageLoadEvent},
    AppHandle, Manager, Url, WebviewWindow, WebviewWindowBuilder,
};

use crate::{error::Result, game_update::InstallProgress};

const GAME_URL: &str = "pokeclicker://localhost/index.html";
static ALTERNATE_ID: AtomicU64 = AtomicU64::new(1);

pub fn create_setup_window<F>(app: &AppHandle, on_retry: F) -> Result<WebviewWindow>
where
    F: Fn(AppHandle) + Send + Sync + 'static,
{
    let retry_handle = app.clone();
    let window = with_default_icon(app, loader_builder(app, "setup", "PokéClicker Setup"))?
        .on_navigation(move |url| {
            if url.scheme() == "pokeclicker-action" && url.host_str() == Some("retry") {
                on_retry(retry_handle.clone());
                false
            } else {
                is_loader_url(url)
            }
        })
        .build()?;
    Ok(window)
}

pub fn create_update_window(app: &AppHandle) -> Result<WebviewWindow> {
    if let Some(existing) = app.get_webview_window("updater") {
        let _ = existing.close();
    }
    let window = with_default_icon(app, loader_builder(app, "updater", "Updating PokéClicker"))?
        .on_navigation(is_loader_url)
        .build()?;
    set_progress(
        &window,
        InstallProgress::new(
            crate::game_update::InstallPhase::Checking,
            "Preparing the game update…",
        ),
    );
    Ok(window)
}

fn loader_builder<'a>(
    app: &'a AppHandle,
    label: &'a str,
    title: &'a str,
) -> WebviewWindowBuilder<'a, tauri::Wry, AppHandle> {
    WebviewWindowBuilder::new(app, label, WebviewUrl::App("index.html".into()))
        .title(title)
        .inner_size(680.0, 520.0)
        .min_inner_size(300.0, 240.0)
        .center()
}

pub fn create_game_window(app: &AppHandle, alternate: bool) -> Result<WebviewWindow> {
    let (label, title) = if alternate {
        let id = ALTERNATE_ID.fetch_add(1, Ordering::Relaxed);
        (format!("alternate-{id}"), "PokéClicker (alternate)")
    } else {
        ("main".into(), "PokéClicker")
    };

    let title_for_page = title.to_owned();
    let client_version = env!("CARGO_PKG_VERSION");
    let legacy_migration = crate::legacy::migration_script(app);
    let init_script = format!(
        r#"
(() => {{
  const originalUserAgent = navigator.userAgent;
  try {{
    Object.defineProperty(navigator, 'userAgent', {{
      configurable: true,
      get: () => `${{originalUserAgent}} Electron PokeclickerDesktop/{client_version}`,
    }});
  }} catch (_) {{}}

  // A pending Web Lock is the cross-platform fallback recommended by the
  // webview runtime to keep an idle game active while its window is hidden.
  try {{
    navigator.locks?.request('pokeclicker-background', () => new Promise(() => {{}}));
  }} catch (_) {{}}

  {legacy_migration}
}})();
"#
    );

    let window = with_default_icon(
        app,
        WebviewWindowBuilder::new(app, label, game_webview_url()),
    )?
    .title(title)
    .inner_size(1280.0, 800.0)
    .min_inner_size(300.0, 200.0)
    .center()
    .enable_clipboard_access()
    .background_throttling(BackgroundThrottlingPolicy::Disabled)
    .initialization_script(init_script)
    .on_document_title_changed(move |window, _| {
        let _ = window.set_title(&title_for_page);
    })
    .on_page_load(|window, payload| {
        if matches!(payload.event(), PageLoadEvent::Finished) {
            let version = serde_json::to_string(env!("CARGO_PKG_VERSION"))
                .expect("client version is valid JSON");
            let _ = window.eval(format!(
                "try {{ DiscordRichPresence.clientVersion = {version}; }} catch (_) {{}}"
            ));
        }
    })
    .on_navigation(|url| {
        if is_game_url(url) || is_embedded_auth_url(url) {
            return true;
        }
        if matches!(url.scheme(), "http" | "https") {
            if let Err(error) = open::that_detached(url.as_str()) {
                log::warn!("could not open external URL: {error}");
            }
        }
        false
    })
    .on_new_window(|url, _features| {
        if matches!(url.scheme(), "http" | "https") {
            if let Err(error) = open::that_detached(url.as_str()) {
                log::warn!("could not open external URL: {error}");
            }
        }
        NewWindowResponse::Deny
    })
    .build()?;

    Ok(window)
}

pub fn set_progress(window: &WebviewWindow, progress: InstallProgress) {
    match serde_json::to_string(&progress) {
        Ok(payload) => {
            let _ = window.eval(format!("window.__setInstallProgress?.({payload});"));
        }
        Err(error) => log::warn!("could not serialize installer progress: {error}"),
    }
}

pub fn close_window(app: &AppHandle, label: &str) {
    if let Some(window) = app.get_webview_window(label) {
        let _ = window.close();
    }
}

pub fn reload_game_windows(app: &AppHandle) {
    for (label, window) in app.webview_windows() {
        if label == "main" || label.starts_with("alternate-") {
            if let Err(error) = window.navigate(game_url()) {
                log::warn!("could not reload {label}: {error}");
            }
        }
    }
}

pub fn focus_primary_window(app: &AppHandle) {
    let window = app
        .get_webview_window("main")
        .or_else(|| app.get_webview_window("setup"))
        .or_else(|| app.get_webview_window("updater"));
    if let Some(window) = window {
        let _ = window.unminimize();
        let _ = window.show();
        let _ = window.set_focus();
    }
}

fn game_webview_url() -> WebviewUrl {
    WebviewUrl::CustomProtocol(game_url())
}

fn with_default_icon<'a>(
    app: &'a AppHandle,
    builder: WebviewWindowBuilder<'a, tauri::Wry, AppHandle>,
) -> Result<WebviewWindowBuilder<'a, tauri::Wry, AppHandle>> {
    match app.default_window_icon() {
        Some(icon) => Ok(builder.icon(icon.clone())?),
        None => Ok(builder),
    }
}

fn game_url() -> Url {
    Url::parse(GAME_URL).expect("the game protocol URL is valid")
}

fn is_game_url(url: &Url) -> bool {
    url.scheme() == "pokeclicker"
        || (url.scheme() == "http" && url.host_str() == Some("pokeclicker.localhost"))
        || (url.scheme() == "https" && url.host_str() == Some("pokeclicker.localhost"))
}

fn is_loader_url(url: &Url) -> bool {
    (url.scheme() == "tauri" && url.host_str() == Some("localhost"))
        || (matches!(url.scheme(), "http" | "https") && url.host_str() == Some("tauri.localhost"))
}

fn is_embedded_auth_url(url: &Url) -> bool {
    url.scheme() == "https"
        && matches!(
            url.host_str(),
            Some("discord.pokeclicker.com" | "discord.com" | "discordapp.com")
        )
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn recognizes_custom_protocol_urls_on_every_desktop_backend() {
        assert!(is_game_url(&Url::parse(GAME_URL).unwrap()));
        assert!(is_game_url(
            &Url::parse("http://pokeclicker.localhost/index.html").unwrap()
        ));
        assert!(!is_game_url(
            &Url::parse("https://pokeclicker.example/index.html").unwrap()
        ));
    }

    #[test]
    fn keeps_only_discord_authentication_hosts_in_the_game_webview() {
        assert!(is_embedded_auth_url(
            &Url::parse("https://discord.pokeclicker.com/proxy?action=login").unwrap()
        ));
        assert!(is_embedded_auth_url(
            &Url::parse("https://discordapp.com/api/oauth2/authorize").unwrap()
        ));
        assert!(is_embedded_auth_url(
            &Url::parse("https://discord.com/login").unwrap()
        ));
        assert!(!is_embedded_auth_url(
            &Url::parse("https://discord.com.example/login").unwrap()
        ));
        assert!(!is_embedded_auth_url(
            &Url::parse("http://discord.com/login").unwrap()
        ));
    }

    #[test]
    fn confines_setup_navigation_to_bundled_assets() {
        assert!(is_loader_url(
            &Url::parse("tauri://localhost/index.html").unwrap()
        ));
        assert!(is_loader_url(
            &Url::parse("http://tauri.localhost/index.html").unwrap()
        ));
        assert!(!is_loader_url(
            &Url::parse("https://example.com/index.html").unwrap()
        ));
    }
}
