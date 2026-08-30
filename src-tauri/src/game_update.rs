use std::{
    fs::{self, File},
    io::{self, BufReader, BufWriter, Read, Write},
    path::{Component, Path, PathBuf},
    sync::Arc,
    time::{Duration, SystemTime, UNIX_EPOCH},
};

use futures_util::StreamExt;
use semver::Version;
use serde::{Deserialize, Serialize};
use tokio::io::AsyncWriteExt;

use crate::error::{ClientError, Result};

pub const GAME_ARCHIVE_URL: &str = "https://codeload.github.com/pokeclicker/pokeclicker/zip/master";
pub const GAME_MANIFEST_URL: &str =
    "https://raw.githubusercontent.com/pokeclicker/pokeclicker/master/package.json";

const CURRENT_DIR: &str = "current";
const PREVIOUS_DIR: &str = "previous";
const MAX_ARCHIVE_BYTES: u64 = 512 * 1024 * 1024;
const MAX_EXTRACTED_BYTES: u64 = 1024 * 1024 * 1024;
const MAX_ARCHIVE_ENTRIES: usize = 100_000;

pub type ProgressCallback = Arc<dyn Fn(InstallProgress) + Send + Sync + 'static>;

#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct InstallProgress {
    pub phase: InstallPhase,
    pub message: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub downloaded: Option<u64>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub total: Option<u64>,
}

#[derive(Clone, Copy, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub enum InstallPhase {
    Checking,
    Downloading,
    Extracting,
    Ready,
    Error,
}

impl InstallProgress {
    pub fn new(phase: InstallPhase, message: impl Into<String>) -> Self {
        Self {
            phase,
            message: message.into(),
            downloaded: None,
            total: None,
        }
    }

    fn download(downloaded: u64, total: Option<u64>) -> Self {
        Self {
            phase: InstallPhase::Downloading,
            message: "Downloading the latest PokéClicker build…".into(),
            downloaded: Some(downloaded),
            total,
        }
    }
}

#[derive(Debug, Deserialize)]
struct GameManifest {
    version: String,
}

#[derive(Clone)]
pub struct GameUpdater {
    client: reqwest::Client,
    game_dir: PathBuf,
}

impl GameUpdater {
    pub fn new(app_data_dir: impl Into<PathBuf>) -> Result<Self> {
        let client = reqwest::Client::builder()
            .connect_timeout(Duration::from_secs(15))
            .user_agent(concat!(
                "PokeclickerDesktop/",
                env!("CARGO_PKG_VERSION"),
                " (+https://github.com/RedSparr0w/Pokeclicker-desktop)"
            ))
            .build()?;

        Ok(Self {
            client,
            game_dir: app_data_dir.into().join("game"),
        })
    }

    pub fn current_dir(&self) -> PathBuf {
        self.game_dir.join(CURRENT_DIR)
    }

    pub fn has_valid_install(&self) -> bool {
        validate_install(&self.current_dir()).is_ok()
    }

    pub fn installed_version(&self) -> Result<Version> {
        read_version(&self.current_dir())
    }

    /// Restores the last complete build after an interrupted directory swap and
    /// removes stale staging data left by an unclean shutdown.
    pub fn recover(&self) -> Result<()> {
        fs::create_dir_all(&self.game_dir)?;

        let current = self.current_dir();
        let previous = self.game_dir.join(PREVIOUS_DIR);

        if validate_install(&current).is_ok() {
            if previous.exists() {
                fs::remove_dir_all(previous)?;
            }
            self.remove_stale_work_files()?;
            return Ok(());
        }

        if validate_install(&previous).is_ok() {
            if current.exists() {
                fs::remove_dir_all(&current)?;
            }
            fs::rename(previous, current)?;
        }

        self.remove_stale_work_files()
    }

    pub async fn latest_version(&self) -> Result<Version> {
        let manifest = self
            .client
            .get(GAME_MANIFEST_URL)
            .timeout(Duration::from_secs(20))
            .send()
            .await?
            .error_for_status()?
            .json::<GameManifest>()
            .await?;

        parse_version(&manifest.version)
    }

    pub async fn install(
        &self,
        expected_version: Version,
        on_progress: ProgressCallback,
    ) -> Result<()> {
        fs::create_dir_all(&self.game_dir)?;

        let unique = unique_suffix();
        let archive_path = self.game_dir.join(format!(".update-{unique}.zip"));
        let staging_path = self.game_dir.join(format!(".staging-{unique}"));

        let result = self
            .install_inner(
                &expected_version,
                &archive_path,
                &staging_path,
                on_progress.clone(),
            )
            .await;

        let _ = tokio::fs::remove_file(&archive_path).await;
        if staging_path.exists() {
            let _ = fs::remove_dir_all(&staging_path);
        }

        result
    }

