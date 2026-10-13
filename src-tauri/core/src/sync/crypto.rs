use age::secrecy::ExposeSecret;
use age::x25519::{Identity, Recipient};
use base64::Engine;
use hkdf::Hkdf;
use hmac::{Hmac, KeyInit, Mac};
use sha2::{Digest, Sha256};
use std::str::FromStr;

const NAME_INFO: &[u8] = b"instantnotes object names";
const PROOF_INFO: &[u8] = b"instantnotes mode proof";
const PLAIN_PREFIX: &str = "instantnotes:";
const STEP: usize = 4096;
const STEPPED_UP_TO: usize = 64 * 1024;
const MARK: u8 = 0x80;

#[derive(Debug, Clone, PartialEq, Eq)]
pub enum CryptoError {
    BadKey,
    Unreadable,
    NotVouched,
}

impl std::fmt::Display for CryptoError {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        match self {
            CryptoError::BadKey => write!(f, "that is not a valid recovery key"),
            CryptoError::Unreadable => write!(f, "an object could not be decrypted with this key"),
            CryptoError::NotVouched => write!(
                f,
                "the key that arrived is not the one the words were made for, so it was not kept"
            ),
        }
    }
}

fn hex(bytes: &[u8]) -> String {
    bytes.iter().map(|b| format!("{b:02x}")).collect()
}

pub fn padded_len(len: usize) -> usize {
    let needed = len + 1;
    if needed <= STEPPED_UP_TO {
        needed.div_ceil(STEP) * STEP
    } else {
        needed.next_power_of_two()
    }
}

pub fn pad(plain: &[u8]) -> Vec<u8> {
    let mut out = Vec::with_capacity(padded_len(plain.len()));
    out.extend_from_slice(plain);
    out.push(MARK);
    out.resize(padded_len(plain.len()), 0);
    out
}

pub fn unpad(padded: &[u8]) -> Result<Vec<u8>, CryptoError> {
    let end = padded
        .iter()
        .rposition(|b| *b != 0)
        .filter(|i| padded[*i] == MARK)
        .ok_or(CryptoError::Unreadable)?;
    Ok(padded[..end].to_vec())
}

pub struct LibraryKey {
    identity: Identity,
    names: [u8; 32],
    proofs: [u8; 32],
}

impl LibraryKey {
    pub fn generate() -> LibraryKey {
        LibraryKey::from_identity(Identity::generate())
    }

    pub fn from_recovery(text: &str) -> Result<LibraryKey, CryptoError> {
        let cleaned: String = text.split_whitespace().collect();
        Identity::from_str(&cleaned.to_uppercase())
            .map(LibraryKey::from_identity)
            .map_err(|_| CryptoError::BadKey)
    }

    fn from_identity(identity: Identity) -> LibraryKey {
        let hkdf = Hkdf::<Sha256>::new(None, identity.to_string().expose_secret().as_bytes());
        let mut names = [0u8; 32];
        let mut proofs = [0u8; 32];
        hkdf.expand(NAME_INFO, &mut names)
            .and_then(|()| hkdf.expand(PROOF_INFO, &mut proofs))
            .expect("32 bytes is a valid HKDF-SHA256 output");
        LibraryKey {
            identity,
            names,
            proofs,
        }
    }

    fn proof_mac(&self) -> Hmac<Sha256> {
        Hmac::<Sha256>::new_from_slice(&self.proofs).expect("HMAC takes a key of any length")
    }

    pub fn prove(&self, text: &str) -> String {
        let mut mac = self.proof_mac();
        mac.update(text.as_bytes());
        hex(&mac.finalize().into_bytes())
    }

    pub fn verify(&self, text: &str, proof: &str) -> bool {
        let Some(bytes) = (0..proof.len())
            .step_by(2)
            .map(|i| {
                proof
                    .get(i..i + 2)
                    .and_then(|p| u8::from_str_radix(p, 16).ok())
            })
            .collect::<Option<Vec<u8>>>()
        else {
            return false;
        };
        let mut mac = self.proof_mac();
        mac.update(text.as_bytes());
        mac.verify_slice(&bytes).is_ok()
    }

