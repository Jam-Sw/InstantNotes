use thiserror::Error;

/// Structured application error shared by the core and the desktop IPC layer.
#[derive(Debug, Error)]
pub enum AppError {
    #[error("{0}")]
    NotFound(String),
    #[error("{0}")]
    Validation(String),
    #[error("{0}")]
    Conflict(String),
    #[error("{0}")]
    Storage(String),
    #[error("{0}")]
    Migration(String),
    /// A damaged or unreadable database file. Kept distinct from `Storage` so
    /// recovery can act on it, but reports the same external error code per
    /// API.md §11 (it is a storage failure to callers).
    #[error("{0}")]
    Corruption(String),
    /// The file's `user_version` is past the last migration this build knows.
    /// Kept distinct from `Migration` so callers can tell "written by a newer
    /// version, do not touch" apart from "this build's own migration failed",
    /// and never route it into `open_or_recover`'s move-aside-and-start-fresh
    /// path the way `is_corruption` would.
    #[error("database schema v{found} was created by a newer version of the app (this build knows up to v{known})")]
    SchemaTooNew { found: i64, known: usize },
}

impl AppError {
    /// Stable error code per API.md §11.
    pub fn code(&self) -> &'static str {
        match self {
            AppError::NotFound(_) => "NOT_FOUND",
            AppError::Validation(_) => "VALIDATION_ERROR",
            AppError::Conflict(_) => "CONFLICT",
            AppError::Storage(_) => "STORAGE_ERROR",
            AppError::Migration(_) => "MIGRATION_ERROR",
            AppError::Corruption(_) => "STORAGE_ERROR",
            AppError::SchemaTooNew { .. } => "MIGRATION_ERROR",
        }
    }

    /// True for a damaged/unreadable database file. `Store::open_or_recover`
    /// keys off this to decide a file is safe to set aside and start fresh.
    pub fn is_corruption(&self) -> bool {
        matches!(self, AppError::Corruption(_))
    }

    /// True when the file is intact but was written by a build newer than
    /// this one. Nothing to recover from and nothing safe to touch; the
    /// caller's only move is to tell the user to update.
    pub fn is_schema_too_new(&self) -> bool {
        matches!(self, AppError::SchemaTooNew { .. })
    }
}

impl From<rusqlite::Error> for AppError {
    fn from(e: rusqlite::Error) -> Self {
        match &e {
            rusqlite::Error::QueryReturnedNoRows => AppError::NotFound("not found".into()),
            // SQLITE_CORRUPT / SQLITE_NOTADB mean the file itself is unusable,
            // not a transient lock or a logical error; mark it recoverable.
            rusqlite::Error::SqliteFailure(err, _)
                if matches!(
                    err.code,
                    rusqlite::ErrorCode::DatabaseCorrupt | rusqlite::ErrorCode::NotADatabase
                ) =>
            {
                AppError::Corruption(e.to_string())
            }
            _ => AppError::Storage(e.to_string()),
        }
    }
}

pub type Result<T> = std::result::Result<T, AppError>;

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn error_codes_match_api_contract() {
        assert_eq!(AppError::NotFound("x".into()).code(), "NOT_FOUND");
        assert_eq!(AppError::Validation("x".into()).code(), "VALIDATION_ERROR");
        assert_eq!(AppError::Conflict("x".into()).code(), "CONFLICT");
        assert_eq!(AppError::Storage("x".into()).code(), "STORAGE_ERROR");
        assert_eq!(AppError::Migration("x".into()).code(), "MIGRATION_ERROR");
        assert_eq!(AppError::Corruption("x".into()).code(), "STORAGE_ERROR");
        assert_eq!(
            AppError::SchemaTooNew { found: 4, known: 3 }.code(),
            "MIGRATION_ERROR"
        );
    }

    #[test]
    fn only_corruption_reports_corruption() {
        assert!(AppError::Corruption("x".into()).is_corruption());
        assert!(!AppError::Storage("x".into()).is_corruption());
        assert!(!AppError::SchemaTooNew { found: 4, known: 3 }.is_corruption());
    }

    #[test]
    fn only_schema_too_new_reports_schema_too_new() {
        assert!(AppError::SchemaTooNew { found: 4, known: 3 }.is_schema_too_new());
        assert!(!AppError::Migration("x".into()).is_schema_too_new());
    }
}
