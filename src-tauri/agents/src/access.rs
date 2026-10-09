use crate::fail;
use instantnotes_core::Store;
use serde_json::Value;

pub const ACCESS_KEY: &str = "agents.access";

pub const TAGS_KEY: &str = "agents.tags";

pub const BLOCKED_KEY: &str = "agents.blocked";

#[derive(Debug, Clone, Copy, PartialEq, Eq, PartialOrd, Ord)]
pub enum Access {
    Off,
    Read,
    Write,
}

impl Access {
    pub fn of(store: &Store) -> Access {
        match store.get_setting(ACCESS_KEY) {
            Ok(Some(Value::String(s))) if s == "read" => Access::Read,
            Ok(Some(Value::String(s))) if s == "write" => Access::Write,
            _ => Access::Off,
        }
    }

    pub(crate) fn check(store: &Store, needed: Access) -> Result<(), String> {
        let granted = Access::of(store);
        if granted < needed {
            return Err(match granted {
                Access::Off => "Agent access is off, so nothing was read or changed. The user can turn it on in InstantNotes, Settings > Agents.",
                _ => "Agent access is read only, so nothing was changed. The user can allow writing in InstantNotes, Settings > Agents.",
            }
            .into());
        }
        if needed == Access::Write && !store.schema_is_current().map_err(fail)? {
            return Err("InstantNotes was updated since this connection started, so nothing was changed. Restart the connection to keep writing.".into());
        }
        Ok(())
    }
}
