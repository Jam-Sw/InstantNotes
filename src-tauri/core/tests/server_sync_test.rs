use instantnotes_core::store::server_sync::MergeReview;
use instantnotes_core::sync::crypto::{LibraryKey, Lock};
use instantnotes_core::sync::cycle::{ModeCheck, ServerSync, SyncReport};
use instantnotes_core::sync::object::sha_hex;
use instantnotes_core::sync::remote::{
    Remote, RemoteChange, RemoteChanges, RemoteError, RemoteKeys, RemoteOp,
};
use instantnotes_core::types::*;
use instantnotes_core::Store;
use std::cell::RefCell;
use std::collections::{BTreeMap, HashMap};
use std::path::PathBuf;
use std::rc::Rc;
use std::sync::Mutex;

const GRID: &str = r#"{"v":1,"engine":"grid","data":{"cols":[{"w":120},{"w":80}],"rows":[["Build","ms"],["a1f3","412"],["",""]]}}"#;
const CANVAS: &str = r#"{"v":1,"engine":"excalidraw","data":{"elements":[{"id":"e1","type":"text","text":"hello"}],"appState":{},"files":{}}}"#;

#[derive(Clone)]
struct Row {
    sha: Option<String>,
    seq: i64,
}

#[derive(Default)]
struct Server {
    library_id: String,
    epoch: i64,
    head: i64,
    mode: Option<String>,
    recipient: Option<String>,
    objects: BTreeMap<(i64, String), Row>,
    blobs: HashMap<String, Vec<u8>>,
    page_limit: usize,
    budget: Option<usize>,
    uploaded: usize,
    max_object: u64,
}

impl Server {
    fn new() -> Rc<RefCell<Server>> {
        Rc::new(RefCell::new(Server {
            library_id: "library-1".into(),
            epoch: 1,
            max_object: u64::MAX,
            ..Default::default()
        }))
    }

    fn live_blobs(&self) -> Vec<&Vec<u8>> {
        self.objects
            .iter()
            .filter(|((epoch, _), _)| *epoch == self.epoch)
            .filter_map(|(_, row)| row.sha.as_ref())
            .filter_map(|sha| self.blobs.get(sha))
            .collect()
    }
}

struct Handle {
    server: Rc<RefCell<Server>>,
    online: Rc<RefCell<bool>>,
}

impl Handle {
    fn up(&self) -> Result<(), RemoteError> {
        if !*self.online.borrow() {
            return Err(RemoteError::Unreachable("offline".into()));
        }
        let mut s = self.server.borrow_mut();
        match &mut s.budget {
            Some(0) => Err(RemoteError::Unreachable("connection dropped".into())),
            Some(left) => {
                *left -= 1;
                Ok(())
            }
            None => Ok(()),
        }
    }
}

impl Remote for Handle {
    fn changes(&mut self, since: i64) -> Result<RemoteChanges, RemoteError> {
        self.up()?;
        let s = self.server.borrow();
        if since > s.head {
            return Err(RemoteError::Gone);
        }
        let mut changes: Vec<RemoteChange> = s
            .objects
            .iter()
            .filter(|((epoch, _), row)| *epoch == s.epoch && row.seq > since)
            .map(|((_, name), row)| RemoteChange {
                name: name.clone(),
                sha: row.sha.clone(),
                seq: row.seq,
            })
            .collect();
        changes.sort_by_key(|c| c.seq);
        let mut more = false;
        if s.page_limit > 0 && changes.len() > s.page_limit {
            let last = changes[s.page_limit - 1].seq;
            let whole = changes.iter().take_while(|c| c.seq <= last).count();
            more = whole < changes.len();
            changes.truncate(whole);
        }
        Ok(RemoteChanges {
            library_id: s.library_id.clone(),
            epoch: s.epoch,
            head: s.head,
            changes,
            more,
        })
    }

    fn max_object_bytes(&self) -> u64 {
        self.server.borrow().max_object
    }

    fn missing(&mut self, shas: &[String]) -> Result<Vec<String>, RemoteError> {
        self.up()?;
        let s = self.server.borrow();
        Ok(shas
            .iter()
            .filter(|h| !s.blobs.contains_key(*h))
            .cloned()
            .collect())
    }

