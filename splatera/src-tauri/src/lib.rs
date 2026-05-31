use arboard::Clipboard;
use color_thief::{get_palette, ColorFormat};
use image::imageops::FilterType;
use rusqlite::{params, Connection};
use serde::{Deserialize, Serialize};
use std::collections::HashMap;
use std::env;
use std::fs;
use std::path::{Path, PathBuf};
use std::sync::Mutex;
use std::time::{SystemTime, UNIX_EPOCH};
use tauri::{AppHandle, Manager, State};
use uuid::Uuid;
use walkdir::WalkDir;

const IMAGE_EXTENSIONS: &[&str] = &["png", "jpg", "jpeg", "webp", "bmp", "gif"];
const VIDEO_EXTENSIONS: &[&str] = &["mp4", "webm", "mov"];
const TEXT_EXTENSIONS: &[&str] = &["txt", "md"];
const CODE_EXTENSIONS: &[&str] = &["js", "py", "rs", "css", "html", "json"];
const ALL_EXTENSIONS: &[&str] = &[
    "png", "jpg", "jpeg", "webp", "bmp", "gif", "mp4", "webm", "mov", "txt", "md", "js", "py",
    "rs", "css", "html", "json",
];

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
enum AssetKind {
    Image,
    Code,
    Text,
    Video,
    Unknown,
}

impl AssetKind {
    fn default_tags(&self) -> Vec<String> {
        match self {
            AssetKind::Image => vec!["image".to_string()],
            AssetKind::Text => vec!["text".to_string()],
            AssetKind::Code => vec!["code".to_string()],
            AssetKind::Video => vec!["video".to_string()],
            AssetKind::Unknown => vec![],
        }
    }
}

