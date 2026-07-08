//! noetica-operator — Noetica's on-device neural-operator inference sidecar.
//!
//! A tiny HTTP server wrapping `tract` (a PURE-RUST ONNX runtime). It serves ANY ONNX operator model —
//! Fourier Neural Operator surrogates and friends — that lives in the operator dir (~/.noetica/operators by
//! default, or NOETICA_OPERATOR_DIR). Sovereign inference: train an operator OFFLINE, drop its `.onnx` here,
//! and it runs fully local, no Python, no cloud. tract needs no prebuilt binary, so it cross-compiles to every
//! target (unlike ONNX Runtime, whose missing x86_64-apple-darwin prebuilt blocked bundling).
//!
//! Resolution-invariant models (FNOs) accept variable spatial dims: tract is shape-typed, so we build (and
//! cache) a runnable plan per concrete input-shape signature — one model still serves any grid the caller sends.
//!
//! Endpoints (the stable wire contract, mirrored by agent-machine/lib/operator-runtime.ts):
//!   GET  /health             -> {"ok":true,"models":[...]}
//!   GET  /models             -> {"models":[...]}
//!   GET  /meta?model=NAME    -> {"model":NAME,"inputs":[{name,shape,dtype}],"outputs":[...]}
//!   POST /infer  {"model":NAME,"inputs":{NAME:{"shape":[..],"data":[..f32..]}}}
//!                            -> {"outputs":{NAME:{"shape":[..],"data":[..f32..]}},"ms":N}
//!
//! Tensors are dense, row-major f32. A `null` dim in /meta is dynamic.

use std::collections::HashMap;
use std::path::PathBuf;
use std::sync::{Arc, Mutex};
use std::time::Instant;

use serde::Deserialize;
use serde_json::{json, Value as Json};
use tiny_http::{Header, Method, Request, Response, Server};
use tract_onnx::prelude::*;
use tract_onnx::tract_hir::infer::GenericFactoid;

/// Per-tensor element cap (~32 MB of f32) so a bad caller can't exhaust memory.
const MAX_ELEMENTS: i64 = 8 * 1024 * 1024;

type Runnable = Arc<RunnableModel<TypedFact, Box<dyn TypedOp>, TypedModel>>;

/// Loaded inference model (typed shapes still symbolic) + the input/output node names, read once.
struct Loaded {
    model: InferenceModel,
    input_names: Vec<String>,
    output_names: Vec<String>,
}

struct Cache {
    loaded: Mutex<HashMap<String, Arc<Loaded>>>,
    /// "name|shape1;shape2" -> runnable plan optimized for that concrete input-shape combination.
    runnables: Mutex<HashMap<String, Runnable>>,
}

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

fn json_resp(body: Json, code: u16) -> Response<std::io::Cursor<Vec<u8>>> {
    let header = Header::from_bytes(&b"Content-Type"[..], &b"application/json"[..]).unwrap();
    Response::from_string(body.to_string()).with_status_code(code).with_header(header)
}

fn err(msg: impl Into<String>, code: u16) -> Response<std::io::Cursor<Vec<u8>>> {
    json_resp(json!({ "error": msg.into() }), code)
}

/// Load the model + its input/output node names (cached by name). Returns the loaded entry or (message, status).
fn ensure_loaded(cache: &Cache, model: &str) -> Result<Arc<Loaded>, (String, u16)> {
    if let Some(l) = cache.loaded.lock().unwrap().get(model) {
        return Ok(l.clone());
    }
    let path = model_path(model).ok_or_else(|| ("invalid model name".to_string(), 400))?;
    if !path.exists() {
        return Err((format!("unknown model '{model}'"), 404));
    }
    let m = tract_onnx::onnx()
        .model_for_path(&path)
        .map_err(|e| (format!("failed to load model: {e}"), 500))?;
    let names = |outlets: &[OutletId]| outlets.iter().map(|o| m.node(o.node).name.clone()).collect::<Vec<_>>();
    let input_names = m.input_outlets().map(names).map_err(|e| (format!("model io: {e}"), 500))?;
    let output_names = m.output_outlets().map(names).map_err(|e| (format!("model io: {e}"), 500))?;
    let loaded = Arc::new(Loaded { model: m, input_names, output_names });
    cache.loaded.lock().unwrap().insert(model.to_string(), loaded.clone());
    Ok(loaded)
}

