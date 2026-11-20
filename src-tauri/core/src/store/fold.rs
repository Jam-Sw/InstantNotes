use super::*;
use std::collections::HashSet;

fn append_block(base: &str, addition: &str) -> String {
    let left = base.trim_end();
    let right = addition.trim();
    if right.is_empty() {
        return left.to_string();
    }
    if left.trim().is_empty() {
        right.to_string()
    } else {
        format!("{left}\n\n{right}")
    }
}

pub fn fold_ids(into_id: &str, source_ids: &[String]) -> Vec<String> {
    let mut ids = vec![into_id.to_string()];
    let mut seen: HashSet<&str> = HashSet::from([into_id]);
    for id in source_ids {
        if seen.insert(id.as_str()) {
            ids.push(id.clone());
        }
    }
    ids
}

impl Store {
    pub fn fold_notes(&mut self, into_id: &str, source_ids: &[String]) -> Result<FoldOutcome> {
        let target = self.fetch_note(into_id)?;
        if target.is_deleted {
            return Err(AppError::Validation(
                "restore the target note from Trash before folding into it".into(),
            ));
        }
        if target.content_kind != CONTENT_KIND_DOCUMENT {
            return Err(AppError::Validation(format!(
                "notes can only be folded into a document, not a {}",
                target.content_kind
            )));
        }

        let folded_ids: Vec<String> = fold_ids(into_id, source_ids).split_off(1);
        if folded_ids.is_empty() {
            return Err(AppError::Validation(
                "choose at least one other note to fold into this note".into(),
            ));
        }

        let mut sources: Vec<Note> = Vec::with_capacity(folded_ids.len());
        for id in &folded_ids {
            let note = self.fetch_note(id)?;
            if note.is_deleted {
                return Err(AppError::Validation(
                    "trashed notes must be restored before folding".into(),
                ));
            }
            if note.content_kind != CONTENT_KIND_DOCUMENT {
                return Err(AppError::Validation(format!(
                    "only document notes can be folded, not a {}",
                    note.content_kind
                )));
            }
            sources.push(note);
        }

        let now = now_iso();
        let tx = self.conn.transaction()?;

        let mut before = Vec::with_capacity(1 + sources.len());
        before.push(
            activity::snapshot(&tx, into_id)?
                .ok_or_else(|| AppError::NotFound(format!("note {into_id} not found")))?,
        );
        for src in &sources {
            before.push(
                activity::snapshot(&tx, &src.id)?
                    .ok_or_else(|| AppError::NotFound(format!("note {} not found", src.id)))?,
            );
        }

        let title_is_auto = |id: &str| -> Result<bool> {
            Ok(tx
                .query_row(
                    "SELECT title_is_auto FROM notes WHERE id = ?1",
                    params![id],
                    |r| r.get::<_, i64>(0),
                )
                .map(|v| v != 0)?)
        };
        let target_auto = title_is_auto(into_id)?;

        let mut combined = target.body.clone();
        for src in &sources {
            let custom_heading = !title_is_auto(&src.id)?
                && !src.title.trim().is_empty()
                && src.title.trim() != "Untitled"
                && !src.body.trim_start().starts_with(src.title.trim());
            let chunk = if custom_heading {
                if src.body.trim().is_empty() {
                    format!("## {}", src.title.trim())
                } else {
                    format!("## {}\n\n{}", src.title.trim(), src.body.trim_end())
                }
            } else {
                src.body.trim_end().to_string()
            };
            combined = append_block(&combined, &chunk);
        }

        let new_title = if target_auto {
            domain::derive_title(&combined)
        } else {
            target.title.clone()
        };

        tx.execute(
            "UPDATE notes SET title = ?1, body = ?2, updated_at = ?3 WHERE id = ?4",
            params![new_title, combined, now, into_id],
        )?;

        reconcile_inline_tags(&tx, into_id, &combined)?;

        for src in &sources {
            let manual_tags: Vec<String> = {
                let mut stmt = tx.prepare(
                    "SELECT tag_id FROM note_tags WHERE note_id = ?1 AND source = 'manual'",
                )?;
                let rows = stmt.query_map(params![src.id], |r| r.get::<_, String>(0))?;
                rows.collect::<rusqlite::Result<Vec<_>>>()?
            };
            for tag_id in manual_tags {
                attach_tag(&tx, into_id, &tag_id, "manual")?;
            }

            let spaces: Vec<String> = {
                let mut stmt =
                    tx.prepare("SELECT workspace_id FROM note_workspaces WHERE note_id = ?1")?;
                let rows = stmt.query_map(params![src.id], |r| r.get::<_, String>(0))?;
                rows.collect::<rusqlite::Result<Vec<_>>>()?
            };
            for ws_id in spaces {
                tx.execute(
                    "INSERT OR IGNORE INTO note_workspaces (note_id, workspace_id, created_at) \
                     VALUES (?1, ?2, ?3)",
                    params![into_id, ws_id, now],
                )?;
            }

            tx.execute(
                "UPDATE notes SET is_archived = 1, updated_at = ?1 WHERE id = ?2",
                params![now, src.id],
            )?;
        }

        tx.commit()?;
        let note = self.fetch_note(into_id)?;
        Ok(FoldOutcome {
            note,
            folded_ids,
            before,
        })
    }

    pub fn undo_fold(&mut self, before: &[activity::NoteSnapshot]) -> Result<Note> {
        if before.len() < 2 {
            return Err(AppError::Validation(
                "a fold snapshot requires the target note and at least one folded note".into(),
            ));
        }
        let primary_id = before[0].id.clone();
        let tx = self.conn.transaction()?;
        for snap in before {
            activity::restore(&tx, snap)?;
        }
        tx.commit()?;
        self.fetch_note(&primary_id)
    }
}
