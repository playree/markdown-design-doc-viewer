//! The Rust side of the desktop app: reads the Markdown files, follows their changes, lets the webview load
//! their images, and opens the links. The documents are rendered in the webview (desktop/host.ts).

use std::collections::HashMap;
use std::path::{Path, PathBuf};
use std::sync::{Mutex, PoisonError};
use std::time::Duration;

use notify::{EventKind, RecommendedWatcher, RecursiveMode};
use notify_debouncer_full::{new_debouncer, DebounceEventResult, Debouncer, RecommendedCache};
use serde::Serialize;
use tauri::{AppHandle, Emitter, Manager, State, Window, WindowEvent};
use tauri_plugin_opener::OpenerExt;

/// How long the changes of a file are gathered before the document is read again.
const DEBOUNCE: Duration = Duration::from_millis(300);

/// The images the webview may load from the disk (`allow_images`).
const IMAGE_EXTENSIONS: &[&str] = &["apng", "avif", "bmp", "gif", "ico", "jpeg", "jpg", "png", "svg", "webp"];

/// The files a link opens with their default app. The others are shown in their folder instead, so that a link
/// in a document cannot run a program.
const OPENED_EXTENSIONS: &[&str] = &[
    "apng", "avif", "bmp", "gif", "jpeg", "jpg", "png", "webp", "pdf", "txt", "log", "csv", "tsv", "json", "yaml",
    "yml", "docx", "xlsx", "pptx",
];

/// The file a window shows, with the watcher of its folder.
struct Watch {
    path: PathBuf,
    _debouncer: Debouncer<RecommendedWatcher, RecommendedCache>,
}

/// The watches by window label. A watch is dropped (and stops) when its window opens another file or is closed.
#[derive(Default)]
struct Watches(Mutex<HashMap<String, Watch>>);

/// A document read by `open_document`.
#[derive(Serialize)]
struct Document {
    /// The absolute path, without symbolic links.
    path: String,
    /// Its folder, from which the links and images are resolved.
    dir: String,
    name: String,
    text: String,
}

fn to_string(path: &Path) -> String {
    path.to_string_lossy().into_owned()
}

fn has_extension(path: &Path, extensions: &[&str]) -> bool {
    path.extension()
        .and_then(|ext| ext.to_str())
        .is_some_and(|ext| extensions.iter().any(|e| ext.eq_ignore_ascii_case(e)))
}

/// The file given on the command line (or by the file manager), if any.
#[tauri::command]
fn initial_path() -> Option<String> {
    // macOS adds -psn_… when the app is started from the Finder.
    let arg = std::env::args_os().skip(1).find(|arg| !arg.to_string_lossy().starts_with("-psn_"))?;
    let path = PathBuf::from(arg);
    Some(to_string(&dunce::canonicalize(&path).unwrap_or(path)))
}

/// Reads a Markdown file for the window, and follows its changes (`document-changed`).
#[tauri::command]
fn open_document(window: Window, watches: State<'_, Watches>, path: String) -> Result<Document, String> {
    // dunce: without the \\?\ prefix std::fs::canonicalize adds on Windows.
    let path = dunce::canonicalize(&path).map_err(|e| e.to_string())?;
    let bytes = std::fs::read(&path).map_err(|e| e.to_string())?;
    let mut text = String::from_utf8(bytes).map_err(|_| "The file is not UTF-8 text.".to_string())?;
    if text.starts_with('\u{feff}') {
        text.remove(0);
    }
    let dir = path.parent().ok_or("The file has no folder.")?;
    watch(&window, &watches, &path, dir)?;
    Ok(Document {
        path: to_string(&path),
        dir: to_string(dir),
        name: path.file_name().map(|name| name.to_string_lossy().into_owned()).unwrap_or_default(),
        text,
    })
}

fn watch(window: &Window, watches: &Watches, path: &Path, dir: &Path) -> Result<(), String> {
    let mut watches = watches.0.lock().unwrap_or_else(PoisonError::into_inner);
    let label = window.label().to_string();
    // Read again after a change: the watch goes on.
    if watches.get(&label).is_some_and(|watch| watch.path == path) {
        return Ok(());
    }
    watches.remove(&label);

    let app = window.app_handle().clone();
    let target = to_string(path);
    let name = path.file_name().map(ToOwned::to_owned);
    let window_label = label.clone();
    let mut debouncer = new_debouncer(DEBOUNCE, None, move |result: DebounceEventResult| {
        let Ok(events) = result else {
            return;
        };
        let changed = events.iter().any(|event| {
            !matches!(event.kind, EventKind::Access(_)) && event.paths.iter().any(|p| p.file_name() == name.as_deref())
        });
        if changed {
            let _ = app.emit_to(window_label.as_str(), "document-changed", &target);
        }
    })
    .map_err(|e| e.to_string())?;
    // The folder rather than the file: editors that write another file and rename it to the document replace the
    // file, which would end a watch of the file itself.
    debouncer.watch(dir, RecursiveMode::NonRecursive).map_err(|e| e.to_string())?;
    watches.insert(label, Watch { path: path.to_path_buf(), _debouncer: debouncer });
    Ok(())
}

/// Lets the webview load these images (local images of the document) with the asset protocol.
#[tauri::command]
fn allow_images(app: AppHandle, paths: Vec<String>) {
    let scope = app.asset_protocol_scope();
    for path in paths.into_iter().map(PathBuf::from) {
        if !has_extension(&path, IMAGE_EXTENSIONS) || !path.is_file() {
            continue;
        }
        let _ = scope.allow_file(&path);
        // Also as the protocol may see it, without symbolic links.
        if let Ok(canonical) = dunce::canonicalize(&path) {
            if canonical != path {
                let _ = scope.allow_file(&canonical);
            }
        }
    }
}

/// Opens a web or mail link in its default app.
#[tauri::command]
fn open_url(app: AppHandle, url: String) -> Result<(), String> {
    let lower = url.to_ascii_lowercase();
    if !["http://", "https://", "mailto:"].iter().any(|scheme| lower.starts_with(scheme)) {
        return Err(format!("Not a web or mail link: {url}"));
    }
    app.opener().open_url(url, None::<&str>).map_err(|e| e.to_string())
}

/// Opens a linked file (not Markdown) with its default app, or shows it in its folder.
#[tauri::command]
fn open_path(app: AppHandle, path: String) -> Result<(), String> {
    let path = dunce::canonicalize(&path).map_err(|e| e.to_string())?;
    let opener = app.opener();
    if path.is_dir() || has_extension(&path, OPENED_EXTENSIONS) {
        opener.open_path(to_string(&path), None::<&str>)
    } else {
        opener.reveal_item_in_dir(&path)
    }
    .map_err(|e| e.to_string())
}

pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_opener::init())
        .manage(Watches::default())
        .invoke_handler(tauri::generate_handler![initial_path, open_document, allow_images, open_url, open_path])
        .on_window_event(|window, event| {
            if let WindowEvent::Destroyed = event {
                window.state::<Watches>().0.lock().unwrap_or_else(PoisonError::into_inner).remove(window.label());
            }
        })
        .run(tauri::generate_context!())
        .expect("error while running the app");
}
