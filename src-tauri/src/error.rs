use instantnotes_core::AppError;
use serde::{Serialize, Serializer};

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum ErrorCode {
    NotFound,
    Validation,
    Conflict,
    Storage,
    Migration,
}

impl ErrorCode {
    pub fn as_str(self) -> &'static str {
        match self {
            Self::NotFound => "NOT_FOUND",
            Self::Validation => "VALIDATION_ERROR",
            Self::Conflict => "CONFLICT",
            Self::Storage => "STORAGE_ERROR",
            Self::Migration => "MIGRATION_ERROR",
        }
    }

    #[cfg(test)]
    pub const ALL: &'static [ErrorCode] = &[
        Self::NotFound,
        Self::Validation,
        Self::Conflict,
        Self::Storage,
        Self::Migration,
    ];

    #[cfg(test)]
    pub fn parse(s: &str) -> Option<Self> {
        Self::ALL.iter().copied().find(|c| c.as_str() == s)
    }
}

impl Serialize for ErrorCode {
    fn serialize<S: Serializer>(&self, serializer: S) -> Result<S::Ok, S::Error> {
        serializer.serialize_str(self.as_str())
    }
}

#[derive(Serialize, Debug)]
#[serde(rename_all = "camelCase")]
pub struct CmdError {
    code: ErrorCode,
    message: String,
}

impl CmdError {
    pub fn storage(message: impl Into<String>) -> Self {
        CmdError {
            code: ErrorCode::Storage,
            message: message.into(),
        }
    }

    pub fn validation(message: impl Into<String>) -> Self {
        CmdError {
            code: ErrorCode::Validation,
            message: message.into(),
        }
    }

    #[cfg(test)]
    pub fn code(&self) -> ErrorCode {
        self.code
    }
}

impl From<AppError> for CmdError {
    fn from(e: AppError) -> Self {
        if e.is_corruption() {
            if let Some(path) = crate::LIBRARY_DB.get() {
                instantnotes_core::Store::mark_library_suspect(path);
            }
        }
        let code = match &e {
            AppError::NotFound(_) => ErrorCode::NotFound,
            AppError::Validation(_) => ErrorCode::Validation,
            AppError::Conflict(_) => ErrorCode::Conflict,
            AppError::Storage(_) | AppError::Corruption(_) => ErrorCode::Storage,
            AppError::Migration(_) | AppError::SchemaTooNew { .. } => ErrorCode::Migration,
        };
        CmdError {
            code,
            message: e.to_string(),
        }
    }
}

pub type CmdResult<T> = Result<T, CmdError>;

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn every_core_error_code_is_a_known_code() {
        for e in [
            AppError::NotFound("x".into()),
            AppError::Validation("x".into()),
            AppError::Conflict("x".into()),
            AppError::Storage("x".into()),
            AppError::Migration("x".into()),
            AppError::Corruption("x".into()),
            AppError::SchemaTooNew { found: 9, known: 6 },
        ] {
            let code = e.code();
            assert!(
                ErrorCode::parse(code).is_some(),
                "core emits {code}, which is not an ErrorCode"
            );
            assert_eq!(CmdError::from(e).code().as_str(), code);
        }
    }

    #[test]
    fn a_corruption_error_marks_the_library_for_a_full_check() {
        let dir = tempfile::tempdir().unwrap();
        let db = dir.path().join("library.db");
        let _ = crate::LIBRARY_DB.set(db.clone());
        let marker = dir.path().join("library.db.verify");
        assert!(!marker.exists());
        let _ = CmdError::from(AppError::Storage("x".into()));
        assert!(!marker.exists());
        let _ = CmdError::from(AppError::Corruption("x".into()));
        assert!(marker.exists());
    }

    #[test]
    fn codes_serialize_as_their_api_strings() {
        let json = serde_json::to_string(&CmdError::validation("nope")).expect("serialize");
        assert_eq!(json, r#"{"code":"VALIDATION_ERROR","message":"nope"}"#);
        assert_eq!(CmdError::storage("nope").code(), ErrorCode::Storage);
    }

    #[test]
    fn every_code_round_trips_through_its_string() {
        for code in ErrorCode::ALL {
            assert_eq!(ErrorCode::parse(code.as_str()), Some(*code));
        }
    }
}
