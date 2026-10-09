use instantnotes_core::import::rtf::to_markdown;
use instantnotes_core::import::stickies::{read_folder, resolve_folder};
use instantnotes_core::types::{ImportItem, NoteFilter};
use instantnotes_core::Store;
use std::fs;
use std::path::{Path, PathBuf};
use std::time::{Duration, SystemTime};

const FORMATTED: &str = "0B7D6A52-5A1F-4C3E-9D2B-3F1E8A6C4D10";
const WITH_IMAGE: &str = "6E2F9C31-8B4A-4D7E-A1C5-2D9E7F3B8A64";
const SCRIPTS: &str = "C4A81E07-3D6B-45F2-9E8C-7B1A0D5F2E93";

fn fixtures() -> PathBuf {
    Path::new(env!("CARGO_MANIFEST_DIR")).join("tests/fixtures/stickies")
}

fn rtf(id: &str) -> Vec<u8> {
    fs::read(fixtures().join(format!("{id}.rtfd/TXT.rtf"))).unwrap()
}

fn convert(rtf: &[u8]) -> String {
    to_markdown(rtf, |name| Some(format!("![](attachments/{name})")))
}

fn folder() -> tempfile::TempDir {
    let dir = tempfile::tempdir().unwrap();
    copy_dir(&fixtures(), dir.path());
    dir
}

fn copy_dir(from: &Path, to: &Path) {
    for entry in fs::read_dir(from).unwrap() {
        let entry = entry.unwrap();
        let target = to.join(entry.file_name());
        if entry.file_type().unwrap().is_dir() {
            fs::create_dir_all(&target).unwrap();
            copy_dir(&entry.path(), &target);
        } else {
            fs::copy(entry.path(), target).unwrap();
        }
    }
}

#[test]
fn formatting_lists_links_and_escapes_become_markdown() {
    assert_eq!(
        convert(&rtf(FORMATTED)),
        "Groceries for the week\n\
         Plain, **bold**, *italic*, ***both***, ~~struck~~, under. \
         Caf\u{e9} \u{201c}quoted\u{201d} \u{2014} don\u{2019}t \u{1f680} done.\n\
         - milk\n\
         - eggs\n  \
         - free range\n\
         - bread\n\
         1. first\n\
         2. second\n\
         See [the site](https://example.com/path?a=1&b=2) and #errands\n\
         line one\n\
         line two tabbed\n\
         braces {x} and back\\slash\n\
         \n\
         after image"
    );
}

#[test]
fn an_attachment_is_asked_for_by_name_and_its_placeholder_dropped() {
    let mut asked = Vec::new();
    let md = to_markdown(&rtf(WITH_IMAGE), |name| {
        asked.push(name.to_string());
        Some("![](attachments/new.png)".into())
    });
    assert_eq!(asked, ["Attachment.png"]);
    assert!(
        md.ends_with("braces {x} and back\\slash\n![](attachments/new.png)\nafter image"),
        "{md}"
    );
    assert!(!md.contains('\u{ac}'), "the 0xAC placeholder is not text");
}

#[test]
fn an_attachment_that_could_not_come_in_says_so_in_its_place() {
    let md = to_markdown(&rtf(WITH_IMAGE), |_| None);
    assert!(md.contains("\n[Not imported: Attachment.png]\n"), "{md}");
}

#[test]
fn surrogate_pairs_and_other_scripts_decode() {
    assert_eq!(
        convert(&rtf(SCRIPTS)),
        "rocket \u{1f680} and caf\u{e9} and \u{201c}q\u{201d} and \u{41f}\u{440}\u{438} and \u{2713}"
    );
}

#[test]
fn a_windows_checkout_with_crlf_reads_the_same() {
    let lf = rtf(FORMATTED);
    let crlf: Vec<u8> = lf
        .iter()
        .flat_map(|&b| {
            if b == b'\n' {
                vec![b'\r', b'\n']
            } else {
                vec![b]
            }
        })
        .collect();
    assert_eq!(convert(&crlf), convert(&lf));
}

#[test]
fn emphasis_markers_never_touch_whitespace() {
    assert_eq!(convert(br"{\rtf1 a\b  bold \b0 c}"), "a **bold** c");
    assert_eq!(
        convert(br"{\rtf1 \i  \i0 x}"),
        " x",
        "a styled space stays a space"
    );
}

#[test]
fn emphasis_closes_at_each_line() {
    assert_eq!(convert(b"{\\rtf1 \\b one\\\ntwo\\b0 }"), "**one**\n**two**");
}

#[test]
fn tables_metadata_and_starred_groups_are_not_text() {
    let rtf = br"{\rtf1{\fonttbl{\f0 Helvetica;}}{\colortbl;\red0\green0\blue0;}{\info{\title T}}{\*\generator Foo;}Hello}";
    assert_eq!(convert(rtf), "Hello");
}

