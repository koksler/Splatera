mod processing;
use crate::processing::{
    Asset, AssetKind, FileMetadata, SimplifiedAsset, ALL_EXTENSIONS,
    color_distance, compute_file_hash, extract_colors, extract_metadata, hex_to_rgb,
    process_single_path, save_thumbnail,
};

use arboard::Clipboard;
use rusqlite::{params, Connection};
use serde::{Deserialize, Serialize};
use std::collections::HashMap;
use std::env;
use std::fs;
use std::path::{Path, PathBuf};
use std::sync::Mutex;
use tauri::{AppHandle, Manager, State};

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct AppConfig {
    pub library_path: String,
    pub theme_mode: String,
    pub thumbnail_size: u32,
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

pub struct AppState {
    pub config: AppConfig,
    pub db: Mutex<Connection>,
    pub clipboard: Mutex<Clipboard>,
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


#[tauri::command]
async fn clear_library(state: State<'_, AppState>) -> Result<(), String> {
    let conn = state.db.lock().map_err(|e| e.to_string())?;
    conn.execute("DELETE FROM assets", ()).map_err(|e| e.to_string())?;

    let thumbnails_dir = Path::new(&state.config.library_path).join("thumbnails");
    if thumbnails_dir.exists() {
        let _ = fs::remove_dir_all(&thumbnails_dir);
        let _ = fs::create_dir_all(&thumbnails_dir);
    }

    let local_dir = Path::new(&state.config.library_path).join("local");
    if local_dir.exists() {
        let _ = fs::remove_dir_all(&local_dir);
        let _ = fs::create_dir_all(&local_dir);
    }

    Ok(())
}

#[tauri::command]
async fn save_settings(state: State<'_, AppState>, settings: String) -> Result<(), String> {
    let settings_path = Path::new(&state.config.library_path).join("settings.json");
    fs::write(settings_path, settings).map_err(|e| e.to_string())
}

#[tauri::command]
async fn load_settings(state: State<'_, AppState>) -> Result<String, String> {
    let settings_path = Path::new(&state.config.library_path).join("settings.json");
    if !settings_path.exists() {
        return Ok("{}".to_string());
    }
    fs::read_to_string(settings_path).map_err(|e| e.to_string())
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
            processing::copy_to_local_library,
            processing::prepare_dropped_paths,
            processing::check_import_paths,
            processing::process_asset,
            get_library,
            recalculate_db,
            recalculate_colors,
            get_top_tags,
            update_asset_tags,
            delete_asset,
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
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}


