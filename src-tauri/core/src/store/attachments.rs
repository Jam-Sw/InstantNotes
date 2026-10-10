use super::*;
use crate::attachments::{referenced_names, remove_attachment};
use std::collections::BTreeSet;

const CAPTURE_DRAFT_SETTING: &str = "capture.draft";

impl Store {
    pub fn attachment_names_of(&self, ids: &[String]) -> Result<BTreeSet<String>> {
        let mut names = BTreeSet::new();
        let mut stmt = self
            .conn
            .prepare("SELECT body, surface_data FROM notes WHERE id = ?1")?;
        for id in ids {
            let row: Option<(String, Option<String>)> = stmt
                .query_row(params![id], |r| Ok((r.get(0)?, r.get(1)?)))
                .optional()?;
            if let Some((body, surface)) = row {
                names.extend(referenced_names(&body));
                names.extend(referenced_names(surface.as_deref().unwrap_or("")));
            }
        }
        Ok(names)
    }

    pub fn unreferenced_attachments(
        &self,
        names: impl IntoIterator<Item = String>,
    ) -> Result<Vec<String>> {
        let draft = self
            .get_setting(CAPTURE_DRAFT_SETTING)?
            .and_then(|v| v.as_str().map(str::to_string))
            .unwrap_or_default();
        let in_draft: BTreeSet<String> = referenced_names(&draft)
            .into_iter()
            .map(|n| n.to_ascii_lowercase())
            .collect();
        let mut stmt = self.conn.prepare(
            "SELECT 1 FROM notes WHERE instr(lower(body), ?1) > 0 \
             OR instr(lower(COALESCE(surface_data, '')), ?1) > 0 LIMIT 1",
        )?;
        let mut out = Vec::new();
        for name in names {
            let lowered = name.to_ascii_lowercase();
            if in_draft.contains(&lowered) {
                continue;
            }
            let reference = format!("attachments/{lowered}");
            if !stmt.exists(params![reference])? {
                out.push(name);
            }
        }
        out.sort();
        Ok(out)
    }

    pub fn remove_unreferenced_attachments(
        &self,
        dir: &Path,
        names: impl IntoIterator<Item = String>,
    ) -> Result<AttachmentCleanup> {
        let vault_dir = self.vault_root().map(|root| root.join("attachments"));
        let mut done = AttachmentCleanup::default();
        for name in self.unreferenced_attachments(names)? {
            if let Ok(bytes) = remove_attachment(dir, vault_dir.as_deref(), &name) {
                if bytes > 0 {
                    done.count += 1;
                    done.bytes += bytes;
                }
            }
        }
        Ok(done)
    }
}
