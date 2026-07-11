//! Note CRUD, listing, and full-text search.

use super::*;

impl Store {
    pub fn create_note(&mut self, input: CreateNoteInput) -> Result<Note> {
        let body = input.body.unwrap_or_default();
        let explicit_title = input
            .title
            .map(|t| t.trim().to_string())
            .filter(|t| !t.is_empty());
        let title_is_auto = explicit_title.is_none();
        let title = explicit_title.unwrap_or_else(|| domain::derive_title(&body));
        let inline_tags = domain::extract_inline_tags(&body);
        let now = now_iso();
        let id = new_id();

        let tx = self.conn.transaction()?;
        tx.execute(
            "INSERT INTO notes (id, title, title_is_auto, body, created_at, updated_at) \
             VALUES (?1, ?2, ?3, ?4, ?5, ?5)",
            params![id, title, i64::from(title_is_auto), body, now],
        )?;
        for name in &inline_tags {
            let tag = tag_get_or_create(&tx, name)?;
            attach_tag(&tx, &id, &tag.id, "inline")?;
        }
        for name in &input.tags {
            let tag = tag_get_or_create(&tx, name)?;
            attach_tag(&tx, &id, &tag.id, "manual")?;
        }
        tx.commit()?;
        self.fetch_note(&id)
    }

    /// Fetch a note. When `touch` is true, updates `last_opened_at`.
    pub fn get_note(&mut self, id: &str, touch: bool) -> Result<Note> {
        if touch {
            self.conn.execute(
                "UPDATE notes SET last_opened_at = ?1 WHERE id = ?2",
                params![now_iso(), id],
            )?;
        }
        self.fetch_note(id)
    }

    pub fn update_note(&mut self, id: &str, patch: UpdateNotePatch) -> Result<Note> {
        // Ensure existence first for a clean NOT_FOUND.
        let existing = self.fetch_note(id)?;
        // An empty patch is a no-op: skip the UPDATE so updated_at is not
        // bumped and recency-sorted lists keep their order.
        if patch.title.is_none()
            && patch.body.is_none()
            && patch.is_pinned.is_none()
            && patch.is_archived.is_none()
        {
            return Ok(existing);
        }
        let title_is_auto: bool = self
            .conn
            .query_row(
                "SELECT title_is_auto FROM notes WHERE id = ?1",
                params![id],
                |r| r.get::<_, i64>(0),
            )
            .map(|v| v != 0)?;

        // An explicit title pins the title; an auto title follows body edits.
        let explicit_title = patch
            .title
            .map(|t| t.trim().to_string())
            .filter(|t| !t.is_empty());
        let (new_title, new_title_is_auto) = match (&explicit_title, &patch.body) {
            (Some(t), _) => (Some(t.clone()), Some(false)),
            (None, Some(body)) if title_is_auto => (Some(domain::derive_title(body)), None),
            _ => (None, None),
        };

        let now = now_iso();
        let tx = self.conn.transaction()?;
        tx.execute(
            "UPDATE notes SET \
               title = COALESCE(?1, title), \
               title_is_auto = COALESCE(?2, title_is_auto), \
               body = COALESCE(?3, body), \
               is_pinned = COALESCE(?4, is_pinned), \
               is_archived = COALESCE(?5, is_archived), \
               updated_at = ?6 \
             WHERE id = ?7",
            params![
                new_title,
                new_title_is_auto.map(i64::from),
                patch.body.as_deref(),
                patch.is_pinned.map(i64::from),
                patch.is_archived.map(i64::from),
                now,
                id
            ],
        )?;
        if let Some(body) = &patch.body {
            // Reconcile inline tags with the new body: attach the tags it now
            // mentions, then detach any inline-sourced edge whose #token is
            // gone so removing a tag chip is not undone by the next save.
            // Manual edges are pinned and never touched by a body edit.
            let mut kept_ids: Vec<String> = Vec::new();
            for name in domain::extract_inline_tags(body) {
                let tag = tag_get_or_create(&tx, &name)?;
                attach_tag(&tx, id, &tag.id, "inline")?;
                kept_ids.push(tag.id);
            }
            if kept_ids.is_empty() {
                tx.execute(
                    "DELETE FROM note_tags WHERE note_id = ?1 AND source = 'inline'",
                    params![id],
                )?;
            } else {
                let placeholders = vec!["?"; kept_ids.len()].join(", ");
                let sql = format!(
                    "DELETE FROM note_tags WHERE note_id = ? AND source = 'inline' \
                     AND tag_id NOT IN ({placeholders})"
                );
                let mut args: Vec<&dyn rusqlite::ToSql> = Vec::with_capacity(kept_ids.len() + 1);
                args.push(&id);
                for tag_id in &kept_ids {
                    args.push(tag_id);
                }
                tx.execute(&sql, rusqlite::params_from_iter(args))?;
            }
        }
        tx.commit()?;
        self.fetch_note(id)
    }

