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
        }
    }
}

impl From<rusqlite::Error> for AppError {
    fn from(e: rusqlite::Error) -> Self {
        match e {
            rusqlite::Error::QueryReturnedNoRows => AppError::NotFound("not found".into()),
            other => AppError::Storage(other.to_string()),
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
    }
}
