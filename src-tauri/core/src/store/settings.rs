//! The key/value settings store.

use super::*;

impl Store {
    pub fn get_setting(&self, key: &str) -> Result<Option<serde_json::Value>> {
        let raw: Option<String> = self
            .conn
            .query_row(
                "SELECT value FROM settings WHERE key = ?1",
                params![key],
                |r| r.get(0),
            )
            .optional()?;
        match raw {
            None => Ok(None),
            Some(s) => serde_json::from_str(&s)
                .map(Some)
                .map_err(|e| AppError::Storage(format!("corrupt setting '{key}': {e}"))),
        }
    }

    pub fn set_setting(&mut self, key: &str, value: serde_json::Value) -> Result<()> {
        let serialized = serde_json::to_string(&value)
            .map_err(|e| AppError::Validation(format!("unserializable setting value: {e}")))?;
        self.conn.execute(
            "INSERT INTO settings (key, value, updated_at) VALUES (?1, ?2, ?3) \
             ON CONFLICT(key) DO UPDATE SET value = excluded.value, \
             updated_at = excluded.updated_at",
            params![key, serialized, now_iso()],
        )?;
        Ok(())
    }

    pub fn delete_setting(&mut self, key: &str) -> Result<()> {
        self.conn
            .execute("DELETE FROM settings WHERE key = ?1", params![key])?;
        Ok(())
    }
}