    pub fn soft_delete_note(&mut self, id: &str) -> Result<Note> {
        self.fetch_note(id)?;
        let now = now_iso();
        self.conn.execute(
            "UPDATE notes SET is_deleted = 1, deleted_at = ?1, updated_at = ?1 \
             WHERE id = ?2",
            params![now, id],
        )?;
        self.fetch_note(id)
    }

    pub fn restore_note(&mut self, id: &str) -> Result<Note> {
        self.fetch_note(id)?;
        let now = now_iso();
        self.conn.execute(
            "UPDATE notes SET is_deleted = 0, deleted_at = NULL, updated_at = ?1 \
             WHERE id = ?2",
            params![now, id],
        )?;
        self.fetch_note(id)
    }

    /// Permanent deletion requires `confirm == true` (VALIDATION_ERROR otherwise).
    pub fn permanently_delete_note(&mut self, id: &str, confirm: bool) -> Result<()> {
        if !confirm {
            return Err(AppError::Validation(
                "permanent deletion requires explicit confirmation".into(),
            ));
        }
        self.fetch_note(id)?;
        // FK cascade removes note_tags; the AFTER DELETE trigger removes FTS rows.
        self.conn
            .execute("DELETE FROM notes WHERE id = ?1", params![id])?;
        Ok(())
    }

