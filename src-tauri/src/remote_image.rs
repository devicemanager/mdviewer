// Remote images, fetched here instead of by the webview (2026-10-19).
//
// Swift's design lets the WebView load remote images itself: a CSP that
// allows http:/https: images unless the policy is Never, with the JS gate
// renaming only `<img src>`. Under Ask that would leave every other way a
// document can reference an image — CSS `url()` in a style attribute or
// `<style>`, `<video poster>`, SVG `<image href>`, `<table background>`,
// `<input type=image>` — loading before the user has agreed to anything
// (found 2026-10-19 by web/e2e/remoteImages.e2e.ts). Swift never actually
// relaxes its CSP (`allowsRemoteContent` is set, never read), so v1.2.2
// loads no remote image at all, under any policy. The port's CSP keeps
// img-src local-only under every policy too, and
// an `<img>` the user has allowed is fetched by this command and handed to
// the page as a `data:` URL, which the CSP already permits. Everything that
// isn't an `<img>` stays blocked by the CSP, even under Always.
//
// The page only calls this after consent ("Load" / "Always Allow" in the
// prompt) or under Always; it refuses under Never regardless, so a policy
// change can't be raced by an in-flight render.

use std::io::Read;
use std::time::Duration;

use base64::Engine as _;

/// Larger than any reasonable document image; stops a hostile server from
/// streaming forever into memory.
const MAX_IMAGE_BYTES: u64 = 15 * 1024 * 1024;
const TIMEOUT: Duration = Duration::from_secs(20);
const MAX_REDIRECTS: u32 = 5;

/// Only absolute http/https URLs — the same set the JS gate restores.
pub fn validate_url(url: &str) -> Result<url::Url, String> {
    let parsed = url::Url::parse(url).map_err(|e| format!("invalid image URL: {e}"))?;
    match parsed.scheme() {
        "http" | "https" => Ok(parsed),
        other => Err(format!("refusing to fetch a {other}: URL")),
    }
}

/// The response's media type, if it's an image. `image/svg+xml` included:
/// an SVG shown through `<img>` runs no script and loads nothing further.
pub fn image_media_type(content_type: Option<&str>) -> Result<String, String> {
    let media_type = content_type
        .and_then(|ct| ct.split(';').next())
        .map(|ct| ct.trim().to_ascii_lowercase())
        .unwrap_or_default();
    if media_type.starts_with("image/") && media_type.len() > "image/".len() {
        Ok(media_type)
    } else {
        Err(format!("not an image (content-type {media_type:?})"))
    }
}

pub fn data_url(media_type: &str, bytes: &[u8]) -> String {
    format!("data:{media_type};base64,{}", base64::engine::general_purpose::STANDARD.encode(bytes))
}

/// Blocking GET of one image. Call from `spawn_blocking`.
pub fn fetch_as_data_url(url: &str) -> Result<String, String> {
    let url = validate_url(url)?;
    let agent: ureq::Agent = ureq::Agent::config_builder()
        .timeout_global(Some(TIMEOUT))
        .max_redirects(MAX_REDIRECTS)
        .user_agent("MDViewer")
        .build()
        .into();
    let mut response = agent.get(url.as_str()).call().map_err(|e| e.to_string())?;
    let media_type = image_media_type(response.headers().get("content-type").and_then(|v| v.to_str().ok()))?;
    let mut bytes = Vec::new();
    response
        .body_mut()
        .as_reader()
        .take(MAX_IMAGE_BYTES + 1)
        .read_to_end(&mut bytes)
        .map_err(|e| e.to_string())?;
    if bytes.len() as u64 > MAX_IMAGE_BYTES {
        return Err(format!("image larger than {MAX_IMAGE_BYTES} bytes"));
    }
    Ok(data_url(&media_type, &bytes))
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::io::Write;
    use std::net::TcpListener;

    /// One-shot local HTTP server answering every request with `response`.
    fn serve(response: Vec<u8>) -> String {
        let listener = TcpListener::bind("127.0.0.1:0").unwrap();
        let port = listener.local_addr().unwrap().port();
        std::thread::spawn(move || {
            for stream in listener.incoming() {
                let Ok(mut stream) = stream else { return };
                let mut buf = [0u8; 4096];
                let _ = std::io::Read::read(&mut stream, &mut buf);
                let _ = stream.write_all(&response);
            }
        });
        format!("http://127.0.0.1:{port}/image")
    }

    fn http_response(content_type: &str, body: &[u8]) -> Vec<u8> {
        let mut r = format!(
            "HTTP/1.1 200 OK\r\ncontent-type: {content_type}\r\ncontent-length: {}\r\nconnection: close\r\n\r\n",
            body.len()
        )
        .into_bytes();
        r.extend_from_slice(body);
        r
    }

    #[test]
    fn validate_url_accepts_http_and_https() {
        assert!(validate_url("https://raw.githubusercontent.com/devicemanager/mdviewer/main/docs/icon.png").is_ok());
        assert!(validate_url("http://example.com/a.png").is_ok());
    }

    #[test]
    fn validate_url_rejects_other_schemes_and_relative_urls() {
        for url in ["file:///etc/passwd", "data:image/png;base64,AA==", "mdviewer-local://x/a.png", "javascript:alert(1)", "/a.png", "a.png"] {
            assert!(validate_url(url).is_err(), "{url}");
        }
    }

    #[test]
    fn image_media_type_accepts_images_and_drops_parameters() {
        assert_eq!(image_media_type(Some("image/png")).unwrap(), "image/png");
        assert_eq!(image_media_type(Some("Image/SVG+XML; charset=utf-8")).unwrap(), "image/svg+xml");
    }

    #[test]
    fn image_media_type_rejects_everything_else() {
        for ct in [Some("text/html"), Some("application/octet-stream"), Some("image/"), Some(""), None] {
            assert!(image_media_type(ct).is_err(), "{ct:?}");
        }
    }

    #[test]
    fn data_url_is_base64() {
        assert_eq!(data_url("image/png", b"abc"), "data:image/png;base64,YWJj");
    }

    #[test]
    fn fetch_as_data_url_returns_the_image() {
        let url = serve(http_response("image/png", b"\x89PNG"));
        assert_eq!(fetch_as_data_url(&url).unwrap(), "data:image/png;base64,iVBORw==");
    }

    #[test]
    fn fetch_as_data_url_refuses_a_non_image_response() {
        let url = serve(http_response("text/html", b"<html>"));
        assert!(fetch_as_data_url(&url).is_err());
    }

    #[test]
    fn fetch_as_data_url_refuses_an_error_status() {
        let url = serve(b"HTTP/1.1 404 Not Found\r\ncontent-type: image/png\r\ncontent-length: 0\r\nconnection: close\r\n\r\n".to_vec());
        assert!(fetch_as_data_url(&url).is_err());
    }

    #[test]
    fn fetch_as_data_url_refuses_an_oversized_image() {
        let body = vec![0u8; (MAX_IMAGE_BYTES + 1) as usize];
        let url = serve(http_response("image/png", &body));
        let err = fetch_as_data_url(&url).unwrap_err();
        assert!(err.contains("larger than"), "{err}");
    }

    /// Hits the real network — the project's own icon on GitHub. Not run by
    /// default: `cargo test -- --ignored fetches_the_projects_icon`.
    #[test]
    #[ignore]
    fn fetches_the_projects_icon_from_github() {
        let url = fetch_as_data_url("https://github.com/devicemanager/mdviewer/raw/main/docs/icon.png").unwrap();
        assert!(url.starts_with("data:image/png;base64,iVBORw0KGgo"), "{}", &url[..40.min(url.len())]);
    }
}
