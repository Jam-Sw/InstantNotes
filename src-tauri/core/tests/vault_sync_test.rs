use instantnotes_core::types::*;
use instantnotes_core::vault::{parse_note, CycleReport, Folder, Syncer};
use instantnotes_core::Store;
use std::fs;
use std::path::{Path, PathBuf};
use std::sync::Mutex;

const GRID: &str = r#"{"v":1,"engine":"grid","data":{"cols":[{"w":120},{"w":80}],"rows":[["Build","ms"],["a1f3","412"],["",""]]}}"#;

struct Device {
    store: Mutex<Store>,
    syncer: Syncer,
    attachments: PathBuf,
    _home: tempfile::TempDir,
}

impl Device {
    fn join(root: &Path) -> Device {
        let mut store = Store::open_in_memory().unwrap();
        store.configure_vault(Some(root)).unwrap();
        Device::attach(store, root)
    }

    fn attach(store: Store, root: &Path) -> Device {
        let home = tempfile::tempdir().unwrap();
        let attachments = home.path().join("attachments");
        Device {
            store: Mutex::new(store),
            syncer: Syncer::new(
                Box::new(Folder::new(root.to_path_buf())),
                Some(attachments.clone()),
            ),
            attachments,
            _home: home,
        }
    }

    fn s(&self) -> std::sync::MutexGuard<'_, Store> {
        self.store.lock().unwrap()
    }

    fn sync(&mut self) -> CycleReport {
        let report = self.syncer.cycle(&self.store);
        assert!(report.errors.is_empty(), "sync errors: {:?}", report.errors);
        assert!(report.reached(), "unreachable: {:?}", report.unreachable);
        report
    }

    fn create(&self, title: &str, body: &str) -> Note {
        self.s()
            .create_note(CreateNoteInput {
                title: Some(title.to_string()),
                body: Some(body.to_string()),
                ..Default::default()
            })
            .unwrap()
    }

    fn edit(&self, id: &str, body: &str) {
        self.s()
            .update_note(
                id,
                UpdateNotePatch {
                    body: Some(body.to_string()),
                    ..Default::default()
                },
            )
            .unwrap();
    }

    fn note(&self, id: &str) -> Note {
        self.s().get_note(id, false).unwrap()
    }

    fn library(&self) -> Vec<Summary> {
        let s = self.s();
        let mut out = Vec::new();
        for filter in [
            NoteFilter::default(),
            NoteFilter {
                is_archived: Some(true),
                ..Default::default()
            },
            NoteFilter {
                is_deleted: Some(true),
                ..Default::default()
            },
        ] {
            for n in s.list_notes(filter).unwrap() {
                let mut tags: Vec<String> = s
                    .tags_for_note(&n.id)
                    .unwrap()
                    .into_iter()
                    .map(|t| t.name)
                    .collect();
                tags.sort();
                let mut spaces: Vec<String> = s
                    .workspaces_for_note(&n.id)
                    .unwrap()
                    .into_iter()
                    .map(|w| w.name)
                    .collect();
                spaces.sort();
                out.push(Summary {
                    id: n.id,
                    title: n.title,
                    body: n.body,
                    deleted: n.is_deleted,
                    tags,
                    spaces,
                });
            }
        }
        out.sort_by(|a, b| a.id.cmp(&b.id));
        out
    }

    fn pending(&self) -> i64 {
        self.s().vault_status().unwrap().pending
    }
}

#[derive(Debug, PartialEq)]
struct Summary {
    id: String,
    title: String,
    body: String,
    deleted: bool,
    tags: Vec<String>,
    spaces: Vec<String>,
}

fn pair() -> (tempfile::TempDir, Device, Device) {
    let share = tempfile::tempdir().unwrap();
    let a = Device::join(share.path());
    let b = Device::join(share.path());
    (share, a, b)
}

fn settle(a: &mut Device, b: &mut Device) {
    for _ in 0..3 {
        a.sync();
        b.sync();
    }
    assert_eq!(a.library(), b.library());
    assert_eq!(a.pending(), 0);
    assert_eq!(b.pending(), 0);
}

