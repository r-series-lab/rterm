use crate::cli::json;
use crate::cli::{CliError, CliResult};
use crate::core::connections;

pub fn test(remote: String, as_json: bool) -> CliResult<()> {
    match connections::test_connection(&remote) {
        Ok(result) => {
            if as_json {
                json::print_success("connections.test", result).map_err(CliError::from)?;
            } else {
                println!("Protocol: {}", result.protocol);
                println!("Endpoint: {}", result.endpoint);
                println!("Working directory: {}", result.working_directory);
            }
            Ok(())
        }
        Err(message) => {
            if as_json {
                json::print_error("connection_test_failed", &message).map_err(CliError::from)?;
                return Err(CliError::rendered(message));
            }
            Err(CliError::plain(message))
        }
    }
}
