use super::*;

impl Store {
    pub fn library_graph(&self) -> Result<LibraryGraph> {
        const LIVE: &str = "n.is_deleted = 0 AND n.is_archived = 0";
        let notes = self.query_rows(
            &format!(
                "SELECT n.id, n.title, n.content_kind, n.is_pinned FROM notes n \
                 WHERE {LIVE} ORDER BY n.updated_at DESC, n.id"
            ),
            |r| {
                Ok(GraphNote {
                    id: r.get(0)?,
                    title: r.get(1)?,
                    content_kind: r.get(2)?,
                    is_pinned: r.get::<_, i64>(3)? != 0,
                })
            },
        )?;
        let tags = self.query_rows("SELECT id, name, color FROM tags ORDER BY name", |r| {
            Ok(GraphTag {
                id: r.get(0)?,
                name: r.get(1)?,
                color: r.get(2)?,
            })
        })?;
        let spaces = self.query_rows("SELECT id, name FROM workspaces ORDER BY name", |r| {
            Ok(GraphSpace {
                id: r.get(0)?,
                name: r.get(1)?,
            })
        })?;
        let links = self.query_rows(
            &format!(
                "SELECT e.note_id, e.tag_id, 'tag', e.source FROM note_tags e \
                   JOIN notes n ON n.id = e.note_id WHERE {LIVE} \
                 UNION ALL \
                 SELECT e.note_id, e.workspace_id, 'space', NULL FROM note_workspaces e \
                   JOIN notes n ON n.id = e.note_id WHERE {LIVE}"
            ),
            |r| {
                Ok(GraphLink {
                    note_id: r.get(0)?,
                    target_id: r.get(1)?,
                    kind: r.get(2)?,
                    source: r.get(3)?,
                })
            },
        )?;
        Ok(LibraryGraph {
            notes,
            tags,
            spaces,
            links,
        })
    }

    pub(super) fn query_rows<T>(
        &self,
        sql: &str,
        map: impl FnMut(&rusqlite::Row<'_>) -> rusqlite::Result<T>,
    ) -> Result<Vec<T>> {
        let mut stmt = self.conn.prepare(sql)?;
        let rows = stmt.query_map([], map)?;
        Ok(rows.collect::<rusqlite::Result<Vec<_>>>()?)
    }
}