    pub fn recovery(&self) -> String {
        self.identity.to_string().expose_secret().to_string()
    }

    pub fn recipient(&self) -> String {
        self.identity.to_public().to_string()
    }

    pub fn wrap_for(&self, public: &str) -> Result<String, CryptoError> {
        let recipient = Recipient::from_str(public).map_err(|_| CryptoError::BadKey)?;
        let sealed = age::encrypt(&recipient, self.recovery().as_bytes())
            .map_err(|_| CryptoError::BadKey)?;
        Ok(base64::engine::general_purpose::STANDARD.encode(sealed))
    }
}

pub struct JoinKey {
    identity: Identity,
}

impl JoinKey {
    pub fn generate() -> JoinKey {
        JoinKey {
            identity: Identity::generate(),
        }
    }

    pub fn public(&self) -> String {
        self.identity.to_public().to_string()
    }

    pub fn unwrap(&self, wrapped: &str, recipient: &str) -> Result<LibraryKey, CryptoError> {
        let sealed = base64::engine::general_purpose::STANDARD
            .decode(wrapped.trim())
            .map_err(|_| CryptoError::Unreadable)?;
        let secret = age::decrypt(&self.identity, &sealed).map_err(|_| CryptoError::Unreadable)?;
        let text = String::from_utf8(secret).map_err(|_| CryptoError::Unreadable)?;
        let key = LibraryKey::from_recovery(&text)?;
        if key.recipient() != recipient.trim() {
            return Err(CryptoError::NotVouched);
        }
        Ok(key)
    }
}

pub fn join_words(public: &str, recipient: &str) -> [&'static str; 6] {
    let digest = Sha256::digest(
        format!("instantnotes-join\n{}\n{}", public.trim(), recipient.trim()).as_bytes(),
    );
    std::array::from_fn(|i| WORDS[digest[i] as usize])
}

pub enum Lock {
    Plain,
    Encrypted(LibraryKey),
}

impl Lock {
    pub fn encrypted(&self) -> bool {
        matches!(self, Lock::Encrypted(_))
    }

    pub fn name(&self, key: &str) -> String {
        match self {
            Lock::Plain => hex(&Sha256::digest(format!("{PLAIN_PREFIX}{key}").as_bytes())),
            Lock::Encrypted(library) => {
                let mut mac = Hmac::<Sha256>::new_from_slice(&library.names)
                    .expect("HMAC takes a key of any length");
                mac.update(key.as_bytes());
                hex(&mac.finalize().into_bytes())
            }
        }
    }

    pub fn seal(&self, plain: &[u8]) -> Vec<u8> {
        match self {
            Lock::Plain => plain.to_vec(),
            Lock::Encrypted(library) => age::encrypt(&library.identity.to_public(), &pad(plain))
                .expect("age encryption to an X25519 recipient"),
        }
    }

    pub fn open(&self, sealed: &[u8]) -> Result<Vec<u8>, CryptoError> {
        match self {
            Lock::Plain => Ok(sealed.to_vec()),
            Lock::Encrypted(library) => {
                let padded =
                    age::decrypt(&library.identity, sealed).map_err(|_| CryptoError::Unreadable)?;
                unpad(&padded)
            }
        }
    }
}

