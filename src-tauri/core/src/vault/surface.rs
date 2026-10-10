use crate::sheet::Sheet;
use crate::types::{CONTENT_KIND_SHEET, CONTENT_KIND_WHITEBOARD};
use serde_json::{json, Map, Value};

pub const CANVAS_EXT: &str = ".excalidraw";
pub const SHEET_EXT: &str = ".csv";

pub fn surface_ext(kind: &str) -> Option<&'static str> {
    match kind {
        CONTENT_KIND_WHITEBOARD => Some(CANVAS_EXT),
        CONTENT_KIND_SHEET => Some(SHEET_EXT),
        _ => None,
    }
}

pub fn surface_rel(note_rel: &str, ext: &str) -> String {
    format!("{}{ext}", note_rel.strip_suffix(".md").unwrap_or(note_rel))
}

pub fn note_of_surface(rel: &str) -> Option<(String, &'static str)> {
    for (ext, kind) in [
        (CANVAS_EXT, CONTENT_KIND_WHITEBOARD),
        (SHEET_EXT, CONTENT_KIND_SHEET),
    ] {
        if let Some(stem) = rel.strip_suffix(ext) {
            return Some((format!("{stem}.md"), kind));
        }
    }
    None
}

pub fn is_vault_file_name(name: &str) -> bool {
    name.ends_with(".md") || note_of_surface(name).is_some()
}

pub fn surface_file(kind: &str, surface_data: Option<&str>) -> Option<String> {
    match kind {
        CONTENT_KIND_WHITEBOARD => Some(canvas_file(surface_data)),
        CONTENT_KIND_SHEET => Some(
            surface_data
                .and_then(|raw| Sheet::parse(raw).ok())
                .map(|sheet| sheet.csv())
                .unwrap_or_default(),
        ),
        _ => None,
    }
}

pub fn canvas_file(surface_data: Option<&str>) -> String {
    let envelope: Value = surface_data
        .and_then(|raw| serde_json::from_str(raw).ok())
        .unwrap_or(Value::Null);
    let data = if envelope["engine"] == "excalidraw" {
        &envelope["data"]
    } else {
        &Value::Null
    };
    let object = |v: &Value| match v {
        Value::Object(_) => v.clone(),
        _ => Value::Object(Map::new()),
    };
    let file = json!({
        "type": "excalidraw",
        "version": 2,
        "source": "InstantNotes",
        "elements": match &data["elements"] {
            Value::Array(_) => data["elements"].clone(),
            _ => json!([]),
        },
        "appState": object(&data["appState"]),
        "files": object(&data["files"]),
    });
    let mut text =
        serde_json::to_string_pretty(&file).expect("a JSON value always serializes to a string");
    text.push('\n');
    text
}

pub fn same_surface(kind: &str, a: &str, b: &str) -> bool {
    if kind == CONTENT_KIND_WHITEBOARD {
        same_canvas(a, b)
    } else {
        a == b
    }
}

pub fn same_canvas(a: &str, b: &str) -> bool {
    match (
        serde_json::from_str::<Value>(a),
        serde_json::from_str::<Value>(b),
    ) {
        (Ok(x), Ok(y)) => x == y,
        _ => false,
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn the_surface_file_sits_beside_its_note() {
        assert_eq!(surface_rel("Plan.md", CANVAS_EXT), "Plan.excalidraw");
        assert_eq!(surface_rel("trash/Plan.md", SHEET_EXT), "trash/Plan.csv");
        assert_eq!(
            note_of_surface("trash/Plan.excalidraw"),
            Some(("trash/Plan.md".to_string(), CONTENT_KIND_WHITEBOARD))
        );
        assert_eq!(
            note_of_surface("Log.csv"),
            Some(("Log.md".to_string(), CONTENT_KIND_SHEET))
        );
        assert_eq!(note_of_surface("Plan.md"), None);
    }

    #[test]
    fn each_kind_names_its_extension() {
        assert_eq!(surface_ext("whiteboard"), Some(".excalidraw"));
        assert_eq!(surface_ext("sheet"), Some(".csv"));
        assert_eq!(surface_ext("document"), None);
        assert!(is_vault_file_name("a.md"));
        assert!(is_vault_file_name("a.csv"));
        assert!(is_vault_file_name("a.excalidraw"));
        assert!(!is_vault_file_name("a.txt"));
    }

    #[test]
    fn a_document_has_no_surface_file() {
        assert_eq!(surface_file("document", Some("{}")), None);
    }

    #[test]
    fn a_sheet_surface_file_is_its_csv_or_empty_when_unreadable() {
        let grid = r#"{"v":1,"engine":"grid","data":{"cols":[{"w":1},{"w":1}],"rows":[["a","b"],["1","2"],["",""]]}}"#;
        assert_eq!(
            surface_file("sheet", Some(grid)).as_deref(),
            Some("a,b\r\n1,2\r\n")
        );
        assert_eq!(surface_file("sheet", Some("not json")).as_deref(), Some(""));
        assert_eq!(surface_file("sheet", None).as_deref(), Some(""));
    }

    #[test]
    fn a_legacy_engine_canvas_is_an_empty_scene() {
        let file = canvas_file(Some(
            r#"{"v":1,"engine":"svelte-flow","data":{"nodes":[1]}}"#,
        ));
        let v: Value = serde_json::from_str(&file).unwrap();
        assert_eq!(v["elements"], json!([]));
        assert_eq!(v["appState"], json!({}));
    }

    #[test]
    fn formatting_does_not_change_the_drawing_but_does_change_a_csv() {
        let file = canvas_file(Some(
            r#"{"v":1,"engine":"excalidraw","data":{"elements":[{"id":"a"}],"appState":{},"files":{}}}"#,
        ));
        let compact =
            serde_json::to_string(&serde_json::from_str::<Value>(&file).unwrap()).unwrap();
        assert!(same_surface("whiteboard", &file, &compact));
        assert!(!same_surface("whiteboard", &file, "{}"));
        assert!(!same_surface("whiteboard", &file, "not json"));
        assert!(same_surface("sheet", "a,b\r\n", "a,b\r\n"));
        assert!(!same_surface("sheet", "a,b\r\n", "a,b\n"));
    }
}
