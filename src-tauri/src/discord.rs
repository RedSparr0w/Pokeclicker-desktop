use std::{
    sync::mpsc::{self, Receiver, Sender},
    thread,
    time::Duration,
};

use discord_rich_presence::{activity, DiscordIpc, DiscordIpcClient};
use serde::Deserialize;
use tauri::WebviewWindow;

const DISCORD_CLIENT_ID: &str = "733927271726841887";
const PRESENCE_INTERVAL: Duration = Duration::from_secs(15);
const PRESENCE_SCRIPT: &str = r#"
(() => {
  try {
    return typeof DiscordRichPresence === 'undefined'
      ? null
      : DiscordRichPresence.getRichPresenceData();
  } catch (_) {
    return null;
  }
})()
"#;

#[derive(Clone, Debug, Default, Deserialize)]
#[serde(rename_all = "camelCase")]
struct PresenceData {
    #[serde(default)]
    enabled: bool,
    line1: Option<String>,
    line2: Option<String>,
    start_timestamp: Option<i64>,
    large_image_key: Option<String>,
    large_image_text: Option<String>,
    small_image_key: Option<String>,
    small_image_text: Option<String>,
}

pub fn start(window: WebviewWindow) {
    let (sender, receiver) = mpsc::channel();
    thread::Builder::new()
        .name("discord-presence".into())
        .spawn(move || presence_worker(receiver))
        .expect("failed to start Discord presence worker");

    thread::Builder::new()
        .name("discord-poller".into())
        .spawn(move || poll_game(window, sender))
        .expect("failed to start Discord presence poller");
}

fn poll_game(window: WebviewWindow, sender: Sender<PresenceData>) {
    loop {
        let callback_sender = sender.clone();
        if window
            .eval_with_callback(PRESENCE_SCRIPT, move |raw| {
                if let Some(presence) = parse_presence(&raw) {
                    let _ = callback_sender.send(presence);
                }
            })
            .is_err()
        {
            break;
        }
        thread::sleep(PRESENCE_INTERVAL);
    }
}

fn presence_worker(receiver: Receiver<PresenceData>) {
    let mut client: Option<DiscordIpcClient> = None;

    while let Ok(presence) = receiver.recv() {
        if !presence.enabled {
            if let Some(active_client) = client.as_mut() {
                if let Err(error) = active_client.clear_activity() {
                    log::debug!("could not clear Discord activity: {error}");
                    client = None;
                }
            }
            continue;
        }

        if client.is_none() {
            let mut new_client = DiscordIpcClient::new(DISCORD_CLIENT_ID);
            match new_client.connect() {
                Ok(()) => client = Some(new_client),
                Err(error) => {
                    log::debug!("Discord is not available: {error}");
                    continue;
                }
            }
        }

        let activity = build_activity(presence);
        if let Some(active_client) = client.as_mut() {
            if let Err(error) = active_client.set_activity(activity) {
                log::debug!("lost the Discord IPC connection: {error}");
                let _ = active_client.close();
                client = None;
            }
        }
    }

    if let Some(mut active_client) = client {
        let _ = active_client.close();
    }
}

fn build_activity(data: PresenceData) -> activity::Activity<'static> {
    let mut output = activity::Activity::new()
        .details(display_line(data.line1))
        .state(display_line(data.line2));

    if let Some(timestamp) = data.start_timestamp {
        // PokéClicker returns Date.now() milliseconds while Discord expects Unix seconds.
        let timestamp = if timestamp > 10_000_000_000 {
            timestamp / 1_000
        } else {
            timestamp
        };
        output = output.timestamps(activity::Timestamps::new().start(timestamp));
    }

    let mut assets = activity::Assets::new();
    let mut has_assets = false;
    if let Some(value) = non_empty(data.large_image_key) {
        assets = assets.large_image(limit(value));
        has_assets = true;
    }
    if let Some(value) = non_empty(data.large_image_text) {
        assets = assets.large_text(limit(value));
        has_assets = true;
    }
    if let Some(value) = non_empty(data.small_image_key) {
        assets = assets.small_image(limit(value));
        has_assets = true;
    }
    if let Some(value) = non_empty(data.small_image_text) {
        assets = assets.small_text(limit(value));
        has_assets = true;
    }
    if has_assets {
        output = output.assets(assets);
    }

    output
}

fn parse_presence(raw: &str) -> Option<PresenceData> {
    serde_json::from_str::<Option<PresenceData>>(raw)
        .ok()
        .flatten()
        .or_else(|| {
            serde_json::from_str::<String>(raw)
                .ok()
                .and_then(|inner| serde_json::from_str::<Option<PresenceData>>(&inner).ok())
                .flatten()
        })
}

fn display_line(value: Option<String>) -> String {
    let value = value.unwrap_or_default();
    if value.chars().count() <= 1 {
        "--".into()
    } else {
        limit(value)
    }
}

fn non_empty(value: Option<String>) -> Option<String> {
    value.filter(|candidate| !candidate.trim().is_empty())
}

fn limit(value: String) -> String {
    value.chars().take(128).collect()
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn parses_webview_callback_values() {
        let raw = r#"{"enabled":true,"line1":"Route 1","startTimestamp":123000}"#;
        let parsed = parse_presence(raw).unwrap();
        assert!(parsed.enabled);
        assert_eq!(parsed.line1.as_deref(), Some("Route 1"));
    }

    #[test]
    fn limits_discord_text_by_characters() {
        let value = "🌟".repeat(140);
        assert_eq!(limit(value).chars().count(), 128);
        assert_eq!(display_line(Some(" ".into())), "--");
    }
}