fn md_files(dir: &Path) -> Vec<String> {
    let mut names: Vec<String> = fs::read_dir(dir)
        .map(|entries| {
            entries
                .flatten()
                .map(|e| e.file_name().to_string_lossy().into_owned())
                .filter(|n| n.ends_with(".md") && !n.starts_with('.'))
                .collect()
        })
        .unwrap_or_default();
    names.sort();
    names
}

fn titled(device: &Device, title: &str) -> Vec<Summary> {
    device
        .library()
        .into_iter()
        .filter(|n| n.title.starts_with(title))
        .collect()
}

#[test]
fn a_note_made_on_one_device_arrives_on_the_other_whole() {
    let (_share, mut a, mut b) = pair();
    let n = a.create("Plan", "ship it #release");
    {
        let mut s = a.s();
        let lab = s.get_or_create_workspace("Lab").unwrap();
        s.add_note_to_workspace(&n.id, &lab.id).unwrap();
        s.add_tag_to_note(&n.id, "manual-one").unwrap();
    }
    a.sync();
    let arrived = b.sync();
    assert_eq!(arrived.notes, vec![n.id.clone()]);
    let got = b.note(&n.id);
    assert_eq!(got.title, "Plan");
    assert_eq!(got.body, "ship it #release");
    assert_eq!(got.created_at, n.created_at);
    settle(&mut a, &mut b);
    let summary = &b.library()[0];
    assert_eq!(summary.tags, vec!["manual-one", "release"]);
    assert_eq!(summary.spaces, vec!["Lab"]);
}

#[test]
fn a_device_does_not_read_its_own_writes_back_as_changes() {
    let (_share, mut a, _b) = pair();
    let n = a.create("Plan", "body");
    a.sync();
    a.edit(&n.id, "body two");
    let own = a.sync();
    assert!(own.notes.is_empty(), "{:?}", own.notes);
    assert!(a.sync().notes.is_empty());
    assert_eq!(a.note(&n.id).body, "body two");
}

#[test]
fn an_edit_travels_back_without_a_conflict() {
    let (_share, mut a, mut b) = pair();
    let n = a.create("Plan", "v1");
    settle(&mut a, &mut b);
    b.edit(&n.id, "v2 from b");
    b.sync();
    let report = a.sync();
    assert_eq!(report.notes, vec![n.id.clone()]);
    assert_eq!(report.conflicts, 0);
    assert_eq!(a.note(&n.id).body, "v2 from b");
    settle(&mut a, &mut b);
    assert_eq!(a.library().len(), 1);
}

#[test]
fn edits_on_both_devices_keep_both_versions() {
    let (_share, mut a, mut b) = pair();
    let n = a.create("Plan", "v1");
    settle(&mut a, &mut b);
    a.edit(&n.id, "from a");
    b.edit(&n.id, "from b");
    a.sync();
    let report = b.sync();
    assert_eq!(report.conflicts, 1);
    assert_eq!(b.note(&n.id).body, "from b");
    settle(&mut a, &mut b);
    let copies = titled(&a, "Plan (conflict ");
    assert_eq!(copies.len(), 1, "{:?}", a.library());
    assert_eq!(copies[0].body, "from a");
    assert!(copies[0].tags.contains(&"conflict".to_string()));
    assert_eq!(a.note(&n.id).body, "from b");
}

#[test]
fn trash_and_restore_travel_and_a_destroy_becomes_a_trash() {
    let (share, mut a, mut b) = pair();
    let n = a.create("Plan", "v1");
    settle(&mut a, &mut b);

    a.s().soft_delete_note(&n.id).unwrap();
    settle(&mut a, &mut b);
    assert!(b.note(&n.id).is_deleted);
    assert_eq!(md_files(&share.path().join("trash")), vec!["Plan.md"]);

    b.s().restore_note(&n.id).unwrap();
    settle(&mut a, &mut b);
    assert!(!a.note(&n.id).is_deleted);

    a.s().permanently_delete_note(&n.id, true).unwrap();
    a.sync();
    b.sync();
    assert!(b.note(&n.id).is_deleted, "a destroy elsewhere trashes here");
    assert!(md_files(share.path()).is_empty());
    b.sync();
    assert!(
        md_files(share.path()).is_empty(),
        "the trashed note came back"
    );
    assert!(md_files(&share.path().join("trash")).is_empty());
}