#[test]
fn unicode_escapes_follow_the_rtf_rules() {
    assert_eq!(convert(br"{\rtf1\uc0 \u-10179 \u-8576 }"), "\u{1f680}");
    assert_eq!(convert(br"{\rtf1\uc1 caf\u233 e!}"), "caf\u{e9}!");
    assert_eq!(convert(br"{\rtf1\uc0 a\u-10179 b}"), "ab");
}

#[test]
fn a_link_whose_text_is_its_address_stays_bare() {
    let rtf = br#"{\rtf1 {\field{\*\fldinst{HYPERLINK "https://a.io"}}{\fldrslt https://a.io}}}"#;
    assert_eq!(convert(rtf), "https://a.io");
}

#[test]
fn a_line_break_inside_a_list_item_stays_in_the_item() {
    let rtf = b"{\\rtf1 \\ls1\\ilvl1{\\listtext\t\\uc0\\u8226 \t}one\\line two\\\n}";
    assert_eq!(convert(rtf), "  - one\n    two");
}

#[test]
fn broken_input_ends_without_a_panic() {
    assert_eq!(convert(br"}}}{\b x"), "**x**");
    assert_eq!(convert(br"{\rtf1 \'zz\u"), "zz");
    assert_eq!(convert(b""), "");
}

#[test]
fn only_packages_with_text_are_stickies_and_colors_come_from_the_state_file() {
    let dir = folder();
    let stickies = read_folder(dir.path()).unwrap();
    let mut ids: Vec<&str> = stickies.iter().map(|s| s.id.as_str()).collect();
    ids.sort();
    assert_eq!(ids, [FORMATTED, WITH_IMAGE, SCRIPTS]);
    let color = |id: &str| stickies.iter().find(|s| s.id == id).unwrap().color.clone();
    assert_eq!(color(FORMATTED).as_deref(), Some("#fef49c"));
    assert_eq!(color(WITH_IMAGE).as_deref(), Some("#adf4ff"));
    assert_eq!(color(SCRIPTS), None);
    for sticky in &stickies {
        assert!(sticky.created_at <= sticky.updated_at, "{}", sticky.id);
    }
}

#[test]
fn newest_first_by_when_stickies_last_saved_it() {
    let dir = folder();
    let touch = |id: &str, secs_ago: u64| {
        let file = fs::File::options()
            .write(true)
            .open(dir.path().join(format!("{id}.rtfd/TXT.rtf")))
            .unwrap();
        file.set_modified(SystemTime::now() - Duration::from_secs(secs_ago))
            .unwrap();
    };
    touch(FORMATTED, 300);
    touch(WITH_IMAGE, 10);
    touch(SCRIPTS, 3000);
    let ids: Vec<String> = read_folder(dir.path())
        .unwrap()
        .into_iter()
        .map(|s| s.id)
        .collect();
    assert_eq!(ids, [WITH_IMAGE, FORMATTED, SCRIPTS]);
}

#[test]
fn picking_the_container_finds_the_notes_inside() {
    let dir = tempfile::tempdir().unwrap();
    let notes = dir.path().join("Data/Library/Stickies");
    fs::create_dir_all(&notes).unwrap();
    assert_eq!(resolve_folder(dir.path()), notes);
    assert_eq!(resolve_folder(&notes), notes, "the right folder stays");
}

#[cfg(unix)]
#[test]
fn a_symlinked_package_is_not_followed() {
    let dir = folder();
    let elsewhere = tempfile::tempdir().unwrap();
    let outside = elsewhere.path().join("secret.rtfd");
    fs::create_dir(&outside).unwrap();
    fs::write(outside.join("TXT.rtf"), br"{\rtf1 not a sticky}").unwrap();
    std::os::unix::fs::symlink(&outside, dir.path().join("AAAAAAAA.rtfd")).unwrap();
    let stickies = read_folder(dir.path()).unwrap();
    assert!(stickies.iter().all(|s| s.id != "AAAAAAAA"));
}

#[test]
fn an_unreadable_state_file_only_costs_the_colors() {
    let dir = folder();
    fs::write(dir.path().join(".SavedStickiesState"), b"not a plist").unwrap();
    let stickies = read_folder(dir.path()).unwrap();
    assert_eq!(stickies.len(), 3);
    assert!(stickies.iter().all(|s| s.color.is_none()));
}

fn item(id: &str, body: &str, created: u64, updated: u64) -> ImportItem {
    let at = |secs: u64| SystemTime::UNIX_EPOCH + Duration::from_secs(secs);
    ImportItem {
        source_id: id.into(),
        body: body.into(),
        created_at: at(created),
        updated_at: at(updated),
    }
}

const JAN: u64 = 1_704_067_200;
const FEB: u64 = 1_706_745_600;