#[derive(Debug, Clone, Serialize, Deserialize)]
struct FileMetadata {
    size_bytes: u64,
    file_name: String,
    extension: String,
    last_modified_os: u64,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Asset {
    id: String,
    original_path: String,
    preview_path: Option<String>,
    kind: AssetKind,
    dominant_colors: Vec<String>,
    tags: Vec<String>,
    metadata: FileMetadata,
    width: u32,
    height: u32,
    created_at: u64,
    content_snippet: Option<String>,
    #[serde(default)]
    is_broken: bool,
    file_hash: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
struct AppConfig {
    library_path: String,
    theme_mode: String,
    thumbnail_size: u32,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
struct LibraryQuery {
    query: Option<String>,
    tags: Option<Vec<String>>,
    color: Option<String>,
    date: Option<String>,
    sort: Option<String>,
    filter_tag: Option<String>,
    limit: Option<u32>,
    offset: Option<u32>,
}

fn get_config(app: &tauri::AppHandle) -> Result<AppConfig, String> {
    let exe_path = env::current_exe().map_err(|e| e.to_string())?;
    let exe_dir = exe_path.parent().ok_or("Cannot determine exe directory")?;

    let portable_flag = exe_dir.join("portable.txt");

    let lib_path = if portable_flag.exists() {
        exe_dir.join(".splatera_library")
    } else {
        let app_dir = app.path().app_data_dir().map_err(|e| e.to_string())?;
        app_dir.join(".splatera_library")
    };

    fs::create_dir_all(&lib_path).unwrap_or_default();
    fs::create_dir_all(lib_path.join("thumbnails")).unwrap_or_default();

    Ok(AppConfig {
        library_path: lib_path.to_string_lossy().into_owned(),
        theme_mode: "dark".to_string(),
        thumbnail_size: 400,
    })
}

struct AppState {
    config: AppConfig,
    db: Mutex<Connection>,
    clipboard: Mutex<Clipboard>,
}

fn get_db_path(config: &AppConfig) -> PathBuf {
    Path::new(&config.library_path).join("database.db")
}

fn init_db(config: &AppConfig) -> Result<Connection, String> {
    let db_path = get_db_path(config);
    let conn = Connection::open(db_path).map_err(|e| e.to_string())?;

    conn.execute(
        "CREATE TABLE IF NOT EXISTS assets (
            id TEXT PRIMARY KEY,
            original_path TEXT UNIQUE NOT NULL,
            preview_path TEXT,
            kind TEXT NOT NULL,
            dominant_colors TEXT, 
            tags TEXT,           
            size_bytes INTEGER,
            file_name TEXT,
            extension TEXT,
            last_modified_os INTEGER,
            width INTEGER,
            height INTEGER,
            created_at INTEGER,
            content_snippet TEXT,
            is_broken INTEGER DEFAULT 0,
            file_hash TEXT
        )",
        (),
    )
    .map_err(|e| e.to_string())?;

    let _ = conn.execute("ALTER TABLE assets ADD COLUMN file_hash TEXT", ());
    let _ = conn.execute(
        "CREATE INDEX IF NOT EXISTS idx_assets_kind ON assets(kind)",
        (),
    );
    let _ = conn.execute(
        "CREATE INDEX IF NOT EXISTS idx_assets_created ON assets(created_at)",
        (),
    );
    let _ = conn.execute(
        "CREATE INDEX IF NOT EXISTS idx_assets_hash ON assets(file_hash)",
        (),
    );

    Ok(conn)
}

fn extract_metadata(path: &Path) -> Result<FileMetadata, String> {
    let meta = fs::metadata(path).map_err(|e| e.to_string())?;
    Ok(FileMetadata {
        size_bytes: meta.len(),
        file_name: path
            .file_name()
            .unwrap_or_default()
            .to_string_lossy()
            .to_string(),
        extension: path
            .extension()
            .unwrap_or_default()
            .to_string_lossy()
            .to_string(),
        last_modified_os: meta
            .modified()
            .unwrap_or(SystemTime::now())
            .duration_since(UNIX_EPOCH)
            .unwrap_or_default()
            .as_secs(),
    })
}

fn extract_colors(img: &image::DynamicImage) -> Vec<String> {
    let sample = img.resize(256, 256, FilterType::Nearest);
    get_palette(sample.into_rgb8().as_raw(), ColorFormat::Rgb, 5, 5)
        .map(|palette| {
            palette
                .into_iter()
                .map(|c| format!("#{:02X}{:02X}{:02X}", c.r, c.g, c.b))
                .collect()
        })
        .unwrap_or_default()
}

fn hex_to_rgb(hex: &str) -> Option<(i32, i32, i32)> {
    let hex = hex.trim_start_matches('#');
    if hex.len() != 6 {
        return None;
    }
    let r = i32::from_str_radix(&hex[0..2], 16).ok()?;
    let g = i32::from_str_radix(&hex[2..4], 16).ok()?;
    let b = i32::from_str_radix(&hex[4..6], 16).ok()?;
    Some((r, g, b))
}

fn color_distance(c1: (i32, i32, i32), c2: (i32, i32, i32)) -> f64 {
    let dr = (c1.0 - c2.0).pow(2);
    let dg = (c1.1 - c2.1).pow(2);
    let db = (c1.2 - c2.2).pow(2);
    ((dr + dg + db) as f64).sqrt()
}

fn save_thumbnail(img: &image::DynamicImage, asset_id: &str, config: &AppConfig) -> Option<String> {
    let thumb = img.resize(
        config.thumbnail_size,
        config.thumbnail_size,
        FilterType::Lanczos3,
    );
    let path = Path::new(&config.library_path)
        .join("thumbnails")
        .join(format!("{}.jpg", asset_id));
    thumb.into_rgb8().save(&path).ok()?;
    Some(path.to_string_lossy().into_owned())
}

fn read_text_snippet(path: &Path) -> Option<String> {
    let content = fs::read_to_string(path).ok()?;
    Some(content.lines().take(20).collect::<Vec<_>>().join("\n"))
}

fn compute_file_hash(path: &Path) -> Result<String, String> {
    use std::io::Read;
    let mut file = fs::File::open(path).map_err(|e| e.to_string())?;
    let mut hasher = xxhash_rust::xxh3::Xxh3::new();
    let mut buffer = [0; 65536];
    loop {
        let count = file.read(&mut buffer).map_err(|e| e.to_string())?;
        if count == 0 {
            break;
        }
        hasher.update(&buffer[..count]);
    }
    Ok(format!("{:016x}", hasher.digest()))
}

fn process_single_path(path: &Path, config: &AppConfig) -> Result<Asset, String> {
    let metadata = extract_metadata(path)?;
    let asset_id = Uuid::new_v4().to_string();

    let ext = metadata.extension.to_lowercase();
    let mut tags = if ext.is_empty() {
        vec![]
    } else {
        vec![ext.clone()]
    };

    let kind;
    let mut preview_path = None;
    let mut dominant_colors = vec![];
    let mut content_snippet = None;
    let mut width = 0u32;
    let mut height = 0u32;

    if IMAGE_EXTENSIONS.contains(&ext.as_str()) {
        kind = AssetKind::Image;
        if let Ok(img) = image::open(path) {
            width = img.width();
            height = img.height();
            dominant_colors = extract_colors(&img);
            preview_path = save_thumbnail(&img, &asset_id, config);
        }
    } else if VIDEO_EXTENSIONS.contains(&ext.as_str()) {
        kind = AssetKind::Video;
        let (w, h) = get_video_dimensions(path);
        width = w;
        height = h;

        preview_path = generate_video_thumbnail(path, &asset_id, config);
    } else if TEXT_EXTENSIONS.contains(&ext.as_str()) {
        kind = AssetKind::Text;
        content_snippet = read_text_snippet(path);
        width = 400;
        height = 300;
    } else if CODE_EXTENSIONS.contains(&ext.as_str()) {
        kind = AssetKind::Code;
        content_snippet = read_text_snippet(path);
        width = 400;
        height = 300;
    } else {
        kind = AssetKind::Unknown;
    }

    tags.extend(kind.default_tags());

    let file_hash = compute_file_hash(path).ok();

    Ok(Asset {
        id: asset_id,
        original_path: path.to_string_lossy().into_owned(),
        preview_path,
        kind,
        dominant_colors,
        tags,
        metadata,
        width,
        height,
        created_at: SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .unwrap_or_default()
            .as_secs(),
        content_snippet,
        is_broken: false,
        file_hash,
    })
}

#[derive(Debug, Clone, Serialize, Deserialize)]
struct SimplifiedAsset {
    id: String,
    original_path: String,
    preview_path: Option<String>,
    kind: AssetKind,
    tags: Vec<String>,
    file_name: String,
    width: u32,
    height: u32,
    created_at: u64,
    last_modified_os: u64,
    content_snippet: Option<String>,
    is_broken: bool,
    file_hash: Option<String>,
}

#[tauri::command]
fn is_temp_path(path: &Path) -> bool {
    let temp = std::env::temp_dir();
    if let (Ok(p), Ok(t)) = (path.canonicalize(), temp.canonicalize()) {
        p.starts_with(t)
    } else {
        path.starts_with(&temp)
    }
}

#[derive(Debug, Clone, Serialize, Deserialize)]
struct PrepareResult {
    paths: Vec<String>,
    has_temp: bool,
}

#[tauri::command]
async fn prepare_dropped_paths(
    state: State<'_, AppState>,
    paths: Vec<String>,
) -> Result<PrepareResult, String> {
    let config = state.config.clone();
    let mut result = Vec::new();
    let mut has_temp = false;

    for p in paths {
        let src_path = Path::new(&p);
        if src_path.exists() && is_temp_path(src_path) {
            has_temp = true;
            let ext = src_path
                .extension()
                .map(|e| e.to_string_lossy().to_lowercase())
                .unwrap_or_else(|| "_".to_string());

            let local_dir = Path::new(&config.library_path).join("local").join(&ext);
            if let Err(e) = fs::create_dir_all(&local_dir) {
                println!("Failed to create local dir for temp: {}", e);
                result.push(p);
                continue;
            }

            let file_name = match src_path.file_name() {
                Some(n) => n,
                None => {
                    result.push(p);
                    continue;
                }
            };

            let mut dest_path = local_dir.join(file_name);
            if dest_path.exists() {
                let stem = src_path.file_stem().unwrap_or_default().to_string_lossy();
                let mut counter = 1;
                loop {
                    let new_name = if ext == "_" {
                        format!("{}_{}", stem, counter)
                    } else {
                        format!("{}_{}.{}", stem, counter, ext)
                    };
                    let new_path = local_dir.join(new_name);
                    if !new_path.exists() {
                        dest_path = new_path;
                        break;
                    }
                    counter += 1;
                }
            }

            if let Err(e) = fs::copy(&src_path, &dest_path) {
                println!("Failed to copy temp file: {}", e);
                result.push(p);
            } else {
                result.push(dest_path.to_string_lossy().into_owned());
            }
        } else {
            result.push(p);
        }
    }

    Ok(PrepareResult { paths: result, has_temp })
}

#[derive(Debug, Clone, Serialize, Deserialize)]
struct ImportCheckResult {
    allowed_paths: Vec<String>,
    duplicate_paths: Vec<String>,
    duplicate_hashes: Vec<String>,
}

#[tauri::command]
async fn check_import_paths(
    state: State<'_, AppState>,
    paths: Vec<String>,
) -> Result<ImportCheckResult, String> {
    let conn = state.db.lock().map_err(|e| e.to_string())?;
    
    let mut allowed_paths = Vec::new();
    let mut duplicate_paths = Vec::new();
    let mut duplicate_hashes = Vec::new();

    for p in paths {
        let path = Path::new(&p);
        if !path.exists() {
            continue;
        }

        let path_exists: i32 = conn
            .query_row(
                "SELECT COUNT(*) FROM assets WHERE original_path = ?1",
                rusqlite::params![p],
                |row| row.get(0),
            )
            .unwrap_or(0);

        if path_exists > 0 {
            duplicate_paths.push(p);
            continue;
        }

        let ext = path
            .extension()
            .map(|e| e.to_string_lossy().to_lowercase())
            .unwrap_or_default();

        if ALL_EXTENSIONS.contains(&ext.as_str()) {
            if let Ok(hash) = compute_file_hash(path) {
                let hash_exists: i32 = conn
                    .query_row(
                        "SELECT COUNT(*) FROM assets WHERE file_hash = ?1",
                        rusqlite::params![hash],
                        |row| row.get(0),
                    )
                    .unwrap_or(0);

                if hash_exists > 0 {
                    duplicate_hashes.push(p);
                    continue;
                }
            }
        }

        allowed_paths.push(p);
    }

    Ok(ImportCheckResult {
        allowed_paths,
        duplicate_paths,
        duplicate_hashes,
    })
}

#[tauri::command]
async fn copy_to_local_library(
    state: State<'_, AppState>,
    path: String,
) -> Result<String, String> {
    let config = state.config.clone();
    let src_path = Path::new(&path);
    if !src_path.exists() {
        return Err(format!("Source path does not exist: {}", path));
    }

    let ext = src_path
        .extension()
        .map(|e| e.to_string_lossy().to_lowercase())
        .unwrap_or_else(|| "_".to_string());

    let local_dir = Path::new(&config.library_path).join("local").join(&ext);
    if src_path.starts_with(&local_dir) {
        return Ok(path);
    }

    fs::create_dir_all(&local_dir).map_err(|e| e.to_string())?;

    let file_name = src_path
        .file_name()
        .ok_or_else(|| "Invalid file name".to_string())?;

    let mut dest_path = local_dir.join(file_name);
    if dest_path.exists() {
        let stem = src_path
            .file_stem()
            .unwrap_or_default()
            .to_string_lossy();
        let mut counter = 1;
        loop {
            let new_name = if ext == "_" {
                format!("{}_{}", stem, counter)
            } else {
                format!("{}_{}.{}", stem, counter, ext)
            };
            let new_path = local_dir.join(new_name);
            if !new_path.exists() {
                dest_path = new_path;
                break;
            }
            counter += 1;
        }
    }

    fs::copy(&src_path, &dest_path).map_err(|e| e.to_string())?;

    Ok(dest_path.to_string_lossy().into_owned())
}

#[tauri::command]
async fn process_asset(
    _app: AppHandle,
    state: State<'_, AppState>,
    path: String,
) -> Result<Vec<SimplifiedAsset>, String> {
    let config = state.config.clone();

    let assets = tokio::task::spawn_blocking(move || {
        let root = Path::new(&path);

        let paths: Vec<PathBuf> = if root.is_dir() {
            WalkDir::new(root)
                .into_iter()
                .filter_map(|e| e.ok())
                .filter(|e| e.file_type().is_file())
                .map(|e| e.path().to_path_buf())
                .collect()
        } else {
            vec![root.to_path_buf()]
        };

        let processed: Vec<Asset> = paths
            .into_iter()
            .filter(|p| {
                p.extension()
                    .map(|e| ALL_EXTENSIONS.contains(&e.to_string_lossy().to_lowercase().as_str()))
                    .unwrap_or(false)
            })
            .filter_map(|p| process_single_path(&p, &config).ok())
            .collect();

        Ok::<Vec<Asset>, String>(processed)
    })
    .await
    .unwrap_or_else(|e| Err(format!("Task panicked: {}", e)))?;

    let mut conn = state.db.lock().map_err(|e| e.to_string())?;
    let tx = conn.transaction().map_err(|e| e.to_string())?;

    let mut saved = Vec::new();
    for a in assets {
        let mut duplicate_handled = false;
        if let Some(ref hash) = a.file_hash {
            let res = tx.query_row(
                "SELECT id, is_broken, original_path FROM assets WHERE file_hash = ?1 LIMIT 1",
                rusqlite::params![hash],
                |row| {
                    Ok((
                        row.get::<_, String>(0)?,
                        row.get::<_, i32>(1)?,
                        row.get::<_, String>(2)?,
                    ))
                },
            );

            if let Ok((existing_id, is_broken, old_path)) = res {
                let old_path_exists = Path::new(&old_path).exists();
                if is_broken == 1 || !old_path_exists {
                    let _ = tx.execute(
                        "UPDATE assets SET original_path = ?1, is_broken = 0 WHERE id = ?2",
                        rusqlite::params![a.original_path, existing_id],
                    );
                }

                saved.push(SimplifiedAsset {
                    id: existing_id,
                    original_path: a.original_path.clone(),
                    preview_path: a.preview_path.clone(),
                    kind: a.kind.clone(),
                    tags: a.tags.clone(),
                    file_name: a.metadata.file_name.clone(),
                    width: a.width,
                    height: a.height,
                    created_at: a.created_at,
                    last_modified_os: a.metadata.last_modified_os,
                    content_snippet: a
                        .content_snippet
                        .as_ref()
                        .map(|s| s.lines().take(5).collect::<Vec<_>>().join("\n")),
                    is_broken: false,
                    file_hash: a.file_hash.clone(),
                });

                duplicate_handled = true;
            }
        }

        if duplicate_handled {
            continue;
        }

        let tags_json = serde_json::to_string(&a.tags).unwrap_or_default();
        let color_json = serde_json::to_string(&a.dominant_colors).unwrap_or_default();
        let kind_str = format!("{:?}", a.kind);

        let res = tx.execute(
            "INSERT OR IGNORE INTO assets (id, original_path, preview_path, kind, dominant_colors, tags, size_bytes, file_name, extension, last_modified_os, width, height, created_at, content_snippet, is_broken, file_hash)
             VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11, ?12, ?13, ?14, ?15, ?16)",
            params![
                a.id, a.original_path, a.preview_path, kind_str,
                color_json, tags_json, a.metadata.size_bytes, a.metadata.file_name,
                a.metadata.extension, a.metadata.last_modified_os, a.width, a.height,
                a.created_at, a.content_snippet, if a.is_broken { 1 } else { 0 },
                a.file_hash
            ],
        );

        if let Ok(rows) = res {
            if rows > 0 {
                saved.push(SimplifiedAsset {
                    id: a.id,
                    original_path: a.original_path,
                    preview_path: a.preview_path,
                    kind: a.kind,
                    tags: a.tags,
                    file_name: a.metadata.file_name,
                    width: a.width,
                    height: a.height,
                    created_at: a.created_at,
                    last_modified_os: a.metadata.last_modified_os,
                    content_snippet: a
                        .content_snippet
                        .as_ref()
                        .map(|s| s.lines().take(5).collect::<Vec<_>>().join("\n")),
                    is_broken: a.is_broken,
                    file_hash: a.file_hash,
                });
            }
        }
    }
    tx.commit().map_err(|e| e.to_string())?;

    Ok(saved)
}

#[tauri::command]
fn get_library(
    state: State<'_, AppState>,
    query: LibraryQuery,
) -> Result<Vec<SimplifiedAsset>, String> {
    let conn = state.db.lock().map_err(|e| e.to_string())?;

    let mut sql = "SELECT id, original_path, preview_path, kind, dominant_colors, tags, file_name, width, height, created_at, last_modified_os, content_snippet, is_broken, file_hash FROM assets WHERE 1=1".to_string();
    let mut params_vec: Vec<String> = Vec::new();

    if let Some(tag) = &query.filter_tag {
        let tag_lower = tag.to_lowercase();
        if tag_lower == "images" {
            sql.push_str(" AND (kind = 'Image' OR tags LIKE ?)");
            params_vec.push("%\"png\"%".to_string());
        } else {
            sql.push_str(" AND tags LIKE ?");
            params_vec.push(format!("%\"{}\"%", tag_lower));
        }
    }

    if let Some(q) = &query.query {
        let q = q.trim().to_lowercase();
        if !q.is_empty() {
            let is_exclude = q.starts_with('-');
            let term = if is_exclude { &q[1..] } else { &q };
            let pattern = format!("%{}%", term);

            if is_exclude {
                sql.push_str(
                    " AND file_name NOT LIKE ? AND tags NOT LIKE ? AND content_snippet NOT LIKE ?",
                );
            } else {
                sql.push_str(" AND (file_name LIKE ? OR tags LIKE ? OR content_snippet LIKE ?)");
            }
            params_vec.push(pattern.clone());
            params_vec.push(pattern.clone());
            params_vec.push(pattern.clone());
        }
    }

    if let Some(tags) = &query.tags {
        for tag_item in tags {
            let tag_item = tag_item.trim().to_lowercase();
            if tag_item.is_empty() {
                continue;
            }
            let is_exclude = tag_item.starts_with('-');
            let match_tag = if is_exclude {
                &tag_item[1..]
            } else {
                &tag_item
            };
            let pattern = format!("%\"{}\"%", match_tag);

            if is_exclude {
                sql.push_str(" AND tags NOT LIKE ?");
            } else {
                sql.push_str(" AND tags LIKE ?");
            }
            params_vec.push(pattern);
        }
    }

    if let Some(d_filter) = &query.date {
        if !d_filter.is_empty() {
            sql.push_str(
                " AND strftime('%d.%m.%Y', datetime(last_modified_os, 'unixepoch')) LIKE ?",
            );
            params_vec.push(format!("%{}%", d_filter));
        }
    }

    if let Some(sort_type) = &query.sort {
        match sort_type.as_str() {
            "name_asc" => sql.push_str(" ORDER BY LOWER(file_name) ASC"),
            "name_desc" => sql.push_str(" ORDER BY LOWER(file_name) DESC"),
            "date_desc" => sql.push_str(" ORDER BY created_at DESC"),
            "date_asc" => sql.push_str(" ORDER BY created_at ASC"),
            _ => sql.push_str(" ORDER BY created_at DESC"),
        }
    } else {
        sql.push_str(" ORDER BY created_at DESC");
    }

    let limit = query.limit.unwrap_or(50);
    let offset = query.offset.unwrap_or(0);
    sql.push_str(&format!(" LIMIT {} OFFSET {}", limit, offset));

    let mut stmt = conn.prepare(&sql).map_err(|e| e.to_string())?;
    let mut rows = stmt
        .query(rusqlite::params_from_iter(params_vec))
        .map_err(|e| e.to_string())?;

    let mut results = Vec::new();
    let lib_path = Path::new(&state.config.library_path);

    while let Some(row) = rows.next().map_err(|e| e.to_string())? {
        let kind_str: String = row.get(3).unwrap_or("Unknown".to_string());
        let kind = match kind_str.as_str() {
            "Image" => AssetKind::Image,
            "Video" => AssetKind::Video,
            "Text" => AssetKind::Text,
            "Code" => AssetKind::Code,
            _ => AssetKind::Unknown,
        };

        let tags_json: String = row.get(5).unwrap_or("[]".to_string());
        let tags: Vec<String> = serde_json::from_str(&tags_json).unwrap_or_default();

        let colors_json: String = row.get(4).unwrap_or("[]".to_string());
        let dominant_colors: Vec<String> = serde_json::from_str(&colors_json).unwrap_or_default();

        let mut preview_path: Option<String> = row.get(2).ok();
        if let Some(preview) = &preview_path {
            if preview.starts_with("./") {
                let absolute = lib_path.join(&preview[2..]);
                preview_path = Some(absolute.to_string_lossy().into_owned());
            }
        }

        let asset = SimplifiedAsset {
            id: row.get(0).unwrap_or_default(),
            original_path: row.get(1).unwrap_or_default(),
            preview_path,
            kind,
            tags,
            file_name: row.get(6).unwrap_or_default(),
            width: row.get(7).unwrap_or(0),
            height: row.get(8).unwrap_or(0),
            created_at: row.get(9).unwrap_or(0),
            last_modified_os: row.get(10).unwrap_or(0),
            content_snippet: row
                .get(11)
                .ok()
                .map(|s: String| s.lines().take(5).collect::<Vec<_>>().join("\n")),
            is_broken: row.get::<_, i32>(12).unwrap_or(0) == 1,
            file_hash: row.get(13).ok(),
        };

        if let Some(target_color) = &query.color {
            if let Some(rgb1) = hex_to_rgb(target_color) {
                let has_match = dominant_colors.iter().any(|c_hex| {
                    if let Some(rgb2) = hex_to_rgb(c_hex) {
                        color_distance(rgb1, rgb2) < 60.0
                    } else {
                        false
                    }
                });
                if !has_match {
                    continue;
                }
            }
        }

        results.push(asset);
    }

    Ok(results)
}

#[tauri::command]
fn get_top_tags(state: State<'_, AppState>) -> Result<Vec<String>, String> {
    let conn = state.db.lock().map_err(|e| e.to_string())?;
    let mut stmt = conn
        .prepare("SELECT tags FROM assets")
        .map_err(|e| e.to_string())?;
    let mut rows = stmt.query(()).map_err(|e| e.to_string())?;

    let mut counts: HashMap<String, usize> = HashMap::new();
    while let Some(row) = rows.next().map_err(|e| e.to_string())? {
        let tags_json: String = row.get(0).unwrap_or("[]".to_string());
        let tags: Vec<String> = serde_json::from_str(&tags_json).unwrap_or_default();
        for tag in tags {
            *counts.entry(tag.to_uppercase()).or_insert(0) += 1;
        }
    }

    let mut sorted: Vec<(String, usize)> = counts.into_iter().collect();
    sorted.sort_by(|a, b| b.1.cmp(&a.1));
    Ok(sorted.into_iter().map(|(tag, _)| tag).collect())
}

#[tauri::command]
async fn recalculate_db(state: State<'_, AppState>) -> Result<(), String> {
    let config = state.config.clone();

    let assets: Vec<Asset> = {
        let conn = state.db.lock().map_err(|e| e.to_string())?;
        let mut stmt = conn.prepare("SELECT id, original_path, preview_path, kind, dominant_colors, tags, size_bytes, file_name, extension, last_modified_os, width, height, created_at, content_snippet, is_broken, file_hash FROM assets").map_err(|e| e.to_string())?;
        let items = stmt
            .query_map((), |row| {
                let kind_str: String = row.get(3)?;
                let kind = match kind_str.as_str() {
                    "Image" => AssetKind::Image,
                    "Video" => AssetKind::Video,
                    "Text" => AssetKind::Text,
                    "Code" => AssetKind::Code,
                    _ => AssetKind::Unknown,
                };
                let tags_json: String = row.get(5)?;
                let tags: Vec<String> = serde_json::from_str(&tags_json).unwrap_or_default();
                let colors_json: String = row.get(4)?;
                let dominant_colors: Vec<String> =
                    serde_json::from_str(&colors_json).unwrap_or_default();

                Ok(Asset {
                    id: row.get(0)?,
                    original_path: row.get(1)?,
                    preview_path: row.get(2)?,
                    kind,
                    dominant_colors,
                    tags,
                    metadata: FileMetadata {
                        size_bytes: row.get(6)?,
                        file_name: row.get(7)?,
                        extension: row.get(8)?,
                        last_modified_os: row.get(9)?,
                    },
                    width: row.get(10)?,
                    height: row.get(11)?,
                    created_at: row.get(12)?,
                    content_snippet: row.get(13)?,
                    is_broken: row.get::<_, i32>(14)? == 1,
                    file_hash: row.get(15)?,
                })
            })
            .map_err(|e| e.to_string())?;
        items
            .collect::<Result<Vec<_>, _>>()
            .map_err(|e| e.to_string())?
    };

    let valid = tokio::task::spawn_blocking(move || {
        let mut result = Vec::new();
        for mut a in assets {
            if Path::new(&a.original_path).exists() {
                if let Ok(meta) = extract_metadata(Path::new(&a.original_path)) {
                    a.metadata = meta;
                }
                for tag in a.kind.default_tags() {
                    if !a.tags.contains(&tag) {
                        a.tags.push(tag);
                    }
                }
                if a.kind == AssetKind::Image {
                    let thumb_missing = a
                        .preview_path
                        .as_ref()
                        .map(|p| !Path::new(p).exists())
                        .unwrap_or(true);
                    if thumb_missing {
                        if let Ok(img) = image::open(&a.original_path) {
                            a.preview_path = save_thumbnail(&img, &a.id, &config);
                        }
                    }
                }
                if a.file_hash.is_none() || a.file_hash.as_deref() == Some("") {
                    a.file_hash = compute_file_hash(Path::new(&a.original_path)).ok();
                }
                result.push(a);
            }
        }
        Ok::<Vec<Asset>, String>(result)
    })
    .await
    .unwrap_or_else(|e| Err(format!("Task panicked: {}", e)))?;

    let mut conn = state.db.lock().map_err(|e| e.to_string())?;
    let tx = conn.transaction().map_err(|e| e.to_string())?;

    tx.execute("DELETE FROM assets", ())
        .map_err(|e| e.to_string())?;
    for a in valid {
        let tags_json = serde_json::to_string(&a.tags).unwrap_or_default();
        let color_json = serde_json::to_string(&a.dominant_colors).unwrap_or_default();
        let _ = tx.execute(
            "INSERT INTO assets (id, original_path, preview_path, kind, dominant_colors, tags, size_bytes, file_name, extension, last_modified_os, width, height, created_at, content_snippet, is_broken, file_hash)
             VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11, ?12, ?13, ?14, ?15, ?16)",
            params![
                a.id, a.original_path, a.preview_path, format!("{:?}", a.kind),
                color_json, tags_json, a.metadata.size_bytes, a.metadata.file_name,
                a.metadata.extension, a.metadata.last_modified_os, a.width, a.height,
                a.created_at, a.content_snippet, if a.is_broken { 1 } else { 0 },
                a.file_hash
            ],
        );
    }
    tx.commit().map_err(|e| e.to_string())?;

