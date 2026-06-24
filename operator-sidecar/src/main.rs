//! noetica-operator — Noetica's on-device neural-operator inference sidecar.
//!
//! A tiny HTTP server wrapping ONNX Runtime (`ort`). It serves ANY ONNX operator model — Fourier Neural
//! Operator surrogates and friends — that lives in the operator dir (~/.noetica/operators by default, or
//! NOETICA_OPERATOR_DIR). This is the sovereign inference path: train an operator OFFLINE, drop its `.onnx`
//! here, and it runs fully local, no Python, no cloud. Resolution-invariant models (FNOs) accept variable
//! spatial dims, so one model serves any grid the caller sends.
//!
//! Endpoints (the stable wire contract, mirrored by agent-machine/lib/operator-runtime.ts):
//!   GET  /health             -> {"ok":true,"models":[...]}
//!   GET  /models             -> {"models":[...]}
//!   GET  /meta?model=NAME    -> {"model":NAME,"inputs":[{name,shape,dtype}],"outputs":[...]}
//!   POST /infer  {"model":NAME,"inputs":{NAME:{"shape":[..],"data":[..f32..]}}}
//!                            -> {"outputs":{NAME:{"shape":[..],"data":[..f32..]}},"ms":N}
//!
//! Tensors are dense, row-major f32. A `null`/`-1` dim in /meta is dynamic.

use std::collections::HashMap;
use std::path::PathBuf;
use std::sync::Mutex;
use std::time::Instant;

use ort::session::Session;
use ort::value::Tensor;
use serde::Deserialize;
use serde_json::{json, Value as Json};
use tiny_http::{Header, Method, Request, Response, Server};

/// Per-tensor element cap (~32 MB of f32) so a bad caller can't exhaust memory.
const MAX_ELEMENTS: i64 = 8 * 1024 * 1024;

fn models_dir() -> PathBuf {
    if let Ok(d) = std::env::var("NOETICA_OPERATOR_DIR") {
        if !d.is_empty() {
            return PathBuf::from(d);
        }
    }
    let home = std::env::var("HOME").unwrap_or_else(|_| ".".into());
    PathBuf::from(home).join(".noetica").join("operators")
}

/// Only safe model names map to a file — never path traversal. A model is `<name>.onnx` in the operator dir.
fn safe_model_name(name: &str) -> Option<&str> {
    if name.is_empty()
        || name.len() > 128
        || name.contains("..")
        || !name.chars().all(|c| c.is_ascii_alphanumeric() || c == '_' || c == '-' || c == '.')
    {
        return None;
    }
    Some(name)
}

fn model_path(name: &str) -> Option<PathBuf> {
    let safe = safe_model_name(name)?;
    Some(models_dir().join(format!("{safe}.onnx")))
}

fn list_models() -> Vec<String> {
    let mut out = Vec::new();
    if let Ok(rd) = std::fs::read_dir(models_dir()) {
        for e in rd.flatten() {
            let p = e.path();
            if p.extension().and_then(|s| s.to_str()) == Some("onnx") {
                if let Some(stem) = p.file_stem().and_then(|s| s.to_str()) {
                    out.push(stem.to_string());
                }
            }
        }
    }
    out.sort();
    out
}

#[derive(Deserialize)]
struct TensorJson {
    shape: Vec<i64>,
    data: Vec<f32>,
}

#[derive(Deserialize)]
struct InferReq {
    model: String,
    inputs: HashMap<String, TensorJson>,
}

type Cache = Mutex<HashMap<String, Session>>;

fn json_resp(body: Json, code: u16) -> Response<std::io::Cursor<Vec<u8>>> {
    let header = Header::from_bytes(&b"Content-Type"[..], &b"application/json"[..]).unwrap();
    Response::from_string(body.to_string()).with_status_code(code).with_header(header)
}

fn err(msg: impl Into<String>, code: u16) -> Response<std::io::Cursor<Vec<u8>>> {
    json_resp(json!({ "error": msg.into() }), code)
}

/// Ensure the named model is loaded into the cache. Returns Ok(()) or an (message, status) error.
fn ensure_loaded(cache: &Cache, model: &str) -> Result<(), (String, u16)> {
    {
        let guard = cache.lock().unwrap();
        if guard.contains_key(model) {
            return Ok(());
        }
    }
    let path = model_path(model).ok_or_else(|| ("invalid model name".to_string(), 400))?;
    if !path.exists() {
        return Err((format!("unknown model '{model}'"), 404));
    }
    let session = Session::builder()
        .and_then(|mut b| b.commit_from_file(&path))
        .map_err(|e| (format!("failed to load model: {e}"), 500))?;
    cache.lock().unwrap().insert(model.to_string(), session);
    Ok(())
}

/// Describe a ValueType's dims as a JSON array (null = dynamic) + dtype string.
fn io_spec(name: &str, vt: &ort::value::ValueType) -> Json {
    let (dims, dtype) = match vt.tensor_shape() {
        Some(shape) => {
            let d: Vec<Json> = shape.iter().map(|&x| if x < 0 { Json::Null } else { json!(x) }).collect();
            let ty = vt.tensor_type().map(|t| format!("{t:?}")).unwrap_or_else(|| "unknown".into());
            (d, ty)
        }
        None => (Vec::new(), "non-tensor".to_string()),
    };
    json!({ "name": name, "shape": dims, "dtype": dtype })
}

