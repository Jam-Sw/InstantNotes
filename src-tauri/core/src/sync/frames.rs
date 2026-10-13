const LEN: usize = 8;
const SHA: usize = 32;

fn hex(bytes: &[u8]) -> String {
    bytes.iter().map(|b| format!("{b:02x}")).collect()
}

fn unhex(text: &str) -> Option<[u8; SHA]> {
    if text.len() != SHA * 2 {
        return None;
    }
    let mut out = [0u8; SHA];
    for (i, chunk) in text.as_bytes().chunks(2).enumerate() {
        let pair = std::str::from_utf8(chunk).ok()?;
        out[i] = u8::from_str_radix(pair, 16).ok()?;
    }
    Some(out)
}

pub fn encode<'a>(blobs: impl IntoIterator<Item = (&'a str, &'a [u8])>) -> Option<Vec<u8>> {
    let mut out = Vec::new();
    for (sha, bytes) in blobs {
        out.extend_from_slice(&(bytes.len() as u64).to_be_bytes());
        out.extend_from_slice(&unhex(sha)?);
        out.extend_from_slice(bytes);
    }
    Some(out)
}

pub fn decode(mut data: &[u8]) -> Option<Vec<(String, Vec<u8>)>> {
    let mut out = Vec::new();
    while !data.is_empty() {
        if data.len() < LEN + SHA {
            return None;
        }
        let len = u64::from_be_bytes(data[..LEN].try_into().ok()?) as usize;
        let sha = hex(&data[LEN..LEN + SHA]);
        let rest = &data[LEN + SHA..];
        if rest.len() < len {
            return None;
        }
        out.push((sha, rest[..len].to_vec()));
        data = &rest[len..];
    }
    Some(out)
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::sync::object::sha_hex;

    #[test]
    fn frames_round_trip_and_refuse_a_truncated_or_bad_stream() {
        let a = b"first".to_vec();
        let b = Vec::new();
        let (sa, sb) = (sha_hex(&a), sha_hex(&b));
        let data = encode([(sa.as_str(), &a[..]), (sb.as_str(), &b[..])]).unwrap();
        assert_eq!(decode(&data).unwrap(), vec![(sa.clone(), a), (sb, b)]);
        assert!(decode(&data[..data.len() - 1]).is_none());
        assert!(decode(&data[..10]).is_none());
        assert_eq!(decode(&[]).unwrap(), Vec::new());
        assert!(encode([("not-hex", &b"x"[..])]).is_none());
    }
}
