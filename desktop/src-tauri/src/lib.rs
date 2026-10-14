//! The Rust side of the desktop app: reads the Markdown files, follows their changes, lets the webview load
//! their images, and opens the links. The documents are rendered in the webview (desktop/host.ts).
//!
//! One process shows the documents, each in its window: the files given to another launch (Windows and Linux) or
//! by the Finder (macOS, `RunEvent::Opened`) open in a new window (`open_paths`).
//!
//! The commands that touch the disk are async, so that a slow share does not block the main thread. Their errors
//! are English texts, which the webview translates.

use std::collections::{HashMap, HashSet};
use std::path::{Path, PathBuf};
use std::sync::{Mutex, PoisonError};
use std::time::Duration;

use notify::{EventKind, RecommendedWatcher, RecursiveMode};
use notify_debouncer_full::{new_debouncer, DebounceEventResult, Debouncer, RecommendedCache};
use serde::Serialize;
use tauri::{AppHandle, Emitter, Manager, RunEvent, State, WebviewWindow, WebviewWindowBuilder, Window, WindowEvent};
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

/// The watcher of the folder of the file a window shows, by window label. It stops when it is dropped: when its
/// window opens another file or is closed.
#[derive(Default)]
struct Watches(Mutex<HashMap<String, Debouncer<RecommendedWatcher, RecommendedCache>>>);

/// The documents of the windows.
#[derive(Default)]
struct Windows(Mutex<WindowsState>);

/// By window label.
#[derive(Default)]
struct WindowsState {
    /// The windows whose page has asked for its first file (`initial_path`).
    started: HashSet<String>,
    /// The file given to a window by `open_paths`, until the window has opened it (`open_document`).
    pending: HashMap<String, String>,
    /// The file a window shows.
    shown: HashMap<String, String>,
    /// The number of the last window opened by `open_paths`.
    last: u32,
}

/// The images already allowed by `allow_images`.
#[derive(Default)]
struct AllowedImages(Mutex<HashSet<PathBuf>>);

/// A document read by `open_document` or `read_document`.
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

/// The path without symbolic links, as `open_document` gives it, so that a window that shows the file is found.
fn canonical(path: PathBuf) -> String {
    to_string(&dunce::canonicalize(&path).unwrap_or(path))
}

/// The files given on the command line (or by the file manager), relative to `cwd`.
fn arg_paths(args: impl IntoIterator<Item = impl Into<PathBuf>>, cwd: &Path) -> Vec<String> {
    args.into_iter()
        .map(Into::into)
        // macOS adds -psn_… when the app is started from the Finder.
        .filter(|arg| !arg.to_string_lossy().starts_with("-psn_"))
        .map(|arg| canonical(cwd.join(arg)))
        .collect()
}

/// Shows the window in front of the others, also when it is minimized.
fn bring_to_front(window: &WebviewWindow) {
    let _ = window.unminimize();
    let _ = window.set_focus();
}

/// Shows each file: in the window that shows it already, in the first window if its page has not started yet (the
/// file given to the launch), in a window that shows nothing, or else in a new window.
fn open_paths(app: &AppHandle, paths: Vec<String>) {
    let windows = app.state::<Windows>();
    for path in paths {
        let mut state = windows.0.lock().unwrap_or_else(PoisonError::into_inner);
        // Also a window being created, not listed by the app yet.
        let showing = state.shown.iter().chain(&state.pending).find(|(_, shown)| **shown == path);
        if let Some((label, _)) = showing {
            let window = app.get_webview_window(label);
            drop(state);
            if let Some(window) = window {
                bring_to_front(&window);
            }
            continue;
        }
        let labels: Vec<String> = app.webview_windows().into_keys().collect();
        let is_empty = |label: &&String| !state.shown.contains_key(*label) && !state.pending.contains_key(*label);
        // First a window whose page has not started yet.
        let empty = labels
            .iter()
            .filter(is_empty)
            .find(|label| !state.started.contains(*label))
            .or_else(|| labels.iter().find(is_empty))
            .cloned();
        if let Some(label) = empty {
            state.pending.insert(label.clone(), path.clone());
            // A page not started yet asks for it (`initial_path`).
            if state.started.contains(&label) {
                drop(state);
                let _ = app.emit_to(label.as_str(), "open-document", &path);
                if let Some(window) = app.get_webview_window(&label) {
                    bring_to_front(&window);
                }
            }
        } else {
            state.last += 1;
            let label = format!("doc-{}", state.last);
            state.pending.insert(label.clone(), path);
            drop(state);
            if let Err(error) = new_window(app, &label) {
                eprintln!("Could not open a window: {error}");
                windows.0.lock().unwrap_or_else(PoisonError::into_inner).pending.remove(&label);
            }
        }
    }
}

