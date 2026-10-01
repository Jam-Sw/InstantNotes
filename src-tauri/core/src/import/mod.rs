//! Bringing notes in from other apps (Settings > Import). Reading and
//! converting only: the library is written by `Store::import_notes`, and
//! images are copied in by the shell, which owns the attachments folder.

pub mod rtf;
pub mod stickies;
