//! noetica-embed — Noetica's own local embedding sidecar + vector tier.
//!
//! A tiny HTTP server wrapping `fastembed` (ONNX bge-small-en-v1.5) AND a per-collection exact vector index
//! (vec_store). This is the embedder + retrieval store Noetica runs FOR ITSELF: deterministic, repeatable, no
//! Python, never the generative model (ollama). The model (~130MB) is fetched once to ~/.noetica/embed-cache;
//! vector indexes persist under ~/.noetica/vec-index.
//!
//! Endpoints:
//!   GET  /health                          -> {"ok":true,"model_loaded":bool,"dim":384}
//!   POST /embed       {"texts":[...]}      -> {"vectors":[[f32; 384], ...]}
//!   POST /vec/upsert  {"collection","items":[{"id","text"?,"vec"?,"meta"?}]} -> {"upserted":n}
//!   POST /vec/query   {"collection","text"|"vec","k"?}  -> {"hits":[{"id","score","meta"}]}
//!   POST /vec/delete  {"collection","ids"?}             -> {"deleted":n}   (no ids => drop collection)
//!   GET  /vec/stats                        -> {"collections":[{"name","count"}]}

mod vec_store;

use std::sync::Mutex;

use fastembed::{EmbeddingModel, InitOptions, TextEmbedding};
use tiny_http::{Header, Method, Response, Server};

use vec_store::VectorStore;

fn cache_dir() -> std::path::PathBuf {
    let home = std::env::var("HOME").unwrap_or_else(|_| ".".into());
    std::path::Path::new(&home).join(".noetica").join("embed-cache")
}

fn vec_dir() -> std::path::PathBuf {
    let home = std::env::var("HOME").unwrap_or_else(|_| ".".into());
    std::path::Path::new(&home).join(".noetica").join("vec-index")
}

fn load_model() -> Result<TextEmbedding, Box<dyn std::error::Error>> {
    let dir = cache_dir();
    std::fs::create_dir_all(&dir).ok();
    let opts = InitOptions::new(EmbeddingModel::BGESmallENV15)
        .with_cache_dir(dir)
        .with_show_download_progress(false);
    Ok(TextEmbedding::try_new(opts)?)
}

/// Embed a batch of texts, loading the model on first use. Shared by /embed and the /vec text paths.
fn embed_batch(model: &Mutex<Option<TextEmbedding>>, texts: Vec<String>) -> Result<Vec<Vec<f32>>, String> {
    if texts.is_empty() { return Ok(vec![]); }
    let mut guard = model.lock().unwrap();
    if guard.is_none() {
        match load_model() {
            Ok(m) => *guard = Some(m),
            Err(e) => return Err(format!("load: {}", e.to_string().replace('"', "'"))),
        }
    }
    let m = guard.as_ref().unwrap();
    let refs: Vec<&str> = texts.iter().map(|s| s.as_str()).collect();
    m.embed(refs, None).map_err(|e| format!("embed: {}", e.to_string().replace('"', "'")))
}

fn vecs_to_json(vecs: &[Vec<f32>]) -> String {
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
    out
}

fn json(body: String, code: u16) -> Response<std::io::Cursor<Vec<u8>>> {
    let header = Header::from_bytes(&b"Content-Type"[..], &b"application/json"[..]).unwrap();
    Response::from_string(body).with_status_code(code).with_header(header)
}

fn read_body(req: &mut tiny_http::Request) -> Option<serde_json::Value> {
    let mut body = String::new();
    if req.as_reader().read_to_string(&mut body).is_err() { return None; }
    serde_json::from_str::<serde_json::Value>(&body).ok()
}

/// Parse a JSON array of numbers into Vec<f32>.
fn as_f32_vec(v: Option<&serde_json::Value>) -> Vec<f32> {
    v.and_then(|x| x.as_array())
        .map(|a| a.iter().filter_map(|n| n.as_f64().map(|f| f as f32)).collect())
        .unwrap_or_default()
}