#[test]
fn imported_notes_keep_their_dates_titles_and_tags_and_land_in_the_space() {
    let mut store = Store::open_in_memory().unwrap();
    let outcome = store
        .import_notes(
            "stickies",
            vec![
                item("A", "**Groceries**\n- milk #errands", JAN, FEB),
                item("B", "Call the bank", JAN, JAN),
            ],
            Some("Apple Stickies"),
        )
        .unwrap();
    assert_eq!(outcome.imported, 2);
    assert_eq!(outcome.skipped, 0);
    let space = outcome.workspace_id.expect("filed in a Space");

    let notes = store
        .list_notes(NoteFilter {
            workspace_id: Some(space),
            ..Default::default()
        })
        .unwrap();
    let groceries = notes.iter().find(|n| n.title == "Groceries").unwrap();
    assert_eq!(groceries.created_at, "2024-01-01T00:00:00.000000Z");
    assert_eq!(groceries.updated_at, "2024-02-01T00:00:00.000000Z");
    assert!(groceries.last_opened_at.is_some(), "not a Revisit capture");
    let tags = store.tags_for_note(&groceries.id).unwrap();
    assert_eq!(
        tags.iter().map(|t| t.name.as_str()).collect::<Vec<_>>(),
        ["errands"]
    );
    assert!(notes.iter().any(|n| n.title == "Call the bank"));
}

#[test]
fn a_sticky_is_imported_once_until_its_note_is_destroyed() {
    let mut store = Store::open_in_memory().unwrap();
    store
        .import_notes("stickies", vec![item("A", "one", JAN, JAN)], None)
        .unwrap();
    let again = store
        .import_notes(
            "stickies",
            vec![item("A", "one", JAN, JAN), item("B", "two", JAN, JAN)],
            None,
        )
        .unwrap();
    assert_eq!((again.imported, again.skipped), (1, 1));
    assert_eq!(
        store.imported_ids("stickies").unwrap(),
        ["A".to_string(), "B".to_string()].into()
    );

    let a = store
        .list_notes(Default::default())
        .unwrap()
        .into_iter()
        .find(|n| n.body == "one")
        .unwrap();
    store.soft_delete_note(&a.id).unwrap();
    assert!(store.imported_ids("stickies").unwrap().contains("A"));
    store.permanently_delete_note(&a.id, true).unwrap();
    assert!(!store.imported_ids("stickies").unwrap().contains("A"));
    let back = store
        .import_notes("stickies", vec![item("A", "one", JAN, JAN)], None)
        .unwrap();
    assert_eq!(back.imported, 1);
}

#[test]
fn no_space_is_made_when_nothing_lands_or_none_is_named() {
    let mut store = Store::open_in_memory().unwrap();
    let none = store
        .import_notes("stickies", vec![item("A", "x", JAN, JAN)], Some("   "))
        .unwrap();
    assert_eq!(none.workspace_id, None);
    let empty = store
        .import_notes(
            "stickies",
            vec![item("A", "x", JAN, JAN)],
            Some("Apple Stickies"),
        )
        .unwrap();
    assert_eq!((empty.imported, empty.workspace_id), (0, None));
    assert!(store.list_workspaces().unwrap().is_empty());
}

#[test]
fn a_stickies_folder_lands_as_notes_once() {
    let dir = folder();
    let mut store = Store::open_in_memory().unwrap();
    let items = |store: &Store| -> Vec<ImportItem> {
        let done = store.imported_ids("stickies").unwrap();
        read_folder(dir.path())
            .unwrap()
            .into_iter()
            .filter(|s| !done.contains(&s.id))
            .map(|s| ImportItem {
                body: to_markdown(&s.rtf, |name| {
                    Some(format!("![](attachments/copy-of-{name})"))
                }),
                source_id: s.id,
                created_at: s.created_at,
                updated_at: s.updated_at,
            })
            .collect()
    };
    let first = items(&store);
    let outcome = store
        .import_notes("stickies", first, Some("Apple Stickies"))
        .unwrap();
    assert_eq!(outcome.imported, 3);

    let notes = store.list_notes(Default::default()).unwrap();
    let mut titles: Vec<&str> = notes.iter().map(|n| n.title.as_str()).collect();
    titles.sort();
    assert_eq!(
        titles,
        [
            "Groceries for the week",
            "Groceries for the week",
            "rocket 🚀 and café and “q” and При and ✓"
        ]
    );
    assert!(notes
        .iter()
        .any(|n| n.body.contains("![](attachments/copy-of-Attachment.png)")));
    assert!(notes.iter().all(|n| n.last_opened_at.is_some()));
    let errands = store.list_tags().unwrap();
    assert!(
        errands.iter().any(|t| t.tag.name == "errands"),
        "#errands became a tag"
    );

    assert!(items(&store).is_empty(), "a second pass finds nothing new");
}

#[test]
fn a_modified_date_before_the_created_one_is_raised_to_it() {
    let mut store = Store::open_in_memory().unwrap();
    store
        .import_notes("stickies", vec![item("A", "x", FEB, JAN)], None)
        .unwrap();
    let note = &store.list_notes(Default::default()).unwrap()[0];
    assert_eq!(note.created_at, note.updated_at);
}
