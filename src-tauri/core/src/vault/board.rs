//! A whiteboard's canvas in the vault: a standard `.excalidraw` file beside
//! the note's `.md`, sharing its name, so the board opens in Excalidraw or
//! any tool that reads its format. The note file holds the frontmatter and
//! the text on the board; this file holds the drawing.

use serde_json::{json, Map, Value};

pub const CANVAS_EXT: &str = ".excalidraw";

/// The canvas file that sits beside the note file `note_rel` (`x.md`).
pub fn canvas_rel(note_rel: &str) -> String {
    format!(
        "{}{CANVAS_EXT}",
        note_rel.strip_suffix(".md").unwrap_or(note_rel)
    )
}

/// The note file a canvas file belongs to: the inverse of `canvas_rel`.
pub fn note_rel_of_canvas(canvas_rel: &str) -> Option<String> {
    canvas_rel
        .strip_suffix(CANVAS_EXT)
        .map(|stem| format!("{stem}.md"))
}

/// The `.excalidraw` file for a whiteboard's stored canvas (`surface_data`:
/// `{"v":1,"engine":"excalidraw","data":{elements,appState,files}}`). A
/// missing, unreadable, or other-engine canvas becomes an empty scene, the
/// same thing the app shows for it.
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

/// Whether two canvas files hold the same drawing, ignoring formatting.
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
    fn the_canvas_sits_beside_its_note() {
        assert_eq!(canvas_rel("Plan.md"), "Plan.excalidraw");
        assert_eq!(canvas_rel("trash/Plan.md"), "trash/Plan.excalidraw");
        assert_eq!(
            note_rel_of_canvas("trash/Plan.excalidraw").as_deref(),
            Some("trash/Plan.md")
        );
        assert_eq!(note_rel_of_canvas("Plan.md"), None);
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
    fn formatting_does_not_change_the_drawing() {
        let file = canvas_file(Some(
            r#"{"v":1,"engine":"excalidraw","data":{"elements":[{"id":"a"}],"appState":{},"files":{}}}"#,
        ));
        let compact =
            serde_json::to_string(&serde_json::from_str::<Value>(&file).unwrap()).unwrap();
        assert!(same_canvas(&file, &compact));
        assert!(!same_canvas(&file, "{}"));
        assert!(!same_canvas(&file, "not json"));
    }
}