    Ok(())
}

#[tauri::command]
async fn recalculate_colors(state: State<'_, AppState>) -> Result<usize, String> {
    let targets: Vec<(String, String)> = {
        let conn = state.db.lock().map_err(|e| e.to_string())?;
        let mut stmt = conn.prepare("SELECT id, original_path FROM assets WHERE dominant_colors IS NULL OR dominant_colors = '[]' OR dominant_colors = ''").map_err(|e| e.to_string())?;
        let rows = stmt
            .query_map((), |row| {
                Ok((row.get::<_, String>(0)?, row.get::<_, String>(1)?))
            })
            .map_err(|e| e.to_string())?;

        rows.filter_map(|r| r.ok()).collect()
    };

    let color_updates = tokio::task::spawn_blocking(move || {
        let mut updates = Vec::new();
        for (id, path_str) in targets {
            let path = Path::new(&path_str);
            if path.exists() {
                if let Ok(img) = image::open(path) {
                    let colors = extract_colors(&img);
                    updates.push((id, serde_json::to_string(&colors).unwrap_or_default()));
                }
            }
        }
        updates
    })
    .await
    .map_err(|e| e.to_string())?;

    let updated_count = color_updates.len();

    let mut conn = state.db.lock().map_err(|e| e.to_string())?;
    let tx = conn.transaction().map_err(|e| e.to_string())?;
    for (id, colors_json) in color_updates {
        let _ = tx.execute(
            "UPDATE assets SET dominant_colors = ?1 WHERE id = ?2",
            rusqlite::params![colors_json, id],
        );
    }
    tx.commit().map_err(|e| e.to_string())?;

    Ok(updated_count)
}