    fn upload(&mut self, blobs: &[(String, Vec<u8>)]) -> Result<(), RemoteError> {
        self.up()?;
        let mut s = self.server.borrow_mut();
        for (sha, bytes) in blobs {
            assert_eq!(&sha_hex(bytes), sha);
            assert!(bytes.len() as u64 <= s.max_object);
            s.uploaded += 1;
            s.blobs.insert(sha.clone(), bytes.clone());
        }
        Ok(())
    }

    fn download(&mut self, shas: &[String]) -> Result<Vec<(String, Vec<u8>)>, RemoteError> {
        self.up()?;
        let s = self.server.borrow();
        Ok(shas
            .iter()
            .filter_map(|sha| s.blobs.get(sha).map(|b| (sha.clone(), b.clone())))
            .collect())
    }

    fn commit(&mut self, epoch: i64, ops: &[RemoteOp]) -> Result<i64, RemoteError> {
        self.up()?;
        let mut s = self.server.borrow_mut();
        if epoch != s.epoch && epoch != s.epoch + 1 {
            return Err(RemoteError::WrongEpoch);
        }
        if epoch == s.epoch {
            let stale: Vec<String> = ops
                .iter()
                .filter(|op| {
                    s.objects
                        .get(&(epoch, op.name.clone()))
                        .and_then(|r| r.sha.clone())
                        != op.base
                })
                .map(|op| op.name.clone())
                .collect();
            if !stale.is_empty() {
                return Err(RemoteError::Conflict(stale));
            }
        }
        s.head += 1;
        let seq = s.head;
        for op in ops {
            s.objects.insert(
                (epoch, op.name.clone()),
                Row {
                    sha: op.sha.clone(),
                    seq,
                },
            );
        }
        Ok(seq)
    }

    fn keys(&mut self) -> Result<RemoteKeys, RemoteError> {
        self.up()?;
        let s = self.server.borrow();
        Ok(RemoteKeys {
            mode: s.mode.clone(),
            recipient: s.recipient.clone(),
            epoch: s.epoch,
            head: s.head,
        })
    }

    fn set_keys(&mut self, mode: &str, recipient: Option<&str>) -> Result<(), RemoteError> {
        self.up()?;
        let mut s = self.server.borrow_mut();
        s.mode = Some(mode.into());
        s.recipient = recipient.map(Into::into);
        Ok(())
    }

    fn switch(
        &mut self,
        from_epoch: i64,
        built_at: i64,
        mode: &str,
        recipient: Option<&str>,
    ) -> Result<i64, RemoteError> {
        self.up()?;
        let mut s = self.server.borrow_mut();
        if s.epoch != from_epoch {
            return Err(RemoteError::WrongEpoch);
        }
        let moved = s
            .objects
            .iter()
            .any(|((epoch, _), row)| *epoch == from_epoch && row.seq > built_at);
        if moved {
            return Err(RemoteError::Conflict(Vec::new()));
        }
        s.objects.retain(|(epoch, _), _| *epoch != from_epoch);
        let live: std::collections::HashSet<String> =
            s.objects.values().filter_map(|r| r.sha.clone()).collect();
        s.blobs.retain(|sha, _| live.contains(sha));
        s.epoch = from_epoch + 1;
        s.head += 1;
        s.mode = Some(mode.into());
        s.recipient = recipient.map(Into::into);
        Ok(s.epoch)
    }
}

struct Device {
    store: Mutex<Store>,
    sync: ServerSync<Handle>,
    online: Rc<RefCell<bool>>,
    attachments: PathBuf,
    _home: tempfile::TempDir,
}

fn lock_for(recovery: Option<&str>) -> Lock {
    match recovery {
        Some(r) => Lock::Encrypted(LibraryKey::from_recovery(r).unwrap()),
        None => Lock::Plain,
    }
}

impl Device {
    fn join(server: &Rc<RefCell<Server>>, recovery: Option<&str>) -> Device {
        Device::with_store(server, recovery, Store::open_in_memory().unwrap())
    }

