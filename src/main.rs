fn main() {
    if let Err(error) = rterm::cli::run() {
        if !error.already_rendered() {
            eprintln!("{error}");
        }
        std::process::exit(1);
    }
}