#[tauri::command]
async fn update_asset_tags(
    state: State<'_, AppState>,
    id: String,
    tags: Vec<String>,
) -> Result<(), String> {
    let tags_json = serde_json::to_string(&tags).map_err(|e| e.to_string())?;
    let conn = state.db.lock().map_err(|e| e.to_string())?;
    conn.execute(
        "UPDATE assets SET tags = ?1 WHERE id = ?2",
        params![tags_json, id],
    )
    .map_err(|e| e.to_string())?;
    Ok(())
}

#[tauri::command]
async fn delete_asset(state: State<'_, AppState>, id: String) -> Result<(), String> {
    let conn = state.db.lock().map_err(|e| e.to_string())?;

    let preview_path: Option<String> = conn
        .query_row(
            "SELECT preview_path FROM assets WHERE id = ?1",
            params![id],
            |row| row.get(0),
        )
        .ok();

    if let Some(path) = preview_path {
        let _ = fs::remove_file(path);
    }

    conn.execute("DELETE FROM assets WHERE id = ?1", params![id])
        .map_err(|e| e.to_string())?;
    Ok(())
}

#[tauri::command]
async fn rename_asset(
    state: State<'_, AppState>,
    id: String,
    new_name: String,
) -> Result<(), String> {
    let conn = state.db.lock().map_err(|e| e.to_string())?;
    conn.execute(
        "UPDATE assets SET file_name = ?1 WHERE id = ?2",
        params![new_name, id],
    )
    .map_err(|e| e.to_string())?;
    Ok(())
}

