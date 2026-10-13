use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};

pub const NOTE_PREFIX: &str = "note:";
pub const ATTACHMENT_PREFIX: &str = "attachment:";
pub const MANIFEST_KEY: &str = "manifest";
const VERSION: u32 = 1;

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct Envelope {
    pub v: u32,
    pub key: String,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub md: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub surface: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub manifest: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub bytes: Option<String>,
}

pub fn sha_hex(bytes: &[u8]) -> String {
    Sha256::digest(bytes)
        .iter()
        .map(|b| format!("{b:02x}"))
        .collect()
}

pub fn note_key(id: &str) -> String {
    format!("{NOTE_PREFIX}{id}")
}

pub fn attachment_key(file: &str) -> String {
    format!("{ATTACHMENT_PREFIX}{file}")
}

impl Envelope {
    fn empty(key: String) -> Envelope {
        Envelope {
            v: VERSION,
            key,
            md: None,
            surface: None,
            manifest: None,
            bytes: None,
        }
    }

    pub fn note(id: &str, md: String, surface: Option<String>) -> Envelope {
        Envelope {
            md: Some(md),
            surface,
            ..Envelope::empty(note_key(id))
        }
    }

    pub fn manifest(text: String) -> Envelope {
        Envelope {
            manifest: Some(text),
            ..Envelope::empty(MANIFEST_KEY.to_string())
        }
    }

    pub fn attachment(file: &str, bytes: &[u8]) -> Envelope {
        use base64::Engine;
        Envelope {
            bytes: Some(base64::engine::general_purpose::STANDARD.encode(bytes)),
            ..Envelope::empty(attachment_key(file))
        }
    }

    pub fn encode(&self) -> Vec<u8> {
        serde_json::to_vec(self).expect("an envelope always serializes")
    }

    pub fn decode(bytes: &[u8]) -> Option<Envelope> {
        serde_json::from_slice::<Envelope>(bytes)
            .ok()
            .filter(|e| e.v == VERSION)
    }

    pub fn note_id(&self) -> Option<&str> {
        self.key.strip_prefix(NOTE_PREFIX)
    }

    pub fn attachment_file(&self) -> Option<&str> {
        self.key
            .strip_prefix(ATTACHMENT_PREFIX)
            .filter(|f| !f.starts_with('.') && crate::attachments::is_plain_name(f))
    }

    pub fn attachment_bytes(&self) -> Option<Vec<u8>> {
        use base64::Engine;
        self.bytes
            .as_deref()
            .and_then(|b| base64::engine::general_purpose::STANDARD.decode(b).ok())
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn an_envelope_round_trips_and_encodes_the_same_way_every_time() {
        let note = Envelope::note("abc", "---\nid: abc\n---\nhi".into(), Some("{}".into()));
        let bytes = note.encode();
        assert_eq!(bytes, note.encode());
        let back = Envelope::decode(&bytes).unwrap();
        assert_eq!(back, note);
        assert_eq!(back.note_id(), Some("abc"));
        assert_eq!(Envelope::manifest("tags: {}".into()).note_id(), None);
        assert!(Envelope::decode(br#"{"v":2,"key":"note:x"}"#).is_none());
        assert!(Envelope::decode(b"not json").is_none());
    }

    #[test]
    fn an_attachment_carries_its_bytes_and_a_safe_name_only() {
        let image = Envelope::attachment("0123456789abcdef.png", &[1, 2, 255]);
        assert_eq!(image.attachment_bytes().unwrap(), vec![1, 2, 255]);
        assert_eq!(image.attachment_file(), Some("0123456789abcdef.png"));
        let escape = Envelope::attachment("../../etc/passwd", b"x");
        assert_eq!(escape.attachment_file(), None);
    }
}
