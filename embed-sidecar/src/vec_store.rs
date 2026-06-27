//! vec_store.rs — per-collection flat exact vector index for the noetica-embed sidecar.
//!
//! The extracted "vector tier" of the tiered-memory architecture: chunk vectors (and their text/provenance)
//! live HERE — contiguous, per-collection — instead of as DocumentChunk graph atoms. Retrieval becomes a tight
//! per-collection scan rather than an O(all-atoms) graph walk + per-atom JSON parse.
//!
//! Robust by design: EXACT cosine (unit-normalized dot product — no recall loss), trivial per-id delete and
//! whole-collection drop, dependency-free atomic binary persistence. A flat scan in Rust handles tens of
//! thousands of vectors per collection in single-digit ms; an HNSW backend can slot behind this same interface
//! if a single collection ever outgrows that. Exact-correct now, approximate-NN only when scale demands it.

use std::collections::{HashMap, HashSet};
use std::fs;
use std::io::{Read, Write};
use std::path::{Path, PathBuf};

const MAGIC: &[u8; 4] = b"NVI1";

fn normalize(v: &[f32]) -> Vec<f32> {
    let norm: f32 = v.iter().map(|x| x * x).sum::<f32>().sqrt();
    if norm <= 0.0 { return v.to_vec(); }
    v.iter().map(|x| x / norm).collect()
}

fn sanitize_name(name: &str) -> String {
    let s: String = name
        .chars()
        .map(|c| if c.is_ascii_alphanumeric() || c == '-' || c == '_' { c } else { '_' })
        .collect();
    if s.is_empty() { "_".into() } else { s }
}

/// One collection: rows of unit-normalized vectors (flattened) + parallel id/meta arrays + an id→row index.
struct Collection {
    dim: usize,
    ids: Vec<String>,
    metas: Vec<String>, // raw JSON text per row (carries text + provenance); emitted verbatim
    vecs: Vec<f32>,     // flattened, row i = vecs[i*dim .. (i+1)*dim], unit-normalized
    pos: HashMap<String, usize>,
}

impl Collection {
    fn new(dim: usize) -> Self {
        Collection { dim, ids: vec![], metas: vec![], vecs: vec![], pos: HashMap::new() }
    }

    fn len(&self) -> usize { self.ids.len() }

    fn upsert(&mut self, id: String, vec: &[f32], meta: String) {
        let unit = normalize(vec);
        if let Some(&i) = self.pos.get(&id) {
            self.metas[i] = meta;
            let off = i * self.dim;
            self.vecs[off..off + self.dim].copy_from_slice(&unit[..self.dim]);
        } else {
            let i = self.ids.len();
            self.ids.push(id.clone());
            self.metas.push(meta);
            self.vecs.extend_from_slice(&unit);
            self.pos.insert(id, i);
        }
    }

    fn query(&self, q: &[f32], k: usize) -> Vec<(String, f32, String)> {
        if self.dim == 0 || q.len() != self.dim || self.ids.is_empty() { return vec![]; }
        let qn = normalize(q);
        let mut scored: Vec<(usize, f32)> = Vec::with_capacity(self.ids.len());
        for i in 0..self.ids.len() {
            let off = i * self.dim;
            let row = &self.vecs[off..off + self.dim];
            let mut dot = 0.0f32;
            for j in 0..self.dim { dot += row[j] * qn[j]; }
            scored.push((i, dot));
        }
        scored.sort_by(|a, b| b.1.partial_cmp(&a.1).unwrap_or(std::cmp::Ordering::Equal));
        scored.truncate(k);
        scored.into_iter().map(|(i, s)| (self.ids[i].clone(), s, self.metas[i].clone())).collect()
    }

    /// Delete by id — rebuild without the removed rows (simple + correct; keeps the index compact).
    fn delete(&mut self, ids: &[String]) -> usize {
        let del: HashSet<&String> = ids.iter().collect();
        let mut nc = Collection::new(self.dim);
        for i in 0..self.ids.len() {
            if del.contains(&self.ids[i]) { continue; }
            let off = i * self.dim;
            nc.upsert(self.ids[i].clone(), &self.vecs[off..off + self.dim].to_vec(), self.metas[i].clone());
        }
        let removed = self.ids.len() - nc.ids.len();
        *self = nc;
        removed
    }

    fn save(&self, path: &Path) -> std::io::Result<()> {
        let tmp = path.with_extension("tmp");
        {
            let mut f = fs::File::create(&tmp)?;
            f.write_all(MAGIC)?;
            f.write_all(&(self.dim as u32).to_le_bytes())?;
            f.write_all(&(self.ids.len() as u32).to_le_bytes())?;
            for i in 0..self.ids.len() {
                let id = self.ids[i].as_bytes();
                f.write_all(&(id.len() as u32).to_le_bytes())?;
                f.write_all(id)?;
                let meta = self.metas[i].as_bytes();
                f.write_all(&(meta.len() as u32).to_le_bytes())?;
                f.write_all(meta)?;
                let off = i * self.dim;
                for j in 0..self.dim { f.write_all(&self.vecs[off + j].to_le_bytes())?; }
            }
            f.flush()?;
        }
        fs::rename(&tmp, path) // atomic replace
    }

