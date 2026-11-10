//! ECHO's API as this client uses it (docs/api/openapi.yaml): a device token from
//! `POST /auth/device`, sent as a bearer header (the server's Origin check exempts it), the
//! allow-listed Subsonic proxy for the library, and signed stream URLs for the player, which sends
//! no header of its own. Blocking: the window calls it from a worker thread (gio::spawn_blocking).

use serde_json::{Value, json};
use std::time::{Duration, SystemTime, UNIX_EPOCH};

const RETRIES: u32 = 2;

/// The wait before retry `attempt` (0, 1): 300 ms then 900 ms, each ×0.5–1.5.
fn retry_delay(attempt: u32, rand: f64) -> Duration {
    Duration::from_secs_f64(0.3 * 3f64.powi(attempt as i32) * (0.5 + rand))
}

#[derive(Debug)]
pub enum ApiError {
    /// 401: the token was revoked or expired, or the credentials were wrong; ECHO's error code.
    Unauthorized(Option<String>),
    Failed(String),
}

impl std::fmt::Display for ApiError {
    fn fmt(&self, f: &mut std::fmt::Formatter) -> std::fmt::Result {
        match self {
            ApiError::Unauthorized(code) => {
                write!(f, "signed out ({})", code.as_deref().unwrap_or("401"))
            }
            ApiError::Failed(why) => write!(f, "{why}"),
        }
    }
}

#[derive(Clone, Debug)]
pub struct Album {
    pub id: String,
    pub name: String,
    pub artist: String,
}

#[derive(Clone, Debug)]
pub struct Song {
    pub id: String,
    pub title: String,
    pub artist: String,
    pub seconds: u64,
}

#[derive(Clone)]
pub struct Api {
    pub base: String,
    agent: ureq::Agent,
}

impl Api {
    pub fn new(base: &str) -> Self {
        // Error answers carry ECHO's code ({ "error": … }): read them instead of failing on status.
        // No answer in 30 s is a failure: a request left hanging would hold its worker for ever.
        let config = ureq::Agent::config_builder()
            .http_status_as_error(false)
            .timeout_global(Some(Duration::from_secs(30)))
            .build();
        Api {
            base: base.trim_end_matches('/').to_string(),
            agent: config.into(),
        }
    }

    fn answer(
        res: Result<ureq::http::Response<ureq::Body>, ureq::Error>,
    ) -> Result<Value, ApiError> {
        let mut res = res.map_err(|e| ApiError::Failed(e.to_string()))?;
        let status = res.status().as_u16();
        let body: Value = res.body_mut().read_json().unwrap_or(Value::Null);
        let code = body["error"]
            .as_str()
            .or(body["code"].as_str())
            .map(String::from);
        match status {
            200..=299 => Ok(body),
            401 => Err(ApiError::Unauthorized(code)),
            _ => Err(ApiError::Failed(
                code.unwrap_or_else(|| format!("HTTP {status}")),
            )),
        }
    }

    /// A read that failed on the way (no connection, a proxy's 502–504, 429) is asked again, twice
    /// at most, as the web does (src/client/api.ts). Writes go once.
    fn get(&self, token: &str, path: &str) -> Result<Value, ApiError> {
        for attempt in 0.. {
            let res = self
                .agent
                .get(format!("{}/api/v1{path}", self.base))
                .header("Authorization", format!("Bearer {token}"))
                .call();
            let passing = match &res {
                Err(ureq::Error::Timeout(_)) => false, // it already took its time
                Err(_) => true,
                // ECHO's own 502 (Navidrome is down) has a JSON body and is an answer.
                Ok(r) => match r.status().as_u16() {
                    429 => true,
                    502..=504 => r
                        .headers()
                        .get("content-type")
                        .is_none_or(|t| !t.to_str().unwrap_or("").starts_with("application/json")),
                    _ => false,
                },
            };
            if !passing || attempt == RETRIES {
                return Self::answer(res);
            }
            let after = res.ok().and_then(|r| {
                r.headers()
                    .get("retry-after")?
                    .to_str()
                    .ok()?
                    .parse::<u64>()
                    .ok()
            });
            // The clock's nanoseconds are jitter enough: devices that lost the server together
            // do not come back in step.
            let rand = f64::from(
                SystemTime::now()
                    .duration_since(UNIX_EPOCH)
                    .map_or(0, |d| d.subsec_nanos()),
            ) / 1e9;
            std::thread::sleep(
                Duration::from_secs(after.unwrap_or(0)) + retry_delay(attempt, rand),
            );
        }
        unreachable!()
    }

