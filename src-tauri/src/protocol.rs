use std::{
    fs::{self, File},
    io::{Read, Seek, SeekFrom},
    path::{Component, Path, PathBuf},
    time::UNIX_EPOCH,
};

use percent_encoding::percent_decode_str;
use tauri::{
    http::{
        header::{
            ACCEPT_RANGES, ACCESS_CONTROL_ALLOW_ORIGIN, CACHE_CONTROL, CONTENT_LENGTH,
            CONTENT_RANGE, CONTENT_TYPE, ETAG, IF_NONE_MATCH, RANGE,
        },
        Method, Request, Response, StatusCode,
    },
    Manager, Runtime, UriSchemeContext,
};

const GAME_DIR: &str = "game/current";

pub fn serve_game<R: Runtime>(
    context: UriSchemeContext<'_, R>,
    request: Request<Vec<u8>>,
) -> Response<Vec<u8>> {
    if !is_game_window(context.webview_label()) {
        return text_response(
            StatusCode::FORBIDDEN,
            "This protocol is private to game windows.",
        );
    }

    if request.method() != Method::GET && request.method() != Method::HEAD {
        return Response::builder()
            .status(StatusCode::METHOD_NOT_ALLOWED)
            .header("Allow", "GET, HEAD")
            .body(Vec::new())
            .expect("static response is valid");
    }

    let root = match context.app_handle().path().app_data_dir() {
        Ok(path) => path.join(GAME_DIR),
        Err(_) => {
            return text_response(
                StatusCode::INTERNAL_SERVER_ERROR,
                "The application data directory is unavailable.",
            );
        }
    };

    match serve_file(&root, request.uri().path(), &request) {
        Ok(response) => response,
        Err(status) => text_response(
            status,
            status.canonical_reason().unwrap_or("Request failed"),
        ),
    }
}

fn serve_file(
    root: &Path,
    request_path: &str,
    request: &Request<Vec<u8>>,
) -> std::result::Result<Response<Vec<u8>>, StatusCode> {
    let root = root.canonicalize().map_err(|_| StatusCode::NOT_FOUND)?;
    let relative = safe_relative_path(request_path).ok_or(StatusCode::BAD_REQUEST)?;
    let mut path = root.join(relative);
    if path.is_dir() {
        path.push("index.html");
    }

    let path = path.canonicalize().map_err(|_| StatusCode::NOT_FOUND)?;
    if !path.starts_with(&root) || !path.is_file() {
        return Err(StatusCode::FORBIDDEN);
    }

    let metadata = fs::metadata(&path).map_err(|_| StatusCode::NOT_FOUND)?;
    let file_len = metadata.len();
    let etag = weak_etag(&metadata);

    if request
        .headers()
        .get(IF_NONE_MATCH)
        .and_then(|value| value.to_str().ok())
        .is_some_and(|value| value.split(',').any(|candidate| candidate.trim() == etag))
    {
        return Ok(base_response(StatusCode::NOT_MODIFIED, &path, &etag)
            .body(Vec::new())
            .expect("static response is valid"));
    }

    let range = request
        .headers()
        .get(RANGE)
        .and_then(|value| value.to_str().ok())
        .map(|value| parse_single_range(value, file_len))
        .transpose()?;

    let (status, body, content_range, content_length) = if let Some((start, end)) = range {
        let length = end - start + 1;
        let body = if request.method() == Method::HEAD {
            Vec::new()
        } else {
            read_range(&path, start, length).map_err(|_| StatusCode::INTERNAL_SERVER_ERROR)?
        };
        (
            StatusCode::PARTIAL_CONTENT,
            body,
            Some(format!("bytes {start}-{end}/{file_len}")),
            length,
        )
    } else {
        let body = if request.method() == Method::HEAD {
            Vec::new()
        } else {
            fs::read(&path).map_err(|_| StatusCode::INTERNAL_SERVER_ERROR)?
        };
        (StatusCode::OK, body, None, file_len)
    };

    let mut response =
        base_response(status, &path, &etag).header(CONTENT_LENGTH, content_length.to_string());
    if let Some(content_range) = content_range {
        response = response.header(CONTENT_RANGE, content_range);
    }

    Ok(response.body(body).expect("static response is valid"))
}

fn base_response(status: StatusCode, path: &Path, etag: &str) -> tauri::http::response::Builder {
    Response::builder()
        .status(status)
        .header(
            CONTENT_TYPE,
            mime_guess::from_path(path)
                .first_or_octet_stream()
                .essence_str(),
        )
        .header(CACHE_CONTROL, "no-cache")
        .header(ETAG, etag)
        .header(ACCEPT_RANGES, "bytes")
        .header(ACCESS_CONTROL_ALLOW_ORIGIN, "*")
        .header("X-Content-Type-Options", "nosniff")
}

