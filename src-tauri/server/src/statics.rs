use axum::http::{header, HeaderValue, StatusCode};
use axum::response::{IntoResponse, Response};
use std::path::{Component, Path, PathBuf};

pub fn mime_for(path: &Path) -> &'static str {
    match path
        .extension()
        .and_then(|e| e.to_str())
        .map(str::to_ascii_lowercase)
        .as_deref()
    {
        Some("html") => "text/html; charset=utf-8",
        Some("js" | "mjs") => "text/javascript; charset=utf-8",
        Some("css") => "text/css; charset=utf-8",
        Some("json") => "application/json",
        Some("svg") => "image/svg+xml",
        Some("png") => "image/png",
        Some("jpg" | "jpeg") => "image/jpeg",
        Some("gif") => "image/gif",
        Some("webp") => "image/webp",
        Some("ico") => "image/x-icon",
        Some("woff2") => "font/woff2",
        Some("woff") => "font/woff",
        Some("ttf") => "font/ttf",
        Some("txt") => "text/plain; charset=utf-8",
        Some("wasm") => "application/wasm",
        Some("map") => "application/json",
        _ => "application/octet-stream",
    }
}

pub fn safe_relative(request_path: &str) -> Option<PathBuf> {
    let trimmed = request_path.trim_start_matches('/');
    let mut out = PathBuf::new();
    for part in Path::new(trimmed).components() {
        match part {
            Component::Normal(p) => out.push(p),
            Component::CurDir => {}
            _ => return None,
        }
    }
    Some(out)
}

pub async fn serve_file(path: &Path, cache: &'static str) -> Option<Response> {
    let bytes = tokio::fs::read(path).await.ok()?;
    let mut response = (StatusCode::OK, bytes).into_response();
    let headers = response.headers_mut();
    headers.insert(
        header::CONTENT_TYPE,
        HeaderValue::from_static(mime_for(path)),
    );
    headers.insert(header::CACHE_CONTROL, HeaderValue::from_static(cache));
    Some(response)
}

pub const RUNTIME_META: &str = r#"<meta name="instantnotes-runtime" content="web">"#;

pub fn mark_web(index: &str) -> String {
    match index.find("<head>") {
        Some(at) => {
            let split = at + "<head>".len();
            format!("{}{}{}", &index[..split], RUNTIME_META, &index[split..])
        }
        None => format!("{RUNTIME_META}{index}"),
    }
}

async fn serve_index(ui_dir: &Path) -> Option<Response> {
    let raw = tokio::fs::read_to_string(ui_dir.join("index.html"))
        .await
        .ok()?;
    let mut response = (StatusCode::OK, mark_web(&raw)).into_response();
    let headers = response.headers_mut();
    headers.insert(
        header::CONTENT_TYPE,
        HeaderValue::from_static("text/html; charset=utf-8"),
    );
    headers.insert(header::CACHE_CONTROL, HeaderValue::from_static("no-cache"));
    Some(response)
}

pub async fn serve_ui(ui_dir: &Path, request_path: &str) -> Response {
    if let Some(rel) = safe_relative(request_path) {
        if !rel.as_os_str().is_empty() {
            let full = ui_dir.join(&rel);
            let immutable = rel.starts_with("_app/immutable");
            let cache = if immutable {
                "public, max-age=31536000, immutable"
            } else {
                "no-cache"
            };
            if tokio::fs::metadata(&full)
                .await
                .map(|m| m.is_file())
                .unwrap_or(false)
            {
                if let Some(found) = serve_file(&full, cache).await {
                    return found;
                }
            }
        }
    }
    match serve_index(ui_dir).await {
        Some(index) => index,
        None => (
            StatusCode::NOT_FOUND,
            "the web UI is not installed next to this server",
        )
            .into_response(),
    }
}

pub fn html(status: StatusCode, body: String) -> Response {
    let mut response = (status, body).into_response();
    response.headers_mut().insert(
        header::CONTENT_TYPE,
        HeaderValue::from_static("text/html; charset=utf-8"),
    );
    response
        .headers_mut()
        .insert(header::CACHE_CONTROL, HeaderValue::from_static("no-store"));
    response
}

pub const SIGN_IN: &str = r#"<!doctype html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">
<title>InstantNotes</title>
<style>
:root{color-scheme:light dark;font-family:system-ui,sans-serif}
body{margin:0;min-height:100vh;display:grid;place-items:center;background:Canvas;color:CanvasText}
main{text-align:center;padding:2rem}
h1{font-weight:600;font-size:1.5rem;margin:0 0 .5rem}
p{opacity:.7;margin:0 0 1.5rem}
a{display:inline-block;padding:.6rem 1.4rem;border-radius:.6rem;background:CanvasText;color:Canvas;text-decoration:none;font-weight:600}
</style></head><body><main>
<h1>InstantNotes</h1><p>Your notes, in your browser.</p>
<a href="/auth/login">Sign in</a>
</main></body></html>"#;

pub const SIGNED_IN: &str = r#"<!doctype html>
<html lang="en"><head><meta charset="utf-8"><title>InstantNotes</title>
<meta http-equiv="refresh" content="0; url=/">
<script>location.replace("/")</script></head>
<body><a href="/">Continue to InstantNotes</a></body></html>"#;

pub fn error_page(message: &str) -> String {
    let safe: String = message
        .chars()
        .map(|c| match c {
            '<' => "&lt;".to_string(),
            '>' => "&gt;".to_string(),
            '&' => "&amp;".to_string(),
            c => c.to_string(),
        })
        .collect();
    format!(
        r#"<!doctype html><html lang="en"><head><meta charset="utf-8"><title>InstantNotes</title>
<style>:root{{color-scheme:light dark;font-family:system-ui,sans-serif}}body{{margin:0;min-height:100vh;display:grid;place-items:center}}main{{text-align:center;padding:2rem}}</style></head>
<body><main><h1>Sign-in did not finish</h1><p>{safe}</p><p><a href="/auth/login">Try again</a></p></main></body></html>"#
    )
}