    async fn install_inner(
        &self,
        expected_version: &Version,
        archive_path: &Path,
        staging_path: &Path,
        on_progress: ProgressCallback,
    ) -> Result<()> {
        on_progress(InstallProgress::new(
            InstallPhase::Downloading,
            "Downloading the latest PokéClicker build…",
        ));

        let response = self
            .client
            .get(GAME_ARCHIVE_URL)
            .send()
            .await?
            .error_for_status()?;
        let total = response.content_length();

        if total.is_some_and(|size| size > MAX_ARCHIVE_BYTES) {
            return Err(ClientError::ArchiveTooLarge(MAX_ARCHIVE_BYTES));
        }

        let mut output = tokio::fs::File::create(archive_path).await?;
        let mut stream = response.bytes_stream();
        let mut downloaded = 0_u64;

        while let Some(chunk) = stream.next().await {
            let chunk = chunk?;
            downloaded = downloaded.saturating_add(chunk.len() as u64);
            if downloaded > MAX_ARCHIVE_BYTES {
                return Err(ClientError::ArchiveTooLarge(MAX_ARCHIVE_BYTES));
            }
            output.write_all(&chunk).await?;
            on_progress(InstallProgress::download(downloaded, total));
        }

        output.flush().await?;
        output.sync_all().await?;
        drop(output);

        on_progress(InstallProgress::new(
            InstallPhase::Extracting,
            "Download complete. Verifying and installing…",
        ));

        let archive_path = archive_path.to_owned();
        let extraction_path = staging_path.to_owned();
        let extraction_version = expected_version.clone();
        tokio::task::spawn_blocking(move || {
            extract_game_archive(&archive_path, &extraction_path, &extraction_version)
        })
        .await
        .map_err(|error| io::Error::other(format!("extract task failed: {error}")))??;

        swap_install(&self.game_dir, staging_path)?;
        on_progress(InstallProgress::new(
            InstallPhase::Ready,
            format!("PokéClicker {expected_version} is ready."),
        ));
        Ok(())
    }

    fn remove_stale_work_files(&self) -> Result<()> {
        for entry in fs::read_dir(&self.game_dir)? {
            let entry = entry?;
            let name = entry.file_name();
            let name = name.to_string_lossy();
            if name.starts_with(".staging-") && entry.file_type()?.is_dir() {
                fs::remove_dir_all(entry.path())?;
            } else if name.starts_with(".update-") && entry.file_type()?.is_file() {
                fs::remove_file(entry.path())?;
            }
        }
        Ok(())
    }
}

fn parse_version(value: &str) -> Result<Version> {
    Version::parse(value.trim_start_matches('v')).map_err(|source| ClientError::InvalidVersion {
        value: value.to_owned(),
        source,
    })
}

fn read_version(root: &Path) -> Result<Version> {
    let path = root.join("package.json");
    if !path.is_file() {
        return Err(ClientError::MissingManifest(path));
    }
    let manifest: GameManifest = serde_json::from_reader(BufReader::new(File::open(path)?))?;
    parse_version(&manifest.version)
}

fn validate_install(root: &Path) -> Result<Version> {
    if !root.join("index.html").is_file() {
        return Err(ClientError::IncompleteGameBuild);
    }
    read_version(root)
}

fn extract_game_archive(archive_path: &Path, staging: &Path, expected: &Version) -> Result<()> {
    if staging.exists() {
        fs::remove_dir_all(staging)?;
    }
    fs::create_dir_all(staging)?;

    let input = BufReader::new(File::open(archive_path)?);
    let mut archive = zip::ZipArchive::new(input)?;
    if archive.len() > MAX_ARCHIVE_ENTRIES {
        return Err(ClientError::ArchiveHasTooManyEntries);
    }

    let mut extracted_bytes = 0_u64;
    let mut extracted_files = 0_usize;

    for index in 0..archive.len() {
        let mut entry = archive.by_index(index)?;
        if entry.is_symlink() {
            return Err(ClientError::ArchivePath(entry.name().to_owned()));
        }

        let enclosed = entry
            .enclosed_name()
            .ok_or_else(|| ClientError::ArchivePath(entry.name().to_owned()))?;
        let Some(relative) = docs_relative_path(&enclosed) else {
            continue;
        };
        if relative.as_os_str().is_empty() {
            continue;
        }

        let destination = staging.join(&relative);
        if entry.is_dir() {
            fs::create_dir_all(destination)?;
            continue;
        }

        extracted_bytes = extracted_bytes
            .checked_add(entry.size())
            .ok_or(ClientError::ArchiveTooLarge(MAX_EXTRACTED_BYTES))?;
        if extracted_bytes > MAX_EXTRACTED_BYTES {
            return Err(ClientError::ArchiveTooLarge(MAX_EXTRACTED_BYTES));
        }

        if let Some(parent) = destination.parent() {
            fs::create_dir_all(parent)?;
        }
        let mut output = BufWriter::new(File::create(destination)?);
        let expected_size = entry.size();
        let copied = io::copy(&mut entry.by_ref().take(expected_size + 1), &mut output)?;
        if copied != expected_size {
            return Err(ClientError::IncompleteGameBuild);
        }
        output.flush()?;
        extracted_files += 1;
    }

    if extracted_files == 0 {
        return Err(ClientError::IncompleteGameBuild);
    }

    let actual = validate_install(staging)?;
    if &actual != expected {
        return Err(ClientError::VersionMismatch {
            expected: expected.to_string(),
            actual: actual.to_string(),
        });
    }

    Ok(())
}

