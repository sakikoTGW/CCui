//! CCui project graph indexer.
//!
//! Fast, parallel replacement for the daemon's TypeScript `scanProjectGraph`.
//! Walks the project (gitignore-aware), builds a directory/file containment
//! graph + import edges, and emits a `ProjectGraph`-compatible JSON document on
//! stdout. The daemon spawns this as a subprocess and falls back to the TS
//! implementation if the binary is missing or fails — so a crash here can never
//! take down the daemon (fault isolation by design).

use std::collections::HashSet;
use std::fs;
use std::path::Path;
use std::time::{SystemTime, UNIX_EPOCH};

use ignore::WalkBuilder;
use rayon::prelude::*;
use regex::Regex;
use serde::Serialize;

const GRAPH_IGNORE: &[&str] = &[
    "node_modules", ".git", "dist", "build", ".next", "out", ".cache",
    "coverage", ".turbo", "vendor", "target", ".claude", ".cursor",
    "package-lock.json",
];
const CODE_EXT: &[&str] = &["ts", "tsx", "js", "jsx", "md", "json", "css", "html"];
const TOP_AREAS: &[&str] = &["src", "gui", "docs", "scripts", "packages", "apps"];
const MAX_DEPTH: usize = 6;
const MAX_IMPORT_BYTES: usize = 120_000;

#[derive(Serialize)]
struct GraphNode {
    id: String,
    path: String,
    label: String,
    kind: &'static str, // "dir" | "file" | "area"
    #[serde(skip_serializing_if = "Option::is_none")]
    tokens: Option<u32>,
}