/// `open_paths` for the files given to the running app, not on the event loop where they arrive: creating a window
/// there would wait for the event loop (Windows).
fn open_paths_later(app: &AppHandle, paths: Vec<String>) {
    let app = app.clone();
    tauri::async_runtime::spawn(async move { open_paths(&app, paths) });
}

/// A window like the first one (tauri.conf.json).
fn new_window(app: &AppHandle, label: &str) -> tauri::Result<WebviewWindow> {
    let mut config = app.config().app.windows.first().cloned().unwrap_or_default();
    config.label = label.to_string();
    WebviewWindowBuilder::from_config(app, &config)?.build()
}

/// The file the window opens first (given to the launch, or by `open_paths`), if any.
#[tauri::command]
fn initial_path(window: Window, windows: State<'_, Windows>) -> Option<String> {
    let mut state = windows.0.lock().unwrap_or_else(PoisonError::into_inner);
    state.started.insert(window.label().to_string());
    state.pending.get(window.label()).cloned()
}

/// Reads a Markdown file for the window, and follows its changes (`document-changed`) in place of those of the
/// file the window showed before.
#[tauri::command]
async fn open_document(
    window: Window,
    watches: State<'_, Watches>,
    windows: State<'_, Windows>,
    path: String,
) -> Result<Document, String> {
    let result = read(&path);
    {
        let mut state = windows.0.lock().unwrap_or_else(PoisonError::into_inner);
        let label = window.label();
        if state.pending.get(label) == Some(&path) {
            state.pending.remove(label);
        }
        // Unless it is not read: the window still shows the previous one.
        if let Ok(document) = &result {
            state.shown.insert(label.to_string(), document.path.clone());
        }
    }
    let document = result?;
    let path = PathBuf::from(&document.path);
    let mut watches = watches.0.lock().unwrap_or_else(PoisonError::into_inner);
    // The changes of the previous file are no longer followed, even if the new watch fails.
    watches.remove(window.label());
    match watch(&window, &path) {
        Ok(watcher) => {
            watches.insert(window.label().to_string(), watcher);
        }
        // Shown without following its changes (e.g. no more inotify watches, or a share that cannot be watched).
        Err(error) => eprintln!("Could not watch {}: {error}", path.display()),
    }
    Ok(document)
}

/// Ends the app, with all its windows (File > Exit).
#[tauri::command]
fn exit(app: AppHandle) {
    app.exit(0);
}

/// Reads the file of the window again after a change, without changing what is watched.
#[tauri::command]
async fn read_document(path: String) -> Result<Document, String> {
    read(&path)
}

fn read(path: &str) -> Result<Document, String> {
    // dunce: without the \\?\ prefix std::fs::canonicalize adds on Windows.
    let path = dunce::canonicalize(path).map_err(|e| e.to_string())?;
    let bytes = std::fs::read(&path).map_err(|e| e.to_string())?;
    let mut text = String::from_utf8(bytes).map_err(|_| "The file is not UTF-8 text.".to_string())?;
    if text.starts_with('\u{feff}') {
        text.remove(0);
    }
    let dir = path.parent().ok_or("The file has no folder.")?;
    Ok(Document {
        path: to_string(&path),
        dir: to_string(dir),
        name: path.file_name().map(|name| name.to_string_lossy().into_owned()).unwrap_or_default(),
        text,
    })
}

/// Watches the folder of the file, and tells the window when the file changes.
fn watch(window: &Window, path: &Path) -> Result<Debouncer<RecommendedWatcher, RecommendedCache>, String> {
    let dir = path.parent().ok_or("The file has no folder.")?;
    let app = window.app_handle().clone();
    let label = window.label().to_string();
    let target = to_string(path);
    let name = path.file_name().map(ToOwned::to_owned);
    let mut debouncer = new_debouncer(DEBOUNCE, None, move |result: DebounceEventResult| {
        let Ok(events) = result else {
            return;
        };
        let changed = events.iter().any(|event| {
            !matches!(event.kind, EventKind::Access(_)) && event.paths.iter().any(|p| p.file_name() == name.as_deref())
        });
        if changed {
            let _ = app.emit_to(label.as_str(), "document-changed", &target);
        }
    })
    .map_err(|e| e.to_string())?;
    // The folder rather than the file: editors that write another file and rename it to the document replace the
    // file, which would end a watch of the file itself.
    debouncer.watch(dir, RecursiveMode::NonRecursive).map_err(|e| e.to_string())?;
    Ok(debouncer)
}