#[tauri::command]
async fn open_in_folder(path: String) -> Result<(), String> {
    use std::process::Command;

    #[cfg(target_os = "windows")]
    Command::new("explorer")
        .arg("/select,")
        .arg(&path)
        .spawn()
        .map_err(|e| e.to_string())?;

    #[cfg(target_os = "macos")]
    Command::new("open")
        .arg("-R")
        .arg(&path)
        .spawn()
        .map_err(|e| e.to_string())?;

    #[cfg(target_os = "linux")]
    Command::new("xdg-open")
        .arg(Path::new(&path).parent().unwrap_or(Path::new("/")))
        .spawn()
        .map_err(|e| e.to_string())?;

    Ok(())
}

#[tauri::command]
async fn read_full_text_file(path: String) -> Result<String, String> {
    use std::io::Read;
    let mut handle = fs::File::open(&path)
        .map_err(|e| e.to_string())?
        .take(2 * 1024 * 1024);
    let mut buffer = Vec::new();
    handle.read_to_end(&mut buffer).map_err(|e| e.to_string())?;

    let was_truncated = buffer.len() == 2 * 1024 * 1024;
    let mut text = String::from_utf8_lossy(&buffer).into_owned();

    if was_truncated {
        text.push_str("\n\n[... file truncated at 2MB ...]");
    }

    Ok(text)
}