#[test]
fn a_rename_moves_the_file_and_never_duplicates_the_note() {
    let (share, mut a, mut b) = pair();
    let n = a.create("Plan", "v1");
    settle(&mut a, &mut b);
    a.s()
        .update_note(
            &n.id,
            UpdateNotePatch {
                title: Some("Roadmap".into()),
                ..Default::default()
            },
        )
        .unwrap();
    let other = a.create("Plan", "a new note under the old name");
    settle(&mut a, &mut b);
    assert_eq!(b.note(&n.id).title, "Roadmap");
    assert_eq!(b.note(&other.id).body, "a new note under the old name");
    assert_eq!(md_files(share.path()), vec!["Plan.md", "Roadmap.md"]);
    assert_eq!(b.library().len(), 2);
}

#[test]
fn tags_and_spaces_merge_by_name_and_removals_travel() {
    let (share, mut a, mut b) = pair();
    let tag = a.s().get_or_create_tag("work").unwrap();
    a.s()
        .update_tag(&tag.id, None, Some("#ff0000".into()))
        .unwrap();
    b.s().get_or_create_workspace("Someday").unwrap();
    b.s().get_or_create_tag("home").unwrap();
    settle(&mut a, &mut b);
    for d in [&a, &b] {
        let s = d.s();
        assert_eq!(
            s.find_tag("work").unwrap().unwrap().color.as_deref(),
            Some("#ff0000")
        );
        assert!(s.find_tag("home").unwrap().is_some());
        assert!(s.find_workspace("Someday").unwrap().is_some());
    }
    let someday = a.s().find_workspace("Someday").unwrap().unwrap();
    a.s().delete_workspace(&someday.id).unwrap();
    settle(&mut a, &mut b);
    assert!(b.s().find_workspace("Someday").unwrap().is_none());
    let manifest = fs::read_to_string(share.path().join("instantnotes.yaml")).unwrap();
    assert!(!manifest.contains("Someday"), "{manifest}");
    assert!(manifest.contains("home"), "{manifest}");
}

#[test]
fn an_unmounted_share_changes_nothing_and_edits_wait_for_it() {
    let parent = tempfile::tempdir().unwrap();
    let share = parent.path().join("share");
    fs::create_dir(&share).unwrap();
    let mut a = Device::join(&share);
    let mut b = Device::join(&share);
    let n = a.create("Plan", "v1");
    settle(&mut a, &mut b);

    let away = parent.path().join("away");
    fs::rename(&share, &away).unwrap();
    fs::create_dir(&share).unwrap();
    let report = b.syncer.cycle(&b.store);
    assert!(!report.reached());
    assert!(!b.note(&n.id).is_deleted);
    b.edit(&n.id, "written offline");
    assert!(!b.syncer.cycle(&b.store).reached());
    assert_eq!(b.pending(), 1);
    assert!(
        fs::read_dir(&share).unwrap().next().is_none(),
        "wrote into the mount point"
    );
    let status = b.s().vault_status().unwrap();
    assert!(!status.reachable);
    assert!(status.unreachable.unwrap().contains("instantnotes.yaml"));

    fs::remove_dir(&share).unwrap();
    fs::rename(&away, &share).unwrap();
    b.sync();
    a.sync();
    assert_eq!(a.note(&n.id).body, "written offline");
    assert!(b.s().vault_status().unwrap().reachable);
}

#[test]
fn a_mass_removal_waits_for_confirmation() {
    let (share, mut a, mut b) = pair();
    let ids: Vec<String> = (0..25)
        .map(|i| a.create(&format!("Note {i}"), "x").id)
        .collect();
    settle(&mut a, &mut b);
    for name in md_files(share.path()) {
        fs::remove_file(share.path().join(name)).unwrap();
    }
    let held = b.sync();
    assert_eq!(held.held_removals, 25);
    assert!(ids.iter().all(|id| !b.note(id).is_deleted));
    assert_eq!(b.s().vault_status().unwrap().held_removals, 25);
    assert_eq!(b.sync().held_removals, 25);

    b.s().confirm_vault_removals().unwrap();
    let applied = b.sync();
    assert_eq!(applied.held_removals, 0);
    assert!(ids.iter().all(|id| b.note(id).is_deleted));
    assert!(md_files(share.path()).is_empty());
}

