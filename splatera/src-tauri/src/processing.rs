use crate::{AppConfig, AppState};
use color_thief::{get_palette, ColorFormat};
use image::imageops::FilterType;
use rusqlite::params;
use serde::{Deserialize, Serialize};
use std::fs;
use std::path::{Path, PathBuf};
use std::time::{SystemTime, UNIX_EPOCH};
use tauri::{AppHandle, State};
use uuid::Uuid;
use walkdir::WalkDir;

pub const IMAGE_EXTENSIONS: &[&str] = &["png", "jpg", "jpeg", "webp", "bmp", "gif"];
pub const VIDEO_EXTENSIONS: &[&str] = &["mp4", "webm", "mov"];
pub const TEXT_EXTENSIONS: &[&str] = &["txt", "md"];
pub const CODE_EXTENSIONS: &[&str] = &["js", "py", "rs", "css", "html", "json"];
pub const ALL_EXTENSIONS: &[&str] = &[
    "png", "jpg", "jpeg", "webp", "bmp", "gif", "mp4", "webm", "mov", "txt", "md", "js", "py",
    "rs", "css", "html", "json",
];

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub enum AssetKind {
    Image,
    Code,
    Text,
    Video,
    Unknown,
}

impl AssetKind {
    pub fn default_tags(&self) -> Vec<String> {
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
pub struct FileMetadata {
    pub size_bytes: u64,
    pub file_name: String,
    pub extension: String,
    pub last_modified_os: u64,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Asset {
    pub id: String,
    pub original_path: String,
    pub preview_path: Option<String>,
    pub kind: AssetKind,
    pub dominant_colors: Vec<String>,
    pub tags: Vec<String>,
    pub metadata: FileMetadata,
    pub width: u32,
    pub height: u32,
    pub created_at: u64,
    pub content_snippet: Option<String>,
    pub is_broken: bool,
    pub file_hash: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct SimplifiedAsset {
    pub id: String,
    pub original_path: String,
    pub preview_path: Option<String>,
    pub kind: AssetKind,
    pub tags: Vec<String>,
    pub file_name: String,
    pub width: u32,
    pub height: u32,
    pub created_at: u64,
    pub last_modified_os: u64,
    pub content_snippet: Option<String>,
    pub is_broken: bool,
    pub file_hash: Option<String>,
}

pub fn extract_metadata(path: &Path) -> Result<FileMetadata, String> {
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

pub fn extract_colors(img: &image::DynamicImage) -> Vec<String> {
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

pub fn hex_to_rgb(hex: &str) -> Option<(i32, i32, i32)> {
    let hex = hex.trim_start_matches('#');
    if hex.len() != 6 {
        return None;
    }
    let r = i32::from_str_radix(&hex[0..2], 16).ok()?;
    let g = i32::from_str_radix(&hex[2..4], 16).ok()?;
    let b = i32::from_str_radix(&hex[4..6], 16).ok()?;
    Some((r, g, b))
}

pub fn color_distance(c1: (i32, i32, i32), c2: (i32, i32, i32)) -> f64 {
    let dr = (c1.0 - c2.0).pow(2);
    let dg = (c1.1 - c2.1).pow(2);
    let db = (c1.2 - c2.2).pow(2);
    ((dr + dg + db) as f64).sqrt()
}

pub fn save_thumbnail(img: &image::DynamicImage, asset_id: &str, config: &AppConfig) -> Option<String> {
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

pub fn read_text_snippet(path: &Path) -> Option<String> {
    let content = fs::read_to_string(path).ok()?;
    Some(content.lines().take(20).collect::<Vec<_>>().join("\n"))
}

pub fn compute_file_hash(path: &Path) -> Result<String, String> {
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

pub fn process_single_path(path: &Path, config: &AppConfig) -> Result<Asset, String> {
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

pub fn get_video_dimensions(path: &Path) -> (u32, u32) {
    use std::process::Command;
    #[cfg(target_os = "windows")]
    use std::os::windows::process::CommandExt;

    let path_str = path.to_string_lossy();

    let mut cmd = Command::new("ffprobe");
    cmd.args(&[
        "-v",
        "error",
        "-select_streams",
        "v:0",
        "-show_entries",
        "stream=width,height",
        "-of",
        "csv=s=x:p=0",
        &path_str,
    ]);
    #[cfg(target_os = "windows")]
    cmd.creation_flags(0x08000000);

    let ffprobe_res = cmd.output();

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

pub fn generate_video_thumbnail(
    video_path: &Path,
    asset_id: &str,
    config: &AppConfig,
) -> Option<String> {
    use std::process::Command;
    #[cfg(target_os = "windows")]
    use std::os::windows::process::CommandExt;

    let thumb_path = Path::new(&config.library_path)
        .join("thumbnails")
        .join(format!("{}.jpg", asset_id));

    let video_path_str = video_path.to_string_lossy();
    let thumb_path_str = thumb_path.to_string_lossy();

    let mut cmd = Command::new("ffmpeg");
    cmd.args(&[
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
    ]);
    #[cfg(target_os = "windows")]
    cmd.creation_flags(0x08000000);

    let res = cmd.output();

    if res.is_ok() && thumb_path.exists() {
        Some(thumb_path.to_string_lossy().into_owned())
    } else {
        None
    }
}

#[tauri::command]
pub fn is_temp_path(path: &Path) -> bool {
    let temp = std::env::temp_dir();
    if let (Ok(p), Ok(t)) = (path.canonicalize(), temp.canonicalize()) {
        p.starts_with(t)
    } else {
        path.starts_with(&temp)
    }
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct PrepareResult {
    pub paths: Vec<String>,
    pub has_temp: bool,
}

#[tauri::command]
pub async fn prepare_dropped_paths(
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
pub struct ImportCheckResult {
    pub allowed_paths: Vec<String>,
    pub duplicate_paths: Vec<String>,
    pub duplicate_hashes: Vec<String>,
}

#[tauri::command]
pub async fn check_import_paths(
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
pub async fn copy_to_local_library(
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
pub async fn process_asset(
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
pub async fn read_full_text_file(path: String) -> Result<String, String> {
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
pub fn resolve_path(path: String) -> Result<String, String> {
    let p = Path::new(&path);
    let abs = if p.is_absolute() {
        p.to_path_buf()
    } else {
        std::env::current_dir().map_err(|e| e.to_string())?.join(p)
    };
    Ok(abs.to_string_lossy().into_owned())
}

#[tauri::command]
pub fn filter_known_paths(
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

#[tauri::command]
pub async fn expand_directory(path: String) -> Result<Vec<String>, String> {
    let root = Path::new(&path);
    if !root.exists() {
        return Err(format!("Path does not exist: {}", path));
    }
    let mut files = Vec::new();
    if root.is_dir() {
        for entry in WalkDir::new(root).into_iter().filter_map(|e| e.ok()) {
            if entry.file_type().is_file() {
                if let Some(ext) = entry.path().extension() {
                    let ext_str = ext.to_string_lossy().to_lowercase();
                    if ALL_EXTENSIONS.contains(&ext_str.as_str()) {
                        files.push(entry.path().to_string_lossy().into_owned());
                    }
                }
            }
        }
    } else if root.is_file() {
        if let Some(ext) = root.extension() {
            let ext_str = ext.to_string_lossy().to_lowercase();
            if ALL_EXTENSIONS.contains(&ext_str.as_str()) {
                files.push(path);
            }
        }
    }
    Ok(files)
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
