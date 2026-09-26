//! The one place a command error is built.
//!
//! A `CmdError` carries an `ErrorCode`, never a string, so a wrong code is
//! unwritable: the codes in API.md §14 are the only values that exist. Before
//! this, two dozen sites hand-rolled `code:` as a literal and eight of them
//! wrote `"VALIDATION"` instead of `"VALIDATION_ERROR"`, which silently broke
//! the friendly copy in `src/lib/errors.ts` for every validation failure.
//!
//! `From<AppError>` stays the path a core error takes; the constructors here
//! are for the shell's own failures, which have no `AppError` to map.

use instantnotes_core::AppError;
use serde::{Serialize, Serializer};

/// A stable error code per API.md §14 — the only codes callers may branch on.
/// The frontend mirror is `src/lib/api/error-codes.ts` and the core's
/// `AppError::code()` is the authority for the strings; both equalities are
/// asserted (in `src/lib/api/contract.test.ts` and in this module's tests).
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

    /// The inverse of `as_str`, used to prove the core's `AppError::code()`
    /// strings and this enum cannot drift apart.
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

/// Serializable error per API.md §3.6 / §14.
#[derive(Serialize, Debug)]
#[serde(rename_all = "camelCase")]
pub struct CmdError {
    code: ErrorCode,
    message: String,
}

impl CmdError {
    /// A persistence or platform failure: the operation could not be carried
    /// out. Also the code for a path the shell refuses to touch.
    pub fn storage(message: impl Into<String>) -> Self {
        CmdError {
            code: ErrorCode::Storage,
            message: message.into(),
        }
    }

    /// Input from the webview failed a rule.
    pub fn validation(message: impl Into<String>) -> Self {
        CmdError {
            code: ErrorCode::Validation,
            message: message.into(),
        }
    }

    /// Read back for assertions; production code only ever serializes it.
    #[cfg(test)]
    pub fn code(&self) -> ErrorCode {
        self.code
    }
}

impl From<AppError> for CmdError {
    fn from(e: AppError) -> Self {
        // Matched rather than read off `e.code()` so a new `AppError` variant
        // cannot reach the frontend without a decision here; the test below
        // holds this mapping and `AppError::code()` in agreement.
        let code = match &e {
            AppError::NotFound(_) => ErrorCode::NotFound,
            AppError::Validation(_) => ErrorCode::Validation,
            AppError::Conflict(_) => ErrorCode::Conflict,
            // A damaged file is a storage failure to callers (API.md §14).
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
