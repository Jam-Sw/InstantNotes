//! Dashboard stats: library counts from the store, joined with attachment
//! counts from the filesystem, for the Settings front page.

use crate::*;

/// The store's counts plus the on-disk attachment totals. Flattened so the
/// frontend sees one flat object of camelCase numbers.
#[derive(serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub struct DashboardStats {
    #[serde(flatten)]
    library: LibraryStats,
    attachments_count: i64,
    attachments_bytes: i64,
}

#[tauri::command(async)]
pub fn library_stats(state: State<'_, AppState>, app: AppHandle) -> CmdResult<DashboardStats> {
    let library = locked(&state)?.library_stats()?;
    let (attachments_count, attachments_bytes) = attachments_stats(&app);
    Ok(DashboardStats {
        library,
        attachments_count,
        attachments_bytes,
    })
}
