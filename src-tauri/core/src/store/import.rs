//! Notes brought in from other apps (Settings > Import): all of a batch in
//! one transaction, each source note at most once per library.

use super::notes::{insert_note, NewNote};
use super::settings::setting_put;
use super::*;
use std::collections::{BTreeMap, HashSet};

impl Store {
    /// The source ids already imported from `source` whose note still
    /// exists, in the Trash or not.
    pub fn imported_ids(&self, source: &str) -> Result<HashSet<String>> {
        Ok(imported(&self.conn, source)?.into_keys().collect())
    }

    /// Insert `items` as notes, skipping any imported before, filed in the
    /// Space named `space` (created if new, and only if a note lands; none
    /// when blank). Each keeps its dates; its title comes from its body, and
    /// its `#words` become tags, as for any note. They are stamped as opened
    /// now: an import is not a capture waiting in Revisit.
    pub fn import_notes(
        &mut self,
        source: &str,
        items: Vec<ImportItem>,
        space: Option<&str>,
    ) -> Result<ImportOutcome> {
        let tx = self.conn.transaction()?;
        let mut done = imported(&tx, source)?;
        let space = space.map(str::trim).filter(|s| !s.is_empty());
        let mut workspace: Option<Workspace> = None;
        let mut outcome = ImportOutcome {
            imported: 0,
            skipped: 0,
            workspace_id: None,
        };
        let now = now_iso();
        for item in items {
            if done.contains_key(&item.source_id) {
                outcome.skipped += 1;
                continue;
            }
            let id = insert_note(
                &tx,
                NewNote {
                    body: &item.body,
                    title: None,
                    created_at: &iso(item.created_at),
                    updated_at: &iso(item.updated_at.max(item.created_at)),
                    last_opened_at: Some(&now),
                },
            )?;
            if let Some(name) = space {
                if workspace.is_none() {
                    workspace = Some(workspace_get_or_create(&tx, name)?);
                }
                if let Some(ws) = &workspace {
                    tx.execute(
                        "INSERT OR IGNORE INTO note_workspaces (note_id, workspace_id, created_at) \
                         VALUES (?1, ?2, ?3)",
                        params![id, ws.id, now],
                    )?;
                }
            }
            done.insert(item.source_id, id);
            outcome.imported += 1;
        }
        if outcome.imported > 0 {
            let map = serde_json::to_value(&done)
                .map_err(|e| AppError::Storage(format!("import record: {e}")))?;
            setting_put(&tx, &record_key(source), &map)?;
        }
        tx.commit()?;
        outcome.workspace_id = workspace.map(|w| w.id);
        Ok(outcome)
    }
}

/// Settings key holding, for one source, which note each source id became.
fn record_key(source: &str) -> String {
    format!("import.{source}")
}

/// The record for `source`, keeping only entries whose note still exists: a
/// note destroyed for good frees its source note to be imported again.
fn imported(conn: &Connection, source: &str) -> Result<BTreeMap<String, String>> {
    let raw: Option<String> = conn
        .query_row(
            "SELECT value FROM settings WHERE key = ?1",
            params![record_key(source)],
            |r| r.get(0),
        )
        .optional()?;
    // A record that cannot be parsed is rebuilt by the next import.
    let record: BTreeMap<String, String> = raw
        .and_then(|s| serde_json::from_str(&s).ok())
        .unwrap_or_default();
    let mut exists = conn.prepare("SELECT 1 FROM notes WHERE id = ?1")?;
    let mut live = BTreeMap::new();
    for (source_id, note_id) in record {
        if exists.exists(params![note_id])? {
            live.insert(source_id, note_id);
        }
    }
    Ok(live)
}