/// Lets the webview load these images (local images of the document) with the asset protocol.
#[tauri::command]
async fn allow_images(app: AppHandle, allowed: State<'_, AllowedImages>, paths: Vec<String>) -> Result<(), String> {
    let scope = app.asset_protocol_scope();
    let mut allowed = allowed.0.lock().unwrap_or_else(PoisonError::into_inner);
    for path in paths.into_iter().map(PathBuf::from) {
        // A missing image is looked up again on the next render: it may have been added meanwhile.
        if allowed.contains(&path) || !has_extension(&path, IMAGE_EXTENSIONS) || !path.is_file() {
            continue;
        }
        let _ = scope.allow_file(&path);
        // Also as the protocol may see it, without symbolic links.
        if let Ok(canonical) = dunce::canonicalize(&path) {
            if canonical != path {
                let _ = scope.allow_file(&canonical);
            }
        }
        allowed.insert(path);
    }
    Ok(())
}

/// Opens a web or mail link in its default app.
#[tauri::command]
async fn open_url(app: AppHandle, url: String) -> Result<(), String> {
    let lower = url.to_ascii_lowercase();
    if !["http://", "https://", "mailto:"].iter().any(|scheme| lower.starts_with(scheme)) {
        return Err("Not a web or mail link.".to_string());
    }
    app.opener().open_url(url, None::<&str>).map_err(|e| e.to_string())
}

/// Opens a linked file (not Markdown) with its default app, or shows it in its folder. A folder is shown too, not
/// opened: on macOS an app is a folder (`Tool.app`).
#[tauri::command]
async fn open_path(app: AppHandle, path: String) -> Result<(), String> {
    let path = dunce::canonicalize(&path).map_err(|e| e.to_string())?;
    let opener = app.opener();
    if path.is_file() && has_extension(&path, OPENED_EXTENSIONS) {
        opener.open_path(to_string(&path), None::<&str>)
    } else {
        opener.reveal_item_in_dir(&path)
    }
    .map_err(|e| e.to_string())
}

/// Runs the app (src/main.rs).
pub fn run() {
    tauri::Builder::default()
        // First, so that another launch ends before setting up the rest. Its files open in this process.
        .plugin(tauri_plugin_single_instance::init(|app, args, cwd| {
            let paths = arg_paths(args.into_iter().skip(1), Path::new(&cwd));
            if paths.is_empty() {
                // Launched again without a file: the app comes to the front, the first window if still open.
                let windows = app.webview_windows();
                if let Some(window) = windows.get("main").or_else(|| windows.values().next()) {
                    bring_to_front(window);
                }
            } else {
                open_paths_later(app, paths);
            }
        }))
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_opener::init())
        .manage(Watches::default())
        .manage(AllowedImages::default())
        .manage(Windows::default())
        .setup(|app| {
            let cwd = std::env::current_dir().unwrap_or_default();
            open_paths(app.handle(), arg_paths(std::env::args_os().skip(1), &cwd));
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            initial_path,
            exit,
            open_document,
            read_document,
            allow_images,
            open_url,
            open_path
        ])
        .on_window_event(|window, event| {
            if let WindowEvent::Destroyed = event {
                let label = window.label();
                window.state::<Watches>().0.lock().unwrap_or_else(PoisonError::into_inner).remove(label);
                let windows = window.state::<Windows>();
                let mut state = windows.0.lock().unwrap_or_else(PoisonError::into_inner);
                state.started.remove(label);
                state.pending.remove(label);
                state.shown.remove(label);
            }
        })
        .build(tauri::generate_context!())
        .expect("error while building the app")
        .run(on_run_event);
}

/// macOS gives the files opened from the Finder to the running app, also those of its launch (which are not on its
/// command line).
#[cfg(target_os = "macos")]
fn on_run_event(app: &AppHandle, event: RunEvent) {
    if let RunEvent::Opened { urls } = event {
        open_paths_later(app, urls.iter().filter_map(|url| url.to_file_path().ok()).map(canonical).collect());
    }
}

/// Nothing elsewhere: the files come on the command line (`setup` and the single instance).
#[cfg(not(target_os = "macos"))]
fn on_run_event(_app: &AppHandle, _event: RunEvent) {}