fn docs_relative_path(path: &Path) -> Option<PathBuf> {
    let mut components = path.components();
    match (components.next(), components.next()) {
        (Some(Component::Normal(_)), Some(Component::Normal(directory))) if directory == "docs" => {
        }
        _ => return None,
    }

    let mut relative = PathBuf::new();
    for component in components {
        match component {
            Component::Normal(value) => relative.push(value),
            _ => return None,
        }
    }
    Some(relative)
}

fn swap_install(game_dir: &Path, staging: &Path) -> Result<()> {
    let current = game_dir.join(CURRENT_DIR);
    let previous = game_dir.join(PREVIOUS_DIR);

    if previous.exists() {
        fs::remove_dir_all(&previous)?;
    }
    if current.exists() {
        fs::rename(&current, &previous)?;
    }

    if let Err(error) = fs::rename(staging, &current) {
        if previous.exists() && !current.exists() {
            let _ = fs::rename(&previous, &current);
        }
        return Err(error.into());
    }

    Ok(())
}

fn unique_suffix() -> String {
    let nanos = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .unwrap_or_default()
        .as_nanos();
    format!("{}-{nanos}", std::process::id())
}

#[cfg(test)]
mod tests {
    use super::*;
    use zip::{write::SimpleFileOptions, ZipWriter};

    #[test]
    fn accepts_only_files_below_the_archived_docs_directory() {
        assert_eq!(
            docs_relative_path(Path::new("pokeclicker-master/docs/index.html")),
            Some(PathBuf::from("index.html"))
        );
        assert_eq!(
            docs_relative_path(Path::new("pokeclicker-master/src/index.ts")),
            None
        );
        assert_eq!(docs_relative_path(Path::new("docs/index.html")), None);
    }

    #[test]
    fn extracts_and_validates_a_complete_build() {
        let temp = tempfile::tempdir().unwrap();
        let archive_path = temp.path().join("game.zip");
        let staging = temp.path().join("staging");
        write_test_archive(
            &archive_path,
            &[
                ("pokeclicker-master/docs/index.html", b"<html></html>"),
                (
                    "pokeclicker-master/docs/package.json",
                    br#"{"version":"1.2.3"}"#,
                ),
                ("pokeclicker-master/src/ignored.ts", b"ignored"),
            ],
        );

        extract_game_archive(&archive_path, &staging, &Version::new(1, 2, 3)).unwrap();

        assert!(staging.join("index.html").is_file());
        assert!(!staging.join("ignored.ts").exists());
    }

    #[test]
    fn rejects_a_build_with_an_unexpected_version() {
        let temp = tempfile::tempdir().unwrap();
        let archive_path = temp.path().join("game.zip");
        let staging = temp.path().join("staging");
        write_test_archive(
            &archive_path,
            &[
                ("pokeclicker-master/docs/index.html", b"<html></html>"),
                (
                    "pokeclicker-master/docs/package.json",
                    br#"{"version":"1.2.3"}"#,
                ),
            ],
        );

        let error =
            extract_game_archive(&archive_path, &staging, &Version::new(9, 9, 9)).unwrap_err();
        assert!(matches!(error, ClientError::VersionMismatch { .. }));
    }

    fn write_test_archive(path: &Path, files: &[(&str, &[u8])]) {
        let output = File::create(path).unwrap();
        let mut archive = ZipWriter::new(output);
        for (name, contents) in files {
            archive
                .start_file(*name, SimpleFileOptions::default())
                .unwrap();
            archive.write_all(contents).unwrap();
        }
        archive.finish().unwrap();
    }
}
