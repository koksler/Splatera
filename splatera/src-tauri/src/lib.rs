mod processing;
use crate::processing::{
    color_distance, compute_file_hash, extract_colors, extract_metadata, generate_video_thumbnail,
    get_video_dimensions, hex_to_rgb, locate_moved_file, read_text_snippet, save_thumbnail,
    Asset, AssetKind, FileMetadata, SimplifiedAsset,
};

use arboard::Clipboard;
use rusqlite::{params, Connection};
use serde::{Deserialize, Serialize};
use std::collections::HashMap;
use std::env;
use std::fs;
use std::path::{Path, PathBuf};
use std::sync::Mutex;
use tauri::{Emitter, Manager, State};
use uuid::Uuid;

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct RegenerateAssetResult {
    pub asset: SimplifiedAsset,
    pub hash_changed: bool,
    pub relocated: bool,
    pub old_path: String,
    pub new_path: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct RecalculateDbResult {
    pub total: usize,
    pub updated: usize,
    pub relocated: usize,
    pub broken: usize,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct BatchProgressPayload {
    pub op_type: String,
    pub current: usize,
    pub total: usize,
    pub message: String,
    pub asset_name: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct DeleteOperationData {
    pub id: String,
    pub original_path: String,
    pub preview_path: Option<String>,
    pub kind: String,
    pub dominant_colors: Option<String>,
    pub tags: Option<String>,
    pub size_bytes: Option<u64>,
    pub file_name: Option<String>,
    pub extension: Option<String>,
    pub last_modified_os: Option<u64>,
    pub width: Option<u32>,
    pub height: Option<u32>,
    pub created_at: Option<u64>,
    pub content_snippet: Option<String>,
    pub is_broken: Option<i32>,
    pub file_hash: Option<String>,
    pub deleted_from_device: bool,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ImportOperationData {
    pub asset_ids: Vec<String>,
    pub copied_paths: Vec<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct UndoResult {
    pub op_type: String,
    pub count: usize,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct AppConfig {
    pub library_path: String,
    pub theme_mode: String,
    pub thumbnail_size: u32,
    pub gpu_acceleration: bool,
    pub local_storage_path: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct OnboardingStatus {
    pub needs_onboarding: bool,
    pub default_portable_path: String,
    pub default_standard_path: String,
    pub default_local_portable: String,
    pub default_local_standard: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct CompleteOnboardingPayload {
    pub theme_mode: String,
    pub setup_mode: String,
    pub masonry_type: String,
    pub local_storage_path: Option<String>,
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

pub fn get_library_paths(app: &tauri::AppHandle) -> Result<(PathBuf, PathBuf), String> {
    #[cfg(target_os = "linux")]
    {
        let app_dir = app.path().app_data_dir().map_err(|e| e.to_string())?;
        Ok((app_dir.join(".splatera_library"), app_dir.join(".splatera_library")))
    }

    #[cfg(not(target_os = "linux"))]
    {
        let exe_path = env::current_exe().map_err(|e| e.to_string())?;
        let exe_dir = exe_path.parent().ok_or("Cannot determine exe directory")?;
        let app_dir = app.path().app_data_dir().map_err(|e| e.to_string())?;
        Ok((exe_dir.join(".splatera_library"), app_dir.join(".splatera_library")))
    }
}

fn get_config(app: &tauri::AppHandle) -> Result<(AppConfig, bool), String> {
    let (portable_lib, standard_lib) = get_library_paths(app)?;

    let (lib_path, is_onboarded) = if portable_lib.exists() {
        (portable_lib, true)
    } else if standard_lib.exists() {
        (standard_lib, true)
    } else {
        (standard_lib, false)
    };

    let mut thumb_size = 400;
    let mut gpu_accel = true;
    let mut theme_mode = "dark".to_string();
    let mut local_storage = None;

    if is_onboarded {
        fs::create_dir_all(&lib_path).unwrap_or_default();
        fs::create_dir_all(lib_path.join("thumbnails")).unwrap_or_default();
        fs::create_dir_all(lib_path.join("local")).unwrap_or_default();

        let settings_file = lib_path.join("settings.json");
        if settings_file.exists() {
            if let Ok(content) = fs::read_to_string(&settings_file) {
                if let Ok(val) = serde_json::from_str::<serde_json::Value>(&content) {
                    if let Some(ts) = val.get("thumbnailSize").and_then(|v| v.as_u64()) {
                        thumb_size = ts as u32;
                    }
                    if let Some(ga) = val.get("gpuAcceleration").and_then(|v| v.as_bool()) {
                        gpu_accel = ga;
                    }
                    if let Some(tm) = val.get("themeMode").and_then(|v| v.as_str()) {
                        theme_mode = tm.to_string();
                    }
                    if let Some(lsp) = val.get("localStoragePath").and_then(|v| v.as_str()) {
                        if !lsp.trim().is_empty() {
                            local_storage = Some(lsp.trim().to_string());
                        }
                    }
                }
            }
        }
    }

    #[cfg(target_os = "windows")]
    if !gpu_accel {
        std::env::set_var("WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS", "--disable-gpu --disable-gpu-compositing");
    }

    Ok((
        AppConfig {
            library_path: lib_path.to_string_lossy().into_owned(),
            theme_mode,
            thumbnail_size: thumb_size,
            gpu_acceleration: gpu_accel,
            local_storage_path: local_storage,
        },
        is_onboarded,
    ))
}

pub struct AppState {
    pub config: Mutex<AppConfig>,
    pub db: Mutex<Connection>,
    pub clipboard: Mutex<Clipboard>,
}

impl AppState {
    pub fn config(&self) -> AppConfig {
        self.config.lock().unwrap().clone()
    }
}

fn get_db_path(config: &AppConfig) -> PathBuf {
    Path::new(&config.library_path).join("database.db")
}

fn setup_db_tables(conn: &Connection) -> Result<(), String> {
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
        "CREATE TABLE IF NOT EXISTS operation_log (
            id TEXT PRIMARY KEY,
            op_type TEXT NOT NULL,
            timestamp INTEGER NOT NULL,
            details_json TEXT NOT NULL
        )",
        (),
    );

    Ok(())
}

fn init_db(config: &AppConfig) -> Result<Connection, String> {
    let db_path = get_db_path(config);
    let conn = Connection::open(db_path).map_err(|e| e.to_string())?;
    setup_db_tables(&conn)?;
    Ok(conn)
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

    let limit = query.limit.unwrap_or(50) as usize;
    let offset = query.offset.unwrap_or(0) as usize;
    let has_color_filter = query.color.is_some();
    if !has_color_filter {
        sql.push_str(&format!(" LIMIT {} OFFSET {}", limit, offset));
    }

    let mut stmt = conn.prepare(&sql).map_err(|e| e.to_string())?;
    let mut rows = stmt
        .query(rusqlite::params_from_iter(params_vec))
        .map_err(|e| e.to_string())?;

    let mut results = Vec::new();
    let lib_path_buf = state.config().library_path;
    let lib_path = Path::new(&lib_path_buf);

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

        let original_path: String = row.get(1).unwrap_or_default();
        let mut preview_path: Option<String> = row.get(2).ok();
        if let Some(ref preview) = preview_path {
            let p = if preview.starts_with("./") {
                lib_path.join(&preview[2..])
            } else {
                Path::new(preview).to_path_buf()
            };
            if !p.exists() {
                preview_path = Some(original_path.clone());
            } else {
                preview_path = Some(p.to_string_lossy().into_owned());
            }
        } else {
            preview_path = Some(original_path.clone());
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

    // Apply pagination in Rust for color-filtered results
    if has_color_filter {
        results = results.into_iter().skip(offset).take(limit).collect();
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

#[derive(Debug, Clone, Serialize)]
struct TagPreview {
    tag: String,
    count: usize,
    preview_path: Option<String>,
}

#[tauri::command]
fn get_tag_previews(state: State<'_, AppState>) -> Result<Vec<TagPreview>, String> {
    let conn = state.db.lock().map_err(|e| e.to_string())?;
    let mut stmt = conn
        .prepare("SELECT tags, preview_path, original_path FROM assets ORDER BY created_at DESC")
        .map_err(|e| e.to_string())?;
    let mut rows = stmt.query(()).map_err(|e| e.to_string())?;

    let mut counts: HashMap<String, usize> = HashMap::new();
    let mut previews: HashMap<String, Vec<String>> = HashMap::new();

    while let Some(row) = rows.next().map_err(|e| e.to_string())? {
        let tags_json: String = row.get(0).unwrap_or("[]".to_string());
        let preview_path: Option<String> = row.get(1).ok();
        let original_path: Option<String> = row.get(2).ok();
        let best_path = preview_path.or(original_path);

        let tags: Vec<String> = serde_json::from_str(&tags_json).unwrap_or_default();
        for tag in tags {
            let upper = tag.to_uppercase();
            *counts.entry(upper.clone()).or_insert(0) += 1;
            if let Some(ref p) = best_path {
                previews.entry(upper).or_default().push(p.clone());
            }
        }
    }

    let mut sorted: Vec<TagPreview> = counts
        .into_iter()
        .map(|(tag, count)| {
            let paths = previews.get(&tag);
            let preview_path = paths.and_then(|v| {
                if v.is_empty() {
                    None
                } else {
                    // Seed a simple LCG pseudo-random generator with a hash of tag + count + length
                    let mut seed = count as u64;
                    for c in tag.chars() {
                        seed = seed.wrapping_add(c as u64).wrapping_mul(31);
                    }
                    let rand_val = seed.wrapping_mul(6364136223846793005).wrapping_add(1442695040888963407);
                    let idx = (rand_val % v.len() as u64) as usize;
                    Some(v[idx].clone())
                }
            });
            TagPreview {
                preview_path,
                tag,
                count,
            }
        })
        .collect();
    sorted.sort_by(|a, b| b.count.cmp(&a.count));
    Ok(sorted)
}

#[tauri::command]
fn get_asset_count_for_tag(state: State<'_, AppState>, tag: String) -> Result<usize, String> {
    let tag_upper = tag.to_uppercase();
    let conn = state.db.lock().map_err(|e| e.to_string())?;
    let mut stmt = conn
        .prepare("SELECT tags FROM assets")
        .map_err(|e| e.to_string())?;
    let mut rows = stmt.query(()).map_err(|e| e.to_string())?;
    
    let mut count = 0;
    while let Some(row) = rows.next().map_err(|e| e.to_string())? {
        let tags_json: String = row.get(0).unwrap_or_else(|_| "[]".to_string());
        let tags: Vec<String> = serde_json::from_str(&tags_json).unwrap_or_default();
        if tags.iter().any(|t| t.to_uppercase() == tag_upper) {
            count += 1;
        }
    }
    Ok(count)
}

#[tauri::command]
fn delete_tag_globally(state: State<'_, AppState>, tag: String) -> Result<(), String> {
    let tag_upper = tag.to_uppercase();
    let mut conn = state.db.lock().map_err(|e| e.to_string())?;
    let tx = conn.transaction().map_err(|e| e.to_string())?;
    
    let mut stmt = tx
        .prepare("SELECT id, tags FROM assets")
        .map_err(|e| e.to_string())?;
    let mut rows = stmt.query(()).map_err(|e| e.to_string())?;

    let mut to_update = Vec::new();
    while let Some(row) = rows.next().map_err(|e| e.to_string())? {
        let id: String = row.get(0).map_err(|e| e.to_string())?;
        let tags_json: String = row.get(1).unwrap_or_else(|_| "[]".to_string());
        let mut tags: Vec<String> = serde_json::from_str(&tags_json).unwrap_or_default();
        
        let old_len = tags.len();
        tags.retain(|t| t.to_uppercase() != tag_upper);
        if tags.len() < old_len {
            let new_json = serde_json::to_string(&tags).map_err(|e| e.to_string())?;
            to_update.push((id, new_json));
        }
    }
    drop(rows);
    drop(stmt);

    for (id, new_json) in to_update {
        tx.execute(
            "UPDATE assets SET tags = ?1 WHERE id = ?2",
            params![new_json, id],
        )
        .map_err(|e| e.to_string())?;
    }

    tx.commit().map_err(|e| e.to_string())?;
    Ok(())
}

#[tauri::command]
async fn delete_tag_and_assets(state: State<'_, AppState>, tag: String) -> Result<(), String> {
    let tag_upper = tag.to_uppercase();
    let mut conn = state.db.lock().map_err(|e| e.to_string())?;
    
    let mut stmt = conn
        .prepare("SELECT id, tags FROM assets")
        .map_err(|e| e.to_string())?;
    let mut rows = stmt.query(()).map_err(|e| e.to_string())?;
    
    let mut ids_to_delete = Vec::new();
    while let Some(row) = rows.next().map_err(|e| e.to_string())? {
        let id: String = row.get(0).map_err(|e| e.to_string())?;
        let tags_json: String = row.get(1).unwrap_or_else(|_| "[]".to_string());
        let tags: Vec<String> = serde_json::from_str(&tags_json).unwrap_or_default();
        if tags.iter().any(|t| t.to_uppercase() == tag_upper) {
            ids_to_delete.push(id);
        }
    }
    drop(rows);
    drop(stmt);
    
    let tx = conn.transaction().map_err(|e| e.to_string())?;
    for id in ids_to_delete {
        let asset_data = tx.query_row(
            "SELECT id, original_path, preview_path, kind, dominant_colors, tags, size_bytes, file_name, extension, last_modified_os, width, height, created_at, content_snippet, is_broken, file_hash FROM assets WHERE id = ?1",
            params![id],
            |row| {
                Ok(DeleteOperationData {
                    id: row.get(0)?,
                    original_path: row.get(1)?,
                    preview_path: row.get(2)?,
                    kind: row.get(3)?,
                    dominant_colors: row.get(4)?,
                    tags: row.get(5)?,
                    size_bytes: row.get(6)?,
                    file_name: row.get(7)?,
                    extension: row.get(8)?,
                    last_modified_os: row.get(9)?,
                    width: row.get(10)?,
                    height: row.get(11)?,
                    created_at: row.get(12)?,
                    content_snippet: row.get(13)?,
                    is_broken: row.get(14)?,
                    file_hash: row.get(15)?,
                    deleted_from_device: false,
                })
            },
        ).ok();
        
        if let Some(data) = asset_data {
            let op_id = format!("op_{}", Uuid::new_v4());
            let details_json = serde_json::to_string(&data).unwrap_or_default();
            let timestamp = std::time::SystemTime::now()
                .duration_since(std::time::UNIX_EPOCH)
                .unwrap_or_default()
                .as_secs();
            let _ = tx.execute(
                "INSERT INTO operation_log (id, op_type, timestamp, details_json) VALUES (?1, 'delete', ?2, ?3)",
                params![op_id, timestamp, details_json],
            );
        }
        
        tx.execute("DELETE FROM assets WHERE id = ?1", params![id]).map_err(|e| e.to_string())?;
    }
    tx.commit().map_err(|e| e.to_string())?;
    Ok(())
}

#[tauri::command]
async fn regenerate_asset(
    _app: tauri::AppHandle,
    state: State<'_, AppState>,
    id: String,
    new_path: Option<String>,
) -> Result<RegenerateAssetResult, String> {
    let config = state.config();
    let config_clone = config.clone();

    // 1. Fetch current asset row from SQLite
    let (old_orig_path, old_preview_path, kind_str, file_hash, tags_json, created_at, content_snippet) = {
        let conn = state.db.lock().map_err(|e| e.to_string())?;
        conn.query_row(
            "SELECT original_path, preview_path, kind, file_hash, tags, created_at, content_snippet FROM assets WHERE id = ?1",
            params![id],
            |row| {
                Ok((
                    row.get::<_, String>(0)?,
                    row.get::<_, Option<String>>(1)?,
                    row.get::<_, String>(2)?,
                    row.get::<_, Option<String>>(3)?,
                    row.get::<_, String>(4)?,
                    row.get::<_, u64>(5)?,
                    row.get::<_, Option<String>>(6)?,
                ))
            },
        )
        .map_err(|e| format!("Asset not found in database: {}", e))?
    };

    let kind = match kind_str.as_str() {
        "Image" => AssetKind::Image,
        "Video" => AssetKind::Video,
        "Text" => AssetKind::Text,
        "Code" => AssetKind::Code,
        _ => AssetKind::Unknown,
    };
    let tags: Vec<String> = serde_json::from_str(&tags_json).unwrap_or_default();

    // 2. Determine target path and whether relocated
    let mut relocated = false;
    let target_path_buf = if let Some(ref np) = new_path {
        relocated = true;
        PathBuf::from(np)
    } else {
        let p = PathBuf::from(&old_orig_path);
        if !p.exists() {
            let custom_local = config.local_storage_path.as_deref().map(Path::new);
            if let Some(found) = locate_moved_file(&p, file_hash.as_deref(), Path::new(&config.library_path), custom_local) {
                relocated = true;
                found
            } else {
                return Err("FILE_NOT_FOUND".to_string());
            }
        } else {
            p
        }
    };

    if !target_path_buf.exists() {
        return Err("FILE_NOT_FOUND".to_string());
    }

    let target_path_str = target_path_buf.to_string_lossy().into_owned();
    let id_clone = id.clone();
    let old_preview_clone = old_preview_path.clone();
    let kind_clone = kind.clone();

    // 3. Process in spawn_blocking
    let process_result = tokio::task::spawn_blocking(move || {
        let meta = extract_metadata(&target_path_buf).map_err(|e| format!("Metadata extraction failed: {}", e))?;
        let new_hash = compute_file_hash(&target_path_buf).map_err(|e| format!("Hash computation failed: {}", e))?;

        let hash_changed = match &file_hash {
            Some(old_h) if !old_h.is_empty() => old_h != &new_hash,
            _ => false,
        };

        let mut width = 0;
        let mut height = 0;
        let mut dominant_colors = Vec::new();
        let mut preview_path = old_preview_clone;
        let mut new_content_snippet = content_snippet;

        match kind_clone {
            AssetKind::Image => {
                if let Ok(img) = image::open(&target_path_buf) {
                    width = img.width();
                    height = img.height();
                    dominant_colors = extract_colors(&img);
                    if let Some(thumb) = save_thumbnail(&img, &id_clone, &config_clone) {
                        preview_path = Some(thumb);
                    }
                }
            }
            AssetKind::Video => {
                let (w, h) = get_video_dimensions(&target_path_buf);
                width = w;
                height = h;
                if let Some(thumb) = generate_video_thumbnail(&target_path_buf, &id_clone, &config_clone) {
                    preview_path = Some(thumb);
                }
            }
            AssetKind::Text | AssetKind::Code => {
                if let Some(snip) = read_text_snippet(&target_path_buf) {
                    new_content_snippet = Some(snip);
                }
            }
            AssetKind::Unknown => {}
        }

        Ok::<(FileMetadata, String, bool, u32, u32, Vec<String>, Option<String>, Option<String>), String>((
            meta,
            new_hash,
            hash_changed,
            width,
            height,
            dominant_colors,
            preview_path,
            new_content_snippet,
        ))
    })
    .await
    .map_err(|e| format!("Task failed: {}", e))??;

    let (meta, new_hash, hash_changed, width, height, dominant_colors, preview_path, new_snippet) = process_result;

    // 4. Update database row
    {
        let conn = state.db.lock().map_err(|e| e.to_string())?;
        let colors_json = serde_json::to_string(&dominant_colors).unwrap_or_default();
        conn.execute(
            "UPDATE assets SET 
                original_path = ?1,
                preview_path = ?2,
                dominant_colors = ?3,
                size_bytes = ?4,
                file_name = ?5,
                extension = ?6,
                last_modified_os = ?7,
                width = ?8,
                height = ?9,
                content_snippet = ?10,
                is_broken = 0,
                file_hash = ?11
             WHERE id = ?12",
            params![
                target_path_str,
                preview_path,
                colors_json,
                meta.size_bytes,
                meta.file_name,
                meta.extension,
                meta.last_modified_os,
                width,
                height,
                new_snippet,
                new_hash,
                id
            ],
        )
        .map_err(|e| format!("Database update failed: {}", e))?;
    }

    println!(
        "[Regenerate Asset] '{}' (ID: {}) updated. Relocated: {}, Hash changed: {} (hash: {})",
        meta.file_name, id, relocated, hash_changed, new_hash
    );

    let simplified = SimplifiedAsset {
        id,
        original_path: target_path_str.clone(),
        preview_path,
        kind,
        tags,
        file_name: meta.file_name,
        width,
        height,
        created_at,
        last_modified_os: meta.last_modified_os,
        content_snippet: new_snippet,
        is_broken: false,
        file_hash: Some(new_hash),
    };

    Ok(RegenerateAssetResult {
        asset: simplified,
        hash_changed,
        relocated,
        old_path: old_orig_path,
        new_path: target_path_str,
    })
}

#[tauri::command]
async fn recalculate_db(app: tauri::AppHandle, state: State<'_, AppState>) -> Result<RecalculateDbResult, String> {
    let config = state.config();
    let config_clone = config.clone();

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

    let total = assets.len();
    let app_clone = app.clone();

    let (valid, updated_count, relocated_count, broken_count) = tokio::task::spawn_blocking(move || {
        let mut result = Vec::new();
        let mut updated = 0usize;
        let mut relocated = 0usize;
        let mut broken = 0usize;

        for (idx, mut a) in assets.into_iter().enumerate() {
            let mut orig_path = PathBuf::from(&a.original_path);
            let mut was_relocated = false;

            if !orig_path.exists() {
                let custom_local = config_clone.local_storage_path.as_deref().map(Path::new);
                if let Some(found) = locate_moved_file(&orig_path, a.file_hash.as_deref(), Path::new(&config_clone.library_path), custom_local) {
                    a.original_path = found.to_string_lossy().into_owned();
                    orig_path = found;
                    a.is_broken = false;
                    relocated += 1;
                    was_relocated = true;
                    println!("[Recalculate DB] Relocated '{}' to '{}'", a.metadata.file_name, a.original_path);
                } else {
                    a.is_broken = true;
                    broken += 1;
                    println!("[Recalculate DB] Missing asset '{}' at '{}'", a.metadata.file_name, a.original_path);
                }
            } else {
                a.is_broken = false;
            }

            if orig_path.exists() {
                if let Ok(meta) = extract_metadata(&orig_path) {
                    a.metadata = meta;
                }
                for tag in a.kind.default_tags() {
                    if !a.tags.contains(&tag) {
                        a.tags.push(tag);
                    }
                }
                if a.kind == AssetKind::Image {
                    if let Ok(img) = image::open(&orig_path) {
                        if a.width == 0 || a.height == 0 {
                            a.width = img.width();
                            a.height = img.height();
                        }
                        if a.dominant_colors.is_empty() {
                            a.dominant_colors = extract_colors(&img);
                        }
                        let needs_thumb = match &a.preview_path {
                            Some(p) => !Path::new(p).exists(),
                            None => true,
                        };
                        if needs_thumb {
                            if let Some(new_thumb) = save_thumbnail(&img, &a.id, &config_clone) {
                                a.preview_path = Some(new_thumb);
                            }
                        }
                    }
                } else if a.kind == AssetKind::Video {
                    if a.width == 0 || a.height == 0 {
                        let (w, h) = get_video_dimensions(&orig_path);
                        a.width = w;
                        a.height = h;
                    }
                    let needs_thumb = match &a.preview_path {
                        Some(p) => !Path::new(p).exists(),
                        None => true,
                    };
                    if needs_thumb {
                        if let Some(new_thumb) = generate_video_thumbnail(&orig_path, &a.id, &config_clone) {
                            a.preview_path = Some(new_thumb);
                        }
                    }
                }
                if a.file_hash.is_none() || a.file_hash.as_deref() == Some("") || was_relocated {
                    a.file_hash = compute_file_hash(&orig_path).ok();
                }
                updated += 1;
            }

            let _ = app_clone.emit("batch-progress", BatchProgressPayload {
                op_type: "recalculate_db".to_string(),
                current: idx + 1,
                total,
                message: format!("Processing {} of {} assets...", idx + 1, total),
                asset_name: Some(a.metadata.file_name.clone()),
            });

            println!("[Recalculate DB] [{}/{}] Processing '{}'...", idx + 1, total, a.metadata.file_name);

            result.push(a);
        }

        (result, updated, relocated, broken)
    })
    .await
    .map_err(|e| format!("Task panicked: {}", e))?;

    let mut conn = state.db.lock().map_err(|e| e.to_string())?;
    let tx = conn.transaction().map_err(|e| e.to_string())?;

    for a in &valid {
        let tags_json = serde_json::to_string(&a.tags).unwrap_or_default();
        let color_json = serde_json::to_string(&a.dominant_colors).unwrap_or_default();
        let _ = tx.execute(
            "UPDATE assets SET 
                original_path = ?1,
                preview_path = ?2, 
                dominant_colors = ?3, 
                tags = ?4, 
                size_bytes = ?5, 
                file_name = ?6, 
                extension = ?7, 
                last_modified_os = ?8, 
                width = ?9, 
                height = ?10, 
                is_broken = ?11, 
                file_hash = ?12 
             WHERE id = ?13",
            params![
                a.original_path,
                a.preview_path,
                color_json,
                tags_json,
                a.metadata.size_bytes,
                a.metadata.file_name,
                a.metadata.extension,
                a.metadata.last_modified_os,
                a.width,
                a.height,
                if a.is_broken { 1 } else { 0 },
                a.file_hash,
                a.id
            ],
        );
    }
    tx.commit().map_err(|e| e.to_string())?;

    // Clean up orphaned thumbnail files
    let thumb_dir = Path::new(&config.library_path).join("thumbnails");
    if thumb_dir.exists() {
        let valid_ids: std::collections::HashSet<String> = {
            let mut stmt = conn.prepare("SELECT id FROM assets").map_err(|e| e.to_string())?;
            let ids = stmt.query_map((), |row| row.get::<_, String>(0)).map_err(|e| e.to_string())?;
            ids.filter_map(|r| r.ok()).collect()
        };
        if let Ok(entries) = fs::read_dir(&thumb_dir) {
            for entry in entries.flatten() {
                if let Some(stem) = entry.path().file_stem().and_then(|s| s.to_str()) {
                    if !valid_ids.contains(stem) {
                        let _ = fs::remove_file(entry.path());
                    }
                }
            }
        }
    }

    let _ = conn.execute("PRAGMA optimize", ());

    let _ = app.emit("batch-progress", BatchProgressPayload {
        op_type: "recalculate_db".to_string(),
        current: total,
        total,
        message: format!("Recalculate complete: {} updated, {} relocated, {} broken.", updated_count, relocated_count, broken_count),
        asset_name: None,
    });

    println!(
        "[Recalculate DB] Finished: {} total, {} updated, {} relocated, {} broken",
        total, updated_count, relocated_count, broken_count
    );

    Ok(RecalculateDbResult {
        total,
        updated: updated_count,
        relocated: relocated_count,
        broken: broken_count,
    })
}

#[tauri::command]
async fn regenerate_thumbnails(app: tauri::AppHandle, state: State<'_, AppState>) -> Result<usize, String> {
    let config = state.config();
    let thumb_dir = Path::new(&config.library_path).join("thumbnails");
    let _ = fs::create_dir_all(&thumb_dir);

    // 1. Clear out existing thumbnails directory from ground up
    if let Ok(entries) = fs::read_dir(&thumb_dir) {
        for entry in entries.flatten() {
            let _ = fs::remove_file(entry.path());
        }
    }

    // 2. Fetch all non-broken image and video assets
    let assets: Vec<(String, String, AssetKind)> = {
        let conn = state.db.lock().map_err(|e| e.to_string())?;
        let mut stmt = conn.prepare("SELECT id, original_path, kind FROM assets WHERE is_broken = 0").map_err(|e| e.to_string())?;
        let items = stmt.query_map((), |row| {
            let id: String = row.get(0)?;
            let path: String = row.get(1)?;
            let kind_str: String = row.get(2)?;
            let kind = match kind_str.as_str() {
                "Image" => AssetKind::Image,
                "Video" => AssetKind::Video,
                "Text" => AssetKind::Text,
                "Code" => AssetKind::Code,
                _ => AssetKind::Unknown,
            };
            Ok((id, path, kind))
        }).map_err(|e| e.to_string())?;
        items.collect::<Result<Vec<_>, _>>().map_err(|e| e.to_string())?
    };

    let total = assets.len();
    let app_clone = app.clone();

    // 3. Rebuild thumbnails in spawn_blocking
    let regenerated = tokio::task::spawn_blocking(move || {
        let mut updates = Vec::new();
        for (idx, (id, orig_path_str, kind)) in assets.into_iter().enumerate() {
            let orig_path = Path::new(&orig_path_str);
            if !orig_path.exists() {
                continue;
            }
            if kind == AssetKind::Image {
                if let Ok(img) = image::open(orig_path) {
                    if let Some(new_thumb) = save_thumbnail(&img, &id, &config) {
                        updates.push((id, new_thumb));
                    }
                }
            } else if kind == AssetKind::Video {
                if let Some(new_thumb) = generate_video_thumbnail(orig_path, &id, &config) {
                    updates.push((id, new_thumb));
                }
            }

            let file_name = orig_path.file_name().and_then(|s| s.to_str()).unwrap_or("").to_string();
            let _ = app_clone.emit("batch-progress", BatchProgressPayload {
                op_type: "regenerate_thumbnails".to_string(),
                current: idx + 1,
                total,
                message: format!("Regenerating thumbnail {} of {}...", idx + 1, total),
                asset_name: Some(file_name),
            });

            println!("[Regenerate Thumbnails] [{}/{}] Generating for {:?}", idx + 1, total, orig_path);
        }
        updates
    })
    .await
    .map_err(|e| format!("Regenerate thumbnails panicked: {}", e))?;

    let count = regenerated.len();

    // 4. Update database records
    let mut conn = state.db.lock().map_err(|e| e.to_string())?;
    let tx = conn.transaction().map_err(|e| e.to_string())?;
    for (id, thumb_path) in regenerated {
        let _ = tx.execute(
            "UPDATE assets SET preview_path = ?1 WHERE id = ?2",
            params![thumb_path, id],
        );
    }
    tx.commit().map_err(|e| e.to_string())?;

    let _ = app.emit("batch-progress", BatchProgressPayload {
        op_type: "regenerate_thumbnails".to_string(),
        current: total,
        total,
        message: format!("Rebuilt {} thumbnails from ground up.", count),
        asset_name: None,
    });

    println!("[Regenerate Thumbnails] Complete. Regenerated {} thumbnails.", count);

    Ok(count)
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
async fn delete_asset(state: State<'_, AppState>, id: String) -> Result<String, String> {
    let conn = state.db.lock().map_err(|e| e.to_string())?;

    let asset_data = conn.query_row(
        "SELECT id, original_path, preview_path, kind, dominant_colors, tags, size_bytes, file_name, extension, last_modified_os, width, height, created_at, content_snippet, is_broken, file_hash FROM assets WHERE id = ?1",
        params![id],
        |row| {
            Ok(DeleteOperationData {
                id: row.get(0)?,
                original_path: row.get(1)?,
                preview_path: row.get(2)?,
                kind: row.get(3)?,
                dominant_colors: row.get(4)?,
                tags: row.get(5)?,
                size_bytes: row.get(6)?,
                file_name: row.get(7)?,
                extension: row.get(8)?,
                last_modified_os: row.get(9)?,
                width: row.get(10)?,
                height: row.get(11)?,
                created_at: row.get(12)?,
                content_snippet: row.get(13)?,
                is_broken: row.get(14)?,
                file_hash: row.get(15)?,
                deleted_from_device: false,
            })
        },
    ).map_err(|e| format!("Asset not found: {}", e))?;

    let op_id = format!("op_{}", Uuid::new_v4());

    let details_json = serde_json::to_string(&asset_data).unwrap_or_default();
    let timestamp = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .unwrap_or_default()
        .as_secs();

    let _ = conn.execute(
        "INSERT INTO operation_log (id, op_type, timestamp, details_json) VALUES (?1, 'delete', ?2, ?3)",
        params![op_id, timestamp, details_json],
    );

    // For library-only deletion, keep thumbnail on disk so undo is seamless
    conn.execute("DELETE FROM assets WHERE id = ?1", params![id])
        .map_err(|e| e.to_string())?;

    Ok(op_id)
}

#[tauri::command]
async fn delete_asset_device(state: State<'_, AppState>, id: String) -> Result<String, String> {
    println!("[delete_asset_device] Received request to delete asset with id: '{}'", id);
    let conn = state.db.lock().map_err(|e| e.to_string())?;

    let asset_data = conn.query_row(
        "SELECT id, original_path, preview_path, kind, dominant_colors, tags, size_bytes, file_name, extension, last_modified_os, width, height, created_at, content_snippet, is_broken, file_hash FROM assets WHERE id = ?1",
        params![id],
        |row| {
            Ok(DeleteOperationData {
                id: row.get(0)?,
                original_path: row.get(1)?,
                preview_path: row.get(2)?,
                kind: row.get(3)?,
                dominant_colors: row.get(4)?,
                tags: row.get(5)?,
                size_bytes: row.get(6)?,
                file_name: row.get(7)?,
                extension: row.get(8)?,
                last_modified_os: row.get(9)?,
                width: row.get(10)?,
                height: row.get(11)?,
                created_at: row.get(12)?,
                content_snippet: row.get(13)?,
                is_broken: row.get(14)?,
                file_hash: row.get(15)?,
                deleted_from_device: true,
            })
        },
    ).map_err(|e| {
        println!("[delete_asset_device] Error looking up asset '{}': {}", id, e);
        format!("Asset not found: {}", e)
    })?;

    println!(
        "[delete_asset_device] Found asset: '{}' (path: '{}')",
        asset_data.file_name.as_deref().unwrap_or("unknown"),
        asset_data.original_path
    );

    // Remove preview thumbnail
    if let Some(ref path) = asset_data.preview_path {
        let p = Path::new(path);
        if p.exists() {
            println!("[delete_asset_device] Removing preview thumbnail at: '{:?}'", p);
            let _ = fs::remove_file(p);
        }
    }

    // Move original file to OS Trash Bin / Recycle Bin
    let orig_path = Path::new(&asset_data.original_path);
    if orig_path.exists() {
        println!("[delete_asset_device] File exists on disk. Attempting trash::delete for: '{:?}'", orig_path);
        if let Ok(meta) = fs::metadata(orig_path) {
            let mut perms = meta.permissions();
            if perms.readonly() {
                perms.set_readonly(false);
                let _ = fs::set_permissions(orig_path, perms);
            }
        }
        if let Err(e) = trash::delete(orig_path) {
            println!("[delete_asset_device] trash::delete failed ({}), falling back to remove_file", e);
            std::thread::sleep(std::time::Duration::from_millis(100));
            if let Err(retry_err) = fs::remove_file(orig_path) {
                println!("[delete_asset_device] Failed to remove file from device: {}", retry_err);
                return Err(format!("Could not move file to trash: {}", retry_err));
            }
            println!("[delete_asset_device] File successfully removed via fs::remove_file fallback.");
        } else {
            println!("[delete_asset_device] File successfully moved to OS trash.");
        }
    } else {
        println!("[delete_asset_device] File does NOT exist on disk at '{:?}' (broken/missing link). Skipping filesystem removal.", orig_path);
    }

    conn.execute("DELETE FROM assets WHERE id = ?1", params![id])
        .map_err(|e| {
            println!("[delete_asset_device] Error deleting DB record for '{}': {}", id, e);
            e.to_string()
        })?;

    println!("[delete_asset_device] Asset '{}' successfully deleted from database and device.", id);

    Ok("deleted".to_string())
}

#[tauri::command]
async fn delete_assets_batch(state: State<'_, AppState>, ids: Vec<String>) -> Result<String, String> {
    let mut conn = state.db.lock().map_err(|e| e.to_string())?;
    let mut last_op_id = String::new();
    let timestamp = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .unwrap_or_default()
        .as_secs();

    let tx = conn.transaction().map_err(|e| e.to_string())?;

    for id in &ids {
        let asset_data = tx.query_row(
            "SELECT id, original_path, preview_path, kind, dominant_colors, tags, size_bytes, file_name, extension, last_modified_os, width, height, created_at, content_snippet, is_broken, file_hash FROM assets WHERE id = ?1",
            params![id],
            |row| {
                Ok(DeleteOperationData {
                    id: row.get(0)?,
                    original_path: row.get(1)?,
                    preview_path: row.get(2)?,
                    kind: row.get(3)?,
                    dominant_colors: row.get(4)?,
                    tags: row.get(5)?,
                    size_bytes: row.get(6)?,
                    file_name: row.get(7)?,
                    extension: row.get(8)?,
                    last_modified_os: row.get(9)?,
                    width: row.get(10)?,
                    height: row.get(11)?,
                    created_at: row.get(12)?,
                    content_snippet: row.get(13)?,
                    is_broken: row.get(14)?,
                    file_hash: row.get(15)?,
                    deleted_from_device: false,
                })
            },
        ).ok();

        if let Some(data) = asset_data {
            let op_id = format!("op_{}", Uuid::new_v4());
            let details_json = serde_json::to_string(&data).unwrap_or_default();
            let _ = tx.execute(
                "INSERT INTO operation_log (id, op_type, timestamp, details_json) VALUES (?1, 'delete', ?2, ?3)",
                params![op_id, timestamp, details_json],
            );
            last_op_id = op_id;
        }

        let _ = tx.execute("DELETE FROM assets WHERE id = ?1", params![id]);
    }

    tx.commit().map_err(|e| e.to_string())?;
    Ok(last_op_id)
}

#[tauri::command]
async fn log_import_operation(
    state: State<'_, AppState>,
    asset_ids: Vec<String>,
    copied_paths: Vec<String>,
) -> Result<String, String> {
    let conn = state.db.lock().map_err(|e| e.to_string())?;
    let op_id = format!("op_{}", Uuid::new_v4());
    let data = ImportOperationData {
        asset_ids,
        copied_paths,
    };
    let details_json = serde_json::to_string(&data).unwrap_or_default();
    let timestamp = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .unwrap_or_default()
        .as_secs();

    conn.execute(
        "INSERT INTO operation_log (id, op_type, timestamp, details_json) VALUES (?1, 'import', ?2, ?3)",
        params![op_id, timestamp, details_json],
    )
    .map_err(|e| e.to_string())?;

    Ok(op_id)
}

#[tauri::command]
async fn undo_last_operation(
    state: State<'_, AppState>,
    op_id: Option<String>,
) -> Result<UndoResult, String> {
    let config = state.config();
    let conn = state.db.lock().map_err(|e| e.to_string())?;

    let row = if let Some(ref id) = op_id {
        conn.query_row(
            "SELECT id, op_type, details_json FROM operation_log WHERE id = ?1",
            params![id],
            |r| Ok((r.get::<_, String>(0)?, r.get::<_, String>(1)?, r.get::<_, String>(2)?)),
        ).ok()
    } else {
        conn.query_row(
            "SELECT id, op_type, details_json FROM operation_log ORDER BY timestamp DESC LIMIT 1",
            (),
            |r| Ok((r.get::<_, String>(0)?, r.get::<_, String>(1)?, r.get::<_, String>(2)?)),
        ).ok()
    };

    let (found_op_id, op_type, details_json) = match row {
        Some(tuple) => tuple,
        None => return Err("No operation to undo.".to_string()),
    };

    if op_type == "delete" {
        if let Ok(asset_data) = serde_json::from_str::<DeleteOperationData>(&details_json) {
            conn.execute(
                "INSERT OR REPLACE INTO assets (id, original_path, preview_path, kind, dominant_colors, tags, size_bytes, file_name, extension, last_modified_os, width, height, created_at, content_snippet, is_broken, file_hash)
                 VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11, ?12, ?13, ?14, ?15, ?16)",
                params![
                    asset_data.id,
                    asset_data.original_path,
                    asset_data.preview_path,
                    asset_data.kind,
                    asset_data.dominant_colors,
                    asset_data.tags,
                    asset_data.size_bytes,
                    asset_data.file_name,
                    asset_data.extension,
                    asset_data.last_modified_os,
                    asset_data.width,
                    asset_data.height,
                    asset_data.created_at,
                    asset_data.content_snippet,
                    asset_data.is_broken,
                    asset_data.file_hash,
                ],
            ).map_err(|e| e.to_string())?;

            // Restore thumbnail if it doesn't exist on disk
            let has_thumb = asset_data.preview_path.as_ref().map(|p| Path::new(p).exists()).unwrap_or(false);
            if !has_thumb {
                let orig_path = Path::new(&asset_data.original_path);
                if orig_path.exists() {
                    if let Ok(img) = image::open(orig_path) {
                        let new_thumb_path = save_thumbnail(&img, &asset_data.id, &config);
                        if let Some(tp) = new_thumb_path {
                            let _ = conn.execute("UPDATE assets SET preview_path = ?1 WHERE id = ?2", params![tp, asset_data.id]);
                        }
                    }
                }
            }

            let _ = conn.execute("DELETE FROM operation_log WHERE id = ?1", params![found_op_id]);

            return Ok(UndoResult {
                op_type: "delete".to_string(),
                count: 1,
            });
        }
    } else if op_type == "import" {
        if let Ok(import_data) = serde_json::from_str::<ImportOperationData>(&details_json) {
            for asset_id in &import_data.asset_ids {
                let _ = conn.execute("DELETE FROM assets WHERE id = ?1", params![asset_id]);

                let thumb_path = Path::new(&config.library_path)
                    .join("thumbnails")
                    .join(format!("{}.jpg", asset_id));
                if thumb_path.exists() {
                    let _ = fs::remove_file(thumb_path);
                }
            }

            for copied_path in &import_data.copied_paths {
                let p = Path::new(copied_path);
                if p.exists() {
                    let _ = fs::remove_file(p);
                }
            }

            let _ = conn.execute("DELETE FROM operation_log WHERE id = ?1", params![found_op_id]);

            return Ok(UndoResult {
                op_type: "import".to_string(),
                count: import_data.asset_ids.len(),
            });
        }
    }

    let _ = conn.execute("DELETE FROM operation_log WHERE id = ?1", params![found_op_id]);
    Err("Failed to execute undo.".to_string())
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

#[derive(serde::Serialize)]
struct LibraryInfo {
    path: String,
    size_bytes: u64,
}

fn calculate_dir_size(path: &Path) -> u64 {
    let mut total_size = 0;
    if let Ok(entries) = fs::read_dir(path) {
        for entry in entries.flatten() {
            let p = entry.path();
            if p.is_dir() {
                total_size += calculate_dir_size(&p);
            } else if let Ok(meta) = entry.metadata() {
                total_size += meta.len();
            }
        }
    }
    total_size
}

#[tauri::command]
async fn get_library_info(state: State<'_, AppState>) -> Result<LibraryInfo, String> {
    let config = state.config();
    let lib_path = PathBuf::from(&config.library_path);
    let size_bytes = calculate_dir_size(&lib_path);
    Ok(LibraryInfo {
        path: config.library_path,
        size_bytes,
    })
}

#[tauri::command]
async fn open_library_folder(state: State<'_, AppState>) -> Result<(), String> {
    let config = state.config();
    let path = &config.library_path;
    #[cfg(target_os = "windows")]
    std::process::Command::new("explorer")
        .arg(path)
        .spawn()
        .map_err(|e| e.to_string())?;

    #[cfg(target_os = "macos")]
    std::process::Command::new("open")
        .arg(path)
        .spawn()
        .map_err(|e| e.to_string())?;

    #[cfg(target_os = "linux")]
    std::process::Command::new("xdg-open")
        .arg(path)
        .spawn()
        .map_err(|e| e.to_string())?;

    Ok(())
}



fn copy_file_to_os_clipboard(path: &str) -> Result<(), String> {
    #[cfg(target_os = "windows")]
    {
        use std::process::Command;
        use std::os::windows::process::CommandExt;
        // PowerShell command to copy a file to the clipboard (as a file/HDROP, not text)
        let script = format!("Set-Clipboard -Path '{}'", path.replace("'", "''"));
        let mut cmd = Command::new("powershell");
        cmd.args(["-NoProfile", "-Command", &script]);
        cmd.creation_flags(0x08000000);
        let output = cmd.output().map_err(|e| e.to_string())?;

        if output.status.success() {
            Ok(())
        } else {
            let err = String::from_utf8_lossy(&output.stderr);
            Err(format!("PowerShell failed: {}", err))
        }
    }

    #[cfg(target_os = "linux")]
    {
        use std::process::{Command, Stdio};
        use std::io::Write;

        let uri = format!("file://{}", path);

        // Try wl-copy (Wayland) first
        if let Ok(mut child) = Command::new("wl-copy")
            .args(["-t", "text/uri-list"])
            .stdin(Stdio::piped())
            .spawn()
        {
            if let Some(mut stdin) = child.stdin.take() {
                let _ = stdin.write_all(uri.as_bytes());
            }
            if child.wait().map(|s| s.success()).unwrap_or(false) {
                return Ok(());
            }
        }

        // Try xclip (X11) as fallback
        if let Ok(mut child) = Command::new("xclip")
            .args(["-selection", "clipboard", "-t", "text/uri-list"])
            .stdin(Stdio::piped())
            .spawn()
        {
            if let Some(mut stdin) = child.stdin.take() {
                let _ = stdin.write_all(uri.as_bytes());
            }
            if child.wait().map(|s| s.success()).unwrap_or(false) {
                return Ok(());
            }
        }

        Err("Failed to copy file to clipboard. Ensure wl-copy or xclip is installed.".to_string())
    }

    #[cfg(not(any(target_os = "windows", target_os = "linux")))]
    {
        Err("File copy not supported on this OS".to_string())
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


#[tauri::command]
async fn clear_library(state: State<'_, AppState>) -> Result<(), String> {
    let conn = state.db.lock().map_err(|e| e.to_string())?;
    conn.execute("DELETE FROM assets", ()).map_err(|e| e.to_string())?;

    let config = state.config();
    let thumbnails_dir = Path::new(&config.library_path).join("thumbnails");
    if thumbnails_dir.exists() {
        let _ = fs::remove_dir_all(&thumbnails_dir);
        let _ = fs::create_dir_all(&thumbnails_dir);
    }

    let local_dir = Path::new(&config.library_path).join("local");
    if local_dir.exists() {
        let _ = fs::remove_dir_all(&local_dir);
        let _ = fs::create_dir_all(&local_dir);
    }

    Ok(())
}

#[tauri::command]
async fn save_settings(window: tauri::Window, state: State<'_, AppState>, settings: String) -> Result<(), String> {
    let lib_path = state.config().library_path;
    let settings_path = Path::new(&lib_path).join("settings.json");
    let mut settings_json: serde_json::Value = serde_json::from_str(&settings).unwrap_or_else(|_| serde_json::json!({}));
    if let (Ok(pos), Ok(size)) = (window.outer_position(), window.outer_size()) {
        settings_json["windowX"] = serde_json::Value::from(pos.x);
        settings_json["windowY"] = serde_json::Value::from(pos.y);
        settings_json["windowWidth"] = serde_json::Value::from(size.width);
        settings_json["windowHeight"] = serde_json::Value::from(size.height);
    }

    // Update in-memory AppConfig live
    if let Some(thumb_sz) = settings_json.get("thumbnailSize").and_then(|v| v.as_u64()) {
        state.config.lock().unwrap().thumbnail_size = thumb_sz as u32;
    }
    if let Some(gpu_accel) = settings_json.get("gpuAcceleration").and_then(|v| v.as_bool()) {
        state.config.lock().unwrap().gpu_acceleration = gpu_accel;
    }
    if let Some(lsp) = settings_json.get("localStoragePath").and_then(|v| v.as_str()) {
        state.config.lock().unwrap().local_storage_path = if !lsp.trim().is_empty() {
            Some(lsp.trim().to_string())
        } else {
            None
        };
    }

    let updated_str = serde_json::to_string_pretty(&settings_json).map_err(|e| e.to_string())?;
    fs::write(settings_path, updated_str).map_err(|e| e.to_string())
}

#[tauri::command]
async fn load_settings(state: State<'_, AppState>) -> Result<String, String> {
    let lib_path = state.config().library_path;
    let settings_path = Path::new(&lib_path).join("settings.json");
    if !settings_path.exists() {
        return Ok("{}".to_string());
    }
    fs::read_to_string(settings_path).map_err(|e| e.to_string())
}

#[tauri::command]
fn check_onboarding_status(app: tauri::AppHandle) -> Result<OnboardingStatus, String> {
    let (portable_lib, standard_lib) = get_library_paths(&app)?;
    let needs_onboarding = !portable_lib.exists() && !standard_lib.exists();

    Ok(OnboardingStatus {
        needs_onboarding,
        default_portable_path: portable_lib.to_string_lossy().to_string(),
        default_standard_path: standard_lib.to_string_lossy().to_string(),
        default_local_portable: portable_lib.join("local").to_string_lossy().to_string(),
        default_local_standard: standard_lib.join("local").to_string_lossy().to_string(),
    })
}

#[tauri::command]
async fn complete_onboarding(
    payload: CompleteOnboardingPayload,
    window: tauri::WebviewWindow,
    state: State<'_, AppState>,
) -> Result<(), String> {
    let app_handle = window.app_handle();
    let (portable_lib, standard_lib) = get_library_paths(&app_handle)?;

    let target_lib = if payload.setup_mode.to_lowercase() == "portable" {
        portable_lib
    } else {
        standard_lib
    };

    fs::create_dir_all(&target_lib).map_err(|e| e.to_string())?;
    fs::create_dir_all(target_lib.join("thumbnails")).map_err(|e| e.to_string())?;

    let local_storage_dir = match &payload.local_storage_path {
        Some(p) if !p.trim().is_empty() => PathBuf::from(p.trim()),
        _ => target_lib.join("local"),
    };
    fs::create_dir_all(&local_storage_dir).map_err(|e| e.to_string())?;

    let view_mode = if payload.masonry_type.to_lowercase() == "horizontal" {
        "horizontal"
    } else {
        "grid"
    };

    let new_config = AppConfig {
        library_path: target_lib.to_string_lossy().into_owned(),
        theme_mode: payload.theme_mode.clone(),
        thumbnail_size: 400,
        gpu_acceleration: true,
        local_storage_path: payload.local_storage_path.as_ref().and_then(|p| {
            if p.trim().is_empty() {
                None
            } else {
                Some(p.trim().to_string())
            }
        }),
    };

    let real_conn = init_db(&new_config)?;

    {
        let mut db_guard = state.db.lock().map_err(|e| e.to_string())?;
        *db_guard = real_conn;
    }
    {
        let mut cfg_guard = state.config.lock().map_err(|e| e.to_string())?;
        *cfg_guard = new_config;
    }

    let settings_path = target_lib.join("settings.json");
    let mut settings_json = serde_json::json!({
        "themeMode": payload.theme_mode,
        "viewMode": view_mode,
        "setupMode": payload.setup_mode,
        "localStoragePath": local_storage_dir.to_string_lossy(),
        "thumbnailSize": 400,
        "rangeVal": 4,
        "autoplay": false,
        "pillHeader": true,
        "disableBlur": false,
        "batchSize": 30,
        "gpuAcceleration": true,
    });
    if let (Ok(pos), Ok(size)) = (window.outer_position(), window.outer_size()) {
        settings_json["windowX"] = serde_json::Value::from(pos.x);
        settings_json["windowY"] = serde_json::Value::from(pos.y);
        settings_json["windowWidth"] = serde_json::Value::from(size.width);
        settings_json["windowHeight"] = serde_json::Value::from(size.height);
    }
    let updated_str = serde_json::to_string_pretty(&settings_json).map_err(|e| e.to_string())?;
    fs::write(settings_path, updated_str).map_err(|e| e.to_string())?;

    Ok(())
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .setup(|app| {
            let (config, is_onboarded) = get_config(&app.handle())?;
            let db = if is_onboarded {
                init_db(&config)?
            } else {
                let conn = Connection::open_in_memory().map_err(|e| e.to_string())?;
                setup_db_tables(&conn)?;
                conn
            };
            let clipboard = Clipboard::new().map_err(|e| e.to_string())?;
            app.manage(AppState {
                config: Mutex::new(config.clone()),
                db: Mutex::new(db),
                clipboard: Mutex::new(clipboard),
            });

            if let Some(main_window) = app.get_webview_window("main") {
                let settings_path = std::path::Path::new(&config.library_path).join("settings.json");
                if settings_path.exists() {
                    if let Ok(settings_str) = std::fs::read_to_string(&settings_path) {
                        if let Ok(settings_json) = serde_json::from_str::<serde_json::Value>(&settings_str) {
                            if let (Some(x), Some(y)) = (settings_json.get("windowX").and_then(|v| v.as_f64()), settings_json.get("windowY").and_then(|v| v.as_f64())) {
                                let _ = main_window.set_position(tauri::Position::Physical(tauri::PhysicalPosition::new(x as i32, y as i32)));
                            }
                            if let (Some(w), Some(h)) = (settings_json.get("windowWidth").and_then(|v| v.as_f64()), settings_json.get("windowHeight").and_then(|v| v.as_f64())) {
                                let _ = main_window.set_size(tauri::Size::Physical(tauri::PhysicalSize::new(w as u32, h as u32)));
                            }
                        }
                    }
                }

                let main_window_clone = main_window.clone();
                let config_clone = config.clone();
                main_window.on_window_event(move |event| {
                    if let tauri::WindowEvent::CloseRequested { .. } = event {
                        if let (Ok(pos), Ok(size)) = (main_window_clone.outer_position(), main_window_clone.outer_size()) {
                            let settings_path = std::path::Path::new(&config_clone.library_path).join("settings.json");
                            let mut settings_json = if settings_path.exists() {
                                if let Ok(settings_str) = std::fs::read_to_string(&settings_path) {
                                    serde_json::from_str::<serde_json::Value>(&settings_str).unwrap_or_else(|_| serde_json::json!({}))
                                } else {
                                    serde_json::json!({})
                                }
                            } else {
                                serde_json::json!({})
                            };
                            settings_json["windowX"] = serde_json::Value::from(pos.x);
                            settings_json["windowY"] = serde_json::Value::from(pos.y);
                            settings_json["windowWidth"] = serde_json::Value::from(size.width);
                            settings_json["windowHeight"] = serde_json::Value::from(size.height);
                            if let Ok(updated_str) = serde_json::to_string_pretty(&settings_json) {
                                let _ = std::fs::write(&settings_path, updated_str);
                            }
                        }
                    }
                });
            }

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
            processing::copy_to_local_library,
            processing::prepare_dropped_paths,
            processing::check_import_paths,
            processing::process_asset,
            get_library,
            recalculate_db,
            recalculate_colors,
            get_top_tags,
            get_tag_previews,
            get_asset_count_for_tag,
            delete_tag_globally,
            delete_tag_and_assets,
            update_asset_tags,
            delete_asset,
            delete_assets_batch,
            delete_asset_device,
            log_import_operation,
            undo_last_operation,
            rename_asset,
            open_in_folder,
            processing::read_full_text_file,
            processing::resolve_path,
            show_window,
            processing::filter_known_paths,
            clear_library,
            save_settings,
            load_settings,
            processing::expand_directory,
            get_library_info,
            open_library_folder,
            regenerate_thumbnails,
            regenerate_asset,
            check_onboarding_status,
            complete_onboarding,
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}


