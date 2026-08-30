use std::{collections::BTreeMap, fs, io, path::Path};

use rusty_leveldb::{LdbIterator, Options, DB};
use tauri::{AppHandle, Manager};

const LEGACY_PROFILE_NAMES: &[&str] = &[
    "pokeclicker-desktop",
    "PokéClicker",
    "Pokeclicker",
    "PokéClicker Desktop",
    "Pokeclicker Desktop",
];
const MAX_DATABASE_FILES: usize = 1_000;
const MAX_DATABASE_BYTES: u64 = 128 * 1024 * 1024;
const MAX_MIGRATION_BYTES: usize = 32 * 1024 * 1024;
const MIGRATION_MARKER: &str = "__pokeclicker_desktop_electron_migration_v2";

pub fn migration_script(app: &AppHandle) -> String {
    let entries = match legacy_entries(app) {
        Ok(Some(entries)) => entries,
        Ok(None) => return String::new(),
        Err(error) => {
            log::warn!("could not read the legacy Electron save data: {error}");
            return String::new();
        }
    };

    let entries = entries.into_iter().collect::<Vec<_>>();
    let Ok(entries) = serde_json::to_string(&entries) else {
        log::warn!("could not serialize the legacy Electron save data");
        return String::new();
    };
    let marker = serde_json::to_string(MIGRATION_MARKER).expect("migration marker is valid JSON");

    format!(
        r#"
if ((location.protocol === 'pokeclicker:' || location.hostname === 'pokeclicker.localhost')
    && localStorage.getItem({marker}) === null) {{
  try {{
    for (const [key, value] of {entries}) {{
      if (localStorage.getItem(key) === null) {{
        localStorage.setItem(key, value);
      }}
    }}
    localStorage.setItem({marker}, 'complete');
  }} catch (error) {{
    console.warn('Could not import the legacy PokéClicker save data.', error);
  }}
}}
"#
    )
}

fn legacy_entries(app: &AppHandle) -> Result<Option<BTreeMap<String, String>>, String> {
    let config_dir = app
        .path()
        .config_dir()
        .map_err(|error| format!("the user configuration directory is unavailable: {error}"))?;

    for profile_name in LEGACY_PROFILE_NAMES {
        let database = config_dir
            .join(profile_name)
            .join("Local Storage")
            .join("leveldb");
        if database.is_dir() {
            return read_legacy_database(&database).map(Some);
        }
    }

    Ok(None)
}

fn read_legacy_database(source: &Path) -> Result<BTreeMap<String, String>, String> {
    let temporary = tempfile::Builder::new()
        .prefix("pokeclicker-electron-migration-")
        .tempdir()
        .map_err(|error| format!("could not create a temporary directory: {error}"))?;
    let database_copy = temporary.path().join("leveldb");
    copy_database(source, &database_copy)
        .map_err(|error| format!("could not copy {}: {error}", source.display()))?;

    let options = Options {
        create_if_missing: false,
        error_if_exists: false,
        reuse_logs: false,
        reuse_manifest: false,
        ..Options::default()
    };

    let mut database = DB::open(&database_copy, options)
        .map_err(|error| format!("could not open the copied database: {error}"))?;
    let mut iterator = database
        .new_iter()
        .map_err(|error| format!("could not iterate over the copied database: {error}"))?;

    let mut entries = BTreeMap::new();
    let mut migrated_bytes = 0_usize;
    while let Some((key, value)) = iterator.next() {
        let Some((key, value)) = decode_entry(&key, &value) else {
            continue;
        };
        if !is_save_key(&key) {
            continue;
        }

        migrated_bytes = migrated_bytes
            .checked_add(key.len())
            .and_then(|total| total.checked_add(value.len()))
            .ok_or_else(|| "legacy save data is too large to import".to_owned())?;
        if migrated_bytes > MAX_MIGRATION_BYTES {
            return Err("legacy save data is too large to import safely".into());
        }
        entries.insert(key, value);
    }

    Ok(entries)
}

