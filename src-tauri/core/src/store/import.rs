use super::notes::{insert_note, NewNote};
use super::settings::setting_put;
use super::*;
use std::collections::{BTreeMap, HashSet};

impl Store {
    pub fn imported_ids(&self, source: &str) -> Result<HashSet<String>> {
        Ok(imported(&self.conn, source)?.into_keys().collect())
    }

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

fn record_key(source: &str) -> String {
    format!("import.{source}")
}

fn imported(conn: &Connection, source: &str) -> Result<BTreeMap<String, String>> {
    let raw: Option<String> = conn
        .query_row(
            "SELECT value FROM settings WHERE key = ?1",
            params![record_key(source)],
            |r| r.get(0),
        )
        .optional()?;
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