#[derive(Serialize)]
struct GraphEdge {
    from: String,
    to: String,
    kind: &'static str, // "contains" | "imports"
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct Stats {
    dirs: usize,
    files: usize,
    import_edges: usize,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct ProjectGraph {
    root: String,
    scanned_at: u128,
    nodes: Vec<GraphNode>,
    edges: Vec<GraphEdge>,
    summary: String,
    stats: Stats,
}

fn node_id(p: &str) -> String {
    p.replace('\\', "/")
}

fn rel_path(root: &str, id: &str) -> String {
    let r = node_id(root);
    let prefix = if r.ends_with('/') { r.clone() } else { format!("{r}/") };
    if let Some(stripped) = id.strip_prefix(&prefix) {
        stripped.to_string()
    } else {
        id.to_string()
    }
}

fn ext_of(name: &str) -> &str {
    match name.rfind('.') {
        Some(i) => &name[i + 1..],
        None => "",
    }
}

/// Resolve `.`/`..` segments in a `/`-joined path, preserving a leading drive.
fn normalize_join(dir: &str, spec: &str) -> String {
    let base = if spec.starts_with('/') {
        spec.to_string()
    } else {
        format!("{dir}/{spec}")
    };
    let mut out: Vec<&str> = Vec::new();
    for seg in base.split('/') {
        match seg {
            "" | "." => {}
            ".." => {
                out.pop();
            }
            s => out.push(s),
        }
    }
    out.join("/")
}

fn dir_name(id: &str) -> String {
    match id.rfind('/') {
        Some(i) => id[..i].to_string(),
        None => id.to_string(),
    }
}

fn resolve_import(from_file: &str, spec: &str) -> Option<String> {
    if spec.is_empty() || spec.starts_with("node:") {
        return None;
    }
    if !spec.starts_with('.') && !spec.starts_with('/') {
        return None;
    }
    let base = normalize_join(&dir_name(from_file), spec);
    let candidates = [
        base.clone(),
        format!("{base}.ts"),
        format!("{base}.tsx"),
        format!("{base}.js"),
        format!("{base}.jsx"),
        format!("{base}/index.ts"),
        format!("{base}/index.js"),
    ];
    for c in candidates {
        if c.contains("node_modules") {
            continue;
        }
        if Path::new(&c).is_file() {
            return Some(node_id(&c));
        }
    }
    None
}

fn main() {
    let args: Vec<String> = std::env::args().collect();
    let mut root = String::new();
    let mut max_files: usize = 0; // 0 = unlimited
    let mut i = 1;
    while i < args.len() {
        match args[i].as_str() {
            "--root" => {
                i += 1;
                if i < args.len() {
                    root = args[i].clone();
                }
            }
            "--max-files" => {
                i += 1;
                if i < args.len() {
                    max_files = args[i].parse().unwrap_or(0);
                }
            }
            other => {
                if root.is_empty() {
                    root = other.to_string();
                }
            }
        }
        i += 1;
    }
    if root.is_empty() {
        root = std::env::current_dir()
            .map(|p| p.to_string_lossy().to_string())
            .unwrap_or_else(|_| ".".to_string());
    }
    let root_id = node_id(&root);

    let mut nodes: Vec<GraphNode> = Vec::new();
    let mut edges: Vec<GraphEdge> = Vec::new();
    let mut seen: HashSet<String> = HashSet::new();
    let mut file_paths: Vec<String> = Vec::new();

    nodes.push(GraphNode {
        id: root_id.clone(),
        path: root_id.clone(),
        label: "root".to_string(),
        kind: "area",
        tokens: None,
    });

    for area in TOP_AREAS {
        let p = format!("{root_id}/{area}");
        if Path::new(&p).is_dir() {
            edges.push(GraphEdge { from: root_id.clone(), to: p.clone(), kind: "contains" });
            nodes.push(GraphNode {
                id: p.clone(),
                path: p.clone(),
                label: (*area).to_string(),
                kind: "area",
                tokens: None,
            });
            seen.insert(p);
        }
    }

    // Sequential DFS walk (parents before children) so containment parents exist.
    let walker = WalkBuilder::new(&root)
        .hidden(true)
        .git_ignore(true)
        .git_global(false)
        .parents(false)
        .max_depth(Some(MAX_DEPTH))
        .build();

    for dent in walker.flatten() {
        let depth = dent.depth();
        if depth == 0 {
            continue; // root itself
        }
        let p = dent.path();
        // Custom ignore on any component name.
        if p.components().any(|c| {
            let s = c.as_os_str().to_string_lossy();
            GRAPH_IGNORE.contains(&s.as_ref())
        }) {
            continue;
        }
        let name = match p.file_name() {
            Some(n) => n.to_string_lossy().to_string(),
            None => continue,
        };
        let id = node_id(&p.to_string_lossy());
        let parent = p
            .parent()
            .map(|pp| node_id(&pp.to_string_lossy()))
            .unwrap_or_else(|| root_id.clone());

        let is_dir = dent.file_type().map(|t| t.is_dir()).unwrap_or(false);
        if is_dir {
            if !seen.contains(&id) {
                seen.insert(id.clone());
                edges.push(GraphEdge { from: parent, to: id.clone(), kind: "contains" });
                nodes.push(GraphNode {
                    id: id.clone(),
                    path: id.clone(),
                    label: name,
                    kind: "dir",
                    tokens: None,
                });
            }
        } else {
            if !CODE_EXT.contains(&ext_of(&name)) {
                continue;
            }
            if max_files > 0 && file_paths.len() >= max_files {
                continue;
            }
            file_paths.push(id.clone());
            if !seen.contains(&id) {
                seen.insert(id.clone());
                edges.push(GraphEdge { from: parent, to: id.clone(), kind: "contains" });
                nodes.push(GraphNode {
                    id: id.clone(),
                    path: id.clone(),
                    label: rel_path(&root_id, &id),
                    kind: "file",
                    tokens: None,
                });
            }
        }
    }

    // Import edges — parallel read + extract + resolve.
    let import_re = Regex::new(
        r#"(?:import|export)\s+(?:type\s+)?(?:[\w*{}\s,]+from\s+)?['"]([^'"]+)['"]|require\s*\(\s*['"]([^'"]+)['"]\s*\)"#,
    )
    .expect("valid import regex");

    let code_files: Vec<&String> = file_paths
        .iter()
        .filter(|fp| {
            let e = ext_of(fp);
            e == "ts" || e == "tsx" || e == "js" || e == "jsx"
        })
        .collect();

    let import_edges: Vec<GraphEdge> = code_files
        .par_iter()
        .flat_map_iter(|fp| {
            let mut local: Vec<GraphEdge> = Vec::new();
            let text = match fs::read_to_string(Path::new(fp.as_str())) {
                Ok(t) if t.len() <= MAX_IMPORT_BYTES => t,
                _ => return local.into_iter(),
            };
            for cap in import_re.captures_iter(&text) {
                let spec = cap.get(1).or_else(|| cap.get(2));
                if let Some(spec) = spec {
                    if let Some(target) = resolve_import(fp, spec.as_str()) {
                        if seen.contains(&target) {
                            local.push(GraphEdge {
                                from: (*fp).clone(),
                                to: target,
                                kind: "imports",
                            });
                        }
                    }
                }
            }
            local.into_iter()
        })
        .collect();
    edges.extend(import_edges);

    let summary = build_summary(&nodes, &edges);
    let dirs = nodes.iter().filter(|n| n.kind == "dir" || n.kind == "area").count();
    let files = nodes.iter().filter(|n| n.kind == "file").count();
    let import_count = edges.iter().filter(|e| e.kind == "imports").count();

    let scanned_at = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|d| d.as_millis())
        .unwrap_or(0);

    let graph = ProjectGraph {
        root: root_id,
        scanned_at,
        nodes,
        edges,
        summary,
        stats: Stats { dirs, files, import_edges: import_count },
    };

    match serde_json::to_string(&graph) {
        Ok(json) => println!("{json}"),
        Err(e) => {
            eprintln!("ccui-indexer: serialize failed: {e}");
            std::process::exit(2);
        }
    }
}

fn last_seg(s: &str) -> &str {
    s.rsplit('/').next().unwrap_or(s)
}

fn build_summary(nodes: &[GraphNode], edges: &[GraphEdge]) -> String {
    let mut lines: Vec<String> = Vec::new();
    lines.push("# Project graph".to_string());
    lines.push(String::new());
    lines.push("## Areas".to_string());
    for a in nodes.iter().filter(|n| n.kind == "area") {
        lines.push(format!("- **{}** — {}", a.label, a.path));
    }
    lines.push(String::new());
    lines.push("## Key files".to_string());
    for f in nodes.iter().filter(|n| n.kind == "file").take(24) {
        lines.push(format!("- `{}`", f.label));
    }
    lines.push(String::new());
    lines.push("## Import edges (sample)".to_string());
    for e in edges.iter().filter(|e| e.kind == "imports").take(20) {
        lines.push(format!("- {} → {}", last_seg(&e.from), last_seg(&e.to)));
    }
    lines.join("\n")
}