    fn with_store(
        server: &Rc<RefCell<Server>>,
        recovery: Option<&str>,
        mut store: Store,
    ) -> Device {
        store.begin_server_sync().unwrap();
        let home = tempfile::tempdir().unwrap();
        let attachments = home.path().join("attachments");
        let online = Rc::new(RefCell::new(true));
        Device {
            store: Mutex::new(store),
            sync: ServerSync::new(
                Handle {
                    server: Rc::clone(server),
                    online: Rc::clone(&online),
                },
                lock_for(recovery),
                Some(attachments.clone()),
            ),
            online,
            attachments,
            _home: home,
        }
    }

    fn s(&self) -> std::sync::MutexGuard<'_, Store> {
        self.store.lock().unwrap()
    }

    fn sync(&mut self) -> SyncReport {
        let mut report = self.sync.cycle(&self.store);
        let mut rounds = 0;
        while report.retry && rounds < 3 {
            report = self.sync.cycle(&self.store);
            rounds += 1;
        }
        assert!(report.errors.is_empty(), "sync errors: {:?}", report.errors);
        report
    }

    fn offline(&self, off: bool) {
        *self.online.borrow_mut() = !off;
    }

    fn create(&self, title: &str, body: &str) -> Note {
        self.s()
            .create_note(CreateNoteInput {
                title: Some(title.into()),
                body: Some(body.into()),
                ..Default::default()
            })
            .unwrap()
    }

    fn edit(&self, id: &str, body: &str) {
        self.s()
            .update_note(
                id,
                UpdateNotePatch {
                    body: Some(body.into()),
                    ..Default::default()
                },
            )
            .unwrap();
    }

    fn note(&self, id: &str) -> Note {
        self.s().get_note(id, false).unwrap()
    }

    fn live(&self) -> Vec<Note> {
        self.s()
            .list_notes(NoteFilter {
                limit: Some(5000),
                ..Default::default()
            })
            .unwrap()
    }

    fn trashed(&self) -> Vec<Note> {
        self.s()
            .list_notes(NoteFilter {
                is_deleted: Some(true),
                ..Default::default()
            })
            .unwrap()
    }

    fn review(&self) -> MergeReview {
        self.s().merge_review().unwrap()
    }
}

fn settle(devices: &mut [&mut Device]) {
    for _ in 0..2 {
        for d in devices.iter_mut() {
            d.sync();
        }
    }
}

fn encrypted_pair() -> (Rc<RefCell<Server>>, Device, Device, String) {
    let server = Server::new();
    let key = LibraryKey::generate();
    let recovery = key.recovery();
    server.borrow_mut().mode = Some("encrypted".into());
    server.borrow_mut().recipient = Some(key.recipient());
    let a = Device::join(&server, Some(&recovery));
    let b = Device::join(&server, Some(&recovery));
    (server, a, b, recovery)
}

#[test]
fn a_note_made_on_one_device_appears_on_the_other_and_the_server_sees_only_ciphertext() {
    let (server, mut a, mut b, _) = encrypted_pair();
    let n = a.create("Secret plan", "the treasure is under the oak");
    settle(&mut [&mut a, &mut b]);
    assert_eq!(b.note(&n.id).body, "the treasure is under the oak");
    let s = server.borrow();
    assert!(!s.live_blobs().is_empty());
    for blob in s.live_blobs() {
        assert!(!blob.windows(8).any(|w| w == b"treasure"));
        assert!(!blob.windows(11).any(|w| w == b"Secret plan"));
    }
    for (_, name) in s.objects.keys() {
        assert!(!name.contains(&n.id));
    }
}

#[test]
fn a_device_offline_for_many_commits_catches_up_and_sends_its_own_edits() {
    let (_server, mut a, mut b, _) = encrypted_pair();
    let shared = a.create("Shared", "v1");
    settle(&mut [&mut a, &mut b]);
    b.offline(true);
    let b_report = b.sync.cycle(&b.store);
    assert!(b_report.unreachable.is_some());
    let made: Vec<Note> = (0..30)
        .map(|n| {
            let note = a.create(&format!("Note {n}"), &format!("body {n}"));
            a.sync();
            note
        })
        .collect();
    let offline_note = b.create("Written offline", "on the train");
    b.edit(&shared.id, "edited offline");
    b.offline(false);
    settle(&mut [&mut b, &mut a]);
    for note in &made {
        assert_eq!(b.note(&note.id).body, note.body);
    }
    assert_eq!(a.note(&offline_note.id).body, "on the train");
    assert_eq!(a.note(&shared.id).body, "edited offline");
}