const WORDS: [&str; 256] = [
    "acorn", "adobe", "agent", "alarm", "album", "amber", "angle", "apple", "apron", "arrow",
    "aspen", "atlas", "attic", "award", "bacon", "badge", "bagel", "baker", "bamboo", "banjo",
    "barn", "basil", "basin", "beach", "beard", "bell", "berry", "bench", "bison", "blade",
    "blank", "blaze", "bloom", "board", "boat", "bolt", "bonus", "book", "boot", "brass", "bread",
    "brick", "bridge", "brook", "brush", "bucket", "bunny", "cabin", "cable", "cactus", "camel",
    "canal", "candle", "canoe", "cargo", "carpet", "castle", "cedar", "chain", "chalk", "charm",
    "cherry", "chess", "chimney", "cider", "cinema", "circle", "cliff", "clock", "cloud", "clover",
    "coast", "cobalt", "cocoa", "comet", "coral", "cotton", "crane", "crayon", "creek", "cricket",
    "crown", "cube", "cup", "curtain", "daisy", "delta", "desert", "diamond", "dinner", "dolphin",
    "donkey", "door", "dragon", "drum", "eagle", "echo", "elbow", "ember", "engine", "falcon",
    "feather", "fence", "fern", "fiddle", "field", "finch", "flame", "flute", "forest", "fossil",
    "fountain", "fox", "frost", "galaxy", "garden", "garlic", "gecko", "ginger", "glacier",
    "globe", "glove", "goat", "grape", "gravel", "guitar", "hammer", "harbor", "harp", "hazel",
    "helmet", "heron", "honey", "hood", "horizon", "igloo", "island", "ivory", "jacket", "jaguar",
    "jasmine", "jelly", "jewel", "kayak", "kettle", "kitten", "koala", "ladder", "lagoon",
    "lantern", "laptop", "lemon", "lily", "lion", "lobster", "lotus", "magnet", "mango", "maple",
    "marble", "meadow", "melon", "mirror", "mitten", "moose", "mosaic", "moss", "mountain",
    "muffin", "nectar", "needle", "nest", "noodle", "oasis", "ocean", "olive", "onion", "orange",
    "orbit", "otter", "owl", "paddle", "palace", "panda", "paper", "parrot", "peach", "pearl",
    "pebble", "pencil", "pepper", "piano", "pickle", "pillow", "pine", "planet", "plum", "pocket",
    "pond", "poppy", "prism", "pumpkin", "puzzle", "quartz", "quill", "rabbit", "radar", "raft",
    "rainbow", "raven", "reef", "ribbon", "river", "robin", "rocket", "rose", "ruby", "saddle",
    "salmon", "sand", "satin", "scarf", "shell", "silver", "sketch", "sled", "snail", "sparrow",
    "spice", "spoon", "spruce", "star", "stone", "storm", "sugar", "summit", "sunset", "swan",
    "table", "tango", "teapot", "thistle", "thunder", "tiger", "timber", "toast", "tomato",
    "topaz", "torch", "tower", "trail", "tulip", "tunnel", "turtle", "valley", "velvet",
];

#[cfg(test)]
mod tests {
    use super::*;
    use std::collections::HashSet;

    #[test]
    fn padding_hides_the_exact_length_and_comes_off_cleanly() {
        assert_eq!(padded_len(0), 4096);
        assert_eq!(padded_len(4095), 4096);
        assert_eq!(padded_len(4096), 8192);
        assert_eq!(padded_len(64 * 1024 - 1), 64 * 1024);
        assert_eq!(padded_len(64 * 1024), 128 * 1024);
        assert_eq!(padded_len(200_000), 262_144);
        for plain in [
            &b""[..],
            b"x",
            b"ends with zero\0",
            &[0x80; 10],
            &vec![7u8; 70_000],
        ] {
            let padded = pad(plain);
            assert_eq!(padded.len(), padded_len(plain.len()));
            assert_eq!(unpad(&padded).unwrap(), plain);
        }
        assert!(unpad(&[1, 2, 3, 0, 0]).is_err());
    }

    #[test]
    fn an_object_opens_only_with_the_library_key() {
        let key = LibraryKey::generate();
        let lock = Lock::Encrypted(key);
        let sealed = lock.seal(b"a secret note");
        assert!(!sealed.windows(6).any(|w| w == b"secret"));
        assert_eq!(lock.open(&sealed).unwrap(), b"a secret note");
        assert_ne!(lock.seal(b"a secret note"), sealed);
        let other = Lock::Encrypted(LibraryKey::generate());
        assert_eq!(other.open(&sealed), Err(CryptoError::Unreadable));
    }

