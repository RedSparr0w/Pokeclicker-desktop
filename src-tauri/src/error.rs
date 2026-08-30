use std::path::PathBuf;

#[derive(Debug, thiserror::Error)]
pub enum ClientError {
    #[error("the update archive is larger than the {0} byte safety limit")]
    ArchiveTooLarge(u64),

    #[error("the update archive contains too many files")]
    ArchiveHasTooManyEntries,

    #[error("the update archive contains an unsafe path: {0}")]
    ArchivePath(String),

    #[error("the update archive does not contain a complete docs build")]
    IncompleteGameBuild,

    #[error("the downloaded build is version {actual}, but {expected} was requested")]
    VersionMismatch { expected: String, actual: String },

    #[error("invalid game version '{value}': {source}")]
    InvalidVersion {
        value: String,
        #[source]
        source: semver::Error,
    },

    #[error("the installed game manifest is missing at {0}")]
    MissingManifest(PathBuf),

    #[error("network request failed: {0}")]
    Network(#[from] reqwest::Error),

    #[error("filesystem operation failed: {0}")]
    Io(#[from] std::io::Error),

    #[error("invalid JSON: {0}")]
    Json(#[from] serde_json::Error),

    #[error("invalid ZIP archive: {0}")]
    Zip(#[from] zip::result::ZipError),

    #[error("desktop runtime error: {0}")]
    Tauri(#[from] tauri::Error),
}

pub type Result<T> = std::result::Result<T, ClientError>;