#[test]
fn one_note_changed_on_two_devices_keeps_both_versions() {
    let (_server, mut a, mut b, _) = encrypted_pair();
    let n = a.create("Plan", "original");
    settle(&mut [&mut a, &mut b]);
    a.edit(&n.id, "from A");
    b.edit(&n.id, "from B");
    a.sync();
    let report = b.sync();
    assert_eq!(report.conflicts, 1);
    settle(&mut [&mut a, &mut b]);
    for d in [&a, &b] {
        let bodies: Vec<String> = d.live().into_iter().map(|n| n.body).collect();
        assert!(bodies.contains(&"from A".to_string()), "{bodies:?}");
        assert!(bodies.contains(&"from B".to_string()), "{bodies:?}");
        assert_eq!(d.live().len(), 2);
        let copy = d.live().into_iter().find(|other| other.id != n.id).unwrap();
        assert!(copy.title.contains("(conflict"), "{}", copy.title);
        let tags: Vec<String> = d
            .s()
            .tags_for_note(&copy.id)
            .unwrap()
            .into_iter()
            .map(|t| t.name)
            .collect();
        assert!(tags.contains(&"conflict".to_string()));
    }
}

#[test]
fn whiteboards_and_sheets_travel_and_keep_both_on_conflict() {
    let (_server, mut a, mut b, _) = encrypted_pair();
    let sheet = a.create("Builds", "");
    let board = a.create("Board", "");
    for (id, kind, surface) in [
        (&sheet.id, CONTENT_KIND_SHEET, GRID),
        (&board.id, CONTENT_KIND_WHITEBOARD, CANVAS),
    ] {
        a.s()
            .update_note(
                id,
                UpdateNotePatch {
                    content_kind: Some(kind.into()),
                    surface_data: Some(surface.into()),
                    ..Default::default()
                },
            )
            .unwrap();
    }
    settle(&mut [&mut a, &mut b]);
    assert!(b.note(&sheet.id).surface_data.unwrap().contains("a1f3"));
    assert!(b.note(&board.id).surface_data.unwrap().contains("hello"));
    let edited = |d: &Device, text: &str| {
        d.s()
            .update_note(
                &board.id,
                UpdateNotePatch {
                    surface_data: Some(CANVAS.replace("hello", text)),
                    ..Default::default()
                },
            )
            .unwrap();
    };
    edited(&a, "from A");
    edited(&b, "from B");
    a.sync();
    assert_eq!(b.sync().conflicts, 1);
    settle(&mut [&mut a, &mut b]);
    let boards: Vec<String> = a
        .live()
        .into_iter()
        .filter(|n| n.content_kind == CONTENT_KIND_WHITEBOARD)
        .map(|n| a.note(&n.id).surface_data.unwrap())
        .collect();
    assert_eq!(boards.len(), 2);
    assert!(boards.iter().any(|s| s.contains("from A")));
    assert!(boards.iter().any(|s| s.contains("from B")));
}

#[test]
fn trash_restore_and_destroy_travel_and_a_destroy_elsewhere_only_trashes() {
    let (_server, mut a, mut b, _) = encrypted_pair();
    let n = a.create("Old", "remove me");
    settle(&mut [&mut a, &mut b]);
    a.s().soft_delete_note(&n.id).unwrap();
    settle(&mut [&mut a, &mut b]);
    assert!(b.note(&n.id).is_deleted);
    b.s().restore_note(&n.id).unwrap();
    settle(&mut [&mut a, &mut b]);
    assert!(!a.note(&n.id).is_deleted);
    a.s().soft_delete_note(&n.id).unwrap();
    a.s().permanently_delete_note(&n.id, true).unwrap();
    settle(&mut [&mut a, &mut b]);
    assert!(
        b.note(&n.id).is_deleted,
        "destroyed elsewhere is trashed here"
    );
    assert!(b.trashed().iter().any(|t| t.id == n.id));
}