fn main() {
    let port: u16 = std::env::var("NOETICA_EMBED_PORT").ok().and_then(|p| p.parse().ok()).unwrap_or(8126);
    let addr = format!("127.0.0.1:{port}");
    let server = Server::http(&addr).expect("bind embed port");
    eprintln!("[noetica-embed] listening on {addr}");

    let model: Mutex<Option<TextEmbedding>> = Mutex::new(None);
    let store: Mutex<VectorStore> = Mutex::new(VectorStore::new(vec_dir()));

    // Bearer-token gate: the sidecar binds loopback, but ANY local process could otherwise call it
    // (embedding exfiltration, vector-index tampering). When NOETICA_SIDECAR_TOKEN is set — the parent
    // agent-machine generates one and passes it at spawn — require it on every route except /health.
    let want_token = std::env::var("NOETICA_SIDECAR_TOKEN").ok().filter(|t| !t.is_empty());

    for mut req in server.incoming_requests() {
        let url = req.url().to_string();
        let method = req.method().clone();

        if let Some(ref token) = want_token {
            let expected = format!("Bearer {token}");
            let authed = url == "/health" || req.headers().iter().any(|h| h.field.equiv("Authorization") && h.value.as_str() == expected);
            if !authed { let _ = req.respond(json("{\"error\":\"unauthorized\"}".into(), 401)); continue; }
        }

        if method == Method::Get && url == "/health" {
            let loaded = model.lock().unwrap().is_some();
            let _ = req.respond(json(format!("{{\"ok\":true,\"model_loaded\":{loaded},\"dim\":384}}"), 200));
            continue;
        }

        if method == Method::Post && url == "/embed" {
            let val = match read_body(&mut req) { Some(v) => v, None => { let _ = req.respond(json("{\"error\":\"json\"}".into(), 400)); continue; } };
            let texts: Vec<String> = val.get("texts").and_then(|t| t.as_array())
                .map(|a| a.iter().filter_map(|x| x.as_str().map(|s| s.to_string())).collect())
                .unwrap_or_default();
            if texts.is_empty() { let _ = req.respond(json("{\"vectors\":[]}".into(), 200)); continue; }
            match embed_batch(&model, texts) {
                Ok(vecs) => { let _ = req.respond(json(vecs_to_json(&vecs), 200)); }
                Err(e) => { let _ = req.respond(json(format!("{{\"error\":\"{e}\"}}"), 500)); }
            }
            continue;
        }

        // ── Vector tier ──────────────────────────────────────────────────────────
        if method == Method::Post && url == "/vec/upsert" {
            let val = match read_body(&mut req) { Some(v) => v, None => { let _ = req.respond(json("{\"error\":\"json\"}".into(), 400)); continue; } };
            let col = val.get("collection").and_then(|c| c.as_str()).unwrap_or("").to_string();
            let items = val.get("items").and_then(|i| i.as_array()).cloned().unwrap_or_default();
            if col.is_empty() || items.is_empty() { let _ = req.respond(json("{\"upserted\":0}".into(), 200)); continue; }

            // Two passes: embed any text-only items in ONE batch (efficient), then assemble (id, vec, meta).
            let mut to_embed: Vec<String> = vec![];
            let mut embed_slot: Vec<Option<usize>> = vec![]; // per item → index into to_embed, or None (vec given)
            for it in &items {
                let has_vec = it.get("vec").and_then(|v| v.as_array()).map(|a| !a.is_empty()).unwrap_or(false);
                if has_vec { embed_slot.push(None); }
                else if let Some(t) = it.get("text").and_then(|t| t.as_str()) { embed_slot.push(Some(to_embed.len())); to_embed.push(t.to_string()); }
                else { embed_slot.push(None); }
            }
            let embedded = match embed_batch(&model, to_embed) { Ok(v) => v, Err(e) => { let _ = req.respond(json(format!("{{\"error\":\"{e}\"}}"), 500)); continue; } };

            let mut tuples: Vec<(String, Vec<f32>, String)> = vec![];
            for (i, it) in items.iter().enumerate() {
                let id = it.get("id").and_then(|x| x.as_str()).unwrap_or("").to_string();
                if id.is_empty() { continue; }
                let vec: Vec<f32> = match embed_slot[i] {
                    Some(slot) => embedded.get(slot).cloned().unwrap_or_default(),
                    None => as_f32_vec(it.get("vec")),
                };
                if vec.is_empty() { continue; }
                let meta = it.get("meta").map(|m| m.to_string()).unwrap_or_else(|| "{}".into());
                tuples.push((id, vec, meta));
            }
            let n = store.lock().unwrap().upsert(&col, tuples);
            let _ = req.respond(json(format!("{{\"upserted\":{n}}}"), 200));
            continue;
        }

        if method == Method::Post && url == "/vec/query" {
            let val = match read_body(&mut req) { Some(v) => v, None => { let _ = req.respond(json("{\"error\":\"json\"}".into(), 400)); continue; } };
            let col = val.get("collection").and_then(|c| c.as_str()).unwrap_or("").to_string();
            let k = val.get("k").and_then(|x| x.as_u64()).unwrap_or(8) as usize;
            let qvec: Vec<f32> = if let Some(t) = val.get("text").and_then(|t| t.as_str()) {
                match embed_batch(&model, vec![t.to_string()]) { Ok(v) => v.into_iter().next().unwrap_or_default(), Err(e) => { let _ = req.respond(json(format!("{{\"error\":\"{e}\"}}"), 500)); continue; } }
            } else { as_f32_vec(val.get("vec")) };
            if col.is_empty() || qvec.is_empty() { let _ = req.respond(json("{\"hits\":[]}".into(), 200)); continue; }
            let hits = store.lock().unwrap().query(&col, &qvec, k);
            let mut out = String::from("{\"hits\":[");
            for (i, (id, score, meta)) in hits.iter().enumerate() {
                if i > 0 { out.push(','); }
                let id_json = serde_json::to_string(id).unwrap_or_else(|_| "\"\"".into());
                let meta_json = if meta.trim().is_empty() { "{}" } else { meta.as_str() };
                out.push_str(&format!("{{\"id\":{id_json},\"score\":{score:.6},\"meta\":{meta_json}}}"));
            }
            out.push_str("]}");
            let _ = req.respond(json(out, 200));
            continue;
        }

        if method == Method::Post && url == "/vec/delete" {
            let val = match read_body(&mut req) { Some(v) => v, None => { let _ = req.respond(json("{\"error\":\"json\"}".into(), 400)); continue; } };
            let col = val.get("collection").and_then(|c| c.as_str()).unwrap_or("").to_string();
            let ids: Vec<String> = val.get("ids").and_then(|i| i.as_array())
                .map(|a| a.iter().filter_map(|x| x.as_str().map(|s| s.to_string())).collect())
                .unwrap_or_default();
            if col.is_empty() { let _ = req.respond(json("{\"deleted\":0}".into(), 200)); continue; }
            let n = store.lock().unwrap().delete(&col, &ids);
            let _ = req.respond(json(format!("{{\"deleted\":{n}}}"), 200));
            continue;
        }

        if method == Method::Get && url == "/vec/stats" {
            let stats = store.lock().unwrap().stats();
            let mut out = String::from("{\"collections\":[");
            for (i, (name, count)) in stats.iter().enumerate() {
                if i > 0 { out.push(','); }
                let name_json = serde_json::to_string(name).unwrap_or_else(|_| "\"\"".into());
                out.push_str(&format!("{{\"name\":{name_json},\"count\":{count}}}"));
            }
            out.push_str("]}");
            let _ = req.respond(json(out, 200));
            continue;
        }

        let _ = req.respond(json("{\"error\":\"not_found\"}".into(), 404));
    }
}
