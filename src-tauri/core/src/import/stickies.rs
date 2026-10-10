use super::rtf::MAX_RTF_BYTES;
use std::collections::HashMap;
use std::fs;
use std::io;
use std::path::{Path, PathBuf};
use std::time::SystemTime;

pub const STICKIES_DIR: &str = "Library/Containers/com.apple.Stickies/Data/Library/Stickies";
const STATE_FILE: &str = ".SavedStickiesState";
const TEXT_FILE: &str = "TXT.rtf";

pub struct Sticky {
    pub id: String,
    pub package: PathBuf,
    pub rtf: Vec<u8>,
    pub color: Option<String>,
    pub created_at: SystemTime,
    pub updated_at: SystemTime,
}

pub fn resolve_folder(dir: &Path) -> PathBuf {
    ["Data/Library/Stickies", "Library/Stickies", "Stickies"]
        .iter()
        .map(|tail| dir.join(tail))
        .find(|candidate| candidate.is_dir())
        .unwrap_or_else(|| dir.to_path_buf())
}

pub fn read_folder(dir: &Path) -> io::Result<Vec<Sticky>> {
    let colors = read_colors(&dir.join(STATE_FILE));
    let mut stickies: Vec<Sticky> = fs::read_dir(dir)?
        .filter_map(|entry| read_package(&entry.ok()?.path(), &colors))
        .collect();
    stickies.sort_by_key(|s| std::cmp::Reverse(s.updated_at));
    Ok(stickies)
}

fn read_package(package: &Path, colors: &HashMap<String, String>) -> Option<Sticky> {
    let name = package.file_name()?.to_str()?;
    let id = name.strip_suffix(".rtfd")?.to_uppercase();
    if id.is_empty() || id.starts_with('.') {
        return None;
    }
    let meta = fs::symlink_metadata(package).ok()?;
    if !meta.is_dir() {
        return None;
    }
    let text = package.join(TEXT_FILE);
    let text_meta = fs::symlink_metadata(&text).ok()?;
    if !text_meta.is_file() || text_meta.len() > MAX_RTF_BYTES as u64 {
        return None;
    }
    let rtf = fs::read(&text).ok()?;
    let updated_at = text_meta.modified().ok()?;
    let created_at = meta
        .created()
        .or_else(|_| meta.modified())
        .unwrap_or(updated_at)
        .min(updated_at);
    Some(Sticky {
        color: colors.get(&id).cloned(),
        id,
        package: package.to_path_buf(),
        rtf,
        created_at,
        updated_at,
    })
}

fn read_colors(path: &Path) -> HashMap<String, String> {
    plist::Value::from_file(path)
        .map(colors_from)
        .unwrap_or_default()
}

fn colors_from(value: plist::Value) -> HashMap<String, String> {
    let entries = match value {
        plist::Value::Array(entries) => entries,
        plist::Value::Dictionary(d) => d
            .into_iter()
            .filter_map(|(_, v)| v.into_array())
            .max_by_key(Vec::len)
            .unwrap_or_default(),
        _ => return HashMap::new(),
    };
    entries
        .iter()
        .filter_map(|entry| {
            let entry = entry.as_dictionary()?;
            let id = entry.get("UUID")?.as_string()?.to_uppercase();
            let color = entry.get("StickyColor")?.as_dictionary()?;
            let channel = |key: &str| {
                let v = color.get(key)?;
                let x = v
                    .as_real()
                    .or_else(|| v.as_signed_integer().map(|i| i as f64))?;
                Some((x.clamp(0.0, 1.0) * 255.0).round() as u8)
            };
            let hex = format!(
                "#{:02x}{:02x}{:02x}",
                channel("Red")?,
                channel("Green")?,
                channel("Blue")?
            );
            Some((id, hex))
        })
        .collect()
}

#[cfg(test)]
mod tests {
    use super::*;
    use plist::{Dictionary, Value};

