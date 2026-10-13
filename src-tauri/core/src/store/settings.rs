use super::*;
use std::collections::BTreeMap;

pub const SHARED_SETTINGS: &[&str] = &[
    "theme.active",
    "theme.mode",
    "theme.custom",
    "theme.font.body",
    "editor.toolbarOpen",
    "editor.sourceMode",
    "editor.showExactTime",
    "links.underline",
    "links.tooltip",
    "links.externalIndicator",
    "images.maxPreviewHeight",
    "suggest.tags",
];

pub(super) const SETTINGS_BASE_SETTING: &str = "sync.settingsBase";

pub type SharedSettings = BTreeMap<String, serde_json::Value>;

pub fn is_shared_setting(key: &str) -> bool {
    SHARED_SETTINGS.contains(&key)
}

pub fn merge_shared_settings(
    base: Option<&SharedSettings>,
    ours: &SharedSettings,
    theirs: &SharedSettings,
) -> SharedSettings {
    let mut merged = SharedSettings::new();
    for key in ours.keys().chain(theirs.keys()) {
        if merged.contains_key(key) {
            continue;
        }
        let known = base.and_then(|b| b.get(key));
        let kept = match (ours.get(key), theirs.get(key)) {
            (Some(o), Some(t)) => match known {
                Some(b) if b == o => Some(t),
                Some(_) => Some(o),
                None => Some(t),
            },
            (Some(o), None) => known.is_none().then_some(o),
            (None, Some(t)) => known.is_none().then_some(t),
            (None, None) => None,
        };
        if let Some(value) = kept {
            merged.insert(key.clone(), value.clone());
        }
    }
    merged
}

pub fn serialize_shared_settings(settings: &SharedSettings) -> String {
    serde_json::to_string(settings).expect("settings are JSON values")
}

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
        setting_put(&self.conn, key, &value)
    }

    pub fn delete_setting(&mut self, key: &str) -> Result<()> {
        self.conn
            .execute("DELETE FROM settings WHERE key = ?1", params![key])?;
        Ok(())
    }

    pub fn shared_settings(&self) -> Result<SharedSettings> {
        let mut out = SharedSettings::new();
        for key in SHARED_SETTINGS {
            if let Some(value) = self.get_setting(key)? {
                out.insert(key.to_string(), value);
            }
        }
        Ok(out)
    }

    pub(super) fn apply_shared_settings(
        &mut self,
        ours: &SharedSettings,
        merged: &SharedSettings,
    ) -> Result<bool> {
        let mut changed = false;
        for (key, value) in merged {
            if is_shared_setting(key) && ours.get(key) != Some(value) {
                setting_put(&self.conn, key, value)?;
                changed = true;
            }
        }
        for key in ours.keys().filter(|k| !merged.contains_key(*k)) {
            self.delete_setting(key)?;
            changed = true;
        }
        Ok(changed)
    }
}

pub(super) fn setting_put(conn: &Connection, key: &str, value: &serde_json::Value) -> Result<()> {
    let serialized = serde_json::to_string(value)
        .map_err(|e| AppError::Validation(format!("unserializable setting value: {e}")))?;
    conn.execute(
        "INSERT INTO settings (key, value, updated_at) VALUES (?1, ?2, ?3) \
         ON CONFLICT(key) DO UPDATE SET value = excluded.value, \
         updated_at = excluded.updated_at",
        params![key, serialized, now_iso()],
    )?;
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    fn map(pairs: &[(&str, serde_json::Value)]) -> SharedSettings {
        pairs
            .iter()
            .map(|(k, v)| (k.to_string(), v.clone()))
            .collect()
    }

    #[test]
    fn a_joining_device_takes_the_library_look_and_keeps_what_the_library_lacks() {
        let ours = map(&[
            ("theme.active", json!("paper")),
            ("links.tooltip", json!(false)),
        ]);
        let theirs = map(&[("theme.active", json!("graphite"))]);
        assert_eq!(
            merge_shared_settings(None, &ours, &theirs),
            map(&[
                ("theme.active", json!("graphite")),
                ("links.tooltip", json!(false))
            ])
        );
    }

    #[test]
    fn the_side_that_changed_since_the_last_sync_wins() {
        let base = map(&[
            ("theme.mode", json!("auto")),
            ("theme.active", json!("paper")),
        ]);
        let ours = map(&[
            ("theme.mode", json!("dark")),
            ("theme.active", json!("paper")),
        ]);
        let theirs = map(&[
            ("theme.mode", json!("auto")),
            ("theme.active", json!("terminal")),
        ]);
        assert_eq!(
            merge_shared_settings(Some(&base), &ours, &theirs),
            map(&[
                ("theme.mode", json!("dark")),
                ("theme.active", json!("terminal"))
            ])
        );
    }

    #[test]
    fn a_setting_removed_on_one_side_is_removed_on_both() {
        let base = map(&[
            ("editor.zoom", json!(1.2)),
            ("links.underline", json!("hover")),
        ]);
        let ours = map(&[("links.underline", json!("hover"))]);
        let theirs = map(&[("editor.zoom", json!(1.2))]);
        assert_eq!(merge_shared_settings(Some(&base), &ours, &theirs), map(&[]));
    }

    #[test]
    fn only_the_look_and_editor_settings_are_shared() {
        assert!(is_shared_setting("theme.active"));
        assert!(is_shared_setting("editor.sourceMode"));
        for key in [
            "sidebar.width",
            "editor.zoom",
            "vault.server",
            "backups.automatic",
            "agents.access",
        ] {
            assert!(!is_shared_setting(key), "{key}");
        }
    }
}