#[test]
fn a_new_title_travels_as_an_update_of_the_same_note() {
    let (_server, mut a, mut b, _) = encrypted_pair();
    let n = a.create("Draft", "text");
    settle(&mut [&mut a, &mut b]);
    a.s()
        .update_note(
            &n.id,
            UpdateNotePatch {
                title: Some("Final".into()),
                ..Default::default()
            },
        )
        .unwrap();
    settle(&mut [&mut a, &mut b]);
    assert_eq!(b.note(&n.id).title, "Final");
    assert_eq!(b.live().len(), 1);
}

#[test]
fn attachments_travel_both_ways() {
    let (_server, mut a, mut b, _) = encrypted_pair();
    std::fs::create_dir_all(&a.attachments).unwrap();
    std::fs::create_dir_all(&b.attachments).unwrap();
    std::fs::write(a.attachments.join("aaaa1111.png"), b"from a").unwrap();
    std::fs::write(b.attachments.join("bbbb2222.png"), b"from b").unwrap();
    settle(&mut [&mut a, &mut b]);
    assert_eq!(
        std::fs::read(b.attachments.join("aaaa1111.png")).unwrap(),
        b"from a"
    );
    assert_eq!(
        std::fs::read(a.attachments.join("bbbb2222.png")).unwrap(),
        b"from b"
    );
}

#[test]
fn tags_and_spaces_made_on_either_side_reach_both() {
    let (_server, mut a, mut b, _) = encrypted_pair();
    let first = a.create("First", "text");
    let second = a.create("Second", "text");
    settle(&mut [&mut a, &mut b]);
    a.s().add_tag_to_note(&first.id, "work").unwrap();
    let space = b.s().get_or_create_workspace("Garden").unwrap();
    b.s().add_note_to_workspace(&second.id, &space.id).unwrap();
    a.sync();
    b.sync();
    settle(&mut [&mut a, &mut b]);
    for d in [&a, &b] {
        let tags: Vec<String> = d
            .s()
            .tags_for_note(&first.id)
            .unwrap()
            .into_iter()
            .map(|t| t.name)
            .collect();
        let spaces: Vec<String> = d
            .s()
            .workspaces_for_note(&second.id)
            .unwrap()
            .into_iter()
            .map(|w| w.name)
            .collect();
        assert_eq!(tags, vec!["work".to_string()]);
        assert_eq!(spaces, vec!["Garden".to_string()]);
        let all_spaces: Vec<String> = d
            .s()
            .list_workspaces()
            .unwrap()
            .into_iter()
            .map(|w| w.workspace.name)
            .collect();
        assert!(all_spaces.contains(&"Garden".to_string()));
        assert_eq!(d.live().len(), 2);
    }
}

#[test]
fn a_tag_on_one_side_and_a_space_on_the_other_for_one_note_keeps_both_versions() {
    let (_server, mut a, mut b, _) = encrypted_pair();
    let n = a.create("Note", "text");
    settle(&mut [&mut a, &mut b]);
    a.s().add_tag_to_note(&n.id, "work").unwrap();
    let space = b.s().get_or_create_workspace("Garden").unwrap();
    b.s().add_note_to_workspace(&n.id, &space.id).unwrap();
    a.sync();
    b.sync();
    settle(&mut [&mut a, &mut b]);
    for d in [&a, &b] {
        assert_eq!(d.live().len(), 2);
        let labelled = d.live().iter().any(|note| {
            d.s()
                .tags_for_note(&note.id)
                .unwrap()
                .iter()
                .any(|t| t.name == "work")
        });
        let spaced = d.live().iter().any(|note| {
            d.s()
                .workspaces_for_note(&note.id)
                .unwrap()
                .iter()
                .any(|w| w.name == "Garden")
        });
        assert!(labelled && spaced);
    }
}