/// A model's declared input shape as JSON dims (null = dynamic), from tract's inference fact: a fixed dim →
/// number, a symbolic/unknown dim → null. e.g. an FNO input [1,1,'H','W'] → [1,1,null,null].
fn shape_json(model: &InferenceModel, outlet: OutletId) -> Vec<Json> {
    match model.outlet_fact(outlet) {
        Ok(fact) => fact.shape.dims().map(|d| match d {
            GenericFactoid::Only(tdim) => tdim.to_i64().ok().map(|v| json!(v)).unwrap_or(Json::Null),
            GenericFactoid::Any => Json::Null,
        }).collect(),
        Err(_) => Vec::new(),
    }
}

fn handle_meta(cache: &Cache, model_name: &str) -> Response<std::io::Cursor<Vec<u8>>> {
    let loaded = match ensure_loaded(cache, model_name) {
        Ok(l) => l,
        Err((m, c)) => return err(m, c),
    };
    let m = &loaded.model;
    let io = |outlets: &[OutletId]| -> Vec<Json> {
        outlets.iter().map(|&o| json!({
            "name": m.node(o.node).name.clone(),
            "shape": shape_json(m, o),
            "dtype": "Float32",
        })).collect()
    };
    let inputs = m.input_outlets().map(io).unwrap_or_default();
    let outputs = m.output_outlets().map(io).unwrap_or_default();
    json_resp(json!({ "model": model_name, "inputs": inputs, "outputs": outputs }), 200)
}