    fn channels(r: Value, g: Value, b: Value) -> Value {
        let mut color = Dictionary::new();
        color.insert("Red".into(), r);
        color.insert("Green".into(), g);
        color.insert("Blue".into(), b);
        Value::Dictionary(color)
    }

    fn sticky(uuid: &str, color: Value) -> Value {
        let mut entry = Dictionary::new();
        entry.insert("UUID".into(), Value::String(uuid.into()));
        entry.insert("StickyColor".into(), color);
        Value::Dictionary(entry)
    }

    #[test]
    fn a_list_of_stickies_maps_each_uuid_to_its_paper() {
        let colors = colors_from(Value::Array(vec![
            sticky(
                "abc",
                channels(Value::Real(1.0), Value::Real(1.0), Value::Real(0.0)),
            ),
            sticky(
                "DEF",
                channels(Value::Real(0.0), Value::Real(0.0), Value::Real(1.0)),
            ),
        ]));
        assert_eq!(colors.get("ABC").map(String::as_str), Some("#ffff00"));
        assert_eq!(colors.get("DEF").map(String::as_str), Some("#0000ff"));
        assert_eq!(colors.len(), 2);
    }

    #[test]
    fn a_dictionary_wrapper_yields_its_longest_list() {
        let mut wrapper = Dictionary::new();
        wrapper.insert(
            "other".into(),
            Value::Array(vec![sticky(
                "one",
                channels(Value::Real(1.0), Value::Real(0.0), Value::Real(0.0)),
            )]),
        );
        wrapper.insert(
            "stickies".into(),
            Value::Array(vec![
                sticky(
                    "two",
                    channels(Value::Real(0.0), Value::Real(1.0), Value::Real(0.0)),
                ),
                sticky(
                    "three",
                    channels(Value::Real(0.0), Value::Real(0.0), Value::Real(1.0)),
                ),
            ]),
        );
        let colors = colors_from(Value::Dictionary(wrapper));
        assert_eq!(colors.len(), 2);
        assert!(colors.contains_key("TWO") && colors.contains_key("THREE"));
        assert!(!colors.contains_key("ONE"));
    }

    #[test]
    fn channels_round_to_hex_and_clamp_to_the_byte() {
        let colors = colors_from(Value::Array(vec![
            sticky(
                "mid",
                channels(Value::Real(0.5), Value::Real(0.251), Value::Real(0.998)),
            ),
            sticky(
                "int",
                channels(
                    Value::Integer(1.into()),
                    Value::Integer(0.into()),
                    Value::Real(2.0),
                ),
            ),
            sticky(
                "neg",
                channels(Value::Real(-1.0), Value::Real(0.0), Value::Real(0.0)),
            ),
        ]));
        assert_eq!(colors["MID"], "#8040fe");
        assert_eq!(colors["INT"], "#ff00ff");
        assert_eq!(colors["NEG"], "#000000");
    }

    #[test]
    fn a_malformed_entry_is_skipped_and_the_rest_kept() {
        let mut no_color = Dictionary::new();
        no_color.insert("UUID".into(), Value::String("lost".into()));
        let mut no_channel = Dictionary::new();
        no_channel.insert("Red".into(), Value::Real(1.0));
        let colors = colors_from(Value::Array(vec![
            Value::Dictionary(no_color),
            sticky("partial", Value::Dictionary(no_channel)),
            Value::String("not a sticky".into()),
            sticky(
                "kept",
                channels(Value::Real(0.0), Value::Real(0.0), Value::Real(0.0)),
            ),
        ]));
        assert_eq!(colors.len(), 1);
        assert_eq!(colors["KEPT"], "#000000");
    }

    #[test]
    fn anything_but_a_list_or_wrapper_has_no_colors() {
        assert!(colors_from(Value::String("x".into())).is_empty());
        assert!(colors_from(Value::Array(vec![])).is_empty());
    }
}
