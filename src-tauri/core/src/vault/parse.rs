use super::{Frontmatter, VaultNote};
use crate::types::CONTENT_KIND_DOCUMENT;
use std::fmt;

#[derive(Debug)]
pub enum ParseError {
    MissingFrontmatter,
    UnterminatedFrontmatter,
    Yaml(serde_norway::Error),
}

impl fmt::Display for ParseError {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        match self {
            ParseError::MissingFrontmatter => {
                write!(f, "file does not start with a `---` frontmatter block")
            }
            ParseError::UnterminatedFrontmatter => {
                write!(f, "frontmatter block has no closing `---`")
            }
            ParseError::Yaml(e) => write!(f, "invalid frontmatter: {e}"),
        }
    }
}

impl std::error::Error for ParseError {}

pub fn parse_note(text: &str) -> Result<VaultNote, ParseError> {
    let after_open = text
        .strip_prefix("---\n")
        .ok_or(ParseError::MissingFrontmatter)?;

    let (yaml, body) = if let Some(idx) = after_open.find("\n---\n") {
        (&after_open[..idx], &after_open[idx + 5..])
    } else if let Some(yaml) = after_open.strip_suffix("\n---") {
        (yaml, "")
    } else {
        return Err(ParseError::UnterminatedFrontmatter);
    };

    let frontmatter: Frontmatter = serde_norway::from_str(yaml).map_err(ParseError::Yaml)?;

    Ok(VaultNote {
        id: frontmatter.id,
        title: frontmatter.title,
        body: body.to_string(),
        created_at: frontmatter.created,
        updated_at: frontmatter.updated,
        is_pinned: frontmatter.pinned,
        is_archived: frontmatter.archived,
        deleted_at: frontmatter.deleted,
        tags: frontmatter.tags,
        spaces: frontmatter.spaces,
        kind: frontmatter
            .kind
            .unwrap_or_else(|| CONTENT_KIND_DOCUMENT.to_string()),
        surface: None,
    })
}