#[test]
fn a_plain_markdown_file_dropped_in_becomes_one_note_everywhere() {
    let (share, mut a, mut b) = pair();
    fs::write(share.path().join("Shopping.md"), "eggs\nmilk #errands\n").unwrap();
    a.sync();
    b.sync();
    settle(&mut a, &mut b);
    let notes = a.library();
    assert_eq!(notes.len(), 1);
    assert_eq!(notes[0].title, "Shopping");
    assert_eq!(notes[0].body, "eggs\nmilk #errands\n");
    assert_eq!(notes[0].tags, vec!["errands"]);
    let written =
        parse_note(&fs::read_to_string(share.path().join("Shopping.md")).unwrap()).unwrap();
    assert_eq!(written.id, notes[0].id);
}

#[test]
fn a_file_edited_in_another_editor_is_read_in() {
    let (share, mut a, _b) = pair();
    let n = a.create("Plan", "v1");
    a.sync();
    let path = share.path().join("Plan.md");
    let text = fs::read_to_string(&path).unwrap();
    fs::write(&path, text.replace("v1", "v1, edited in vim #vim")).unwrap();
    let report = a.sync();
    assert_eq!(report.notes, vec![n.id.clone()]);
    assert_eq!(a.note(&n.id).body, "v1, edited in vim #vim");
    assert_eq!(a.library()[0].tags, vec!["vim"]);
    assert_eq!(a.pending(), 0);
}

#[test]
fn a_broken_edit_to_a_notes_frontmatter_is_reported_and_left_alone() {
    let (share, mut a, _b) = pair();
    let n = a.create("Plan", "v1");
    a.sync();
    let path = share.path().join("Plan.md");
    fs::write(&path, "---\nid: [unclosed\n---\nbody").unwrap();
    let report = a.syncer.cycle(&a.store);
    assert_eq!(report.errors.len(), 1, "{:?}", report.errors);
    assert_eq!(a.library().len(), 1);
    assert_eq!(a.note(&n.id).body, "v1");
    a.edit(&n.id, "v2");
    a.syncer.cycle(&a.store);
    assert_eq!(
        fs::read_to_string(&path).unwrap(),
        "---\nid: [unclosed\n---\nbody"
    );
    assert_eq!(a.pending(), 1);
}

#[test]
fn a_duplicated_file_becomes_its_own_note() {
    let (share, mut a, mut b) = pair();
    let n = a.create("Plan", "v1");
    settle(&mut a, &mut b);
    fs::copy(
        share.path().join("Plan.md"),
        share.path().join("Plan.sync-conflict-20261007-1.md"),
    )
    .unwrap();
    settle(&mut a, &mut b);
    let notes = a.library();
    assert_eq!(notes.len(), 2);
    assert!(notes.iter().any(|x| x.id == n.id && x.title == "Plan"));
    assert!(notes.iter().all(|x| x.body == "v1"));
    let copy = &titled(&a, "Plan (conflict ")[0];
    assert!(copy.tags.contains(&"conflict".to_string()));
    assert!(!share
        .path()
        .join("Plan.sync-conflict-20261007-1.md")
        .exists());
}

#[test]
fn a_joining_device_keeps_its_notes_and_gains_the_vaults() {
    let share = tempfile::tempdir().unwrap();
    let mut a = Device::join(share.path());
    a.create("From A", "a");
    a.sync();
    let mut store = Store::open_in_memory().unwrap();
    store
        .create_note(CreateNoteInput {
            title: Some("From B".into()),
            body: Some("b".into()),
            ..Default::default()
        })
        .unwrap();
    store.configure_vault(Some(share.path())).unwrap();
    let mut b = Device::attach(store, share.path());
    settle(&mut a, &mut b);
    let titles: Vec<String> = a.library().into_iter().map(|n| n.title).collect();
    assert_eq!(titles.len(), 2);
    assert!(titles.contains(&"From A".to_string()) && titles.contains(&"From B".to_string()));
    let revisit = b
        .s()
        .list_notes(NoteFilter {
            never_opened: Some(true),
            ..Default::default()
        })
        .unwrap();
    assert_eq!(revisit.len(), 1, "only B's own capture is unopened on B");
}

