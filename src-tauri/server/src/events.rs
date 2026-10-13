pub use instantnotes_core::commands::{Change, NOTES_CHANGED, TAGS_CHANGED, WORKSPACES_CHANGED};
use std::collections::HashMap;
use std::sync::Mutex;
use tokio::sync::broadcast;

pub const VAULT_SYNCED: &str = "vault:synced";

const BUFFER: usize = 256;

#[derive(Default)]
pub struct Hub {
    map: Mutex<HashMap<String, broadcast::Sender<Change>>>,
}

impl Hub {
    pub fn subscribe(&self, sub: &str) -> broadcast::Receiver<Change> {
        let mut map = self.map.lock().unwrap_or_else(|e| e.into_inner());
        map.entry(sub.to_string())
            .or_insert_with(|| broadcast::channel(BUFFER).0)
            .subscribe()
    }

    pub fn watched(&self) -> Vec<String> {
        let map = self.map.lock().unwrap_or_else(|e| e.into_inner());
        map.iter()
            .filter(|(_, sender)| sender.receiver_count() > 0)
            .map(|(sub, _)| sub.clone())
            .collect()
    }

    pub fn publish(&self, sub: &str, changes: Vec<Change>) {
        if changes.is_empty() {
            return;
        }
        let mut map = self.map.lock().unwrap_or_else(|e| e.into_inner());
        let Some(sender) = map.get(sub) else {
            return;
        };
        if sender.receiver_count() == 0 {
            map.remove(sub);
            return;
        }
        for change in changes {
            let _ = sender.send(change);
        }
    }
}