fn copy_database(source: &Path, destination: &Path) -> io::Result<()> {
    fs::create_dir_all(destination)?;
    let mut copied_files = 0_usize;
    let mut copied_bytes = 0_u64;

    for entry in fs::read_dir(source)? {
        let entry = entry?;
        let file_type = entry.file_type()?;
        if !file_type.is_file() || entry.file_name() == "LOCK" {
            continue;
        }

        copied_files += 1;
        if copied_files > MAX_DATABASE_FILES {
            return Err(io::Error::new(
                io::ErrorKind::InvalidData,
                "legacy database contains too many files",
            ));
        }

        let metadata = entry.metadata()?;
        copied_bytes = copied_bytes
            .checked_add(metadata.len())
            .ok_or_else(|| io::Error::other("legacy database size overflow"))?;
        if copied_bytes > MAX_DATABASE_BYTES {
            return Err(io::Error::new(
                io::ErrorKind::InvalidData,
                "legacy database is too large",
            ));
        }

        fs::copy(entry.path(), destination.join(entry.file_name()))?;
    }

    Ok(())
}

fn decode_entry(database_key: &[u8], database_value: &[u8]) -> Option<(String, String)> {
    let scoped_key = database_key.strip_prefix(b"_")?;
    let separator = scoped_key.iter().position(|byte| *byte == 0)?;
    let scope = &scoped_key[..separator];
    if !(scope.starts_with(b"file:") || scope == b"null") {
        return None;
    }

    let key = decode_chromium_string(&scoped_key[separator + 1..])?;
    let value = decode_chromium_string(database_value)?;
    Some((key, value))
}

fn decode_chromium_string(encoded: &[u8]) -> Option<String> {
    let (&encoding, bytes) = encoded.split_first()?;
    match encoding {
        0 if bytes.len() % 2 == 0 => {
            let utf16 = bytes
                .as_chunks::<2>()
                .0
                .iter()
                .map(|pair| u16::from_le_bytes([pair[0], pair[1]]))
                .collect::<Vec<_>>();
            String::from_utf16(&utf16).ok()
        }
        1 => Some(bytes.iter().map(|byte| char::from(*byte)).collect()),
        _ => None,
    }
}

fn is_save_key(key: &str) -> bool {
    key == "backupSave"
        || key == "settings"
        || key.starts_with("player")
        || key.starts_with("save")
        || key.starts_with("settings")
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn decodes_chromium_latin1_and_utf16_strings() {
        assert_eq!(
            decode_chromium_string(b"\x01save1").as_deref(),
            Some("save1")
        );

        let mut encoded = vec![0];
        for code_unit in "Poké".encode_utf16() {
            encoded.extend_from_slice(&code_unit.to_le_bytes());
        }
        assert_eq!(decode_chromium_string(&encoded).as_deref(), Some("Poké"));
    }

    #[test]
    fn reads_only_game_saves_from_a_copied_chromium_database() {
        let temporary = tempfile::tempdir().unwrap();
        let source = temporary.path().join("source");
        let options = Options {
            create_if_missing: true,
            ..Options::default()
        };
        let mut database = DB::open(&source, options).unwrap();

        database
            .put(
                &chromium_key("file://", "save1"),
                &chromium_string(r#"{"profile":{"name":"Leaf"}}"#),
            )
            .unwrap();
        database
            .put(
                &chromium_key("file://", "player1"),
                &chromium_string(r#"{"trainerId":1}"#),
            )
            .unwrap();
        database
            .put(
                &chromium_key("https://example.com", "save1"),
                &chromium_string("not the game save"),
            )
            .unwrap();
        database
            .put(
                &chromium_key("file://", "unrelated"),
                &chromium_string("ignored"),
            )
            .unwrap();
        database.close().unwrap();

        let entries = read_legacy_database(&source).unwrap();
        assert_eq!(entries.len(), 2);
        assert_eq!(entries.get("player1").unwrap(), r#"{"trainerId":1}"#);
        assert!(entries.contains_key("save1"));
    }

    fn chromium_key(scope: &str, key: &str) -> Vec<u8> {
        let mut output = format!("_{scope}").into_bytes();
        output.push(0);
        output.extend(chromium_string(key));
        output
    }

    fn chromium_string(value: &str) -> Vec<u8> {
        let mut output = vec![1];
        output.extend_from_slice(value.as_bytes());
        output
    }
}