#[test]
fn surfaces_travel_and_a_csv_edited_elsewhere_is_read_in() {
    let (share, mut a, mut b) = pair();
    let n = a.create("Builds", "");
    a.s()
        .update_note(
            &n.id,
            UpdateNotePatch {
                content_kind: Some(CONTENT_KIND_SHEET.into()),
                surface_data: Some(GRID.into()),
                ..Default::default()
            },
        )
        .unwrap();
    settle(&mut a, &mut b);
    let got = b.note(&n.id);
    assert_eq!(got.content_kind, CONTENT_KIND_SHEET);
    assert!(got.surface_data.unwrap().contains("a1f3"));

    let csv = share.path().join("Builds.csv");
    let text = fs::read_to_string(&csv).unwrap();
    fs::write(&csv, format!("{text}b2c4,398\r\n")).unwrap();
    settle(&mut a, &mut b);
    for d in [&a, &b] {
        let note = d.note(&n.id);
        assert!(note.surface_data.unwrap().contains("b2c4"));
        assert!(note.body.contains("| b2c4 | 398 |"), "{}", note.body);
    }
}

#[test]
fn attachments_reach_every_device() {
    let (share, mut a, mut b) = pair();
    fs::create_dir_all(&a.attachments).unwrap();
    fs::write(a.attachments.join("img-1.png"), b"png").unwrap();
    a.sync();
    b.sync();
    assert_eq!(
        fs::read(share.path().join("attachments/img-1.png")).unwrap(),
        b"png"
    );
    assert_eq!(fs::read(b.attachments.join("img-1.png")).unwrap(), b"png");
}

#[test]
fn the_flush_never_overwrites_a_file_changed_since_it_was_written() {
    let (share, mut a, _b) = pair();
    let n = a.create("Plan", "v1");
    a.sync();
    let path = share.path().join("Plan.md");
    let theirs = fs::read_to_string(&path).unwrap().replace("v1", "theirs");
    fs::write(&path, &theirs).unwrap();
    a.edit(&n.id, "mine");
    let out = a.s().flush_vault(100).unwrap();
    assert_eq!(out.written, 0);
    assert_eq!(out.deferred, 1);
    assert_eq!(fs::read_to_string(&path).unwrap(), theirs);
    let report = a.sync();
    assert_eq!(report.conflicts, 1);
    assert_eq!(a.note(&n.id).body, "mine");
    assert_eq!(titled(&a, "Plan (conflict ")[0].body, "theirs");
}

#[test]
fn two_devices_adopting_one_file_at_once_agree_on_one_note() {
    let (share, mut a, mut b) = pair();
    fs::write(share.path().join("Idea.md"), "a plain file").unwrap();
    let rel = vec!["Idea.md".to_string()];
    let from_a = a.s().ingest_vault_files(share.path(), &rel).unwrap();
    let from_b = b.s().ingest_vault_files(share.path(), &rel).unwrap();
    assert_eq!(from_a.changed, from_b.changed);
    settle(&mut a, &mut b);
    assert_eq!(a.library().len(), 1);
    assert_eq!(md_files(share.path()), vec!["Idea.md"]);
}

#[test]
fn a_whiteboard_canvas_travels_and_reads_back() {
    let (share, mut a, mut b) = pair();
    let n = a.create("Board", "");
    let canvas = r#"{"v":1,"engine":"excalidraw","data":{"elements":[{"id":"e1","type":"text","text":"hello"}],"appState":{},"files":{}}}"#;
    a.s()
        .update_note(
            &n.id,
            UpdateNotePatch {
                content_kind: Some(CONTENT_KIND_WHITEBOARD.into()),
                surface_data: Some(canvas.into()),
                ..Default::default()
            },
        )
        .unwrap();
    settle(&mut a, &mut b);
    let got: serde_json::Value =
        serde_json::from_str(&b.note(&n.id).surface_data.unwrap()).unwrap();
    assert_eq!(got["data"]["elements"][0]["text"], "hello");
    assert!(share.path().join("Board.excalidraw").exists());
}

