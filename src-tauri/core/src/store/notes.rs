use super::*;
use crate::sheet::{self, Sheet};

pub(super) struct NewNote<'a> {
    pub body: &'a str,
    pub title: Option<String>,
    pub created_at: &'a str,
    pub updated_at: &'a str,
    pub last_opened_at: Option<&'a str>,
}

pub(super) fn insert_note(conn: &Connection, note: NewNote<'_>) -> Result<String> {
    let explicit_title = note
        .title
        .map(|t| t.trim().to_string())
        .filter(|t| !t.is_empty());
    let title_is_auto = explicit_title.is_none();
    let title = explicit_title.unwrap_or_else(|| domain::derive_title(note.body));
    let id = new_id();
    conn.execute(
        "INSERT INTO notes (id, title, title_is_auto, body, created_at, updated_at, \
         last_opened_at) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7)",
        params![
            id,
            title,
            i64::from(title_is_auto),
            note.body,
            note.created_at,
            note.updated_at,
            note.last_opened_at
        ],
    )?;
    for name in domain::extract_inline_tags(note.body) {
        let tag = tag_get_or_create(conn, &name)?;
        attach_tag(conn, &id, &tag.id, "inline")?;
    }
    Ok(id)
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub(super) struct UpdatePlan {
    pub kind: String,
    pub title: Option<String>,
    pub title_is_auto: Option<bool>,
    pub body: Option<String>,
    pub surface_data: Option<String>,
}

pub(super) fn plan_update(
    existing: &Note,
    title_is_auto: bool,
    patch: &UpdateNotePatch,
) -> Result<Option<UpdatePlan>> {
    if patch.title.is_none()
        && patch.body.is_none()
        && patch.is_pinned.is_none()
        && patch.is_archived.is_none()
        && patch.content_kind.is_none()
        && patch.surface_data.is_none()
    {
        return Ok(None);
    }

    let kind = match patch.content_kind.as_deref() {
        None => existing.content_kind.as_str(),
        Some(k @ (CONTENT_KIND_DOCUMENT | CONTENT_KIND_WHITEBOARD | CONTENT_KIND_SHEET)) => k,
        Some(other) => {
            return Err(AppError::Validation(format!(
                "content kind must be {CONTENT_KIND_DOCUMENT}, {CONTENT_KIND_WHITEBOARD}, or {CONTENT_KIND_SHEET}, got {other}"
            )))
        }
    };
    if has_surface(&existing.content_kind) && kind != existing.content_kind {
        let back = if kind == CONTENT_KIND_DOCUMENT {
            " back"
        } else {
            ""
        };
        return Err(AppError::Validation(format!(
            "a {} cannot be turned{back} into a {kind}",
            existing.content_kind
        )));
    }
    let is_surface = has_surface(kind);
    if patch.surface_data.is_some() && !is_surface {
        return Err(AppError::Validation(
            "only a whiteboard or a sheet holds surface data".into(),
        ));
    }

    let (body, surface_data) = if kind == CONTENT_KIND_SHEET {
        match &patch.surface_data {
            Some(raw) => {
                let grid = Sheet::parse(raw).map_err(AppError::Validation)?;
                (Some(grid.markdown()), Some(raw.clone()))
            }
            None if existing.content_kind != CONTENT_KIND_SHEET => {
                let grid = Sheet::new_default();
                (Some(grid.markdown()), Some(grid.serialize()))
            }
            None => (None, None),
        }
    } else {
        (patch.body.clone(), patch.surface_data.clone())
    };

    let explicit_title = patch
        .title
        .as_deref()
        .map(str::trim)
        .filter(|t| !t.is_empty());
    let becomes_sheet = kind == CONTENT_KIND_SHEET && existing.content_kind != CONTENT_KIND_SHEET;
    let (title, new_title_is_auto) = match (explicit_title, &body) {
        (Some(t), _) => (Some(t.to_string()), Some(false)),
        (None, Some(body)) if title_is_auto && !is_surface => {
            (Some(domain::derive_title(body)), None)
        }
        (None, _) if title_is_auto && becomes_sheet && existing.body.trim().is_empty() => {
            (Some(sheet::DEFAULT_TITLE.to_string()), Some(false))
        }
        (None, _) if title_is_auto && is_surface => (None, Some(false)),
        _ => (None, None),
    };
    Ok(Some(UpdatePlan {
        kind: kind.to_string(),
        title,
        title_is_auto: new_title_is_auto,
        body,
        surface_data,
    }))
}

pub const REVISIT_AFTER_MS: i64 = 3 * 24 * 60 * 60 * 1000;

pub(super) fn expand_revisit(mut filter: NoteFilter, now: chrono::DateTime<Utc>) -> NoteFilter {
    if filter.revisit {
        let cutoff = now - chrono::Duration::milliseconds(REVISIT_AFTER_MS);
        filter.never_opened = Some(true);
        filter.created_before = Some(cutoff.to_rfc3339_opts(SecondsFormat::Micros, true));
        filter.sort_by = Some("createdAt".into());
        filter.sort_order = Some("asc".into());
    }
    filter
}

impl Store {
    pub fn create_note(&mut self, input: CreateNoteInput) -> Result<Note> {
        let body = input.body.unwrap_or_default();
        let now = now_iso();
        let tx = self.conn.transaction()?;
        let id = insert_note(
            &tx,
            NewNote {
                body: &body,
                title: input.title,
                created_at: &now,
                updated_at: &now,
                last_opened_at: None,
            },
        )?;
        for name in &input.tags {
            let tag = tag_get_or_create(&tx, name)?;
            attach_tag(&tx, &id, &tag.id, "manual")?;
        }
        tx.commit()?;
        self.fetch_note(&id)
    }

    pub fn title_is_auto(&self, id: &str) -> Result<bool> {
        self.conn
            .query_row(
                "SELECT title_is_auto FROM notes WHERE id = ?1",
                params![id],
                |r| r.get::<_, i64>(0),
            )
            .optional()?
            .map(|v| v != 0)
            .ok_or_else(|| AppError::NotFound(format!("note {id} not found")))
    }

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
        let existing = self.fetch_note(id)?;
        let title_is_auto: bool = self
            .conn
            .query_row(
                "SELECT title_is_auto FROM notes WHERE id = ?1",
                params![id],
                |r| r.get::<_, i64>(0),
            )
            .map(|v| v != 0)?;
        let Some(plan) = plan_update(&existing, title_is_auto, &patch)? else {
            return Ok(existing);
        };
        let UpdatePlan {
            kind,
            title: new_title,
            title_is_auto: new_title_is_auto,
            body: new_body,
            surface_data: new_surface,
        } = plan;

        let now = now_iso();
        let tx = self.conn.transaction()?;
        if let Some(expected) = &patch.expected_updated_at {
            let current: String = tx.query_row(
                "SELECT updated_at FROM notes WHERE id = ?1",
                params![id],
                |r| r.get(0),
            )?;
            if &current != expected {
                return Err(AppError::Conflict(format!(
                    "note {id} changed since it was read"
                )));
            }
        }
        tx.execute(
            "UPDATE notes SET \
               title = COALESCE(?1, title), \
               title_is_auto = COALESCE(?2, title_is_auto), \
               body = COALESCE(?3, body), \
               is_pinned = COALESCE(?4, is_pinned), \
               is_archived = COALESCE(?5, is_archived), \
               content_kind = ?6, \
               surface_data = COALESCE(?7, surface_data), \
               updated_at = ?8 \
             WHERE id = ?9",
            params![
                new_title,
                new_title_is_auto.map(i64::from),
                new_body.as_deref(),
                patch.is_pinned.map(i64::from),
                patch.is_archived.map(i64::from),
                kind,
                new_surface.as_deref(),
                now,
                id
            ],
        )?;
        if let Some(body) = &new_body {
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

    pub fn permanently_delete_note(&mut self, id: &str, confirm: bool) -> Result<()> {
        if !confirm {
            return Err(AppError::Validation(
                "permanent deletion requires explicit confirmation".into(),
            ));
        }
        self.fetch_note(id)?;
        self.conn
            .execute("DELETE FROM notes WHERE id = ?1", params![id])?;
        Ok(())
    }

    pub fn list_notes(&self, filter: NoteFilter) -> Result<Vec<Note>> {
        let filter = expand_revisit(filter, Utc::now());
        let (conditions, args) = note_conditions(&filter);
        let deleted = filter.is_deleted.unwrap_or(false);

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

        let pinned_first = if deleted { "" } else { "is_pinned DESC, " };
        let sql = format!(
            "SELECT {LIST_COLUMNS} FROM notes{} WHERE {} \
             ORDER BY {pinned_first}{order_column} {order_dir}, id ASC \
             LIMIT {limit} OFFSET {offset}",
            index_hint(&filter),
            conditions.join(" AND ")
        );
        let mut stmt = self.conn.prepare(&sql)?;
        let rows = stmt.query_map(
            rusqlite::params_from_iter(args.iter().map(|a| a.as_ref())),
            row_to_note,
        )?;
        Ok(rows.collect::<rusqlite::Result<Vec<_>>>()?)
    }

    pub fn count_notes(&self, filter: &NoteFilter) -> Result<i64> {
        let filter = expand_revisit(filter.clone(), Utc::now());
        let (conditions, args) = note_conditions(&filter);
        let sql = format!(
            "SELECT COUNT(*) FROM notes{} WHERE {}",
            index_hint(&filter),
            conditions.join(" AND ")
        );
        Ok(self.conn.query_row(
            &sql,
            rusqlite::params_from_iter(args.iter().map(|a| a.as_ref())),
            |r| r.get(0),
        )?)
    }

    pub fn search_notes_page(&self, q: &NoteSearch) -> Result<NoteSearchPage> {
        let Some(match_expr) = fts_match_expr_with(&q.text, q.any_term) else {
            return Ok(NoteSearchPage::default());
        };
        let mut conditions = vec!["notes_fts MATCH ?".to_string(), "n.is_deleted = ?".into()];
        let mut args: Vec<Box<dyn rusqlite::ToSql>> =
            vec![Box::new(match_expr), Box::new(i64::from(q.trashed))];
        if q.pinned_only {
            conditions.push("n.is_pinned = 1".into());
        }
        if let Some(archived) = q.is_archived {
            conditions.push("n.is_archived = ?".into());
            args.push(Box::new(i64::from(archived)));
        }
        if let Some(id) = &q.workspace_id {
            conditions.push(
                "n.id IN (SELECT note_id FROM note_workspaces WHERE workspace_id = ?)".into(),
            );
            args.push(Box::new(id.clone()));
        }
        if let Some(id) = &q.tag_id {
            conditions.push("n.id IN (SELECT note_id FROM note_tags WHERE tag_id = ?)".into());
            args.push(Box::new(id.clone()));
        }
        if let Some(after) = &q.updated_after {
            conditions.push("n.updated_at >= ?".into());
            args.push(Box::new(after.clone()));
        }
        if let Some(before) = &q.updated_before {
            conditions.push("n.updated_at < ?".into());
            args.push(Box::new(before.clone()));
        }
        let filter = conditions.join(" AND ");
        let from = "FROM notes_fts JOIN notes n ON n.seq = notes_fts.rowid";
        let total: i64 = self.conn.query_row(
            &format!("SELECT COUNT(*) {from} WHERE {filter}"),
            rusqlite::params_from_iter(args.iter().map(|a| a.as_ref())),
            |r| r.get(0),
        )?;
        let sql = format!(
            "SELECT n.id, n.title, n.body, \
                    snippet(notes_fts, 1, '\u{1}', '\u{2}', '…', 16), \
                    n.created_at, n.updated_at, n.is_archived, n.content_kind \
             {from} WHERE {filter} \
             ORDER BY lower(n.title) = lower(?) DESC, bm25(notes_fts), n.id LIMIT {} OFFSET {}",
            q.limit.clamp(1, 500),
            q.offset.max(0)
        );
        args.push(Box::new(q.text.trim().to_string()));
        let mut stmt = self.conn.prepare(&sql)?;
        let rows = stmt.query_map(
            rusqlite::params_from_iter(args.iter().map(|a| a.as_ref())),
            |row| {
                Ok(NoteMatch {
                    note_id: row.get(0)?,
                    title: row.get(1)?,
                    body: row.get(2)?,
                    excerpt: row.get(3)?,
                    created_at: row.get(4)?,
                    updated_at: row.get(5)?,
                    is_archived: row.get::<_, i64>(6)? != 0,
                    content_kind: row.get(7)?,
                })
            },
        )?;
        Ok(NoteSearchPage {
            matches: rows.collect::<rusqlite::Result<Vec<_>>>()?,
            total,
        })
    }
}

fn index_hint(filter: &NoteFilter) -> &'static str {
    let live = !filter.is_deleted.unwrap_or(false) && !filter.is_archived.unwrap_or(false);
    if live && filter.never_opened == Some(true) {
        " INDEXED BY idx_notes_revisit"
    } else {
        ""
    }
}

fn note_conditions(filter: &NoteFilter) -> (Vec<String>, Vec<Box<dyn rusqlite::ToSql>>) {
    let mut conditions: Vec<String> = Vec::new();
    let mut args: Vec<Box<dyn rusqlite::ToSql>> = Vec::new();

    let deleted = filter.is_deleted.unwrap_or(false);
    conditions.push(format!("is_deleted = {}", i64::from(deleted)));

    if !deleted {
        conditions.push(format!(
            "is_archived = {}",
            i64::from(filter.is_archived.unwrap_or(false))
        ));
    } else if let Some(archived) = filter.is_archived {
        conditions.push(format!("is_archived = {}", i64::from(archived)));
    }

    if let Some(pinned) = filter.is_pinned {
        conditions.push(format!("is_pinned = {}", i64::from(pinned)));
    }

    if filter.never_opened == Some(true) {
        conditions.push("last_opened_at IS NULL".into());
    }

    if let Some(created_before) = &filter.created_before {
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

    if let Some(after) = &filter.updated_after {
        conditions.push("updated_at >= ?".into());
        args.push(Box::new(after.clone()));
    }
    if let Some(before) = &filter.updated_before {
        conditions.push("updated_at < ?".into());
        args.push(Box::new(before.clone()));
    }

    (conditions, args)
}

impl Store {
    pub fn search_notes(&self, text: &str, limit: i64) -> Result<Vec<SearchResult>> {
        let Some(match_expr) = fts_match_expr(text) else {
            return Ok(Vec::new());
        };
        let limit = limit.clamp(1, 500);
        let mut stmt = self.conn.prepare(
            "SELECT n.id, highlight(notes_fts, 0, '\u{1}', '\u{2}'), \
                    snippet(notes_fts, 1, '\u{1}', '\u{2}', '…', 16), \
                    bm25(notes_fts), n.updated_at \
             FROM notes_fts \
             JOIN notes n ON n.seq = notes_fts.rowid \
             WHERE notes_fts MATCH ?1 AND n.is_deleted = 0 AND n.is_archived = 0 \
             ORDER BY lower(n.title) = lower(?3) DESC, bm25(notes_fts) \
             LIMIT ?2",
        )?;
        let rows = stmt.query_map(params![match_expr, limit, text.trim()], |row| {
            Ok(SearchResult {
                note_id: row.get(0)?,
                title: row.get(1)?,
                excerpt: row.get(2)?,
                score: -row.get::<_, f64>(3)?,
                updated_at: row.get(4)?,
            })
        })?;
        Ok(rows.collect::<rusqlite::Result<Vec<_>>>()?)
    }

    fn id_placeholders(ids: &[String]) -> String {
        vec!["?"; ids.len()].join(", ")
    }

    pub fn set_notes_flags(
        &mut self,
        ids: &[String],
        is_pinned: Option<bool>,
        is_archived: Option<bool>,
    ) -> Result<()> {
        if ids.is_empty() {
            return Ok(());
        }
        let now = now_iso();
        let pinned = is_pinned.map(i64::from);
        let archived = is_archived.map(i64::from);
        let sql = format!(
            "UPDATE notes SET \
               is_pinned = COALESCE(?, is_pinned), \
               is_archived = COALESCE(?, is_archived), \
               updated_at = ? \
             WHERE id IN ({})",
            Self::id_placeholders(ids)
        );
        let mut args: Vec<&dyn rusqlite::ToSql> = vec![&pinned, &archived, &now];
        for id in ids {
            args.push(id);
        }
        self.conn.execute(&sql, rusqlite::params_from_iter(args))?;
        Ok(())
    }

    pub fn soft_delete_notes(&mut self, ids: &[String]) -> Result<()> {
        if ids.is_empty() {
            return Ok(());
        }
        let now = now_iso();
        let sql = format!(
            "UPDATE notes SET is_deleted = 1, deleted_at = ?, updated_at = ? \
             WHERE id IN ({})",
            Self::id_placeholders(ids)
        );
        let mut args: Vec<&dyn rusqlite::ToSql> = vec![&now, &now];
        for id in ids {
            args.push(id);
        }
        self.conn.execute(&sql, rusqlite::params_from_iter(args))?;
        Ok(())
    }

    pub fn restore_notes(&mut self, ids: &[String]) -> Result<()> {
        if ids.is_empty() {
            return Ok(());
        }
        let now = now_iso();
        let sql = format!(
            "UPDATE notes SET is_deleted = 0, deleted_at = NULL, updated_at = ? \
             WHERE id IN ({})",
            Self::id_placeholders(ids)
        );
        let mut args: Vec<&dyn rusqlite::ToSql> = vec![&now];
        for id in ids {
            args.push(id);
        }
        self.conn.execute(&sql, rusqlite::params_from_iter(args))?;
        Ok(())
    }

    pub fn destroy_notes(&mut self, ids: &[String], confirm: bool) -> Result<()> {
        if !confirm {
            return Err(AppError::Validation(
                "permanent deletion requires confirmation".into(),
            ));
        }
        if ids.is_empty() {
            return Ok(());
        }
        let sql = format!(
            "DELETE FROM notes WHERE id IN ({})",
            Self::id_placeholders(ids)
        );
        let args: Vec<&dyn rusqlite::ToSql> =
            ids.iter().map(|id| id as &dyn rusqlite::ToSql).collect();
        self.conn.execute(&sql, rusqlite::params_from_iter(args))?;
        Ok(())
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn note(kind: &str) -> Note {
        Note {
            id: "n1".into(),
            title: "Roadmap".into(),
            body: "Roadmap\nfirst line".into(),
            created_at: "2026-09-01T00:00:00.000000Z".into(),
            updated_at: "2026-09-01T00:00:00.000000Z".into(),
            last_opened_at: None,
            is_pinned: false,
            is_archived: false,
            is_deleted: false,
            deleted_at: None,
            content_kind: kind.into(),
            surface_data: None,
        }
    }

    fn body(text: &str) -> UpdateNotePatch {
        UpdateNotePatch {
            body: Some(text.into()),
            ..Default::default()
        }
    }

    fn validation(r: Result<Option<UpdatePlan>>) -> String {
        match r {
            Err(AppError::Validation(m)) => m,
            other => panic!("expected a validation error, got {other:?}"),
        }
    }

    #[test]
    fn an_empty_patch_is_a_no_op() {
        let plan = plan_update(
            &note(CONTENT_KIND_DOCUMENT),
            true,
            &UpdateNotePatch::default(),
        );
        assert_eq!(plan.unwrap(), None);
    }

    #[test]
    fn a_flag_alone_keeps_the_title_and_kind() {
        let patch = UpdateNotePatch {
            is_pinned: Some(true),
            ..Default::default()
        };
        let plan = plan_update(&note(CONTENT_KIND_DOCUMENT), true, &patch).unwrap();
        assert_eq!(
            plan,
            Some(UpdatePlan {
                kind: CONTENT_KIND_DOCUMENT.into(),
                title: None,
                title_is_auto: None,
                body: None,
                surface_data: None,
            })
        );
    }

    #[test]
    fn an_auto_title_follows_the_body_of_a_document() {
        let plan = plan_update(&note(CONTENT_KIND_DOCUMENT), true, &body("Groceries\nmilk"))
            .unwrap()
            .unwrap();
        assert_eq!(plan.title.as_deref(), Some("Groceries"));
        assert_eq!(plan.title_is_auto, None);
    }

    #[test]
    fn a_pinned_title_ignores_the_body() {
        let plan = plan_update(
            &note(CONTENT_KIND_DOCUMENT),
            false,
            &body("Groceries\nmilk"),
        )
        .unwrap()
        .unwrap();
        assert_eq!(plan.title, None);
        assert_eq!(plan.title_is_auto, None);
    }

    #[test]
    fn an_explicit_title_pins_itself_trimmed() {
        let patch = UpdateNotePatch {
            title: Some("  Manual Title ".into()),
            body: Some("other words".into()),
            ..Default::default()
        };
        let plan = plan_update(&note(CONTENT_KIND_DOCUMENT), true, &patch)
            .unwrap()
            .unwrap();
        assert_eq!(plan.title.as_deref(), Some("Manual Title"));
        assert_eq!(plan.title_is_auto, Some(false));
    }

    #[test]
    fn a_blank_explicit_title_counts_as_none() {
        let patch = UpdateNotePatch {
            title: Some("   ".into()),
            body: Some("Groceries\nmilk".into()),
            ..Default::default()
        };
        let plan = plan_update(&note(CONTENT_KIND_DOCUMENT), true, &patch)
            .unwrap()
            .unwrap();
        assert_eq!(plan.title.as_deref(), Some("Groceries"));
        assert_eq!(plan.title_is_auto, None);
    }

    #[test]
    fn a_whiteboard_body_save_pins_its_auto_title() {
        let plan = plan_update(&note(CONTENT_KIND_WHITEBOARD), true, &body("moved text"))
            .unwrap()
            .unwrap();
        assert_eq!(plan.kind, CONTENT_KIND_WHITEBOARD);
        assert_eq!(plan.title, None);
        assert_eq!(plan.title_is_auto, Some(false));
    }

    #[test]
    fn converting_to_a_whiteboard_freezes_an_auto_title() {
        let patch = UpdateNotePatch {
            content_kind: Some(CONTENT_KIND_WHITEBOARD.into()),
            surface_data: Some("{}".into()),
            ..Default::default()
        };
        let plan = plan_update(&note(CONTENT_KIND_DOCUMENT), true, &patch)
            .unwrap()
            .unwrap();
        assert_eq!(plan.kind, CONTENT_KIND_WHITEBOARD);
        assert_eq!(plan.title, None);
        assert_eq!(plan.title_is_auto, Some(false));
    }

    #[test]
    fn a_whiteboard_cannot_become_a_document() {
        let patch = UpdateNotePatch {
            content_kind: Some(CONTENT_KIND_DOCUMENT.into()),
            ..Default::default()
        };
        let message = validation(plan_update(&note(CONTENT_KIND_WHITEBOARD), false, &patch));
        assert!(message.contains("cannot be turned back"), "{message}");
    }

    #[test]
    fn a_document_cannot_hold_a_canvas() {
        let patch = UpdateNotePatch {
            surface_data: Some("{}".into()),
            ..Default::default()
        };
        let message = validation(plan_update(&note(CONTENT_KIND_DOCUMENT), true, &patch));
        assert!(message.contains("only a whiteboard"), "{message}");
    }

    #[test]
    fn an_unknown_kind_is_rejected_by_name() {
        let patch = UpdateNotePatch {
            content_kind: Some("spreadsheet".into()),
            ..Default::default()
        };
        let message = validation(plan_update(&note(CONTENT_KIND_DOCUMENT), true, &patch));
        assert!(message.contains("spreadsheet"), "{message}");
    }

    const GRID: &str = r#"{"v":1,"engine":"grid","data":{"cols":[{"w":120},{"w":120}],"rows":[["Date","ms"],["2026-10-03","412"]]}}"#;

    #[test]
    fn an_empty_note_becomes_a_sheet_with_the_default_grid_and_name() {
        let mut empty = note(CONTENT_KIND_DOCUMENT);
        empty.body = String::new();
        let patch = UpdateNotePatch {
            content_kind: Some(CONTENT_KIND_SHEET.into()),
            ..Default::default()
        };
        let plan = plan_update(&empty, true, &patch).unwrap().unwrap();
        assert_eq!(plan.kind, CONTENT_KIND_SHEET);
        assert_eq!(plan.title.as_deref(), Some(sheet::DEFAULT_TITLE));
        assert_eq!(plan.title_is_auto, Some(false));
        assert_eq!(plan.body.as_deref(), Some(""));
        let grid = Sheet::parse(plan.surface_data.as_deref().unwrap()).unwrap();
        assert_eq!(grid, Sheet::new_default());
    }

    #[test]
    fn a_note_with_words_keeps_its_title_when_it_becomes_a_sheet() {
        let patch = UpdateNotePatch {
            content_kind: Some(CONTENT_KIND_SHEET.into()),
            surface_data: Some(GRID.into()),
            ..Default::default()
        };
        let plan = plan_update(&note(CONTENT_KIND_DOCUMENT), true, &patch)
            .unwrap()
            .unwrap();
        assert_eq!(plan.title, None);
        assert_eq!(plan.title_is_auto, Some(false));
        assert_eq!(
            plan.body.as_deref(),
            Some("| Date | ms |\n| --- | --- |\n| 2026-10-03 | 412 |")
        );
        assert_eq!(plan.surface_data.as_deref(), Some(GRID));
    }

    #[test]
    fn a_sheet_save_derives_its_body_and_ignores_the_one_sent() {
        let patch = UpdateNotePatch {
            body: Some("someone else's words".into()),
            surface_data: Some(GRID.into()),
            ..Default::default()
        };
        let plan = plan_update(&note(CONTENT_KIND_SHEET), false, &patch)
            .unwrap()
            .unwrap();
        assert!(plan.body.as_deref().unwrap().starts_with("| Date | ms |"));
        let plan = plan_update(&note(CONTENT_KIND_SHEET), false, &body("words"))
            .unwrap()
            .unwrap();
        assert_eq!(plan.body, None);
        assert_eq!(plan.surface_data, None);
    }

    #[test]
    fn a_bad_grid_is_a_validation_error() {
        let patch = UpdateNotePatch {
            surface_data: Some(
                r#"{"v":1,"engine":"grid","data":{"cols":[{"w":1}],"rows":[["a","b"]]}}"#.into(),
            ),
            ..Default::default()
        };
        let message = validation(plan_update(&note(CONTENT_KIND_SHEET), false, &patch));
        assert!(message.contains("row 1 has 2 cells"), "{message}");
    }

    #[test]
    fn a_sheet_cannot_become_a_whiteboard_or_a_document() {
        for kind in [CONTENT_KIND_WHITEBOARD, CONTENT_KIND_DOCUMENT] {
            let patch = UpdateNotePatch {
                content_kind: Some(kind.into()),
                ..Default::default()
            };
            let message = validation(plan_update(&note(CONTENT_KIND_SHEET), false, &patch));
            assert!(message.contains("a sheet cannot be turned"), "{message}");
        }
    }

    #[test]
    fn a_revisit_filter_expands_to_the_open_loop_conditions() {
        let now = chrono::DateTime::parse_from_rfc3339("2026-09-10T12:00:00Z")
            .unwrap()
            .with_timezone(&Utc);
        let filter = expand_revisit(
            NoteFilter {
                revisit: true,
                ..Default::default()
            },
            now,
        );
        assert_eq!(filter.never_opened, Some(true));
        assert_eq!(
            filter.created_before.as_deref(),
            Some("2026-09-07T12:00:00.000000Z")
        );
        assert_eq!(filter.sort_by.as_deref(), Some("createdAt"));
        assert_eq!(filter.sort_order.as_deref(), Some("asc"));
    }

    #[test]
    fn a_plain_filter_is_left_alone() {
        let filter = expand_revisit(
            NoteFilter {
                is_archived: Some(true),
                ..Default::default()
            },
            Utc::now(),
        );
        assert_eq!(filter.never_opened, None);
        assert_eq!(filter.created_before, None);
        assert_eq!(filter.is_archived, Some(true));
    }
}
