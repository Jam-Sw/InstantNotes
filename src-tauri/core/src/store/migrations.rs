pub const MIGRATIONS: &[&str] = &[
    r#"
CREATE TABLE notes (
  seq            INTEGER PRIMARY KEY,
  id             TEXT NOT NULL UNIQUE,
  title          TEXT NOT NULL,
  title_is_auto  INTEGER NOT NULL DEFAULT 1,
  body           TEXT NOT NULL DEFAULT '',
  created_at     TEXT NOT NULL,
  updated_at     TEXT NOT NULL,
  last_opened_at TEXT,
  is_pinned      INTEGER NOT NULL DEFAULT 0,
  is_archived    INTEGER NOT NULL DEFAULT 0,
  is_deleted     INTEGER NOT NULL DEFAULT 0,
  deleted_at     TEXT,
  sync_state     TEXT NOT NULL DEFAULT 'local_only',
  version        INTEGER NOT NULL DEFAULT 1,
  last_synced_at TEXT
);
CREATE INDEX idx_notes_updated_at ON notes(updated_at DESC);
CREATE INDEX idx_notes_created_at ON notes(created_at DESC);
CREATE INDEX idx_notes_flags ON notes(is_deleted, is_archived, is_pinned);

CREATE TABLE tags (
  id         TEXT PRIMARY KEY,
  name       TEXT NOT NULL UNIQUE,
  color      TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE TABLE note_tags (
  note_id    TEXT NOT NULL REFERENCES notes(id) ON DELETE CASCADE,
  tag_id     TEXT NOT NULL REFERENCES tags(id) ON DELETE CASCADE,
  created_at TEXT NOT NULL,
  source     TEXT NOT NULL DEFAULT 'manual',
  PRIMARY KEY (note_id, tag_id)
);
CREATE INDEX idx_note_tags_tag ON note_tags(tag_id);

CREATE TABLE settings (
  key        TEXT PRIMARY KEY,
  value      TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE VIRTUAL TABLE notes_fts USING fts5(
  title, body,
  content='notes', content_rowid='seq',
  tokenize='porter unicode61'
);

CREATE TRIGGER notes_after_insert AFTER INSERT ON notes BEGIN
  INSERT INTO notes_fts(rowid, title, body) VALUES (new.seq, new.title, new.body);
END;
CREATE TRIGGER notes_ad AFTER DELETE ON notes BEGIN
  INSERT INTO notes_fts(notes_fts, rowid, title, body)
    VALUES ('delete', old.seq, old.title, old.body);
END;
CREATE TRIGGER notes_au AFTER UPDATE OF title, body ON notes BEGIN
  INSERT INTO notes_fts(notes_fts, rowid, title, body)
    VALUES ('delete', old.seq, old.title, old.body);
  INSERT INTO notes_fts(rowid, title, body) VALUES (new.seq, new.title, new.body);
END;
"#,
    r#"
CREATE TABLE workspaces (
  id         TEXT PRIMARY KEY,
  name       TEXT NOT NULL COLLATE NOCASE UNIQUE,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE TABLE note_workspaces (
  note_id      TEXT NOT NULL REFERENCES notes(id) ON DELETE CASCADE,
  workspace_id TEXT NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  created_at   TEXT NOT NULL,
  PRIMARY KEY (note_id, workspace_id)
);
CREATE INDEX idx_note_workspaces_ws ON note_workspaces(workspace_id);
"#,
    r#"
ALTER TABLE notes DROP COLUMN sync_state;
ALTER TABLE notes DROP COLUMN version;
ALTER TABLE notes DROP COLUMN last_synced_at;
"#,
    r#"
ALTER TABLE notes ADD COLUMN content_kind TEXT NOT NULL DEFAULT 'document';
ALTER TABLE notes ADD COLUMN surface_data TEXT;
"#,
    r#"
ALTER TABLE notes ADD COLUMN vault_path  TEXT;
ALTER TABLE notes ADD COLUMN file_sha    TEXT;
ALTER TABLE notes ADD COLUMN vault_dirty INTEGER NOT NULL DEFAULT 0;
CREATE INDEX idx_notes_vault_dirty ON notes(vault_dirty) WHERE vault_dirty = 1;
CREATE INDEX idx_notes_vault_path ON notes(vault_path COLLATE NOCASE)
  WHERE vault_path IS NOT NULL;

CREATE TABLE vault_tombstones (
  vault_path TEXT PRIMARY KEY,
  file_sha   TEXT
);

CREATE TRIGGER notes_vault_ai AFTER INSERT ON notes BEGIN
  UPDATE notes SET vault_dirty = 1 WHERE seq = new.seq;
END;
CREATE TRIGGER notes_vault_au AFTER UPDATE OF
  title, title_is_auto, body, created_at, updated_at,
  is_pinned, is_archived, is_deleted, deleted_at ON notes BEGIN
  UPDATE notes SET vault_dirty = 1 WHERE seq = new.seq;
END;
CREATE TRIGGER notes_vault_ad AFTER DELETE ON notes
  WHEN old.vault_path IS NOT NULL BEGIN
  INSERT OR REPLACE INTO vault_tombstones (vault_path, file_sha)
    VALUES (old.vault_path, old.file_sha);
END;

CREATE TRIGGER note_tags_vault_ai AFTER INSERT ON note_tags BEGIN
  UPDATE notes SET vault_dirty = 1 WHERE id = new.note_id;
END;
CREATE TRIGGER note_tags_vault_ad AFTER DELETE ON note_tags BEGIN
  UPDATE notes SET vault_dirty = 1 WHERE id = old.note_id;
END;
CREATE TRIGGER note_workspaces_vault_ai AFTER INSERT ON note_workspaces BEGIN
  UPDATE notes SET vault_dirty = 1 WHERE id = new.note_id;
END;
CREATE TRIGGER note_workspaces_vault_ad AFTER DELETE ON note_workspaces BEGIN
  UPDATE notes SET vault_dirty = 1 WHERE id = old.note_id;
END;

CREATE TRIGGER tags_vault_au AFTER UPDATE OF name ON tags
  WHEN old.name IS NOT new.name BEGIN
  UPDATE notes SET vault_dirty = 1
    WHERE id IN (SELECT note_id FROM note_tags WHERE tag_id = new.id);
END;
CREATE TRIGGER workspaces_vault_au AFTER UPDATE OF name ON workspaces
  WHEN old.name IS NOT new.name BEGIN
  UPDATE notes SET vault_dirty = 1
    WHERE id IN (SELECT note_id FROM note_workspaces WHERE workspace_id = new.id);
END;
"#,
    r#"
ALTER TABLE notes ADD COLUMN board_sha TEXT;

DROP TRIGGER notes_vault_au;
CREATE TRIGGER notes_vault_au AFTER UPDATE OF
  title, title_is_auto, body, created_at, updated_at,
  is_pinned, is_archived, is_deleted, deleted_at,
  content_kind, surface_data ON notes BEGIN
  UPDATE notes SET vault_dirty = 1 WHERE seq = new.seq;
END;

DROP TRIGGER notes_vault_ad;
CREATE TRIGGER notes_vault_ad AFTER DELETE ON notes
  WHEN old.vault_path IS NOT NULL BEGIN
  INSERT OR REPLACE INTO vault_tombstones (vault_path, file_sha)
    VALUES (old.vault_path, old.file_sha);
  INSERT OR REPLACE INTO vault_tombstones (vault_path, file_sha)
    SELECT substr(old.vault_path, 1, length(old.vault_path) - 3) || '.excalidraw',
           old.board_sha
    WHERE old.board_sha IS NOT NULL;
END;
"#,
    r#"
CREATE TABLE agent_activity (
  seq              INTEGER PRIMARY KEY,
  at               INTEGER NOT NULL,
  session          TEXT NOT NULL,
  client           TEXT NOT NULL,
  tool             TEXT NOT NULL,
  kind             TEXT NOT NULL,
  status           TEXT NOT NULL,
  error            TEXT,
  duration_ms      INTEGER NOT NULL DEFAULT 0,
  note_ids         TEXT NOT NULL DEFAULT '[]',
  note_count       INTEGER NOT NULL DEFAULT 0,
  titles           TEXT NOT NULL DEFAULT '[]',
  space            TEXT,
  tag              TEXT,
  query            TEXT,
  after_updated_at TEXT,
  before           TEXT,
  reverted_at      INTEGER,
  reverts          INTEGER
);
"#,
    r#"
ALTER TABLE agent_activity ADD COLUMN request TEXT;
ALTER TABLE agent_activity ADD COLUMN response TEXT;
"#,
    r#"
CREATE TABLE agent_sessions (
  session         TEXT PRIMARY KEY,
  client          TEXT NOT NULL,
  connected_at    INTEGER NOT NULL,
  disconnected_at INTEGER
);
"#,
    r#"
ALTER TABLE agent_sessions ADD COLUMN label TEXT;
ALTER TABLE agent_sessions ADD COLUMN client_session TEXT;
ALTER TABLE agent_sessions ADD COLUMN cwd TEXT;
ALTER TABLE agent_sessions ADD COLUMN client_pid INTEGER;
"#,
    r#"
ALTER TABLE agent_sessions ADD COLUMN matched TEXT;
"#,
    r#"
DROP TRIGGER notes_vault_ad;
CREATE TRIGGER notes_vault_ad AFTER DELETE ON notes
  WHEN old.vault_path IS NOT NULL BEGIN
  INSERT OR REPLACE INTO vault_tombstones (vault_path, file_sha)
    VALUES (old.vault_path, old.file_sha);
  INSERT OR REPLACE INTO vault_tombstones (vault_path, file_sha)
    SELECT substr(old.vault_path, 1, length(old.vault_path) - 3)
             || CASE old.content_kind WHEN 'sheet' THEN '.csv' ELSE '.excalidraw' END,
           old.board_sha
    WHERE old.board_sha IS NOT NULL;
END;
"#,
    r#"
DROP INDEX idx_notes_flags;
CREATE INDEX idx_notes_list ON notes(is_deleted, is_archived, is_pinned DESC, updated_at DESC, id);
CREATE INDEX idx_notes_revisit ON notes(created_at, id)
  WHERE is_deleted = 0 AND is_archived = 0 AND last_opened_at IS NULL;
"#,
    r#"
DROP TABLE notes_fts;
CREATE VIRTUAL TABLE notes_fts USING fts5(
  title, body,
  content='notes', content_rowid='seq',
  tokenize='porter unicode61',
  prefix='1 2 3'
);
INSERT INTO notes_fts(notes_fts) VALUES ('rebuild');
"#,
    r#"
CREATE TABLE sync_objects (
  key        TEXT PRIMARY KEY,
  name       TEXT NOT NULL,
  remote_sha TEXT
);
CREATE INDEX idx_sync_objects_name ON sync_objects(name);
CREATE TABLE attachment_files (
  name       TEXT PRIMARY KEY,
  bytes      BLOB NOT NULL,
  created_at INTEGER NOT NULL
);
"#,
    r#"
ALTER TABLE workspaces ADD COLUMN color TEXT;
ALTER TABLE workspaces ADD COLUMN flag INTEGER NOT NULL DEFAULT 0;
"#,
    r#"
CREATE TABLE agent_scratch (
  seq     INTEGER PRIMARY KEY,
  at      INTEGER NOT NULL,
  session TEXT NOT NULL,
  client  TEXT NOT NULL,
  kind    TEXT NOT NULL,
  text    TEXT NOT NULL
);
CREATE INDEX idx_agent_scratch_session ON agent_scratch(session, seq);
"#,
];

#[cfg(test)]
mod migration_tests {
    use crate::store::{Store, MIGRATIONS};
    use rusqlite::Connection;
    use tempfile::tempdir;

    fn note_columns(conn: &Connection) -> Vec<String> {
        let mut stmt = conn.prepare("PRAGMA table_info(notes)").unwrap();
        let cols: Vec<String> = stmt
            .query_map([], |r| r.get::<_, String>(1))
            .unwrap()
            .map(|r| r.unwrap())
            .collect();
        cols
    }

    #[test]
    fn v3_drops_sync_columns_and_preserves_notes() {
        let dir = tempdir().unwrap();
        let path = dir.path().join("legacy.db");

        {
            let conn = Connection::open(&path).unwrap();
            conn.execute_batch(MIGRATIONS[0]).unwrap();
            conn.execute_batch(MIGRATIONS[1]).unwrap();
            conn.pragma_update(None, "user_version", 2i64).unwrap();
            conn.execute(
                "INSERT INTO notes (id, title, body, created_at, updated_at, \
                 sync_state, version) \
                 VALUES ('n1', 'Kept', 'the body', 't', 't', 'local_only', 3)",
                [],
            )
            .unwrap();
            assert!(note_columns(&conn).contains(&"sync_state".to_string()));
        }

        let mut store = Store::open(&path).unwrap();

        let cols = note_columns(&store.conn);
        assert!(!cols.contains(&"sync_state".to_string()));
        assert!(!cols.contains(&"version".to_string()));
        assert!(!cols.contains(&"last_synced_at".to_string()));

        let note = store.get_note("n1", false).unwrap();
        assert_eq!(note.title, "Kept");
        assert_eq!(note.body, "the body");
        let all = store.list_notes(Default::default()).unwrap();
        assert!(all.iter().any(|n| n.id == "n1"));
    }

    #[test]
    fn a_whiteboard_v4_library_migrates_to_the_vault_schema() {
        let dir = tempdir().unwrap();
        let path = dir.path().join("whiteboard.db");
        {
            let conn = Connection::open(&path).unwrap();
            for sql in &MIGRATIONS[..3] {
                conn.execute_batch(sql).unwrap();
            }
            conn.execute_batch(
                "ALTER TABLE notes ADD COLUMN content_kind TEXT NOT NULL DEFAULT 'document';
                 ALTER TABLE notes ADD COLUMN surface_data TEXT;",
            )
            .unwrap();
            conn.pragma_update(None, "user_version", 4i64).unwrap();
            conn.execute(
                "INSERT INTO notes (id, title, body, created_at, updated_at, content_kind) \
                 VALUES ('n1', 'Board', 'the body', 't', 't', 'whiteboard')",
                [],
            )
            .unwrap();
        }

        let mut store = Store::open(&path).unwrap();

        let cols = note_columns(&store.conn);
        for col in ["content_kind", "surface_data", "vault_path", "vault_dirty"] {
            assert!(cols.contains(&col.to_string()), "missing {col}");
        }
        let kind: String = store
            .conn
            .query_row("SELECT content_kind FROM notes WHERE id = 'n1'", [], |r| {
                r.get(0)
            })
            .unwrap();
        assert_eq!(kind, "whiteboard");
        assert_eq!(store.get_note("n1", false).unwrap().body, "the body");
    }

    #[test]
    fn v6_tracks_whiteboard_canvases_in_the_vault() {
        let dir = tempdir().unwrap();
        let path = dir.path().join("v5.db");
        {
            let conn = Connection::open(&path).unwrap();
            for sql in &MIGRATIONS[..5] {
                conn.execute_batch(sql).unwrap();
            }
            conn.pragma_update(None, "user_version", 5i64).unwrap();
        }

        let store = Store::open(&path).unwrap();
        assert!(note_columns(&store.conn).contains(&"board_sha".to_string()));
        store
            .conn
            .execute_batch(
                "INSERT INTO notes (id, title, body, created_at, updated_at, vault_path, \
                 file_sha, board_sha) VALUES ('n1', 'B', '', 't', 't', 'B.md', 'a', 'b');
                 DELETE FROM notes WHERE id = 'n1';",
            )
            .unwrap();
        let mut stmt = store
            .conn
            .prepare("SELECT vault_path, file_sha FROM vault_tombstones ORDER BY vault_path")
            .unwrap();
        let rows: Vec<(String, String)> = stmt
            .query_map([], |r| Ok((r.get(0)?, r.get(1)?)))
            .unwrap()
            .map(|r| r.unwrap())
            .collect();
        assert_eq!(
            rows,
            vec![
                ("B.excalidraw".to_string(), "b".to_string()),
                ("B.md".to_string(), "a".to_string()),
            ]
        );
    }

    #[test]
    fn v12_tombstones_a_sheet_csv_beside_a_board_canvas() {
        let dir = tempdir().unwrap();
        let path = dir.path().join("v11.db");
        {
            let conn = Connection::open(&path).unwrap();
            for sql in &MIGRATIONS[..11] {
                conn.execute_batch(sql).unwrap();
            }
            conn.pragma_update(None, "user_version", 11i64).unwrap();
        }

        let store = Store::open(&path).unwrap();
        store
            .conn
            .execute_batch(
                "INSERT INTO notes (id, title, body, created_at, updated_at, content_kind, \
                 vault_path, file_sha, board_sha) VALUES \
                 ('b1', 'B', '', 't', 't', 'whiteboard', 'B.md', 'a', 'b'), \
                 ('s1', 'S', '', 't', 't', 'sheet', 'S.md', 'c', 'd');
                 DELETE FROM notes WHERE id IN ('b1', 's1');",
            )
            .unwrap();
        let mut stmt = store
            .conn
            .prepare("SELECT vault_path, file_sha FROM vault_tombstones ORDER BY vault_path")
            .unwrap();
        let rows: Vec<(String, String)> = stmt
            .query_map([], |r| Ok((r.get(0)?, r.get(1)?)))
            .unwrap()
            .map(|r| r.unwrap())
            .collect();
        assert_eq!(
            rows,
            vec![
                ("B.excalidraw".to_string(), "b".to_string()),
                ("B.md".to_string(), "a".to_string()),
                ("S.csv".to_string(), "d".to_string()),
                ("S.md".to_string(), "c".to_string()),
            ]
        );
    }

    fn index_names(conn: &Connection) -> Vec<String> {
        let mut stmt = conn.prepare("PRAGMA index_list('notes')").unwrap();
        stmt.query_map([], |r| r.get::<_, String>(1))
            .unwrap()
            .map(|r| r.unwrap())
            .collect()
    }

    fn plan(conn: &Connection, sql: &str) -> String {
        let mut stmt = conn.prepare(&format!("EXPLAIN QUERY PLAN {sql}")).unwrap();
        stmt.query_map([], |r| r.get::<_, String>(3))
            .unwrap()
            .map(|r| r.unwrap())
            .collect::<Vec<_>>()
            .join(" | ")
    }

    #[test]
    fn v13_swaps_the_flags_index_for_the_list_and_revisit_indexes() {
        let dir = tempdir().unwrap();
        let path = dir.path().join("v12.db");
        {
            let conn = Connection::open(&path).unwrap();
            for sql in &MIGRATIONS[..12] {
                conn.execute_batch(sql).unwrap();
            }
            conn.pragma_update(None, "user_version", 12i64).unwrap();
            conn.execute(
                "INSERT INTO notes (id, title, body, created_at, updated_at) \
                 VALUES ('n1', 'Kept', 'the body', 't', 't')",
                [],
            )
            .unwrap();
            assert!(index_names(&conn).contains(&"idx_notes_flags".to_string()));
        }

        let mut store = Store::open(&path).unwrap();
        let indexes = index_names(&store.conn);
        assert!(!indexes.contains(&"idx_notes_flags".to_string()));
        assert!(indexes.contains(&"idx_notes_list".to_string()));
        assert!(indexes.contains(&"idx_notes_revisit".to_string()));
        assert_eq!(store.get_note("n1", false).unwrap().body, "the body");
    }

    #[test]
    fn v14_adds_a_prefix_index_to_search_and_keeps_every_result() {
        let dir = tempdir().unwrap();
        let path = dir.path().join("v13.db");
        let words = [
            "alpha",
            "alphabet",
            "beta",
            "gamma",
            "garden",
            "gardening",
            "delta",
            "note",
            "notes",
            "quick",
            "quickly",
            "wonder",
            "world",
            "word",
            "words",
            "work",
            "working",
        ];
        {
            let conn = Connection::open(&path).unwrap();
            for sql in &MIGRATIONS[..13] {
                conn.execute_batch(sql).unwrap();
            }
            conn.pragma_update(None, "user_version", 13i64).unwrap();
            for i in 0..60 {
                let title = format!(
                    "{} {}",
                    words[i % words.len()],
                    words[(i * 7) % words.len()]
                );
                let body = (0..40)
                    .map(|j| words[(i * 3 + j * 5) % words.len()])
                    .collect::<Vec<_>>()
                    .join(" ");
                conn.execute(
                    "INSERT INTO notes (id, title, body, created_at, updated_at) \
                     VALUES (?1, ?2, ?3, 't', 't')",
                    rusqlite::params![format!("n{i}"), title, body],
                )
                .unwrap();
            }
            conn.execute(
                "UPDATE notes SET body = body || ' extra' WHERE id = 'n3'",
                [],
            )
            .unwrap();
            conn.execute("DELETE FROM notes WHERE id = 'n9'", [])
                .unwrap();
        }

        let store = Store::open(&path).unwrap();
        let ddl: String = store
            .conn
            .query_row(
                "SELECT sql FROM sqlite_master WHERE name = 'notes_fts'",
                [],
                |r| r.get(0),
            )
            .unwrap();
        assert!(ddl.contains("prefix='1 2 3'"), "{ddl}");

        store
            .conn
            .execute_batch(
                "CREATE VIRTUAL TABLE notes_fts_plain USING fts5(\
                   title, body, content='notes', content_rowid='seq', \
                   tokenize='porter unicode61'); \
                 INSERT INTO notes_fts_plain(notes_fts_plain) VALUES ('rebuild');",
            )
            .unwrap();
        let ranked = |table: &str, q: &str| -> Vec<(String, f64)> {
            let expr = crate::store::fts_match_expr(q).unwrap();
            let mut stmt = store
                .conn
                .prepare(&format!(
                    "SELECT n.id, bm25({table}) FROM {table} \
                     JOIN notes n ON n.seq = {table}.rowid \
                     WHERE {table} MATCH ?1 ORDER BY bm25({table}), {table}.rowid"
                ))
                .unwrap();
            let rows = stmt
                .query_map([expr], |r| Ok((r.get(0)?, r.get(1)?)))
                .unwrap();
            rows.collect::<rusqlite::Result<Vec<_>>>().unwrap()
        };
        let mut matched = 0;
        for q in [
            "a",
            "al",
            "alp",
            "alph",
            "w",
            "wo",
            "wor",
            "word",
            "work working",
            "g",
            "ga",
            "qui",
            "n",
            "extra",
            "zzz",
            "alpha beta",
            "d",
        ] {
            let with_prefix = ranked("notes_fts", q);
            assert_eq!(with_prefix, ranked("notes_fts_plain", q), "{q}");
            assert_eq!(
                store
                    .search_notes(q, 500)
                    .unwrap()
                    .into_iter()
                    .map(|r| r.note_id)
                    .collect::<Vec<_>>(),
                with_prefix.iter().map(|r| r.0.clone()).collect::<Vec<_>>(),
                "{q}"
            );
            matched += with_prefix.len();
        }
        assert!(matched > 200);

        store
            .conn
            .execute(
                "UPDATE notes SET body = 'freshly written wonderland' WHERE id = 'n4'",
                [],
            )
            .unwrap();
        let hits = store.search_notes("wonderl", 10).unwrap();
        assert_eq!(hits.len(), 1);
        assert_eq!(hits[0].note_id, "n4");
    }

    #[test]
    fn the_default_list_reads_in_index_order_without_sorting() {
        let store = Store::open_in_memory().unwrap();
        let listed = plan(
            &store.conn,
            "SELECT id FROM notes WHERE is_deleted = 0 AND is_archived = 0 \
             ORDER BY is_pinned DESC, updated_at DESC, id ASC LIMIT 500",
        );
        assert!(listed.contains("idx_notes_list"), "{listed}");
        assert!(!listed.contains("TEMP B-TREE"), "{listed}");
    }

    #[test]
    fn the_revisit_filter_can_use_its_own_index() {
        let store = Store::open_in_memory().unwrap();
        let counted = plan(
            &store.conn,
            "SELECT COUNT(*) FROM notes INDEXED BY idx_notes_revisit \
             WHERE is_deleted = 0 AND is_archived = 0 AND last_opened_at IS NULL \
             AND created_at < 'z'",
        );
        assert!(counted.contains("idx_notes_revisit"), "{counted}");
    }

    #[test]
    fn v3_library_gains_vault_columns_and_preserves_notes() {
        let dir = tempdir().unwrap();
        let path = dir.path().join("v3.db");
        {
            let conn = Connection::open(&path).unwrap();
            for sql in &MIGRATIONS[..3] {
                conn.execute_batch(sql).unwrap();
            }
            conn.pragma_update(None, "user_version", 3i64).unwrap();
            conn.execute(
                "INSERT INTO notes (id, title, body, created_at, updated_at) \
                 VALUES ('n1', 'Kept', 'the body', 't', 't')",
                [],
            )
            .unwrap();
        }

        let mut store = Store::open(&path).unwrap();

        let cols = note_columns(&store.conn);
        for col in ["vault_path", "file_sha", "vault_dirty"] {
            assert!(cols.contains(&col.to_string()), "missing {col}");
        }
        let dirty: i64 = store
            .conn
            .query_row("SELECT vault_dirty FROM notes WHERE id = 'n1'", [], |r| {
                r.get(0)
            })
            .unwrap();
        assert_eq!(dirty, 0);
        assert_eq!(store.get_note("n1", false).unwrap().body, "the body");
    }
}
