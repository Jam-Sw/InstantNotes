//! The desktop shell behind run(): capture-latency metrics, window management,
//! file I/O commands, and the quit handshake. run() keeps only the native menu,
//! tray, and setup wiring that composes these.

pub(crate) mod capture;
pub(crate) mod files;
pub(crate) mod quit;
pub(crate) mod windows;
