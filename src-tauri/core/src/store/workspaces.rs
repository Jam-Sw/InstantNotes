//! Workspace CRUD and note-workspace membership.

use super::*;

impl Store {
    fn fetch_workspace(&self, id: &str) -> Result<Workspace> {
        self.conn
            .query_row(
                &format!("SELECT {WORKSPACE_COLUMNS} FROM workspaces WHERE id = ?1"),
                params![id],
                row_to_workspace,
            )
            .optional()?
            .ok_or_else(|| AppError::NotFound(format!("workspace {id} not found")))
    }

    pub fn get_or_create_workspace(&mut self, raw_name: &str) -> Result<Workspace> {
        let name = domain::normalize_workspace_name(raw_name)
            .ok_or_else(|| AppError::Validation("workspace name must not be empty".into()))?;
        if let Some(ws) = self
            .conn
            .query_row(
                &format!("SELECT {WORKSPACE_COLUMNS} FROM workspaces WHERE name = ?1"),
                params![name],
                row_to_workspace,
            )
            .optional()?
        {
            return Ok(ws);
        }
        let now = now_iso();
        let id = new_id();
        self.conn.execute(
            "INSERT INTO workspaces (id, name, created_at, updated_at) VALUES (?1, ?2, ?3, ?3)",
            params![id, name, now],
        )?;
        Ok(Workspace {
            id,
            name,
            created_at: now.clone(),
            updated_at: now,
        })
    }

    pub fn list_workspaces(&self) -> Result<Vec<WorkspaceWithCount>> {
        let mut stmt = self.conn.prepare(
            "SELECT w.id, w.name, w.created_at, w.updated_at, \
                    (SELECT COUNT(*) FROM note_workspaces nw \
                       JOIN notes n ON n.id = nw.note_id \
                      WHERE nw.workspace_id = w.id AND n.is_deleted = 0) AS note_count \
             FROM workspaces w ORDER BY w.name COLLATE NOCASE",
        )?;
        let rows = stmt.query_map([], |row| {
            Ok(WorkspaceWithCount {
                workspace: row_to_workspace(row)?,
                note_count: row.get(4)?,
            })
        })?;
        Ok(rows.collect::<rusqlite::Result<Vec<_>>>()?)
    }

    pub fn rename_workspace(&mut self, id: &str, raw_name: &str) -> Result<Workspace> {
        self.fetch_workspace(id)?;
        let name = domain::normalize_workspace_name(raw_name)
            .ok_or_else(|| AppError::Validation("workspace name must not be empty".into()))?;
        let clash: Option<String> = self
            .conn
            .query_row(
                "SELECT id FROM workspaces WHERE name = ?1 AND id <> ?2",
                params![name, id],
                |r| r.get(0),
            )
            .optional()?;
        if clash.is_some() {
            return Err(AppError::Conflict(format!(
                "a workspace named '{name}' already exists"
            )));
        }
        self.conn.execute(
            "UPDATE workspaces SET name = ?1, updated_at = ?2 WHERE id = ?3",
            params![name, now_iso(), id],
        )?;
        self.fetch_workspace(id)
    }

    /// Removes the workspace and its memberships; notes are untouched.
    /// Returns the member note ids so the caller can offer an undo that
    /// re-adds every membership: a post-hoc `list_notes` snapshot can't,
    /// because its default filter hides archived and trashed members.
    pub fn delete_workspace(&mut self, id: &str) -> Result<Vec<String>> {
        self.fetch_workspace(id)?;
        let member_ids = {
            let mut stmt = self
                .conn
                .prepare("SELECT note_id FROM note_workspaces WHERE workspace_id = ?1")?;
            let rows = stmt.query_map(params![id], |r| r.get(0))?;
            rows.collect::<rusqlite::Result<Vec<String>>>()?
        };
        self.conn
            .execute("DELETE FROM workspaces WHERE id = ?1", params![id])?;
        Ok(member_ids)
    }

    /// Tags carried by a workspace's visible notes, with counts scoped to
    /// the workspace (the note list's tag chips). Archived and trashed
    /// members don't contribute: a chip must never filter the visible
    /// list down to zero matches for a tag the user can't see.
    pub fn list_workspace_tags(&self, workspace_id: &str) -> Result<Vec<TagWithCount>> {
        self.fetch_workspace(workspace_id)?;
        let mut stmt = self.conn.prepare(
            "SELECT t.id, t.name, t.color, t.created_at, t.updated_at, \
                    COUNT(*) AS usage_count \
             FROM tags t \
             JOIN note_tags nt ON nt.tag_id = t.id \
             JOIN note_workspaces nw ON nw.note_id = nt.note_id \
             JOIN notes n ON n.id = nt.note_id \
             WHERE nw.workspace_id = ?1 AND n.is_deleted = 0 AND n.is_archived = 0 \
             GROUP BY t.id ORDER BY t.name",
        )?;
        let rows = stmt.query_map(params![workspace_id], |row| {
            Ok(TagWithCount {
                tag: row_to_tag(row)?,
                usage_count: row.get(5)?,
            })
        })?;
        Ok(rows.collect::<rusqlite::Result<Vec<_>>>()?)
    }

    /// Collect a note into a workspace (idempotent).
    pub fn add_note_to_workspace(&mut self, note_id: &str, workspace_id: &str) -> Result<()> {
        self.fetch_note(note_id)?;
        self.fetch_workspace(workspace_id)?;
        self.conn.execute(
            "INSERT OR IGNORE INTO note_workspaces (note_id, workspace_id, created_at) \
             VALUES (?1, ?2, ?3)",
            params![note_id, workspace_id, now_iso()],
        )?;
        Ok(())
    }

    pub fn remove_note_from_workspace(&mut self, note_id: &str, workspace_id: &str) -> Result<()> {
        self.conn.execute(
            "DELETE FROM note_workspaces WHERE note_id = ?1 AND workspace_id = ?2",
            params![note_id, workspace_id],
        )?;
        Ok(())
    }

    pub fn workspaces_for_note(&self, note_id: &str) -> Result<Vec<Workspace>> {
        let mut stmt = self.conn.prepare(
            "SELECT w.id, w.name, w.created_at, w.updated_at \
             FROM workspaces w JOIN note_workspaces nw ON nw.workspace_id = w.id \
             WHERE nw.note_id = ?1 ORDER BY w.name COLLATE NOCASE",
        )?;
        let rows = stmt.query_map(params![note_id], row_to_workspace)?;
        Ok(rows.collect::<rusqlite::Result<Vec<_>>>()?)
    }
}
