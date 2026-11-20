use crate::*;

const TEXT_EXTS: &[&str] = &["dic", "aff", "txt"];
const TEXT_LIMIT: u64 = 64 * 1024 * 1024;
const REPLY_LIMIT: usize = 1024 * 1024;
const REPLY_WAIT: std::time::Duration = std::time::Duration::from_secs(20);

fn validate_text_path(path: &str) -> CmdResult<&std::path::Path> {
    let p = std::path::Path::new(path);
    if !p.is_absolute() {
        return Err(CmdError::validation("file path must be absolute"));
    }
    let allowed = p
        .extension()
        .and_then(|e| e.to_str())
        .is_some_and(|e| TEXT_EXTS.contains(&e.to_ascii_lowercase().as_str()));
    if !allowed {
        return Err(CmdError::validation(
            "file must have a .dic, .aff or .txt extension",
        ));
    }
    Ok(p)
}

fn decode_text(bytes: Vec<u8>) -> String {
    match String::from_utf8(bytes) {
        Ok(text) => text,
        Err(e) => e.into_bytes().iter().map(|&b| char::from(b)).collect(),
    }
}

#[tauri::command(async)]
pub fn plugin_read_text(path: String) -> CmdResult<String> {
    let p = validate_text_path(&path)?;
    let size = std::fs::metadata(p)
        .map_err(|e| CmdError::storage(format!("could not read file: {e}")))?
        .len();
    if size > TEXT_LIMIT {
        return Err(CmdError::validation("file is larger than 64 MB"));
    }
    std::fs::read(p)
        .map(decode_text)
        .map_err(|e| CmdError::storage(format!("could not read file: {e}")))
}

fn validate_address(url: &str) -> CmdResult<reqwest::Url> {
    let parsed =
        reqwest::Url::parse(url).map_err(|_| CmdError::validation("address is not a URL"))?;
    if !matches!(parsed.scheme(), "http" | "https") {
        return Err(CmdError::validation(
            "address must start with http or https",
        ));
    }
    Ok(parsed)
}

type Pending = std::collections::BTreeMap<u32, tokio::sync::oneshot::Sender<()>>;

static PENDING: std::sync::Mutex<Pending> = std::sync::Mutex::new(Pending::new());

fn pending() -> std::sync::MutexGuard<'static, Pending> {
    PENDING
        .lock()
        .unwrap_or_else(std::sync::PoisonError::into_inner)
}

#[tauri::command]
pub async fn plugin_http_post(id: u32, url: String, body: String) -> CmdResult<String> {
    let address = validate_address(&url)?;
    let (stop, stopped) = tokio::sync::oneshot::channel();
    pending().insert(id, stop);
    let reply = tokio::select! {
        reply = post(address, &url, body) => reply,
        _ = stopped => Err(CmdError::storage("request dropped")),
    };
    pending().remove(&id);
    reply
}

#[tauri::command]
pub fn plugin_http_cancel(id: u32) {
    if let Some(stop) = pending().remove(&id) {
        let _ = stop.send(());
    }
}

async fn post(address: reqwest::Url, url: &str, body: String) -> CmdResult<String> {
    let client = reqwest::Client::builder()
        .timeout(REPLY_WAIT)
        .build()
        .map_err(|e| CmdError::storage(format!("could not start the request: {e}")))?;
    let mut reply = client
        .post(address)
        .header("content-type", "application/json")
        .body(body)
        .send()
        .await
        .map_err(|e| CmdError::storage(format!("no answer from {url}: {e}")))?;
    let status = reply.status();
    if !status.is_success() {
        return Err(CmdError::storage(format!("{url} answered {status}")));
    }
    let mut bytes = Vec::new();
    while let Some(chunk) = reply
        .chunk()
        .await
        .map_err(|e| CmdError::storage(format!("no answer from {url}: {e}")))?
    {
        if bytes.len() + chunk.len() > REPLY_LIMIT {
            return Err(CmdError::validation("answer is larger than 1 MB"));
        }
        bytes.extend_from_slice(&chunk);
    }
    Ok(String::from_utf8_lossy(&bytes).into_owned())
}

#[cfg(test)]
mod tests {
    use super::{decode_text, plugin_read_text, validate_address, validate_text_path};

    #[test]
    fn only_absolute_dictionary_and_text_files_are_read() {
        let abs = |tail: &str| format!("{}{tail}", if cfg!(windows) { "C:\\" } else { "/" });
        assert!(validate_text_path(&abs("usr/share/hunspell/en_US.dic")).is_ok());
        assert!(validate_text_path(&abs("usr/share/hunspell/en_US.AFF")).is_ok());
        assert!(validate_text_path("relative/en_US.dic").is_err());
        assert!(validate_text_path(&abs("home/me/.ssh/id_ed25519")).is_err());
        assert!(validate_text_path(&abs("home/me/notes.db")).is_err());
        assert!(plugin_read_text(abs("nonexistent/en_US.dic")).is_err());
    }

    #[test]
    fn text_that_is_not_utf8_is_read_as_latin1() {
        assert_eq!(decode_text("naïve".as_bytes().to_vec()), "naïve");
        assert_eq!(decode_text(vec![b'n', b'a', 0xEF, b'v', b'e']), "naïve");
    }

    #[test]
    fn only_http_addresses_are_called() {
        assert!(validate_address("http://127.0.0.1:8080/v1/completions").is_ok());
        assert!(validate_address("https://models.example/v1/completions").is_ok());
        assert!(validate_address("file:///etc/passwd").is_err());
        assert!(validate_address("127.0.0.1:8080").is_err());
    }
}
