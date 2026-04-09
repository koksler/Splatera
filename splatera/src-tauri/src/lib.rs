use arboard::{Clipboard, ImageData};
use image::io::Reader as ImageReader;
use std::borrow::Cow;
use serde::{Deserialize, Serialize};
use std::collections::HashMap;
use std::fs;
use std::path::{Path, PathBuf};
use std::time::{SystemTime, UNIX_EPOCH};
use uuid::Uuid;
use image::imageops::FilterType;
use color_thief::{get_palette, ColorFormat};
use walkdir::WalkDir;
use std::env;
use tauri::{Manager, State, AppHandle};
use std::sync::Mutex;

// ==========================================
// 1. КОНСТАНТЫ
// ==========================================

const IMAGE_EXTENSIONS: &[&str] = &["png", "jpg", "jpeg", "webp", "bmp", "gif"];
const VIDEO_EXTENSIONS: &[&str] = &["mp4", "webm", "mov"];
const TEXT_EXTENSIONS:  &[&str] = &["txt", "md"];
const CODE_EXTENSIONS:  &[&str] = &["js", "py", "rs", "css", "html", "json"];
const ALL_EXTENSIONS:   &[&str] = &["png", "jpg", "jpeg", "webp", "bmp", "gif", "mp4", "webm", "mov", "txt", "md", "js", "py", "rs", "css", "html", "json"];

// ==========================================
// 2. СТРУКТУРЫ ДАННЫХ
// ==========================================

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
enum AssetKind { Image, Code, Text, Video, Unknown }

