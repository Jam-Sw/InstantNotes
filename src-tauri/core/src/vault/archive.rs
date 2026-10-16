const LOCAL_HEADER: u32 = 0x0403_4b50;
const CENTRAL_HEADER: u32 = 0x0201_4b50;
const END_RECORD: u32 = 0x0605_4b50;
const VERSION: u16 = 20;
const UTF8_NAMES: u16 = 0x0800;
const STORED: u16 = 0;
const DOS_DATE: u16 = (46 << 9) | (1 << 5) | 1;

const CRC_TABLE: [u32; 256] = {
    let mut table = [0u32; 256];
    let mut n = 0;
    while n < 256 {
        let mut c = n as u32;
        let mut k = 0;
        while k < 8 {
            c = if c & 1 != 0 {
                0xEDB8_8320 ^ (c >> 1)
            } else {
                c >> 1
            };
            k += 1;
        }
        table[n] = c;
        n += 1;
    }
    table
};

pub fn crc32(bytes: &[u8]) -> u32 {
    let mut c = 0xFFFF_FFFFu32;
    for b in bytes {
        c = CRC_TABLE[((c ^ *b as u32) & 0xFF) as usize] ^ (c >> 8);
    }
    c ^ 0xFFFF_FFFF
}

struct Entry {
    name: Vec<u8>,
    crc: u32,
    size: u32,
    offset: u32,
}

#[derive(Default)]
pub struct Writer {
    out: Vec<u8>,
    entries: Vec<Entry>,
}

fn put16(out: &mut Vec<u8>, v: u16) {
    out.extend_from_slice(&v.to_le_bytes());
}

fn put32(out: &mut Vec<u8>, v: u32) {
    out.extend_from_slice(&v.to_le_bytes());
}

impl Writer {
    pub fn new() -> Self {
        Self::default()
    }

    pub fn add(&mut self, name: &str, bytes: &[u8]) {
        let name = name.as_bytes().to_vec();
        let crc = crc32(bytes);
        let size = bytes.len() as u32;
        let offset = self.out.len() as u32;
        put32(&mut self.out, LOCAL_HEADER);
        put16(&mut self.out, VERSION);
        put16(&mut self.out, UTF8_NAMES);
        put16(&mut self.out, STORED);
        put16(&mut self.out, 0);
        put16(&mut self.out, DOS_DATE);
        put32(&mut self.out, crc);
        put32(&mut self.out, size);
        put32(&mut self.out, size);
        put16(&mut self.out, name.len() as u16);
        put16(&mut self.out, 0);
        self.out.extend_from_slice(&name);
        self.out.extend_from_slice(bytes);
        self.entries.push(Entry {
            name,
            crc,
            size,
            offset,
        });
    }

    pub fn finish(mut self) -> Vec<u8> {
        let start = self.out.len() as u32;
        for e in &self.entries {
            put32(&mut self.out, CENTRAL_HEADER);
            put16(&mut self.out, VERSION);
            put16(&mut self.out, VERSION);
            put16(&mut self.out, UTF8_NAMES);
            put16(&mut self.out, STORED);
            put16(&mut self.out, 0);
            put16(&mut self.out, DOS_DATE);
            put32(&mut self.out, e.crc);
            put32(&mut self.out, e.size);
            put32(&mut self.out, e.size);
            put16(&mut self.out, e.name.len() as u16);
            put16(&mut self.out, 0);
            put16(&mut self.out, 0);
            put16(&mut self.out, 0);
            put16(&mut self.out, 0);
            put32(&mut self.out, 0);
            put32(&mut self.out, e.offset);
            self.out.extend_from_slice(&e.name);
        }
        let size = self.out.len() as u32 - start;
        let count = self.entries.len() as u16;
        put32(&mut self.out, END_RECORD);
        put16(&mut self.out, 0);
        put16(&mut self.out, 0);
        put16(&mut self.out, count);
        put16(&mut self.out, count);
        put32(&mut self.out, size);
        put32(&mut self.out, start);
        put16(&mut self.out, 0);
        self.out
    }
}

#[cfg(test)]
pub(crate) fn read(bytes: &[u8]) -> Vec<(String, Vec<u8>)> {
    let get16 = |at: usize| u16::from_le_bytes([bytes[at], bytes[at + 1]]) as usize;
    let get32 = |at: usize| {
        u32::from_le_bytes([bytes[at], bytes[at + 1], bytes[at + 2], bytes[at + 3]]) as usize
    };
    let end = bytes.len() - 22;
    assert_eq!(get32(end), END_RECORD as usize);
    let count = get16(end + 10);
    let mut at = get32(end + 16);
    let mut out = Vec::new();
    for _ in 0..count {
        assert_eq!(get32(at), CENTRAL_HEADER as usize);
        assert_eq!(get16(at + 8), UTF8_NAMES as usize);
        let crc = get32(at + 16) as u32;
        let size = get32(at + 24);
        let name_len = get16(at + 28);
        let local = get32(at + 42);
        let name = String::from_utf8(bytes[at + 46..at + 46 + name_len].to_vec()).unwrap();
        assert_eq!(get32(local), LOCAL_HEADER as usize);
        let local_name_len = get16(local + 26);
        let extra_len = get16(local + 28);
        let data_at = local + 30 + local_name_len + extra_len;
        let data = bytes[data_at..data_at + size].to_vec();
        assert_eq!(crc32(&data), crc, "{name}");
        out.push((name, data));
        at += 46 + name_len;
    }
    out
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn the_check_value_of_the_crc_is_right() {
        assert_eq!(crc32(b"123456789"), 0xCBF4_3926);
        assert_eq!(crc32(b""), 0);
    }

    #[test]
    fn entries_round_trip_with_utf8_names_and_empty_files() {
        let mut w = Writer::new();
        w.add("Notes/Café ☕.md", "bonjour".as_bytes());
        w.add("empty.txt", b"");
        w.add("attachments/a.png", &[0, 1, 2, 255]);
        let bytes = w.finish();
        let back = read(&bytes);
        assert_eq!(
            back,
            vec![
                ("Notes/Café ☕.md".to_string(), b"bonjour".to_vec()),
                ("empty.txt".to_string(), Vec::new()),
                ("attachments/a.png".to_string(), vec![0, 1, 2, 255]),
            ]
        );
    }

    #[test]
    fn an_empty_archive_is_only_the_end_record() {
        let bytes = Writer::new().finish();
        assert_eq!(bytes.len(), 22);
        assert!(read(&bytes).is_empty());
    }
}
