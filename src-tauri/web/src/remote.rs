use instantnotes_core::sync::frames;
use instantnotes_core::sync::remote::{Remote, RemoteChanges, RemoteError, RemoteKeys, RemoteOp};
use js_sys::Uint8Array;
use serde::de::DeserializeOwned;
use serde_json::{json, Value};
use wasm_bindgen::{JsCast, JsValue};
use wasm_bindgen_futures::JsFuture;
use web_sys::{AbortSignal, Request, RequestInit, Response, WorkerGlobalScope};

const BASE: &str = "/sync/v1/";
const API: u64 = 1;
const REQUEST_TIMEOUT_MS: u32 = 60_000;
const TRIES: usize = 4;
const MAX_WAIT_MS: i32 = 60_000;
const BATCH_BYTES: usize = 16 * 1024 * 1024;
const MISSING_BATCH: usize = 1000;

pub enum Body {
    None,
    Json(Value),
    Bytes(Vec<u8>),
}

fn scope() -> WorkerGlobalScope {
    js_sys::global().unchecked_into()
}

fn unreachable(e: JsValue) -> RemoteError {
    RemoteError::Unreachable(e.as_string().unwrap_or_else(|| format!("{e:?}")))
}

async fn sleep(ms: i32) {
    let promise = js_sys::Promise::new(&mut |resolve, _| {
        let _ = scope().set_timeout_with_callback_and_timeout_and_arguments_0(&resolve, ms);
    });
    let _ = JsFuture::from(promise).await;
}

async fn text(response: &Response) -> Result<String, RemoteError> {
    let promise = response.text().map_err(unreachable)?;
    Ok(JsFuture::from(promise)
        .await
        .map_err(unreachable)?
        .as_string()
        .unwrap_or_default())
}

pub async fn send(method: &str, path: &str, body: &Body) -> Result<Response, RemoteError> {
    for attempt in 1..=TRIES {
        let init = RequestInit::new();
        init.set_method(method);
        init.set_signal(Some(&AbortSignal::timeout_with_u32(REQUEST_TIMEOUT_MS)));
        let request_body: Option<JsValue> = match body {
            Body::None => None,
            Body::Json(value) => Some(JsValue::from_str(&value.to_string())),
            Body::Bytes(bytes) => Some(Uint8Array::from(bytes.as_slice()).into()),
        };
        if let Some(b) = &request_body {
            init.set_body(b);
        }
        let request =
            Request::new_with_str_and_init(&format!("{BASE}{path}"), &init).map_err(unreachable)?;
        let headers = request.headers();
        headers.set("X-InstantNotes", "1").map_err(unreachable)?;
        if matches!(body, Body::Json(_)) {
            headers
                .set("Content-Type", "application/json")
                .map_err(unreachable)?;
        }
        let response: Response = JsFuture::from(scope().fetch_with_request(&request))
            .await
            .map_err(unreachable)?
            .unchecked_into();
        let status = response.status();
        if status != 429 || attempt == TRIES {
            if response.ok() {
                return Ok(response);
            }
            let answer: Value =
                serde_json::from_str(&text(&response).await?).unwrap_or(Value::Null);
            return Err(RemoteError::from_answer(status, &answer));
        }
        let wait = response
            .headers()
            .get("Retry-After")
            .ok()
            .flatten()
            .and_then(|v| v.parse::<i32>().ok())
            .unwrap_or(1)
            .saturating_mul(1000)
            .clamp(1000, MAX_WAIT_MS);
        sleep(wait).await;
    }
    Err(RemoteError::Unreachable(
        "the server kept asking to slow down".into(),
    ))
}

pub async fn json<T: DeserializeOwned>(
    method: &str,
    path: &str,
    body: &Body,
) -> Result<T, RemoteError> {
    let response = send(method, path, body).await?;
    serde_json::from_str(&text(&response).await?)
        .map_err(|e| RemoteError::Refused(format!("unreadable answer: {e}")))
}

async fn bytes(response: Response) -> Result<Vec<u8>, RemoteError> {
    let promise = response.array_buffer().map_err(unreachable)?;
    let buffer = JsFuture::from(promise).await.map_err(unreachable)?;
    Ok(Uint8Array::new(&buffer).to_vec())
}

pub struct Fetch {
    pub max_object_bytes: u64,
}

