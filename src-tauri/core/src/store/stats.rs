//! Aggregate counts for the Settings dashboard. One cheap query per number;
//! the dashboard is opened rarely and never on a hot path.

use super::*;

impl Store {
    pub fn library_stats(&self) -> Result<LibraryStats> {
        let count = |sql: &str| -> Result<i64> { Ok(self.conn.query_row(sql, [], |r| r.get(0))?) };
        Ok(LibraryStats {
            notes_total: count("SELECT COUNT(*) FROM notes WHERE is_deleted = 0")?,
            notes_active: count(
                "SELECT COUNT(*) FROM notes WHERE is_deleted = 0 AND is_archived = 0",
            )?,
            notes_pinned: count(
                "SELECT COUNT(*) FROM notes WHERE is_deleted = 0 AND is_pinned = 1",
            )?,
            notes_archived: count(
                "SELECT COUNT(*) FROM notes WHERE is_deleted = 0 AND is_archived = 1",
            )?,
            notes_trashed: count("SELECT COUNT(*) FROM notes WHERE is_deleted = 1")?,
            tags: count("SELECT COUNT(*) FROM tags")?,
            spaces: count("SELECT COUNT(*) FROM workspaces")?,
        })
    }
}

#[cfg(test)]
mod tests {
    use crate::store::Store;
    use crate::types::CreateNoteInput;

    #[test]
    fn counts_notes_by_status_tags_and_spaces() {
        let mut store = Store::open_in_memory().unwrap();

        let a = store
            .create_note(CreateNoteInput {
                body: Some("one #work".into()),
                ..Default::default()
            })
            .unwrap();
        let b = store
            .create_note(CreateNoteInput {
                body: Some("two".into()),
                ..Default::default()
            })
            .unwrap();
        store.set_notes_flags(&[a.id.clone()], Some(true), None).unwrap();
        store.soft_delete_note(&b.id).unwrap();
        store.get_or_create_workspace("Ideas").unwrap();

        let s = store.library_stats().unwrap();
        assert_eq!(s.notes_total, 1); // b is trashed, a remains
        assert_eq!(s.notes_active, 1);
        assert_eq!(s.notes_pinned, 1);
        assert_eq!(s.notes_trashed, 1);
        assert_eq!(s.tags, 1); // #work, auto-extracted from a's body
        assert_eq!(s.spaces, 1);
    }
}