    /// Default filter excludes archived and deleted notes; sorts by
    /// updatedAt desc.
    pub fn list_notes(&self, filter: NoteFilter) -> Result<Vec<Note>> {
        let mut conditions: Vec<String> = Vec::new();
        let mut args: Vec<Box<dyn rusqlite::ToSql>> = Vec::new();

        let deleted = filter.is_deleted.unwrap_or(false);
        conditions.push("is_deleted = ?".into());
        args.push(Box::new(i64::from(deleted)));

        if !deleted {
            conditions.push("is_archived = ?".into());
            args.push(Box::new(i64::from(filter.is_archived.unwrap_or(false))));
        } else if let Some(archived) = filter.is_archived {
            conditions.push("is_archived = ?".into());
            args.push(Box::new(i64::from(archived)));
        }

        if let Some(pinned) = filter.is_pinned {
            conditions.push("is_pinned = ?".into());
            args.push(Box::new(i64::from(pinned)));
        }

        if filter.never_opened == Some(true) {
            conditions.push("last_opened_at IS NULL".into());
        }

        if let Some(created_before) = &filter.created_before {
            // Timestamps are stored as UTC ISO-8601, so string comparison is
            // chronological; differing sub-second precision only moves the
            // boundary within a second, which no caller depends on.
            conditions.push("created_at < ?".into());
            args.push(Box::new(created_before.clone()));
        }

        if let Some(workspace_id) = &filter.workspace_id {
            conditions
                .push("id IN (SELECT note_id FROM note_workspaces WHERE workspace_id = ?)".into());
            args.push(Box::new(workspace_id.clone()));
        }

        if !filter.tag_ids.is_empty() {
            let placeholders = vec!["?"; filter.tag_ids.len()].join(", ");
            conditions.push(format!(
                "id IN (SELECT note_id FROM note_tags WHERE tag_id IN ({placeholders}))"
            ));
            for tag_id in &filter.tag_ids {
                args.push(Box::new(tag_id.clone()));
            }
        }

        if let Some(query) = filter.query.as_ref().filter(|q| !q.trim().is_empty()) {
            conditions.push("(title LIKE ? OR body LIKE ?)".into());
            let like = format!("%{}%", query.trim());
            args.push(Box::new(like.clone()));
            args.push(Box::new(like));
        }

        let order_column = match filter.sort_by.as_deref() {
            Some("createdAt") => "created_at",
            Some("lastOpenedAt") => "last_opened_at",
            Some("title") => "title COLLATE NOCASE",
            _ => "updated_at",
        };
        let order_dir = match filter.sort_order.as_deref() {
            Some("asc") => "ASC",
            _ => "DESC",
        };
        let limit = filter.limit.unwrap_or(500).clamp(1, 5000);
        let offset = filter.offset.unwrap_or(0).max(0);

        // Pinned notes float to the top of every live list; trash keeps
        // plain recency order.
        let pinned_first = if deleted { "" } else { "is_pinned DESC, " };
        let sql = format!(
            "SELECT {NOTE_COLUMNS} FROM notes WHERE {} \
             ORDER BY {pinned_first}{order_column} {order_dir} \
             LIMIT {limit} OFFSET {offset}",
            conditions.join(" AND ")
        );
        let mut stmt = self.conn.prepare(&sql)?;
        let rows = stmt.query_map(
            rusqlite::params_from_iter(args.iter().map(|a| a.as_ref())),
            row_to_note,
        )?;
        Ok(rows.collect::<rusqlite::Result<Vec<_>>>()?)
    }

    /// Full-text search over title+body. Always excludes deleted notes;
    /// excludes archived notes. Special characters in `text` must not error.
    /// Title and excerpt matches are bracketed with U+0001 (start) / U+0002
    /// (end) sentinels rather than HTML: both are control characters a user
    /// can never type, so the frontend can split on them unambiguously to
    /// highlight hits as plain-text segments (see `highlight.ts`).
    pub fn search_notes(&self, text: &str, limit: i64) -> Result<Vec<SearchResult>> {
        let Some(match_expr) = fts_match_expr(text) else {
            return Ok(Vec::new());
        };
        let limit = limit.clamp(1, 500);
        let mut stmt = self.conn.prepare(
            // 16 tokens, not the FTS5 default 15 or the prior 12: the list
            // row is single-line and CSS-truncated regardless, so a wider
            // window costs nothing visually and gives multi-word queries
            // enough room for more than one matched term to land together.
            // highlight() (not snippet()) for the title: titles are short, so
            // the full column with markers is what the row renders anyway. A
            // query matching only the title still shows why the note hit.
            "SELECT n.id, highlight(notes_fts, 0, '\u{1}', '\u{2}'), \
                    snippet(notes_fts, 1, '\u{1}', '\u{2}', '…', 16), \
                    bm25(notes_fts), n.updated_at \
             FROM notes_fts \
             JOIN notes n ON n.seq = notes_fts.rowid \
             WHERE notes_fts MATCH ?1 AND n.is_deleted = 0 AND n.is_archived = 0 \
             ORDER BY bm25(notes_fts) \
             LIMIT ?2",
        )?;
        let rows = stmt.query_map(params![match_expr, limit], |row| {
            Ok(SearchResult {
                note_id: row.get(0)?,
                title: row.get(1)?,
                excerpt: row.get(2)?,
                // bm25: lower is better (negative); expose higher-is-better.
                score: -row.get::<_, f64>(3)?,
                updated_at: row.get(4)?,
            })
        })?;
        Ok(rows.collect::<rusqlite::Result<Vec<_>>>()?)
    }
}