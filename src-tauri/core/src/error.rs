use thiserror::Error;

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
    #[error("{0}")]
    Corruption(String),
    #[error("database schema v{found} was created by a newer version of the app (this build knows up to v{known})")]
    SchemaTooNew { found: i64, known: usize },
}

impl AppError {
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

    pub fn is_corruption(&self) -> bool {
        matches!(self, AppError::Corruption(_))
    }

    pub fn is_schema_too_new(&self) -> bool {
        matches!(self, AppError::SchemaTooNew { .. })
    }
}

impl From<rusqlite::Error> for AppError {
    fn from(e: rusqlite::Error) -> Self {
        match &e {
            rusqlite::Error::QueryReturnedNoRows => AppError::NotFound("not found".into()),
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