fn text_response(status: StatusCode, message: &str) -> Response<Vec<u8>> {
    Response::builder()
        .status(status)
        .header(CONTENT_TYPE, "text/plain; charset=utf-8")
        .header(CACHE_CONTROL, "no-store")
        .body(message.as_bytes().to_vec())
        .expect("static response is valid")
}

fn safe_relative_path(raw: &str) -> Option<PathBuf> {
    // URI paths have one structural leading slash. Removing exactly one keeps
    // double-slash and percent-encoded absolute paths from escaping the root.
    let raw = raw.strip_prefix('/').unwrap_or(raw);
    let decoded = percent_decode_str(raw).decode_utf8().ok()?;
    let decoded = if decoded.is_empty() {
        "index.html"
    } else {
        decoded.as_ref()
    };

    let mut relative = PathBuf::new();
    for component in Path::new(decoded).components() {
        match component {
            Component::Normal(value) => relative.push(value),
            _ => return None,
        }
    }
    (!relative.as_os_str().is_empty()).then_some(relative)
}

fn parse_single_range(value: &str, file_len: u64) -> std::result::Result<(u64, u64), StatusCode> {
    let value = value
        .strip_prefix("bytes=")
        .ok_or(StatusCode::RANGE_NOT_SATISFIABLE)?;
    if value.contains(',') || file_len == 0 {
        return Err(StatusCode::RANGE_NOT_SATISFIABLE);
    }

    let (start, end) = value
        .split_once('-')
        .ok_or(StatusCode::RANGE_NOT_SATISFIABLE)?;

    if start.is_empty() {
        let suffix = end
            .parse::<u64>()
            .map_err(|_| StatusCode::RANGE_NOT_SATISFIABLE)?;
        if suffix == 0 {
            return Err(StatusCode::RANGE_NOT_SATISFIABLE);
        }
        let start = file_len.saturating_sub(suffix);
        return Ok((start, file_len - 1));
    }

    let start = start
        .parse::<u64>()
        .map_err(|_| StatusCode::RANGE_NOT_SATISFIABLE)?;
    if start >= file_len {
        return Err(StatusCode::RANGE_NOT_SATISFIABLE);
    }
    let end = if end.is_empty() {
        file_len - 1
    } else {
        end.parse::<u64>()
            .map_err(|_| StatusCode::RANGE_NOT_SATISFIABLE)?
            .min(file_len - 1)
    };
    if end < start {
        return Err(StatusCode::RANGE_NOT_SATISFIABLE);
    }
    Ok((start, end))
}

fn read_range(path: &Path, start: u64, length: u64) -> std::io::Result<Vec<u8>> {
    let mut file = File::open(path)?;
    file.seek(SeekFrom::Start(start))?;
    let mut output = Vec::with_capacity(length.min(usize::MAX as u64) as usize);
    file.take(length).read_to_end(&mut output)?;
    Ok(output)
}

fn weak_etag(metadata: &fs::Metadata) -> String {
    let modified = metadata
        .modified()
        .ok()
        .and_then(|time| time.duration_since(UNIX_EPOCH).ok())
        .map(|duration| duration.as_nanos())
        .unwrap_or_default();
    format!("W/\"{:x}-{modified:x}\"", metadata.len())
}

fn is_game_window(label: &str) -> bool {
    label == "main" || label.starts_with("alternate-")
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn normalizes_safe_game_paths() {
        assert_eq!(safe_relative_path("/"), Some(PathBuf::from("index.html")));
        assert_eq!(
            safe_relative_path("/assets/images/pokeball.png"),
            Some(PathBuf::from("assets/images/pokeball.png"))
        );
        assert_eq!(
            safe_relative_path("/assets/My%20Image.png"),
            Some(PathBuf::from("assets/My Image.png"))
        );
    }

    #[test]
    fn rejects_paths_that_can_escape_the_game_directory() {
        assert_eq!(safe_relative_path("/../secrets"), None);
        assert_eq!(safe_relative_path("/%2e%2e/secrets"), None);
        assert_eq!(safe_relative_path("//etc/passwd"), None);
    }

    #[test]
    fn parses_http_byte_ranges() {
        assert_eq!(parse_single_range("bytes=0-4", 10), Ok((0, 4)));
        assert_eq!(parse_single_range("bytes=5-", 10), Ok((5, 9)));
        assert_eq!(parse_single_range("bytes=-3", 10), Ok((7, 9)));
        assert!(parse_single_range("bytes=20-30", 10).is_err());
        assert!(parse_single_range("bytes=0-1,4-5", 10).is_err());
    }
}