#[test]
fn a_server_restored_from_an_old_backup_loses_nothing() {
    let (server, mut a, mut b, _) = encrypted_pair();
    let kept = a.create("Kept", "before the restore");
    settle(&mut [&mut a, &mut b]);
    {
        let mut s = server.borrow_mut();
        s.library_id = "library-restored".into();
        s.objects.clear();
        s.head = 0;
    }
    let after = b.create("After", "written after");
    settle(&mut [&mut a, &mut b]);
    assert_eq!(a.note(&after.id).body, "written after");
    assert_eq!(b.note(&kept.id).body, "before the restore");
    assert_eq!(a.live().len(), 2);
}

#[test]
fn a_mass_deletion_is_held_until_confirmed() {
    let (_server, mut a, mut b, _) = encrypted_pair();
    let notes: Vec<Note> = (0..30).map(|n| a.create(&format!("N{n}"), "x")).collect();
    settle(&mut [&mut a, &mut b]);
    for note in &notes[..25] {
        a.s().soft_delete_note(&note.id).unwrap();
        a.s().permanently_delete_note(&note.id, true).unwrap();
    }
    a.sync();
    let held = b.sync();
    assert_eq!(held.held_removals, 25);
    assert_eq!(b.live().len(), 30);
    b.sync.confirm_removals();
    b.sync();
    assert_eq!(b.live().len(), 5);
}

#[test]
fn joining_two_libraries_combines_exact_copies_and_lists_the_uncertain() {
    let server = Server::new();
    let key = LibraryKey::generate();
    let recovery = key.recovery();
    let mut linux = Device::join(&server, Some(&recovery));
    let shared_body = "Groceries for the week: milk, eggs";
    let same = linux.create("Groceries", shared_body);
    linux.s().add_tag_to_note(&same.id, "home").unwrap();
    let longer = linux.create("Trip", "Packing list for the coast trip: boots, map");
    linux.create("Only on Linux", "linux text");
    linux.sync();

    let mut mac_store = Store::open_in_memory().unwrap();
    let mac_copy = mac_store
        .create_note(CreateNoteInput {
            title: Some("Groceries".into()),
            body: Some(shared_body.into()),
            ..Default::default()
        })
        .unwrap();
    mac_store.add_tag_to_note(&mac_copy.id, "shopping").unwrap();
    let mac_longer = mac_store
        .create_note(CreateNoteInput {
            title: Some("Trip".into()),
            body: Some("Packing list for the coast trip: boots, map, tent".into()),
            ..Default::default()
        })
        .unwrap();
    mac_store
        .create_note(CreateNoteInput {
            title: Some("Only on Mac".into()),
            body: Some("mac text".into()),
            ..Default::default()
        })
        .unwrap();
    let mut mac = Device::with_store(&server, Some(&recovery), mac_store);
    mac.sync();
    settle(&mut [&mut linux, &mut mac]);

    let titles = |d: &Device| -> Vec<String> {
        let mut t: Vec<String> = d.live().into_iter().map(|n| n.title).collect();
        t.sort();
        t
    };
    assert_eq!(
        titles(&mac),
        vec!["Groceries", "Only on Linux", "Only on Mac", "Trip", "Trip"]
    );
    assert_eq!(titles(&linux), titles(&mac));
    let tags: Vec<String> = mac
        .s()
        .tags_for_note(&same.id)
        .unwrap()
        .into_iter()
        .map(|t| t.name)
        .collect();
    assert!(tags.contains(&"home".into()) && tags.contains(&"shopping".into()));
    let review = mac.review();
    assert_eq!(review.combined.len(), 1);
    assert_eq!(review.combined[0].kept, same.id);
    assert_eq!(review.combined[0].trashed, mac_copy.id);
    assert!(mac.trashed().iter().any(|n| n.id == mac_copy.id));
    assert!(review
        .pairs
        .iter()
        .any(|p| (p.a == longer.id && p.b == mac_longer.id)
            || (p.b == longer.id && p.a == mac_longer.id)));
    mac.s().undo_combine(&mac_copy.id).unwrap();
    assert!(!mac.note(&mac_copy.id).is_deleted);
    mac.s()
        .settle_pair(&longer.id, &mac_longer.id, Some(&mac_longer.id))
        .unwrap();
    assert!(mac.note(&longer.id).is_deleted);
    assert!(mac.review().is_empty());
}

