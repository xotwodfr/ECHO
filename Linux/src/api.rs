//! ECHO's API as this client uses it (docs/api/openapi.yaml): a device token from
//! `POST /auth/device`, sent as a bearer header (the server's Origin check exempts it), the
//! allow-listed Subsonic proxy for the library, and signed stream URLs for the player, which sends
//! no header of its own. Blocking: the window calls it from a worker thread (gio::spawn_blocking).

use serde_json::{Value, json};

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
        let config = ureq::Agent::config_builder()
            .http_status_as_error(false)
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

    fn get(&self, token: &str, path: &str) -> Result<Value, ApiError> {
        let res = self
            .agent
            .get(format!("{}/api/v1{path}", self.base))
            .header("Authorization", format!("Bearer {token}"))
            .call();
        Self::answer(res)
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