    fn load(path: &Path) -> std::io::Result<Collection> {
        let mut f = fs::File::open(path)?;
        let mut magic = [0u8; 4];
        f.read_exact(&mut magic)?;
        if &magic != MAGIC {
            return Err(std::io::Error::new(std::io::ErrorKind::InvalidData, "bad magic"));
        }
        let mut u = [0u8; 4];
        f.read_exact(&mut u)?; let dim = u32::from_le_bytes(u) as usize;
        f.read_exact(&mut u)?; let count = u32::from_le_bytes(u) as usize;
        let mut c = Collection::new(dim);
        for _ in 0..count {
            f.read_exact(&mut u)?; let idl = u32::from_le_bytes(u) as usize;
            let mut idb = vec![0u8; idl]; f.read_exact(&mut idb)?;
            f.read_exact(&mut u)?; let ml = u32::from_le_bytes(u) as usize;
            let mut mb = vec![0u8; ml]; f.read_exact(&mut mb)?;
            let mut row = vec![0f32; dim];
            for j in 0..dim { let mut fb = [0u8; 4]; f.read_exact(&mut fb)?; row[j] = f32::from_le_bytes(fb); }
            let id = String::from_utf8_lossy(&idb).to_string();
            let i = c.ids.len();
            c.ids.push(id.clone());
            c.metas.push(String::from_utf8_lossy(&mb).to_string());
            c.vecs.extend_from_slice(&row); // already unit-normalized at save time
            c.pos.insert(id, i);
        }
        Ok(c)
    }
}

pub struct VectorStore {
    dir: PathBuf,
    cols: HashMap<String, Collection>,
}

impl VectorStore {
    pub fn new(dir: PathBuf) -> Self {
        fs::create_dir_all(&dir).ok();
        VectorStore { dir, cols: HashMap::new() }
    }

    fn path(&self, col: &str) -> PathBuf {
        self.dir.join(format!("{}.idx", sanitize_name(col)))
    }

    fn ensure_loaded(&mut self, col: &str) {
        if self.cols.contains_key(col) { return; }
        let p = self.path(col);
        if p.exists() {
            match Collection::load(&p) {
                Ok(c) => { self.cols.insert(col.to_string(), c); }
                Err(e) => eprintln!("[noetica-embed] vec index load failed for {col}: {e}"),
            }
        }
    }

    /// Upsert (id, vec, meta-json) tuples. Vectors of the wrong dim are skipped. Persists on success.
    pub fn upsert(&mut self, col: &str, items: Vec<(String, Vec<f32>, String)>) -> usize {
        self.ensure_loaded(col);
        let path = self.path(col);
        let dim = self.cols.get(col).map(|c| c.dim).unwrap_or(0);
        let dim = if dim > 0 { dim } else { items.iter().map(|x| x.1.len()).find(|&d| d > 0).unwrap_or(0) };
        let c = self.cols.entry(col.to_string()).or_insert_with(|| Collection::new(dim));
        if c.dim == 0 && dim > 0 { c.dim = dim; }
        let mut n = 0;
        for (id, v, meta) in items {
            if c.dim > 0 && v.len() == c.dim { c.upsert(id, &v, meta); n += 1; }
        }
        if let Err(e) = c.save(&path) { eprintln!("[noetica-embed] vec index save failed for {col}: {e}"); }
        n
    }

    pub fn query(&mut self, col: &str, q: &[f32], k: usize) -> Vec<(String, f32, String)> {
        self.ensure_loaded(col);
        self.cols.get(col).map(|c| c.query(q, k)).unwrap_or_default()
    }

    /// Delete specific ids (empty => drop the whole collection, removing its file). Returns rows removed.
    pub fn delete(&mut self, col: &str, ids: &[String]) -> usize {
        self.ensure_loaded(col);
        let path = self.path(col);
        if ids.is_empty() {
            let n = self.cols.remove(col).map(|c| c.len()).unwrap_or(0);
            fs::remove_file(&path).ok();
            return n;
        }
        if let Some(c) = self.cols.get_mut(col) {
            let removed = c.delete(ids);
            if let Err(e) = c.save(&path) { eprintln!("[noetica-embed] vec index save failed for {col}: {e}"); }
            removed
        } else { 0 }
    }

    /// (collection, count) for every on-disk + loaded collection.
    pub fn stats(&mut self) -> Vec<(String, usize)> {
        // surface every persisted collection, not just loaded ones
        if let Ok(rd) = fs::read_dir(&self.dir) {
            for e in rd.flatten() {
                let p = e.path();
                if p.extension().and_then(|s| s.to_str()) == Some("idx") {
                    if let Some(stem) = p.file_stem().and_then(|s| s.to_str()) {
                        self.ensure_loaded(stem);
                    }
                }
            }
        }
        self.cols.iter().map(|(k, v)| (k.clone(), v.len())).collect()
    }
}