#[test]
fn the_same_note_in_both_libraries_with_different_text_keeps_both() {
    let server = Server::new();
    let mut first = Store::open_in_memory().unwrap();
    let note = first
        .create_note(CreateNoteInput {
            title: Some("Shared".into()),
            body: Some("version one".into()),
            ..Default::default()
        })
        .unwrap();
    let mut a = Device::with_store(&server, None, first);
    a.sync();
    let mut b = Device::join(&server, None);
    b.sync();
    b.edit(&note.id, "version two");
    b.sync();
    a.edit(&note.id, "version one, edited");
    a.sync();
    settle(&mut [&mut a, &mut b]);
    let bodies: Vec<String> = a.live().into_iter().map(|n| n.body).collect();
    assert!(bodies.contains(&"version two".to_string()), "{bodies:?}");
    assert!(
        bodies.contains(&"version one, edited".to_string()),
        "{bodies:?}"
    );
}

#[test]
fn plain_mode_syncs_without_a_key_and_the_server_could_read_it() {
    let server = Server::new();
    server.borrow_mut().mode = Some("plain".into());
    let mut a = Device::join(&server, None);
    let mut b = Device::join(&server, None);
    let n = a.create("Open", "readable on the server");
    settle(&mut [&mut a, &mut b]);
    assert_eq!(b.note(&n.id).body, "readable on the server");
    assert!(server
        .borrow()
        .live_blobs()
        .iter()
        .any(|blob| blob.windows(8).any(|w| w == b"readable")));
}

#[test]
fn turning_encryption_on_and_off_rewrites_the_server_and_loses_nothing() {
    let server = Server::new();
    server.borrow_mut().mode = Some("plain".into());
    let mut a = Device::join(&server, None);
    let mut b = Device::join(&server, None);
    let n = a.create("Diary", "dear diary");
    settle(&mut [&mut a, &mut b]);
    let key = LibraryKey::generate();
    let recovery = key.recovery();
    let recipient = key.recipient();
    b.edit(&n.id, "written while switching");
    a.sync
        .switch_mode(
            &a.store,
            Lock::Encrypted(key),
            "encrypted",
            Some(&recipient),
        )
        .unwrap();
    assert!(server
        .borrow()
        .live_blobs()
        .iter()
        .all(|blob| !blob.windows(5).any(|w| w == b"diary")));
    let report = b.sync.cycle(&b.store);
    assert!(report.mode_changed);
    b.sync = ServerSync::new(
        Handle {
            server: Rc::clone(&server),
            online: Rc::clone(&b.online),
        },
        lock_for(Some(&recovery)),
        Some(b.attachments.clone()),
    );
    settle(&mut [&mut b, &mut a]);
    let bodies: Vec<String> = a.live().into_iter().map(|n| n.body).collect();
    assert!(
        bodies.contains(&"written while switching".to_string()),
        "{bodies:?}"
    );
    a.sync
        .switch_mode(&a.store, Lock::Plain, "plain", None)
        .unwrap();
    assert!(server.borrow().recipient.is_none());
    let report = b.sync.cycle(&b.store);
    assert!(report.mode_changed);
    b.sync = ServerSync::new(
        Handle {
            server: Rc::clone(&server),
            online: Rc::clone(&b.online),
        },
        Lock::Plain,
        Some(b.attachments.clone()),
    );
    settle(&mut [&mut b, &mut a]);
    assert_eq!(b.live().len(), a.live().len());
}

#[test]
fn a_device_with_the_wrong_key_reports_errors_and_changes_nothing() {
    let (_server, mut a, _b, _) = encrypted_pair();
    a.create("Private", "text");
    a.sync();
    let stranger = LibraryKey::generate().recovery();
    let server = Rc::clone(&a.sync.remote.server);
    let mut c = Device::join(&server, Some(&stranger));
    let report = c.sync.cycle(&c.store);
    assert!(!report.errors.is_empty());
    assert!(c.live().is_empty());
}

#[test]
fn a_device_far_behind_pages_through_every_change() {
    let (server, mut a, mut b, _) = encrypted_pair();
    for n in 0..40 {
        a.create(&format!("N{n}"), "x");
        a.sync();
    }
    server.borrow_mut().page_limit = 3;
    b.sync();
    assert_eq!(b.live().len(), 40);
}