fn handle_meta(cache: &Cache, model: &str) -> Response<std::io::Cursor<Vec<u8>>> {
    if let Err((m, c)) = ensure_loaded(cache, model) {
        return err(m, c);
    }
    let guard = cache.lock().unwrap();
    let session = guard.get(model).unwrap();
    let inputs: Vec<Json> = session.inputs().iter().map(|o| io_spec(o.name(), o.dtype())).collect();
    let outputs: Vec<Json> = session.outputs().iter().map(|o| io_spec(o.name(), o.dtype())).collect();
    json_resp(json!({ "model": model, "inputs": inputs, "outputs": outputs }), 200)
}

fn handle_infer(cache: &Cache, body: &str) -> Response<std::io::Cursor<Vec<u8>>> {
    let req: InferReq = match serde_json::from_str(body) {
        Ok(r) => r,
        Err(e) => return err(format!("bad request json: {e}"), 400),
    };
    if let Err((m, c)) = ensure_loaded(cache, &req.model) {
        return err(m, c);
    }

    // Build ONNX inputs, validating each tensor's element count against its shape (defense in depth — the
    // TS runtime validates too, but the sidecar must never trust its caller).
    let mut ort_inputs: Vec<(String, ort::value::DynValue)> = Vec::with_capacity(req.inputs.len());
    for (name, t) in req.inputs {
        let n: i64 = t.shape.iter().product();
        if t.shape.iter().any(|&d| d <= 0) {
            return err(format!("input '{name}': shape dims must be positive"), 400);
        }
        if n > MAX_ELEMENTS {
            return err(format!("input '{name}': {n} elements exceeds cap {MAX_ELEMENTS}"), 400);
        }
        if n as usize != t.data.len() {
            return err(format!("input '{name}': data length {} != product(shape) {n}", t.data.len()), 400);
        }
        match Tensor::from_array((t.shape, t.data)) {
            Ok(tensor) => ort_inputs.push((name, tensor.into_dyn())),
            Err(e) => return err(format!("input '{name}': {e}"), 400),
        }
    }

    let mut guard = cache.lock().unwrap();
    let session = guard.get_mut(&req.model).unwrap();
    let out_names: Vec<String> = session.outputs().iter().map(|o| o.name().to_string()).collect();

    let started = Instant::now();
    let outputs = match session.run(ort_inputs) {
        Ok(o) => o,
        Err(e) => return err(format!("inference failed: {e}"), 500),
    };
    let ms = started.elapsed().as_millis();

    let mut out_map = serde_json::Map::new();
    for name in &out_names {
        let val = &outputs[name.as_str()];
        match val.try_extract_tensor::<f32>() {
            Ok((shape, data)) => {
                let dims: Vec<i64> = shape.to_vec();
                out_map.insert(name.clone(), json!({ "shape": dims, "data": data }));
            }
            Err(e) => return err(format!("output '{name}': {e}"), 500),
        }
    }
    json_resp(json!({ "outputs": Json::Object(out_map), "ms": ms }), 200)
}

fn query_param<'a>(url: &'a str, key: &str) -> Option<&'a str> {
    let q = url.split_once('?')?.1;
    for pair in q.split('&') {
        if let Some((k, v)) = pair.split_once('=') {
            if k == key {
                return Some(v);
            }
        }
    }
    None
}

fn respond(req: Request, resp: Response<std::io::Cursor<Vec<u8>>>) {
    let _ = req.respond(resp);
}

fn main() {
    let port: u16 = std::env::var("NOETICA_OPERATOR_PORT").ok().and_then(|p| p.parse().ok()).unwrap_or(8127);
    let addr = format!("127.0.0.1:{port}");
    let server = Server::http(&addr).expect("bind operator port");
    eprintln!("[noetica-operator] listening on {addr} (models: {})", models_dir().display());

    let cache: Cache = Mutex::new(HashMap::new());

    for mut req in server.incoming_requests() {
        let method = req.method().clone();
        let url = req.url().to_string();
        let path = url.split('?').next().unwrap_or("").to_string();

        match (&method, path.as_str()) {
            (Method::Get, "/health") => {
                respond(req, json_resp(json!({ "ok": true, "models": list_models() }), 200));
            }
            (Method::Get, "/models") => {
                respond(req, json_resp(json!({ "models": list_models() }), 200));
            }
            (Method::Get, "/meta") => {
                match query_param(&url, "model") {
                    Some(model) => {
                        let m = handle_meta(&cache, model);
                        respond(req, m);
                    }
                    None => respond(req, err("missing ?model=", 400)),
                }
            }
            (Method::Post, "/infer") => {
                let mut body = String::new();
                if req.as_reader().read_to_string(&mut body).is_err() {
                    respond(req, err("could not read body", 400));
                    continue;
                }
                let r = handle_infer(&cache, &body);
                respond(req, r);
            }
            _ => respond(req, err("not found", 404)),
        }
    }
}