    #[test]
    fn names_are_stable_per_key_and_reveal_nothing() {
        let key = LibraryKey::generate();
        let recovery = key.recovery();
        let a = Lock::Encrypted(key);
        let b = Lock::Encrypted(LibraryKey::from_recovery(&recovery).unwrap());
        let name = a.name("note:1234");
        assert_eq!(name, b.name("note:1234"));
        assert_eq!(name.len(), 64);
        assert_ne!(name, a.name("note:1235"));
        assert_ne!(
            name,
            Lock::Encrypted(LibraryKey::generate()).name("note:1234")
        );
        assert_ne!(name, Lock::Plain.name("note:1234"));
        assert_eq!(Lock::Plain.name("note:1234"), Lock::Plain.name("note:1234"));
    }

    #[test]
    fn the_recovery_key_reads_back_however_it_was_typed() {
        let key = LibraryKey::generate();
        let recovery = key.recovery();
        assert!(recovery.starts_with("AGE-SECRET-KEY-1"));
        let spaced: String = recovery
            .to_lowercase()
            .chars()
            .collect::<Vec<_>>()
            .chunks(8)
            .map(|c| c.iter().collect::<String>())
            .collect::<Vec<_>>()
            .join(" ");
        let back = LibraryKey::from_recovery(&spaced).unwrap();
        assert_eq!(back.recipient(), key.recipient());
        assert_eq!(
            LibraryKey::from_recovery("not a key").err(),
            Some(CryptoError::BadKey)
        );
    }

    #[test]
    fn a_joining_device_gets_the_library_key_only_through_its_own_key() {
        let library = LibraryKey::generate();
        let joining = JoinKey::generate();
        let wrapped = library.wrap_for(&joining.public()).unwrap();
        assert_eq!(
            joining
                .unwrap(&wrapped, &library.recipient())
                .unwrap()
                .recipient(),
            library.recipient()
        );
        assert!(JoinKey::generate()
            .unwrap(&wrapped, &library.recipient())
            .is_err());
        let invented = LibraryKey::generate().wrap_for(&joining.public()).unwrap();
        assert_eq!(
            joining.unwrap(&invented, &library.recipient()).err(),
            Some(CryptoError::NotVouched)
        );
        assert!(!wrapped.contains(&library.recovery()));
    }

    #[test]
    fn join_words_are_the_same_on_both_sides_and_differ_for_another_key() {
        let joining = JoinKey::generate();
        let public = joining.public();
        let library = LibraryKey::generate().recipient();
        assert_eq!(
            join_words(&public, &library),
            join_words(&format!(" {public}\n"), &library)
        );
        let other = JoinKey::generate().public();
        assert_ne!(join_words(&public, &library), join_words(&other, &library));
        let swapped = LibraryKey::generate().recipient();
        assert_ne!(join_words(&public, &library), join_words(&public, &swapped));
        assert_eq!(WORDS.iter().collect::<HashSet<_>>().len(), 256);
    }

    #[test]
    fn only_the_library_key_can_prove_a_switch_to_plain() {
        let key = LibraryKey::generate();
        let text = crate::sync::object::plain_proof_text("lib", 2);
        let proof = key.prove(&text);
        assert!(key.verify(&text, &proof));
        assert!(!key.verify(&crate::sync::object::plain_proof_text("lib", 3), &proof));
        assert!(!LibraryKey::generate().verify(&text, &proof));
        assert!(!key.verify(&text, "zz"));
        assert!(!key.verify(&text, ""));
    }

    #[test]
    fn plain_mode_stores_content_as_it_is() {
        assert_eq!(Lock::Plain.seal(b"note"), b"note");
        assert_eq!(Lock::Plain.open(b"note").unwrap(), b"note");
        assert!(!Lock::Plain.encrypted());
    }
}
