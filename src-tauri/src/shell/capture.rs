//! Capture reveal-to-ready latency: a rolling median surfaced in the About
//! panel. "Capture is discharge" only holds if the panel is ready before the
//! thought decays, so reveal-to-input-ready is tracked as a first-class number.
//! The anchor is the moment the shell starts revealing the window (the earliest
//! point we control; the OS delivers no hotkey-press timestamp). Note content is
//! never involved here.

use crate::*;

/// Rolling window; enough for a stable median, small enough to forget history.
const CAPTURE_SAMPLE_CAP: usize = 50;

#[derive(Default)]
pub(crate) struct CaptureMetrics {
    inner: Mutex<CaptureMetricsInner>,
}

#[derive(Default)]
struct CaptureMetricsInner {
    shown_at: Option<std::time::Instant>,
    samples_ms: Vec<u64>,
}

impl CaptureMetrics {
    /// Stamp the reveal start; the next capture_input_ready measures against it.
    pub(crate) fn mark_shown(&self) {
        if let Ok(mut inner) = self.inner.lock() {
            inner.shown_at = Some(std::time::Instant::now());
        }
    }
}

#[derive(Serialize, Debug, PartialEq)]
#[serde(rename_all = "camelCase")]
pub(crate) struct CaptureLatencySummary {
    last_ms: Option<u64>,
    median_ms: Option<u64>,
    samples: usize,
}

fn push_capture_sample(samples: &mut Vec<u64>, ms: u64) {
    samples.push(ms);
    if samples.len() > CAPTURE_SAMPLE_CAP {
        samples.remove(0);
    }
}

fn median_ms(samples: &[u64]) -> Option<u64> {
    if samples.is_empty() {
        return None;
    }
    let mut sorted = samples.to_vec();
    sorted.sort_unstable();
    Some(sorted[sorted.len() / 2])
}

/// Called by the capture webview once its textarea has focus after a
/// reveal (post-paint). Consumes the pending stamp so a stray call can
/// never double-record; returns the measured reveal-to-ready milliseconds.
#[tauri::command]
pub fn capture_input_ready(metrics: State<'_, CaptureMetrics>) -> CmdResult<Option<u64>> {
    let mut inner = metrics.inner.lock().map_err(|_| CmdError {
        code: "STORAGE_ERROR".into(),
        message: "internal state lock poisoned".into(),
    })?;
    let Some(shown) = inner.shown_at.take() else {
        return Ok(None);
    };
    let ms = shown.elapsed().as_millis() as u64;
    push_capture_sample(&mut inner.samples_ms, ms);
    Ok(Some(ms))
}

#[tauri::command]
pub fn get_capture_latency(metrics: State<'_, CaptureMetrics>) -> CmdResult<CaptureLatencySummary> {
    let inner = metrics.inner.lock().map_err(|_| CmdError {
        code: "STORAGE_ERROR".into(),
        message: "internal state lock poisoned".into(),
    })?;
    Ok(CaptureLatencySummary {
        last_ms: inner.samples_ms.last().copied(),
        median_ms: median_ms(&inner.samples_ms),
        samples: inner.samples_ms.len(),
    })
}

#[cfg(test)]
mod tests {
    use super::{median_ms, push_capture_sample, CAPTURE_SAMPLE_CAP};

    #[test]
    fn capture_samples_roll_over_at_the_cap() {
        let mut samples = Vec::new();
        for ms in 0..(CAPTURE_SAMPLE_CAP as u64 + 10) {
            push_capture_sample(&mut samples, ms);
        }
        assert_eq!(samples.len(), CAPTURE_SAMPLE_CAP);
        // Oldest entries were evicted; the newest survives.
        assert_eq!(samples.first().copied(), Some(10));
        assert_eq!(samples.last().copied(), Some(CAPTURE_SAMPLE_CAP as u64 + 9));
    }

    #[test]
    fn median_is_none_when_empty_and_stable_against_outliers() {
        assert_eq!(median_ms(&[]), None);
        assert_eq!(median_ms(&[40]), Some(40));
        // One slow cold start must not drag the reported number.
        assert_eq!(median_ms(&[35, 38, 40, 42, 900]), Some(40));
        // Input order is irrelevant.
        assert_eq!(median_ms(&[900, 40, 35, 42, 38]), Some(40));
    }
}