#[tauri::command]
fn resolve_path(path: String) -> Result<String, String> {
    let p = Path::new(&path);
    let abs = if p.is_absolute() {
        p.to_path_buf()
    } else {
        std::env::current_dir().map_err(|e| e.to_string())?.join(p)
    };
    Ok(abs.to_string_lossy().into_owned())
}

fn copy_file_to_os_clipboard(path: &str) -> Result<(), String> {
    #[cfg(target_os = "windows")]
    {
        use std::process::Command;
        // PowerShell command to copy a file to the clipboard (as a file/HDROP, not text)
        let script = format!("Set-Clipboard -Path '{}'", path.replace("'", "''"));
        let output = Command::new("powershell")
            .args(["-NoProfile", "-Command", &script])
            .output()
            .map_err(|e| e.to_string())?;

        if output.status.success() {
            Ok(())
        } else {
            let err = String::from_utf8_lossy(&output.stderr);
            Err(format!("PowerShell failed: {}", err))
        }
    }

    #[cfg(not(target_os = "windows"))]
    {
        Err("File copy only supported on Windows for now".to_string())
    }
}

#[tauri::command]
async fn copy_text_to_clipboard(state: State<'_, AppState>, text: String) -> Result<(), String> {
    let mut clipboard = state.clipboard.lock().map_err(|e| e.to_string())?;
    clipboard.set_text(text).map_err(|e| e.to_string())?;
    Ok(())
}

