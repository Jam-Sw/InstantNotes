use std::fmt;

pub struct Sensitive<T>(pub T);

impl<T> Sensitive<T> {
    pub fn expose(&self) -> &T {
        &self.0
    }
}

impl<T> fmt::Debug for Sensitive<T> {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        f.write_str("<redacted>")
    }
}

impl<T> fmt::Display for Sensitive<T> {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        f.write_str("<redacted>")
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn debug_redacts_content() {
        let s = Sensitive("my secret note".to_string());
        assert_eq!(format!("{:?}", s), "<redacted>");
    }

    #[test]
    fn display_redacts_content() {
        let s = Sensitive("my secret note".to_string());
        assert_eq!(format!("{}", s), "<redacted>");
    }

    #[test]
    fn expose_returns_inner() {
        let s = Sensitive("content".to_string());
        assert_eq!(s.expose(), "content");
    }
}