    /// A device token for this computer: credentials and, with two-factor on, the code, in one go.
    pub fn sign_in(
        &self,
        user: &str,
        password: &str,
        code: &str,
        name: &str,
    ) -> Result<String, ApiError> {
        let mut body = json!({ "username": user, "password": password, "name": name });
        if !code.trim().is_empty() {
            body["code"] = json!(code.trim());
        }
        let res = self
            .agent
            .post(format!("{}/api/v1/auth/device", self.base))
            .send_json(&body);
        let token = Self::answer(res)?["token"].as_str().map(String::from);
        token.ok_or_else(|| ApiError::Failed("no token in the answer".into()))
    }

    /// Ends this device's session on the server (Settings → Account → Sessions loses it).
    pub fn sign_out(&self, token: &str) {
        let res = self
            .agent
            .post(format!("{}/api/v1/auth/logout", self.base))
            .header("Authorization", format!("Bearer {token}"))
            .send_json(json!({}));
        let _ = Self::answer(res);
    }

    fn subsonic(&self, token: &str, method: &str, query: &str) -> Result<Value, ApiError> {
        let r = self.get(token, &format!("/navidrome/rest/{method}?{query}"))?;
        let r = r["subsonic-response"].clone();
        if r["status"] == "ok" {
            Ok(r)
        } else {
            Err(ApiError::Failed(
                r["error"]["message"]
                    .as_str()
                    .unwrap_or("Navidrome refused")
                    .into(),
            ))
        }
    }

    pub fn albums(&self, token: &str) -> Result<Vec<Album>, ApiError> {
        let r = self.subsonic(token, "getAlbumList2", "type=alphabeticalByName&size=500")?;
        let list = r["albumList2"]["album"]
            .as_array()
            .cloned()
            .unwrap_or_default();
        Ok(list
            .iter()
            .map(|a| Album {
                id: text(&a["id"]),
                name: text(&a["name"]),
                artist: text(&a["artist"]),
            })
            .collect())
    }

    pub fn songs(&self, token: &str, album_id: &str) -> Result<Vec<Song>, ApiError> {
        let r = self.subsonic(token, "getAlbum", &format!("id={}", encode(album_id)))?;
        let list = r["album"]["song"].as_array().cloned().unwrap_or_default();
        Ok(list
            .iter()
            .map(|s| Song {
                id: text(&s["id"]),
                title: text(&s["title"]),
                artist: text(&s["artist"]),
                seconds: s["duration"].as_u64().unwrap_or(0),
            })
            .collect())
    }

    /// A signed stream URL (6 h, this song only) the player opens without a header. GStreamer
    /// plays every format Navidrome holds, so the file comes as it is.
    pub fn stream_url(&self, token: &str, song_id: &str) -> Result<String, ApiError> {
        let r = self.get(token, &format!("/navidrome/stream-url/{}", encode(song_id)))?;
        let path = r["url"]
            .as_str()
            .ok_or_else(|| ApiError::Failed("no stream URL".into()))?;
        Ok(format!("{}{path}&format=raw", self.base))
    }
}

fn text(v: &Value) -> String {
    match v {
        Value::String(s) => s.clone(),
        Value::Null => String::new(),
        other => other.to_string(),
    }
}

/// Percent-encodes an id for a path or query (Navidrome ids are usually plain, but need not be).
fn encode(s: &str) -> String {
    s.bytes()
        .map(|b| match b {
            b'A'..=b'Z' | b'a'..=b'z' | b'0'..=b'9' | b'-' | b'_' | b'.' | b'~' => {
                (b as char).to_string()
            }
            _ => format!("%{b:02X}"),
        })
        .collect()
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::io::{Read, Write};

    #[test]
    fn a_retry_waits_longer_each_time() {
        assert_eq!(retry_delay(0, 0.0), Duration::from_millis(150));
        assert_eq!(retry_delay(1, 1.0), Duration::from_millis(1350));
    }

    /// A proxy's 502 twice, then the answer: the read is asked three times and succeeds.
    #[test]
    fn a_read_that_failed_on_the_way_is_asked_again() {
        let server = std::net::TcpListener::bind("127.0.0.1:0").unwrap();
        let base = format!("http://{}", server.local_addr().unwrap());
        let asked = std::thread::spawn(move || {
            for n in 0..3 {
                let (mut c, _) = server.accept().unwrap();
                let _ = c.read(&mut [0; 2048]);
                let res = if n < 2 {
                    "HTTP/1.1 502 Bad Gateway\r\nconnection: close\r\ncontent-length: 0\r\n\r\n"
                        .to_string()
                } else {
                    let body = r#"{"url":"/s"}"#;
                    format!(
                        "HTTP/1.1 200 OK\r\nconnection: close\r\ncontent-type: application/json\r\ncontent-length: {}\r\n\r\n{body}",
                        body.len()
                    )
                };
                c.write_all(res.as_bytes()).unwrap();
            }
        });
        let url = Api::new(&base).stream_url("t", "a1").unwrap();
        assert_eq!(url, format!("{base}/s&format=raw"));
        asked.join().unwrap();
    }
}