fn handle_infer(cache: &Cache, body: &str) -> Response<std::io::Cursor<Vec<u8>>> {
    let req: InferReq = match serde_json::from_str(body) {
        Ok(r) => r,
        Err(e) => return err(format!("bad request json: {e}"), 400),
    };
    let loaded = match ensure_loaded(cache, &req.model) {
        Ok(l) => l,
        Err((m, c)) => return err(m, c),
    };

    // Validate each input tensor (element count vs shape, with a checked product so a crafted overflow can't
    // pass) and build the per-input concrete shape map.
    let mut shapes: HashMap<String, Vec<usize>> = HashMap::with_capacity(req.inputs.len());
    for (name, t) in &req.inputs {
        if t.shape.iter().any(|&d| d <= 0) {
            return err(format!("input '{name}': shape dims must be positive"), 400);
        }
        let mut n: i64 = 1;
        for &d in &t.shape {
            match n.checked_mul(d) {
                Some(v) if v <= MAX_ELEMENTS => n = v,
                _ => return err(format!("input '{name}': element count overflows or exceeds cap {MAX_ELEMENTS}"), 400),
            }
        }
        if n as usize != t.data.len() {
            return err(format!("input '{name}': data length {} != product(shape) {n}", t.data.len()), 400);
        }
        shapes.insert(name.clone(), t.shape.iter().map(|&d| d as usize).collect());
    }
    // Every model input must be supplied.
    for name in &loaded.input_names {
        if !shapes.contains_key(name) {
            return err(format!("missing input '{name}'"), 400);
        }
    }

    // Get-or-build the runnable plan for this concrete input-shape signature (resolution-invariance: a new
    // grid size just builds + caches a new plan; repeats are free).
    let sig = {
        let mut parts: Vec<String> = loaded.input_names.iter()
            .map(|n| format!("{n}={:?}", shapes.get(n).unwrap())).collect();
        parts.sort();
        format!("{}|{}", req.model, parts.join(";"))
    };
    // NB: bind the lookup to a local (releasing the lock) BEFORE the else branch — holding the guard across
    // the if/else and re-locking inside it self-deadlocks (std Mutex is not reentrant).
    let cached = cache.runnables.lock().unwrap().get(&sig).cloned();
    let runnable: Runnable = if let Some(r) = cached {
        r
    } else {
        {
            let mut m = loaded.model.clone();
            for (ix, name) in loaded.input_names.iter().enumerate() {
                let shape = shapes.get(name).unwrap();
                m = match m.with_input_fact(ix, f32::fact(shape.as_slice()).into()) {
                    Ok(m) => m,
                    Err(e) => return err(format!("input '{name}': {e}"), 400),
                };
            }
            let built = match m.into_optimized().and_then(|m| m.into_runnable()) {
                Ok(r) => Arc::new(r),
                Err(e) => return err(format!("plan failed: {e}"), 500),
            };
            cache.runnables.lock().unwrap().insert(sig, built.clone());
            built
        }
    };

    // Build input tensors in the model's input order.
    let mut tensors: TVec<TValue> = tvec!();
    for name in &loaded.input_names {
        let t = &req.inputs[name];
        let shape: Vec<usize> = t.shape.iter().map(|&d| d as usize).collect();
        let tensor = match tract_ndarray::ArrayD::from_shape_vec(shape, t.data.clone()) {
            Ok(a) => Tensor::from(a),
            Err(e) => return err(format!("input '{name}': {e}"), 400),
        };
        tensors.push(tensor.into());
    }

    let started = Instant::now();
    let outputs = match runnable.run(tensors) {
        Ok(o) => o,
        Err(e) => return err(format!("inference failed: {e}"), 500),
    };
    let ms = started.elapsed().as_millis();

    let mut out_map = serde_json::Map::new();
    for (i, out) in outputs.iter().enumerate() {
        let view = match out.to_array_view::<f32>() {
            Ok(v) => v,
            Err(e) => return err(format!("output {i}: {e}"), 500),
        };
        let dims: Vec<i64> = view.shape().iter().map(|&d| d as i64).collect();
        let data: Vec<f32> = view.iter().copied().collect();
        let name = loaded.output_names.get(i).cloned().unwrap_or_else(|| format!("output_{i}"));
        out_map.insert(name, json!({ "shape": dims, "data": data }));
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

    let cache = Cache { loaded: Mutex::new(HashMap::new()), runnables: Mutex::new(HashMap::new()) };

    // Bearer-token gate: the sidecar binds loopback, but ANY local process could otherwise drive model
    // inference. When NOETICA_SIDECAR_TOKEN is set (parent agent-machine generates + passes it at spawn),
    // require it on every route except /health.
    let want_token = std::env::var("NOETICA_SIDECAR_TOKEN").ok().filter(|t| !t.is_empty());

    for mut req in server.incoming_requests() {
        let method = req.method().clone();
        let url = req.url().to_string();
        let path = url.split('?').next().unwrap_or("").to_string();

        if let Some(ref token) = want_token {
            let expected = format!("Bearer {token}");
            let authed = path == "/health" || req.headers().iter().any(|h| h.field.equiv("Authorization") && h.value.as_str() == expected);
            if !authed { respond(req, json_resp(json!({ "error": "unauthorized" }), 401)); continue; }
        }

        match (&method, path.as_str()) {
            (Method::Get, "/health") => respond(req, json_resp(json!({ "ok": true, "models": list_models() }), 200)),
            (Method::Get, "/models") => respond(req, json_resp(json!({ "models": list_models() }), 200)),
            (Method::Get, "/meta") => match query_param(&url, "model") {
                Some(model) => { let m = handle_meta(&cache, model); respond(req, m); }
                None => respond(req, err("missing ?model=", 400)),
            },
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
