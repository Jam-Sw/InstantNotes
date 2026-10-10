use std::path::Path;

const FILE: &str = "window-paint";

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub(crate) struct WindowPaint {
    pub dark: bool,
    pub rgb: [u8; 3],
}

impl WindowPaint {
    pub(crate) fn from_parts(variant: &str, hex: &str) -> Option<Self> {
        let dark = match variant {
            "dark" => true,
            "light" => false,
            _ => return None,
        };
        let digits = hex.strip_prefix('#')?;
        if digits.len() != 6 || !digits.bytes().all(|b| b.is_ascii_hexdigit()) {
            return None;
        }
        let n = u32::from_str_radix(digits, 16).ok()?;
        Some(Self {
            dark,
            rgb: [(n >> 16) as u8, (n >> 8) as u8, n as u8],
        })
    }

    pub(crate) fn parse(text: &str) -> Option<Self> {
        let mut parts = text.split_whitespace();
        let paint = Self::from_parts(parts.next()?, parts.next()?)?;
        parts.next().is_none().then_some(paint)
    }

    pub(crate) fn render(&self) -> String {
        let [r, g, b] = self.rgb;
        let variant = if self.dark { "dark" } else { "light" };
        format!("{variant} #{r:02x}{g:02x}{b:02x}\n")
    }

    #[cfg(not(target_os = "macos"))]
    pub(crate) fn color(&self) -> tauri::window::Color {
        let [r, g, b] = self.rgb;
        tauri::window::Color(r, g, b, 255)
    }

    #[cfg(not(target_os = "macos"))]
    pub(crate) fn theme(&self) -> tauri::Theme {
        if self.dark {
            tauri::Theme::Dark
        } else {
            tauri::Theme::Light
        }
    }
}

pub(crate) fn read(dir: &Path) -> Option<WindowPaint> {
    WindowPaint::parse(&std::fs::read_to_string(dir.join(FILE)).ok()?)
}

pub(crate) fn remember(dir: &Path, paint: &WindowPaint) {
    if read(dir) == Some(*paint) {
        return;
    }
    let _ = std::fs::create_dir_all(dir);
    let _ = std::fs::write(dir.join(FILE), paint.render());
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn a_paint_survives_a_round_trip_through_its_file() {
        let dir = tempfile::tempdir().unwrap();
        let paint = WindowPaint::from_parts("dark", "#0c0c0e").unwrap();
        assert_eq!(read(dir.path()), None);
        remember(dir.path(), &paint);
        assert_eq!(read(dir.path()), Some(paint));
        assert_eq!(paint.rgb, [0x0c, 0x0c, 0x0e]);
        let light = WindowPaint::from_parts("light", "#F4f6F4").unwrap();
        remember(dir.path(), &light);
        assert_eq!(read(dir.path()), Some(light));
        assert_eq!(light.render(), "light #f4f6f4\n");
    }

    #[test]
    fn an_unchanged_paint_is_not_written_again() {
        let dir = tempfile::tempdir().unwrap();
        let paint = WindowPaint::from_parts("dark", "#161617").unwrap();
        remember(dir.path(), &paint);
        let file = dir.path().join(FILE);
        let before = std::fs::metadata(&file).unwrap().modified().unwrap();
        std::thread::sleep(std::time::Duration::from_millis(20));
        remember(dir.path(), &paint);
        assert_eq!(
            std::fs::metadata(&file).unwrap().modified().unwrap(),
            before
        );
    }

    #[test]
    fn anything_but_a_variant_and_a_six_digit_colour_is_refused() {
        for (variant, hex) in [
            ("auto", "#000000"),
            ("dark", "000000"),
            ("dark", "#000"),
            ("dark", "#00000000"),
            ("dark", "#+00000"),
            ("dark", "#00000g"),
            ("dark", "rgb(0, 0, 0)"),
            ("", ""),
        ] {
            assert_eq!(
                WindowPaint::from_parts(variant, hex),
                None,
                "{variant} {hex}"
            );
        }
    }

    #[test]
    fn a_damaged_file_reads_as_no_paint() {
        for text in [
            "",
            "dark",
            "dark #000000 extra",
            "#000000 dark",
            "dark #zzzzzz",
            "\u{0}",
        ] {
            assert_eq!(WindowPaint::parse(text), None, "{text:?}");
        }
        assert!(WindowPaint::parse("  dark   #000000 \n\n").is_some());
    }
}
