use anyhow::Result;
use serde::Serialize;

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
struct JsonSuccess<T>
where
    T: Serialize,
{
    ok: bool,
    command: String,
    data: T,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct JsonError {
    ok: bool,
    error: JsonErrorBody,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct JsonErrorBody {
    code: String,
    message: String,
}

pub fn print_success<T>(command: &str, data: T) -> Result<()>
where
    T: Serialize,
{
    let payload = JsonSuccess {
        ok: true,
        command: command.to_string(),
        data,
    };

    println!("{}", serde_json::to_string(&payload)?);
    Ok(())
}

pub fn print_error(code: &str, message: &str) -> Result<()> {
    let payload = JsonError {
        ok: false,
        error: JsonErrorBody {
            code: code.to_string(),
            message: message.to_string(),
        },
    };

    println!("{}", serde_json::to_string(&payload)?);
    Ok(())
}