#[tauri::command]
async fn copy_image_to_clipboard(_state: State<'_, AppState>, path: String) -> Result<(), String> {
    copy_file_to_os_clipboard(&path)
}

#[tauri::command]
fn show_window(window: tauri::Window) {
    let _ = window.show();
}

/// Returns only paths that are NOT already tracked in the library by their original_path.
/// This is used to silently block internal drag-and-drops (card → app) before the import modal appears.
#[tauri::command]
fn filter_known_paths(
    state: State<'_, AppState>,
    paths: Vec<String>,
) -> Result<Vec<String>, String> {
    let conn = state.db.lock().map_err(|e| e.to_string())?;
    let mut unknown = Vec::new();
    for path in paths {
        let exists: bool = conn
            .query_row(
                "SELECT 1 FROM assets WHERE original_path = ?1 LIMIT 1",
                rusqlite::params![path],
                |_| Ok(true),
            )
            .unwrap_or(false);
        if !exists {
            unknown.push(path);
        }
    }
    Ok(unknown)
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .setup(|app| {
            let config = get_config(&app.handle())?;
            let db = init_db(&config)?;
            let clipboard = Clipboard::new().map_err(|e| e.to_string())?;
            app.manage(AppState {
                config,
                db: Mutex::new(db),
                clipboard: Mutex::new(clipboard),
            });
            Ok(())
        })
        .plugin(tauri_plugin_drag::init())
        .plugin(tauri_plugin_clipboard_manager::init())
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_fs::init())
        .plugin(tauri_plugin_opener::init())
        .invoke_handler(tauri::generate_handler![
            copy_image_to_clipboard,
            copy_text_to_clipboard,
            copy_to_local_library,
            prepare_dropped_paths,
            check_import_paths,
            process_asset,
            get_library,
            recalculate_db,
            recalculate_colors,
            get_top_tags,
            update_asset_tags,
            delete_asset,
            rename_asset,
            open_in_folder,
            read_full_text_file,
            resolve_path,
            show_window,
            filter_known_paths,
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}

fn get_video_dimensions(path: &Path) -> (u32, u32) {
    use std::process::Command;

    let path_str = path.to_string_lossy();

    let ffprobe_res = Command::new("ffprobe")
        .args(&[
            "-v",
            "error",
            "-select_streams",
            "v:0",
            "-show_entries",
            "stream=width,height",
            "-of",
            "csv=s=x:p=0",
            &path_str,
        ])
        .output();

    if let Ok(output) = ffprobe_res {
        let s = String::from_utf8_lossy(&output.stdout);
        let dims: Vec<&str> = s.trim().split('x').collect();
        if dims.len() == 2 {
            let w = dims[0].parse().unwrap_or(0);
            let h = dims[1].parse().unwrap_or(0);
            if w > 0 && h > 0 {
                return (w, h);
            }
        }
    }

    (1920, 1080)
}

fn generate_video_thumbnail(
    video_path: &Path,
    asset_id: &str,
    config: &AppConfig,
) -> Option<String> {
    use std::process::Command;

    let thumb_path = Path::new(&config.library_path)
        .join("thumbnails")
        .join(format!("{}.jpg", asset_id));

    let video_path_str = video_path.to_string_lossy();
    let thumb_path_str = thumb_path.to_string_lossy();

    let res = Command::new("ffmpeg")
        .args(&[
            "-i",
            &video_path_str,
            "-ss",
            "00:00:01",
            "-vframes",
            "1",
            "-q:v",
            "2",
            "-y",
            &thumb_path_str,
        ])
        .output();

    if res.is_ok() && thumb_path.exists() {
        Some(thumb_path.to_string_lossy().into_owned())
    } else {
        None
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn get_test_config() -> AppConfig {
        let lib_path = "./.test_splatera_library".to_string();
        fs::create_dir_all(format!("{}/thumbnails", &lib_path)).unwrap_or_default();
        AppConfig {
            library_path: lib_path,
            theme_mode: "dark".to_string(),
            thumbnail_size: 400,
        }
    }

    #[test]
    fn test_file_type_detection() {
        let config = get_test_config();
        let path = Path::new("test_file.py");
        fs::write(path, "print('hello')").unwrap();

        let asset = process_single_path(path, &config).unwrap();
        assert_eq!(asset.kind, AssetKind::Code);
        assert!(asset.tags.contains(&"py".to_string()));
        assert!(asset.tags.contains(&"code".to_string()));

        fs::remove_file(path).unwrap();
    }

    #[test]
    fn test_color_extraction() {
        use image::{ImageBuffer, Rgb};
        let img = ImageBuffer::from_fn(100, 100, |_, _| Rgb([255u8, 0u8, 0u8]));
        let dynamic = image::DynamicImage::ImageRgb8(img);
        let colors = extract_colors(&dynamic);

        assert!(!colors.is_empty());
        let dominant = &colors[0];
        assert!(dominant.starts_with('#'));
    }
}
