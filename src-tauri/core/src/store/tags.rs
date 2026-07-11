//! Tag CRUD and note-tag associations.

use super::*;

impl Store {
    pub fn get_or_create_tag(&mut self, name: &str) -> Result<Tag> {
        tag_get_or_create(&self.conn, name)
    }

    pub fn list_tags(&self) -> Result<Vec<TagWithCount>> {
        let mut stmt = self.conn.prepare(
            "SELECT t.id, t.name, t.color, t.created_at, t.updated_at, \
                    (SELECT COUNT(*) FROM note_tags nt \
                       JOIN notes n ON n.id = nt.note_id \
                      WHERE nt.tag_id = t.id AND n.is_deleted = 0) AS usage_count \
             FROM tags t ORDER BY t.name",
        )?;
        let rows = stmt.query_map([], |row| {
            Ok(TagWithCount {
                tag: row_to_tag(row)?,
                usage_count: row.get(5)?,
            })
        })?;
        Ok(rows.collect::<rusqlite::Result<Vec<_>>>()?)
    }

    pub fn update_tag(
        &mut self,
        id: &str,
        name: Option<String>,
        color: Option<String>,
    ) -> Result<Tag> {
        let existing = self
            .conn
            .query_row(
                "SELECT id, name, color, created_at, updated_at FROM tags WHERE id = ?1",
                params![id],
                row_to_tag,
            )
            .optional()?
            .ok_or_else(|| AppError::NotFound(format!("tag {id} not found")))?;

        let new_name = match name {
            Some(raw) => {
                let normalized = domain::normalize_tag_name(&raw)
                    .ok_or_else(|| AppError::Validation("tag name must not be empty".into()))?;
                let clash: Option<String> = self
                    .conn
                    .query_row(
                        "SELECT id FROM tags WHERE name = ?1 AND id <> ?2",
                        params![normalized, id],
                        |r| r.get(0),
                    )
                    .optional()?;
                if clash.is_some() {
                    return Err(AppError::Conflict(format!(
                        "a tag named '{normalized}' already exists"
                    )));
                }
                normalized
            }
            None => existing.name,
        };

        self.conn.execute(
            "UPDATE tags SET name = ?1, color = COALESCE(?2, color), updated_at = ?3 WHERE id = ?4",
            params![new_name, color, now_iso(), id],
        )?;
        self.conn
            .query_row(
                "SELECT id, name, color, created_at, updated_at FROM tags WHERE id = ?1",
                params![id],
                row_to_tag,
            )
            .map_err(Into::into)
    }

    /// Removes the tag and its associations; notes are untouched.
    pub fn delete_tag(&mut self, id: &str) -> Result<()> {
        let affected = self
            .conn
            .execute("DELETE FROM tags WHERE id = ?1", params![id])?;
        if affected == 0 {
            return Err(AppError::NotFound(format!("tag {id} not found")));
        }
        Ok(())
    }

    pub fn add_tag_to_note(&mut self, note_id: &str, name: &str) -> Result<Tag> {
        self.fetch_note(note_id)?;
        let tag = tag_get_or_create(&self.conn, name)?;
        attach_tag(&self.conn, note_id, &tag.id, "manual")?;
        // attach_tag is INSERT OR IGNORE, so an edge already present as 'inline'
        // keeps that source. An explicit add is a pin, so promote it to
        // 'manual' and inline reconciliation will no longer detach it.
        self.conn.execute(
            "UPDATE note_tags SET source = 'manual' \
             WHERE note_id = ?1 AND tag_id = ?2 AND source = 'inline'",
            params![note_id, tag.id],
        )?;
        Ok(tag)
    }

    pub fn remove_tag_from_note(&mut self, note_id: &str, tag_id: &str) -> Result<()> {
        self.conn.execute(
            "DELETE FROM note_tags WHERE note_id = ?1 AND tag_id = ?2",
            params![note_id, tag_id],
        )?;
        Ok(())
    }

    pub fn tags_for_note(&self, note_id: &str) -> Result<Vec<Tag>> {
        let mut stmt = self.conn.prepare(
            "SELECT t.id, t.name, t.color, t.created_at, t.updated_at \
             FROM tags t JOIN note_tags nt ON nt.tag_id = t.id \
             WHERE nt.note_id = ?1 ORDER BY t.name",
        )?;
        let rows = stmt.query_map(params![note_id], row_to_tag)?;
        Ok(rows.collect::<rusqlite::Result<Vec<_>>>()?)
    }
}