impl Fetch {
    pub async fn connect() -> Result<Fetch, RemoteError> {
        let info: Value = json("GET", "info", &Body::None).await?;
        if info["app"] != "instantnotes" || info["api"].as_u64() != Some(API) {
            return Err(RemoteError::Refused(
                "this address does not answer as an InstantNotes server".into(),
            ));
        }
        Ok(Fetch {
            max_object_bytes: info["maxObjectBytes"].as_u64().unwrap_or(0),
        })
    }

    async fn upload_frames(&self, batch: &[&(String, Vec<u8>)]) -> Result<(), RemoteError> {
        let body = frames::encode(batch.iter().map(|(s, b)| (s.as_str(), b.as_slice())))
            .ok_or_else(|| RemoteError::Refused("a blob name is not a hash".into()))?;
        send("POST", "blobs/batch", &Body::Bytes(body)).await?;
        Ok(())
    }
}

impl Remote for Fetch {
    async fn changes(&mut self, since: i64) -> Result<RemoteChanges, RemoteError> {
        json("GET", &format!("changes?since={since}&wait=0"), &Body::None).await
    }

    fn max_object_bytes(&self) -> u64 {
        self.max_object_bytes
    }

    async fn missing(&mut self, shas: &[String]) -> Result<Vec<String>, RemoteError> {
        let mut out = Vec::new();
        for batch in shas.chunks(MISSING_BATCH) {
            let answer: Value = json(
                "POST",
                "blobs/missing",
                &Body::Json(json!({ "shas": batch })),
            )
            .await?;
            out.extend(
                answer["missing"]
                    .as_array()
                    .into_iter()
                    .flatten()
                    .filter_map(|v| v.as_str().map(str::to_string)),
            );
        }
        Ok(out)
    }

    async fn upload(&mut self, blobs: &[(String, Vec<u8>)]) -> Result<(), RemoteError> {
        let mut batch: Vec<&(String, Vec<u8>)> = Vec::new();
        let mut size = 0;
        for blob in blobs {
            if blob.1.len() > BATCH_BYTES {
                send(
                    "PUT",
                    &format!("blobs/{}", blob.0),
                    &Body::Bytes(blob.1.clone()),
                )
                .await?;
                continue;
            }
            if size + blob.1.len() > BATCH_BYTES && !batch.is_empty() {
                self.upload_frames(&batch).await?;
                batch.clear();
                size = 0;
            }
            size += blob.1.len();
            batch.push(blob);
        }
        if !batch.is_empty() {
            self.upload_frames(&batch).await?;
        }
        Ok(())
    }

    async fn download(&mut self, shas: &[String]) -> Result<Vec<(String, Vec<u8>)>, RemoteError> {
        let mut out = Vec::new();
        let mut left: Vec<String> = shas.to_vec();
        while !left.is_empty() {
            let response =
                send("POST", "blobs/fetch", &Body::Json(json!({ "shas": left }))).await?;
            let got: Vec<(String, Vec<u8>)> = frames::decode(&bytes(response).await?)
                .ok_or_else(|| RemoteError::Refused("the server sent a damaged batch".into()))?
                .into_iter()
                .filter(|(sha, _)| left.contains(sha))
                .collect();
            if got.is_empty() {
                break;
            }
            left.retain(|sha| !got.iter().any(|(g, _)| g == sha));
            out.extend(got);
        }
        Ok(out)
    }

    async fn commit(
        &mut self,
        epoch: i64,
        ops: &[RemoteOp],
        reset: bool,
    ) -> Result<i64, RemoteError> {
        let answer: Value = json(
            "POST",
            "commit",
            &Body::Json(json!({ "epoch": epoch, "ops": ops, "reset": reset })),
        )
        .await?;
        Ok(answer["head"].as_i64().unwrap_or_default())
    }

    async fn keys(&mut self) -> Result<RemoteKeys, RemoteError> {
        json("GET", "keys", &Body::None).await
    }

    async fn set_keys(&mut self, mode: &str, recipient: Option<&str>) -> Result<(), RemoteError> {
        send(
            "PUT",
            "keys",
            &Body::Json(json!({ "mode": mode, "recipient": recipient })),
        )
        .await?;
        Ok(())
    }

    async fn switch(
        &mut self,
        from_epoch: i64,
        built_at: i64,
        mode: &str,
        recipient: Option<&str>,
        expected: usize,
    ) -> Result<i64, RemoteError> {
        let answer: Value = json(
            "POST",
            "switch",
            &Body::Json(json!({
                "fromEpoch": from_epoch,
                "builtAt": built_at,
                "mode": mode,
                "recipient": recipient,
                "expected": expected,
            })),
        )
        .await?;
        Ok(answer["epoch"].as_i64().unwrap_or_default())
    }
}
