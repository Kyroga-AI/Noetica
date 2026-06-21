//! noetica-embed — Noetica's own local embedding sidecar.
//!
//! A tiny HTTP server wrapping `fastembed` (ONNX bge-small-en-v1.5). This is the embedder
//! Noetica runs FOR ITSELF: deterministic, repeatable, no Python, and never the generative
//! model (ollama). The agent-machine calls it for graph clustering, retrieval, and ingest-time
//! vectorization. The model (~130MB) is fetched once and cached under ~/.noetica/embed-cache.
//!
//! Endpoints:
//!   GET  /health            -> {"ok":true,"model_loaded":bool,"dim":384}
//!   POST /embed  {"texts":[...]}  -> {"vectors":[[f32; 384], ...]}

use std::io::Read;
use std::sync::Mutex;

use fastembed::{EmbeddingModel, InitOptions, TextEmbedding};
use tiny_http::{Header, Method, Response, Server};

fn cache_dir() -> std::path::PathBuf {
    let home = std::env::var("HOME").unwrap_or_else(|_| ".".into());
    std::path::Path::new(&home).join(".noetica").join("embed-cache")
}

fn load_model() -> Result<TextEmbedding, Box<dyn std::error::Error>> {
    let dir = cache_dir();
    std::fs::create_dir_all(&dir).ok();
    let opts = InitOptions::new(EmbeddingModel::BGESmallENV15)
        .with_cache_dir(dir)
        .with_show_download_progress(false);
    Ok(TextEmbedding::try_new(opts)?)
}

fn json(body: String, code: u16) -> Response<std::io::Cursor<Vec<u8>>> {
    let header = Header::from_bytes(&b"Content-Type"[..], &b"application/json"[..]).unwrap();
    Response::from_string(body).with_status_code(code).with_header(header)
}

fn main() {
    let port: u16 = std::env::var("NOETICA_EMBED_PORT").ok().and_then(|p| p.parse().ok()).unwrap_or(8126);
    let addr = format!("127.0.0.1:{port}");
    let server = Server::http(&addr).expect("bind embed port");
    eprintln!("[noetica-embed] listening on {addr}");

    // Lazily loaded on first /embed so startup is instant and the model download is deferred.
    let model: Mutex<Option<TextEmbedding>> = Mutex::new(None);

    for mut req in server.incoming_requests() {
        let url = req.url().to_string();
        let method = req.method().clone();

        if method == Method::Get && url == "/health" {
            let loaded = model.lock().unwrap().is_some();
            let _ = req.respond(json(format!("{{\"ok\":true,\"model_loaded\":{loaded},\"dim\":384}}"), 200));
            continue;
        }

        if method == Method::Post && url == "/embed" {
            let mut body = String::new();
            if req.as_reader().read_to_string(&mut body).is_err() {
                let _ = req.respond(json("{\"error\":\"read\"}".into(), 400));
                continue;
            }
            let texts: Vec<String> = match serde_json::from_str::<serde_json::Value>(&body) {
                Ok(v) => v.get("texts").and_then(|t| t.as_array()).map(|a| {
                    a.iter().filter_map(|x| x.as_str().map(|s| s.to_string())).collect()
                }).unwrap_or_default(),
                Err(_) => { let _ = req.respond(json("{\"error\":\"json\"}".into(), 400)); continue; }
            };
            if texts.is_empty() {
                let _ = req.respond(json("{\"vectors\":[]}".into(), 200));
                continue;
            }

            // Ensure the model is loaded (first call pays the ~8s load + one-time download).
            let mut guard = model.lock().unwrap();
            if guard.is_none() {
                match load_model() {
                    Ok(m) => *guard = Some(m),
                    Err(e) => { let _ = req.respond(json(format!("{{\"error\":\"load: {}\"}}", e.to_string().replace('"', "'")), 500)); continue; }
                }
            }
            let m = guard.as_ref().unwrap();
            let refs: Vec<&str> = texts.iter().map(|s| s.as_str()).collect();
            match m.embed(refs, None) {
                Ok(vecs) => {
                    let mut out = String::from("{\"vectors\":[");
                    for (i, v) in vecs.iter().enumerate() {
                        if i > 0 { out.push(','); }
                        out.push('[');
                        for (j, f) in v.iter().enumerate() {
                            if j > 0 { out.push(','); }
                            out.push_str(&format!("{:.6}", f));
                        }
                        out.push(']');
                    }
                    out.push_str("]}");
                    let _ = req.respond(json(out, 200));
                }
                Err(e) => { let _ = req.respond(json(format!("{{\"error\":\"embed: {}\"}}", e.to_string().replace('"', "'")), 500)); }
            }
            continue;
        }

        let _ = req.respond(json("{\"error\":\"not_found\"}".into(), 404));
    }
}