fn library_of(count: usize, prefix: &str) -> Store {
    let mut store = Store::open_in_memory().unwrap();
    for i in 0..count {
        store
            .create_note(CreateNoteInput {
                title: Some(format!("{prefix} {i}")),
                body: Some(format!("{prefix} body {i}")),
                ..Default::default()
            })
            .unwrap();
    }
    store
}

fn joined(store: Store, root: &Path) -> Device {
    let mut store = store;
    store.configure_vault(Some(root)).unwrap();
    Device::attach(store, root)
}

fn live(device: &Device) -> usize {
    device.library().iter().filter(|n| !n.deleted).count()
}

#[test]
fn an_empty_library_meeting_a_full_folder_takes_every_note() {
    let share = tempfile::tempdir().unwrap();
    let mut desk = joined(library_of(20, "Desk"), share.path());
    desk.sync();
    assert_eq!(md_files(share.path()).len(), 20);
    let mut web = Device::join(share.path());
    assert_eq!(web.sync().notes.len(), 20);
    settle(&mut desk, &mut web);
    assert_eq!(live(&web), 20);
    assert_eq!(live(&desk), 20);
    assert_eq!(md_files(share.path()).len(), 20);
}

#[test]
fn a_full_library_meeting_an_empty_folder_fills_it_and_keeps_every_note() {
    let share = tempfile::tempdir().unwrap();
    let mut web = Device::join(share.path());
    web.sync();
    web.sync();
    let mut desk = joined(library_of(20, "Desk"), share.path());
    settle(&mut desk, &mut web);
    assert_eq!(live(&desk), 20);
    assert_eq!(live(&web), 20);
    assert!(desk.library().iter().all(|n| !n.deleted));
    assert_eq!(md_files(share.path()).len(), 20);
}

#[test]
fn two_full_libraries_meeting_in_one_folder_keep_the_union() {
    let share = tempfile::tempdir().unwrap();
    let mut desk = joined(library_of(12, "Desk"), share.path());
    desk.sync();
    let mut web = joined(library_of(8, "Web"), share.path());
    settle(&mut desk, &mut web);
    assert_eq!(live(&desk), 20);
    assert_eq!(live(&web), 20);
    assert!(web.library().iter().all(|n| !n.deleted));
    assert_eq!(titled(&web, "Desk ").len(), 12);
    assert_eq!(titled(&desk, "Web ").len(), 8);
    assert_eq!(md_files(share.path()).len(), 20);
}

#[test]
fn one_note_edited_differently_on_both_sides_before_they_meet_keeps_both() {
    let first = tempfile::tempdir().unwrap();
    let (mut desk, mut web) = (Device::join(first.path()), Device::join(first.path()));
    let n = desk.create("Plan", "v1");
    settle(&mut desk, &mut web);
    let second = tempfile::tempdir().unwrap();
    let mut desk = joined(desk.store.into_inner().unwrap(), second.path());
    let mut web = joined(web.store.into_inner().unwrap(), second.path());
    desk.edit(&n.id, "from the desktop");
    web.edit(&n.id, "from the web");
    desk.sync();
    assert_eq!(web.sync().conflicts, 1);
    settle(&mut desk, &mut web);
    let plans = titled(&desk, "Plan");
    let mut bodies: Vec<&str> = plans.iter().map(|p| p.body.as_str()).collect();
    bodies.sort();
    assert_eq!(bodies, vec!["from the desktop", "from the web"]);
    assert!(plans.iter().all(|p| !p.deleted));
    let copies = titled(&desk, "Plan (conflict ");
    assert_eq!(copies.len(), 1);
    assert!(copies[0].tags.contains(&"conflict".to_string()));
}
