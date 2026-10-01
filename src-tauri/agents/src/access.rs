//! Whether agents may act, and how far: the level the user set in
//! Settings > Agents, re-read on every call so a change applies at once.

use crate::fail;
use instantnotes_core::Store;
use serde_json::Value;

/// Settings key holding the access level; written by Settings > Agents.
pub const ACCESS_KEY: &str = "agents.access";

/// What agents may do. Off until the user turns it on.
#[derive(Debug, Clone, Copy, PartialEq, Eq, PartialOrd, Ord)]
pub enum Access {
    Off,
    Read,
    Write,
}

impl Access {
    /// The current level, read from settings. Anything unreadable is `Off`.
    pub fn of(store: &Store) -> Access {
        match store.get_setting(ACCESS_KEY) {
            Ok(Some(Value::String(s))) if s == "read" => Access::Read,
            Ok(Some(Value::String(s))) if s == "write" => Access::Write,
            _ => Access::Off,
        }
    }

    /// Let through a call that needs `needed`, or say why not in words the
    /// agent can pass on to the user.
    pub(crate) fn check(store: &Store, needed: Access) -> Result<(), String> {
        let granted = Access::of(store);
        if granted < needed {
            return Err(match granted {
                Access::Off => "Agent access is off. The user can turn it on in InstantNotes, Settings > Agents.",
                _ => "Agent access is read only. The user can allow writing in InstantNotes, Settings > Agents.",
            }
            .into());
        }
        // A newer app that migrated the file since this process opened it
        // owns the schema now; this build's writes could be wrong for it.
        if needed == Access::Write && !store.schema_is_current().map_err(fail)? {
            return Err("InstantNotes was updated since this connection started. Restart the connection to keep writing.".into());
        }
        Ok(())
    }
}