impl AssetKind {
    fn default_tags(&self) -> Vec<String> {
        match self {
            AssetKind::Image   => vec!["image".to_string()],
            AssetKind::Text    => vec!["text".to_string()],
            AssetKind::Code    => vec!["code".to_string()],
            AssetKind::Video   => vec!["video".to_string()],
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
    filter_tag: Option<String>, // backwards compatibility / existing tag sidebar
}

// FIX 1 & 2: Безопасный поиск пути и строгий Portable-маркер
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

// ==========================================
// 3. СОСТОЯНИЕ ПРИЛОЖЕНИЯ
// ==========================================

struct AppState {
    config: AppConfig,
    assets: Mutex<Vec<Asset>>,
}

// ==========================================
// 4. БАЗА ДАННЫХ
// ==========================================

fn get_db_path(config: &AppConfig) -> PathBuf {
    Path::new(&config.library_path).join("database.json")
}

fn read_db(config: &AppConfig) -> Result<Vec<Asset>, String> {
    let db_path = get_db_path(config);
    if !db_path.exists() { return Ok(vec![]); }
    let data = fs::read_to_string(&db_path).map_err(|e| e.to_string())?;
    Ok(serde_json::from_str(&data).unwrap_or_else(|_| vec![]))
}

fn write_db(assets: &[Asset], config: &AppConfig) -> Result<(), String> {
    let json = serde_json::to_string_pretty(assets).map_err(|e| e.to_string())?;
    fs::write(get_db_path(config), json).map_err(|e| e.to_string())
}

// ==========================================
// 4. ОБРАБОТКА ФАЙЛОВ
// ==========================================

fn extract_metadata(path: &Path) -> Result<FileMetadata, String> {
    let meta = fs::metadata(path).map_err(|e| e.to_string())?;
    Ok(FileMetadata {
        size_bytes: meta.len(),
        file_name: path.file_name().unwrap_or_default().to_string_lossy().to_string(),
        extension: path.extension().unwrap_or_default().to_string_lossy().to_string(),
        last_modified_os: meta.modified()
            .unwrap_or(SystemTime::now())
            .duration_since(UNIX_EPOCH)
            .unwrap_or_default()
            .as_secs(),
    })
}

fn extract_colors(img: &image::DynamicImage) -> Vec<String> {
    let sample = img.resize(256, 256, FilterType::Nearest);
    get_palette(sample.into_rgb8().as_raw(), ColorFormat::Rgb, 5, 5)
        .map(|palette| palette.into_iter()
            .map(|c| format!("#{:02X}{:02X}{:02X}", c.r, c.g, c.b))
            .collect())
        .unwrap_or_default()
}

fn hex_to_rgb(hex: &str) -> Option<(i32, i32, i32)> {
    let hex = hex.trim_start_matches('#');
    if hex.len() != 6 { return None; }
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
    let thumb = img.resize(config.thumbnail_size, config.thumbnail_size, FilterType::Lanczos3);
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

fn process_single_path(path: &Path, config: &AppConfig) -> Result<Asset, String> {
    let metadata = extract_metadata(path)?;
    let asset_id = Uuid::new_v4().to_string();

    let ext = metadata.extension.to_lowercase();
    let mut tags = if ext.is_empty() { vec![] } else { vec![ext.clone()] };

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
        
        // Try to generate a video thumbnail using ffmpeg
        preview_path = generate_video_thumbnail(path, &asset_id, config);
    } else if TEXT_EXTENSIONS.contains(&ext.as_str()) {
        kind = AssetKind::Text;
        content_snippet = read_text_snippet(path);
        width = 400; height = 300;
    } else if CODE_EXTENSIONS.contains(&ext.as_str()) {
        kind = AssetKind::Code;
        content_snippet = read_text_snippet(path);
        width = 400; height = 300;
    } else {
        kind = AssetKind::Unknown;
    }

    tags.extend(kind.default_tags());

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
        created_at: SystemTime::now().duration_since(UNIX_EPOCH).unwrap_or_default().as_secs(),
        content_snippet,
        is_broken: false,
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
}

// ==========================================
// 5. КОМАНДЫ TAURI
// ==========================================

#[tauri::command]
async fn process_asset(
    app: AppHandle,
    state: State<'_, AppState>,
    path: String
) -> Result<Vec<SimplifiedAsset>, String> {
    let config = state.config.clone();
    
    let unique = tokio::task::spawn_blocking(move || {
        let root = Path::new(&path);

        let paths: Vec<PathBuf> = if root.is_dir() {
            WalkDir::new(root).into_iter()
                .filter_map(|e| e.ok())
                .filter(|e| e.file_type().is_file())
                .map(|e| e.path().to_path_buf())
                .collect()
        } else {
            vec![root.to_path_buf()]
        };

        let new_assets: Vec<Asset> = paths.into_iter()
            .filter(|p| p.extension()
                .map(|e| ALL_EXTENSIONS.contains(&e.to_string_lossy().to_lowercase().as_str()))
                .unwrap_or(false))
            .filter_map(|p| process_single_path(&p, &config).ok())
            .collect();

        Ok::<Vec<Asset>, String>(new_assets)
    })
    .await
    .unwrap_or_else(|e| Err(format!("Task panicked: {}", e)))?;

    let mut assets = state.assets.lock().map_err(|e| e.to_string())?;
    let existing: std::collections::HashSet<String> =
        assets.iter().map(|a| a.original_path.clone()).collect();

    let unique_filtered: Vec<Asset> = unique.into_iter()
        .filter(|a| !existing.contains(&a.original_path))
        .collect();

    if !unique_filtered.is_empty() {
        assets.extend(unique_filtered.clone());
        write_db(&assets, &state.config)?;
    }

    Ok(unique_filtered.into_iter().map(|a| SimplifiedAsset {
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
        content_snippet: a.content_snippet.as_ref().map(|s| s.lines().take(5).collect::<Vec<_>>().join("\n")),
        is_broken: a.is_broken,
    }).collect())
}

#[tauri::command]
fn get_library(
    state: State<'_, AppState>,
    query: LibraryQuery,
) -> Result<Vec<SimplifiedAsset>, String> {
    let assets_lock = state.assets.lock().map_err(|e| e.to_string())?;
    let mut assets = assets_lock.clone();
    drop(assets_lock); 

    let lib_path = Path::new(&state.config.library_path);

    // Normalize all relative paths to absolute for the frontend protocol
    for asset in assets.iter_mut() {
        if let Some(preview) = &asset.preview_path {
            if preview.starts_with("./") {
                let absolute = lib_path.join(&preview[2..]);
                asset.preview_path = Some(absolute.to_string_lossy().into_owned());
            }
        }
    }

    // 1. Filter by Sidebar Tag
    if let Some(tag) = query.filter_tag {
        let tag_lower = tag.to_lowercase();
        if tag_lower == "images" {
            assets.retain(|a| a.tags.iter().any(|t| IMAGE_EXTENSIONS.contains(&t.to_lowercase().as_str())));
        } else {
            assets.retain(|a| a.tags.iter().any(|t| t.to_lowercase().contains(&tag_lower)));
        }
    }

    // 2. Filter by Search Query
    if let Some(q) = query.query {
        let q = q.trim().to_lowercase();
        if !q.is_empty() {
            let is_exclude = q.starts_with('-');
            let match_term = if is_exclude { &q[1..] } else { &q };

            assets.retain(|a| {
                let name_match = a.metadata.file_name.to_lowercase().contains(match_term);
                let tag_match = a.tags.iter().any(|t| t.to_lowercase().contains(match_term));
                let snippet_match = a.content_snippet.as_ref().map(|s| s.to_lowercase().contains(match_term)).unwrap_or(false);
                let any_match = name_match || tag_match || snippet_match;
                if is_exclude { !any_match } else { any_match }
            });
        }
    }

    // 3. Filter by Selected Tags
    if let Some(tags) = query.tags {
        for tag_item in tags {
            let tag_item = tag_item.trim().to_lowercase();
            if tag_item.is_empty() { continue; }
            let is_exclude = tag_item.starts_with('-');
            let match_tag = if is_exclude { &tag_item[1..] } else { &tag_item };

            assets.retain(|a| {
                let has_tag = a.tags.iter().any(|t| t.to_lowercase() == match_tag);
                if is_exclude { !has_tag } else { has_tag }
            });
        }
    }

    // 4. Color Filter
    if let Some(color_hex) = query.color {
        if let Some(rgb1) = hex_to_rgb(&color_hex) {
            assets.retain(|a| {
                a.dominant_colors.iter().any(|c_hex| {
                    if let Some(rgb2) = hex_to_rgb(c_hex) {
                        color_distance(rgb1, rgb2) < 60.0
                    } else { false }
                })
            });
        }
    }

    // 5. Date Filter
    if let Some(d_filter) = query.date {
        if !d_filter.is_empty() {
            use chrono::{Utc, TimeZone};
            assets.retain(|a| {
                if let Some(dt) = Utc.timestamp_opt(a.metadata.last_modified_os as i64, 0).single() {
                    let date_str = dt.format("%d.%m.%Y").to_string();
                    date_str.contains(&d_filter)
                } else { false }
            });
        }
    }

    // 6. Sort
    if let Some(sort_type) = query.sort {
        match sort_type.as_str() {
            "name_asc"  => assets.sort_by_cached_key(|a| a.metadata.file_name.to_lowercase()),
            "name_desc" => assets.sort_by_cached_key(|a| std::cmp::Reverse(a.metadata.file_name.to_lowercase())),
            "date_desc" => assets.sort_by(|a, b| b.created_at.cmp(&a.created_at)),
            "date_asc"  => assets.sort_by(|a, b| a.created_at.cmp(&b.created_at)),
            _ => {}
        }
    }

    // 7. Final Mapping to SimplifiedAsset
    Ok(assets.into_iter().map(|a| SimplifiedAsset {
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
        content_snippet: a.content_snippet.as_ref().map(|s| s.lines().take(5).collect::<Vec<_>>().join("\n")),
        is_broken: a.is_broken,
    }).collect())
}


#[tauri::command]
fn get_top_tags(state: State<'_, AppState>) -> Result<Vec<String>, String> {
    let assets = state.assets.lock().map_err(|e| e.to_string())?;

    let mut counts: HashMap<String, usize> = HashMap::new();
    for asset in assets.iter() {
        for tag in asset.tags.iter() {
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
    let current_assets = state.assets.lock().map_err(|e| e.to_string())?.clone();
    
    let valid = tokio::task::spawn_blocking(move || {
        let mut result = Vec::new();

        for mut a in current_assets {
            if Path::new(&a.original_path).exists() {
                if let Ok(meta) = extract_metadata(Path::new(&a.original_path)) {
                    a.metadata = meta;
                }
                for tag in a.kind.default_tags() {
                    if !a.tags.contains(&tag) { a.tags.push(tag); }
                }
                
                if a.kind == AssetKind::Image {
                    let thumb_missing = a.preview_path.as_ref()
                        .map(|p| !Path::new(p).exists())
                        .unwrap_or(true);
                        
                    if thumb_missing {
                        if let Ok(img) = image::open(&a.original_path) {
                            a.preview_path = save_thumbnail(&img, &a.id, &config);
                        }
                    }
                }
                result.push(a);
            }
        }
        Ok::<Vec<Asset>, String>(result)
    })
    .await
    .unwrap_or_else(|e| Err(format!("Task panicked: {}", e)))?;

    let mut assets = state.assets.lock().map_err(|e| e.to_string())?;
    *assets = valid;
    write_db(&assets, &state.config)?;
    
    println!("Recalculate complete. {} assets in DB.", assets.len());
    Ok(())
}

#[tauri::command]
async fn recalculate_colors(state: State<'_, AppState>) -> Result<usize, String> {
    let mut assets = state.assets.lock().map_err(|e| e.to_string())?;
    let mut updated = 0;

    for asset in assets.iter_mut() {
        if !asset.dominant_colors.is_empty() { continue; }
        let path = Path::new(&asset.original_path);
        if !path.exists() { continue; }
        if let Ok(img) = image::open(path) {
            asset.dominant_colors = extract_colors(&img);
            updated += 1;
        }
    }

    write_db(&assets, &state.config)?;
    Ok(updated)
}

#[tauri::command]
async fn copy_image_to_clipboard(path: String) -> Result<(), String> {
    let mut clipboard = Clipboard::new().map_err(|e| e.to_string())?;
    let img = ImageReader::open(&path)
        .map_err(|e| e.to_string())?
        .decode()
        .map_err(|e| e.to_string())?;
    let rgba = img.to_rgba8();
    let (w, h) = rgba.dimensions();
    clipboard.set_image(ImageData {
        width: w as usize,
        height: h as usize,
        bytes: Cow::from(rgba.into_raw()),
    }).map_err(|e| e.to_string())?;
    Ok(())
}

#[tauri::command]
async fn copy_text_to_clipboard(path: String) -> Result<(), String> {
    let content = fs::read_to_string(&path).map_err(|e| e.to_string())?;
    let mut clipboard = Clipboard::new().map_err(|e| e.to_string())?;
    clipboard.set_text(content).map_err(|e| e.to_string())?;
    Ok(())
}

#[tauri::command]
async fn update_asset_tags(
    state: State<'_, AppState>,
    id: String,
    tags: Vec<String>
) -> Result<(), String> {
    let mut assets = state.assets.lock().map_err(|e| e.to_string())?;
    assets.iter_mut().find(|a| a.id == id)
        .ok_or("Asset not found".to_string())
        .map(|a| a.tags = tags)?;
    write_db(&assets, &state.config)
}

#[tauri::command]
async fn delete_asset(state: State<'_, AppState>, id: String) -> Result<(), String> {
    let mut assets = state.assets.lock().map_err(|e| e.to_string())?;
    let index = assets.iter().position(|a| a.id == id)
        .ok_or("Asset not found".to_string())?;
    if let Some(preview) = &assets[index].preview_path {
        let _ = fs::remove_file(preview);
    }
    assets.remove(index);
    write_db(&assets, &state.config)
}

#[tauri::command]
async fn rename_asset(state: State<'_, AppState>, id: String, new_name: String) -> Result<(), String> {
    let mut assets = state.assets.lock().map_err(|e| e.to_string())?;
    assets.iter_mut().find(|a| a.id == id)
        .ok_or("Asset not found".to_string())
        .map(|a| a.metadata.file_name = new_name)?;
    write_db(&assets, &state.config)
}

// FIX 5: Поддержка Linux для открытия в проводнике
#[tauri::command]
async fn open_in_folder(path: String) -> Result<(), String> {
    use std::process::Command;
    
    #[cfg(target_os = "windows")]
    Command::new("explorer").arg("/select,").arg(&path).spawn().map_err(|e| e.to_string())?;
    
    #[cfg(target_os = "macos")]
    Command::new("open").arg("-R").arg(&path).spawn().map_err(|e| e.to_string())?;
    
    #[cfg(target_os = "linux")]
    Command::new("xdg-open")
        .arg(Path::new(&path).parent().unwrap_or(Path::new("/")))
        .spawn()
        .map_err(|e| e.to_string())?;

    Ok(())
}

// FIX 4: Предупреждение об обрезке текста
#[tauri::command]
async fn read_full_text_file(path: String) -> Result<String, String> {
    use std::io::Read;
    let mut handle = fs::File::open(&path).map_err(|e| e.to_string())?.take(2 * 1024 * 1024);
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

// ==========================================
// 6. ТОЧКА ВХОДА
// ==========================================

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .setup(|app| {
            let config = get_config(&app.handle())?;
            let assets = read_db(&config)?;
            app.manage(AppState {
                config,
                assets: Mutex::new(assets),
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
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}

fn get_video_dimensions(path: &Path) -> (u32, u32) {
    use std::process::Command;
    
    let path_str = path.to_string_lossy();
    
    // Attempt ffprobe first for high accuracy
    let ffprobe_res = Command::new("ffprobe")
        .args(&[
            "-v", "error",
            "-select_streams", "v:0",
            "-show_entries", "stream=width,height",
            "-of", "csv=s=x:p=0",
            &path_str
        ])
        .output();

    if let Ok(output) = ffprobe_res {
        let s = String::from_utf8_lossy(&output.stdout);
        let dims: Vec<&str> = s.trim().split('x').collect();
        if dims.len() == 2 {
            let w = dims[0].parse().unwrap_or(0);
            let h = dims[1].parse().unwrap_or(0);
            if w > 0 && h > 0 { return (w, h); }
        }
    }
    
    // Graceful default
    (1920, 1080)
}

fn generate_video_thumbnail(video_path: &Path, asset_id: &str, config: &AppConfig) -> Option<String> {
    use std::process::Command;
    
    let thumb_path = Path::new(&config.library_path)
        .join("thumbnails")
        .join(format!("{}.jpg", asset_id));
        
    let video_path_str = video_path.to_string_lossy();
    let thumb_path_str = thumb_path.to_string_lossy();

    // Spawn ffmpeg to grab one frame at 1 second
    let res = Command::new("ffmpeg")
        .args(&[
            "-i", &video_path_str,
            "-ss", "00:00:01",
            "-vframes", "1",
            "-q:v", "2",
            "-y",
            &thumb_path_str
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
    fn test_text_file_detection() {
        let config = get_test_config();
        let path = Path::new("test_file.txt");
        fs::write(path, "hello world").unwrap();

        let asset = process_single_path(path, &config).unwrap();
        assert_eq!(asset.kind, AssetKind::Text);
        assert!(asset.tags.contains(&"txt".to_string()));

        fs::remove_file(path).unwrap();
    }

    #[test]
    fn test_tag_parsing() {
        let input = "logo, ui, dark";
        let tags: Vec<String> = input
            .split(',')
            .map(|t| t.trim().to_lowercase())
            .filter(|t| !t.is_empty())
            .collect();
        assert_eq!(tags, vec!["logo", "ui", "dark"]);
    }

    #[test]
    fn test_color_extraction() {
        use image::{ImageBuffer, Rgb};
        let img = ImageBuffer::from_fn(100, 100, |_, _| Rgb([255u8, 0u8, 0u8]));
        let dynamic = image::DynamicImage::ImageRgb8(img);
        let colors = extract_colors(&dynamic);

        assert!(!colors.is_empty(), "Palette should not be empty");
        let dominant = &colors[0];
        assert!(dominant.starts_with('#'), "Color should be HEX");
        let r = u8::from_str_radix(&dominant[1..3], 16).unwrap();
        assert!(r > 200, "Red channel should be dominant, got {}", r);
    }

    #[test]
    fn test_db_read_write() {
        let config = get_test_config();
        let asset = Asset {
            id: "test-id-123".to_string(),
            original_path: "/some/path/file.png".to_string(),
            preview_path: None,
            kind: AssetKind::Image,
            dominant_colors: vec!["#FF0000".to_string()],
            tags: vec!["png".to_string(), "image".to_string()],
            metadata: FileMetadata {
                size_bytes: 1024,
                file_name: "file.png".to_string(),
                extension: "png".to_string(),
                last_modified_os: 0,
            },
            width: 100,
            height: 100,
            created_at: 0,
            content_snippet: None,
            is_broken: false,
        };

        write_db(&[asset.clone()], &config).unwrap();
        let loaded = read_db(&config).unwrap();
        assert_eq!(loaded.len(), 1);
        assert_eq!(loaded[0].id, "test-id-123");
        assert_eq!(loaded[0].kind, AssetKind::Image);
        assert_eq!(loaded[0].dominant_colors[0], "#FF0000");

        fs::remove_dir_all(&config.library_path).unwrap();
    }

    #[test]
    fn test_broken_path_returns_error() {
        let path = "/this/path/does/not/exist/file.txt".to_string();
        let result = fs::read_to_string(&path);
        assert!(result.is_err(), "Should return error for missing file");
    }

    #[test]
    fn test_thumbnail_generation() {
        use image::{ImageBuffer, Rgb};
        let config = get_test_config();

        let img_path = Path::new("test_image_thumb.png");
        let img = ImageBuffer::from_fn(800, 600, |_, _| Rgb([100u8, 150u8, 200u8]));
        img.save(img_path).unwrap();

        let asset = process_single_path(img_path, &config).unwrap();

        assert!(asset.preview_path.is_some(), "Thumbnail should be created");
        let thumb_path = asset.preview_path.unwrap();
        assert!(Path::new(&thumb_path).exists(), "Thumbnail file should exist on disk");

        fs::remove_file(img_path).unwrap();
        fs::remove_dir_all(&config.library_path).unwrap();
    }
}