#[test]
fn an_interrupted_first_upload_keeps_what_was_committed_and_finishes() {
    let server = Server::new();
    server.borrow_mut().mode = Some("encrypted".into());
    let recovery = LibraryKey::generate().recovery();
    let mut store = Store::open_in_memory().unwrap();
    for n in 0..1200 {
        store
            .create_note(CreateNoteInput {
                title: Some(format!("Note {n}")),
                body: Some(format!("body {n}")),
                ..Default::default()
            })
            .unwrap();
    }
    let mut a = Device::with_store(&server, Some(&recovery), store);
    server.borrow_mut().budget = Some(6);
    let first = a.sync.cycle(&a.store);
    assert!(first.unreachable.is_some());
    let committed = server.borrow().objects.len();
    assert!(committed >= 500, "kept {committed}");
    server.borrow_mut().budget = None;
    a.sync();
    let s = server.borrow();
    assert_eq!(s.objects.len(), 1201);
    assert!(s.uploaded <= 1201 + 500, "uploaded {}", s.uploaded);
    drop(s);
    let mut b = Device::join(&server, Some(&recovery));
    b.sync();
    assert_eq!(b.live().len(), 1200);
}

#[test]
fn an_object_too_large_for_the_server_is_skipped_and_named() {
    let (server, mut a, mut b, _) = encrypted_pair();
    server.borrow_mut().max_object = 64 * 1024;
    std::fs::create_dir_all(&a.attachments).unwrap();
    std::fs::write(a.attachments.join("huge0000.png"), vec![7u8; 200 * 1024]).unwrap();
    let n = a.create("Small", "still syncs");
    let report = a.sync();
    assert_eq!(
        report.too_large,
        vec!["attachment:huge0000.png".to_string()]
    );
    b.sync();
    assert_eq!(b.note(&n.id).body, "still syncs");
    assert!(!b.attachments.join("huge0000.png").exists());
}

#[test]
fn a_server_cannot_turn_encryption_off_or_swap_the_key_without_the_key() {
    let (server, mut a, _b, recovery) = encrypted_pair();
    a.create("Private", "text");
    a.sync();
    let key = LibraryKey::from_recovery(&recovery).unwrap();
    {
        let mut s = server.borrow_mut();
        s.mode = Some("plain".into());
        s.recipient = None;
    }
    let keys = a.sync.remote.keys().unwrap();
    assert!(matches!(
        a.sync.check_mode(&keys, Some(&key)).unwrap(),
        ModeCheck::Refuse(_)
    ));
    {
        let mut s = server.borrow_mut();
        s.mode = Some("encrypted".into());
        s.recipient = Some(LibraryKey::generate().recipient());
    }
    let keys = a.sync.remote.keys().unwrap();
    assert!(matches!(
        a.sync.check_mode(&keys, Some(&key)).unwrap(),
        ModeCheck::Refuse(_)
    ));
    server.borrow_mut().recipient = Some(key.recipient());
    let keys = a.sync.remote.keys().unwrap();
    assert_eq!(
        a.sync.check_mode(&keys, Some(&key)).unwrap(),
        ModeCheck::Encrypted
    );
    assert_eq!(a.sync.check_mode(&keys, None).unwrap(), ModeCheck::NeedsKey);
}

#[test]
fn a_switch_to_plain_made_by_a_key_holder_is_accepted_by_the_others() {
    let (server, mut a, mut b, recovery) = encrypted_pair();
    a.create("Note", "text");
    settle(&mut [&mut a, &mut b]);
    a.sync
        .switch_mode(&a.store, Lock::Plain, "plain", None)
        .unwrap();
    assert!(b.sync.cycle(&b.store).mode_changed);
    let keys = b.sync.remote.keys().unwrap();
    let key = LibraryKey::from_recovery(&recovery).unwrap();
    assert_eq!(
        b.sync.check_mode(&keys, Some(&key)).unwrap(),
        ModeCheck::Plain
    );
    assert_eq!(server.borrow().mode.as_deref(), Some("plain"));
}
