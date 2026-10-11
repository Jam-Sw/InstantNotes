fn main() {
    let code =
        instantnotes_server::run_from_args(std::env::args_os().skip(1)).unwrap_or_else(|| {
            eprintln!("usage: instantnotes-server serve");
            2
        });
    std::process::exit(code);
}
