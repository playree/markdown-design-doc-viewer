//! The Rust side of the desktop app: reads the Markdown files, follows their changes, lists the Markdown files of a
//! folder for the sidebar, lets the webview load their images, opens the links, saves the HTML exports, reads the git
//! history of the documents, and switches the branch of their repository or pulls it. The documents are rendered in
//! the webview (desktop/host.ts).
//!
//! One process shows the documents, each in its window: the files given to another launch (Windows and Linux) or
//! by the Finder (macOS, `RunEvent::Opened`) open in a new window (`open_paths`).
//!
//! The commands that touch the disk are async, so that a slow share does not block the main thread. Their errors
//! are English texts, which the webview translates.

use std::collections::{HashMap, HashSet};
use std::ffi::{OsStr, OsString};
use std::io::Read;
use std::path::{Path, PathBuf};
use std::process::{Child, Command, Output, Stdio};
use std::sync::mpsc::{self, Receiver};
use std::sync::{Mutex, PoisonError};
use std::time::{Duration, Instant};

use notify::event::ModifyKind;
use notify::{EventKind, RecommendedWatcher, RecursiveMode};
use notify_debouncer_full::{new_debouncer, new_debouncer_opt, DebounceEventResult, Debouncer, NoCache, RecommendedCache};
use serde::Serialize;
use tauri::ipc::Response;
use tauri::{AppHandle, Emitter, Manager, RunEvent, State, WebviewWindow, WebviewWindowBuilder, Window, WindowEvent};
use tauri_plugin_dialog::DialogExt;
use tauri_plugin_opener::OpenerExt;

/// How long the changes of a file are gathered before the document is read again.
const DEBOUNCE: Duration = Duration::from_millis(300);

/// The files the app opens itself, and the sidebar lists.
const MARKDOWN_EXTENSIONS: &[&str] = &["md", "markdown"];

/// The folders the sidebar does not look into, besides the hidden ones (`.git`…).
const SKIPPED_FOLDERS: &[&str] = &["node_modules"];

/// How deep the sidebar looks into the subfolders of its folder, and how many files and folders it looks at: a folder
/// such as the home folder is listed in part rather than taking long.
const MAX_DEPTH: usize = 12;
const MAX_ENTRIES: usize = 20_000;

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

/// The watcher of the folders the sidebar of a window lists, by window label. It stops when it is dropped: when the
/// window lists them again, lists another folder or is closed.
#[derive(Default)]
struct FolderWatches(Mutex<HashMap<String, FolderWatcher>>);

type FolderWatcher = Debouncer<RecommendedWatcher, NoCache>;

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

/// The file each window exports to, by window label: chosen by the user in `choose_export_target`, it is the only
/// file `write_export` writes and `open_export` opens, so that the webview cannot write elsewhere.
#[derive(Default)]
struct ExportTargets(Mutex<HashMap<String, PathBuf>>);

/// The git history of the document of each window, by window label, as `git_log` last listed it: `git_show` reads
/// only its commits and paths, so that the webview cannot read the other files of the repository.
#[derive(Default)]
struct Histories(Mutex<HashMap<String, History>>);

struct History {
    /// The document whose history it is.
    file: String,
    /// Its commits, each with the path of the document in it, from the root of the repository.
    revisions: HashSet<(String, String)>,
}

/// The branches of the repository of the document of each window, by window label, as `git_branches` last listed
/// them: `git_switch` switches only to one of them.
#[derive(Default)]
struct BranchLists(Mutex<HashMap<String, ListedBranches>>);

struct ListedBranches {
    /// The document whose repository has them.
    file: String,
    local: HashSet<String>,
    remote: HashSet<String>,
}

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

/// The Markdown files of a folder and of its subfolders, for the sidebar (`open_folder`). Only the subfolders that
/// have Markdown files, in no particular order (the webview sorts them).
#[derive(Serialize)]
struct Folder {
    path: String,
    name: String,
    folders: Vec<Folder>,
    files: Vec<FileEntry>,
}

/// A Markdown file of a `Folder`.
#[derive(Serialize)]
struct FileEntry {
    path: String,
    name: String,
}

/// What `open_folder` returns.
#[derive(Serialize)]
struct FolderTree {
    root: Folder,
    /// true when the folder has more files or subfolders than `MAX_ENTRIES` or `MAX_DEPTH` let the sidebar list.
    truncated: bool,
    /// false when the changes of the list are not followed: the folder could not be watched.
    watching: bool,
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

/// The error of `read` when the file is not there (`FILE_NOT_FOUND` in desktop/host.ts).
const FILE_NOT_FOUND: &str = "The file was not found.";

fn read(path: &str) -> Result<Document, String> {
    // dunce: without the \\?\ prefix std::fs::canonicalize adds on Windows.
    // A text the webview tells apart (a document not in the branch switched to) and translates, unlike the error of
    // the system.
    let path = dunce::canonicalize(path).map_err(|e| {
        if e.kind() == std::io::ErrorKind::NotFound {
            FILE_NOT_FOUND.to_string()
        } else {
            e.to_string()
        }
    })?;
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

/// Lists the Markdown files of a folder and of its subfolders for the sidebar of the window, and follows the
/// changes of their list (`folder-changed`) in place of those of the folder it listed before.
#[tauri::command]
async fn open_folder(window: Window, watches: State<'_, FolderWatches>, path: String) -> Result<FolderTree, String> {
    let root = dunce::canonicalize(&path).map_err(|e| e.to_string())?;
    if !root.is_dir() {
        return Err("Not a folder.".to_string());
    }
    let mut scan = Scan::default();
    let tree = scan_folder(&root, 0, &mut scan);
    // Before taking the lock, which the other windows (and their closing, on the main thread) wait for.
    let watcher = watch_folders(&window, &root, scan.folders);
    let watching = match &watcher {
        Ok(_) => true,
        // Listed without following its changes, which the sidebar tells.
        Err(error) => {
            eprintln!("Could not watch {}: {error}", root.display());
            false
        }
    };
    // The changes of the previous list are no longer followed, even if the new watch failed. The previous watcher
    // stops once the lock is released.
    let _previous = {
        let mut watches = watches.0.lock().unwrap_or_else(PoisonError::into_inner);
        match watcher {
            Ok(watcher) => watches.insert(window.label().to_string(), watcher),
            Err(_) => watches.remove(window.label()),
        }
    };
    Ok(FolderTree { root: tree, truncated: scan.truncated, watching })
}

/// Stops following the changes of the folder the sidebar of the window listed: the sidebar is hidden. On Windows, the
/// watch would keep the folder (and those above it) from being renamed or deleted.
#[tauri::command]
fn close_folder(window: Window, watches: State<'_, FolderWatches>) {
    let _previous = watches.0.lock().unwrap_or_else(PoisonError::into_inner).remove(window.label());
}

/// The beginning of a Markdown file that starts with a front matter, for the list of the design documents
/// (`read_design_docs`).
#[derive(Serialize)]
struct FileHead {
    path: String,
    name: String,
    /// Its folder under the one listed, with `/` (`""` at its top).
    folder: String,
    /// Its first `HEAD_BYTES` (fewer at the end of a character), without a BOM.
    head: String,
}

/// What `read_design_docs` returns.
#[derive(Serialize)]
struct FileHeads {
    files: Vec<FileHead>,
    /// As for the sidebar (`FolderTree`): some files were not looked at.
    truncated: bool,
}

/// How much of a file `read_design_docs` reads: enough for its front matter and title.
const HEAD_BYTES: u64 = 64 * 1024;

/// The Markdown files of a folder and of its subfolders (those the sidebar lists) that start with a front matter, with
/// their beginning: the webview tells the design documents (`type: design_doc`) and lists them with their title and
/// main entries, as the extension does.
#[tauri::command]
async fn read_design_docs(path: String) -> Result<FileHeads, String> {
    let root = dunce::canonicalize(&path).map_err(|e| e.to_string())?;
    if !root.is_dir() {
        return Err("Not a folder.".to_string());
    }
    let mut scan = Scan::default();
    let tree = scan_folder(&root, 0, &mut scan);
    let mut files = Vec::new();
    collect_heads(&tree, &root, &mut files);
    Ok(FileHeads { files, truncated: scan.truncated })
}

/// The files of `folder` and of its subfolders that start with a front matter (`read_head`).
fn collect_heads(folder: &Folder, root: &Path, files: &mut Vec<FileHead>) {
    let relative = Path::new(&folder.path)
        .strip_prefix(root)
        .map(|path| path.components().map(|c| c.as_os_str().to_string_lossy()).collect::<Vec<_>>().join("/"))
        .unwrap_or_default();
    for file in &folder.files {
        if let Some(head) = read_head(Path::new(&file.path)) {
            files.push(FileHead { path: file.path.clone(), name: file.name.clone(), folder: relative.clone(), head });
        }
    }
    for sub in &folder.folders {
        collect_heads(sub, root, files);
    }
}

/// The beginning of a UTF-8 file that starts with `---` (after a BOM), cut at the end of its last whole character.
/// Only its first bytes are read from the other files.
fn read_head(path: &Path) -> Option<String> {
    const BOM: &[u8] = b"\xEF\xBB\xBF";
    let mut file = std::fs::File::open(path).ok()?;
    let mut bytes = Vec::new();
    file.by_ref().take(6).read_to_end(&mut bytes).ok()?;
    if !bytes.strip_prefix(BOM).unwrap_or(&bytes).starts_with(b"---") {
        return None;
    }
    file.take(HEAD_BYTES - 6).read_to_end(&mut bytes).ok()?;
    let bytes = bytes.strip_prefix(BOM).unwrap_or(&bytes);
    match std::str::from_utf8(bytes) {
        Ok(text) => Some(text.to_string()),
        // Cut in the middle of a character.
        Err(error) if error.error_len().is_none() => Some(String::from_utf8_lossy(&bytes[..error.valid_up_to()]).into_owned()),
        Err(_) => None,
    }
}

/// Whether the path is a folder: for a folder dropped on the window.
#[tauri::command]
async fn is_folder(path: String) -> bool {
    Path::new(&path).is_dir()
}

/// What `scan_folder` has looked at.
#[derive(Default)]
struct Scan {
    /// The number of files and folders looked at.
    entries: usize,
    truncated: bool,
    /// The folders listed, from the top, to watch: also those without Markdown files, in which some may be added.
    folders: Vec<PathBuf>,
}

/// A file or folder the sidebar does not list: a hidden one (`.git`), or a folder of `SKIPPED_FOLDERS`.
fn is_skipped(name: &OsStr) -> bool {
    name.to_string_lossy().starts_with('.') || SKIPPED_FOLDERS.iter().any(|skipped| name == *skipped)
}

/// The Markdown files of `dir` and of its subfolders, `depth` folders below the one of the sidebar. The symbolic links
/// to folders are not followed, so that a link to a folder above does not list it again and again.
fn scan_folder(dir: &Path, depth: usize, scan: &mut Scan) -> Folder {
    scan.folders.push(dir.to_path_buf());
    let mut folder = Folder {
        path: to_string(dir),
        // A root (`C:\`, `/`) has no name.
        name: dir.file_name().map_or_else(|| to_string(dir), |name| name.to_string_lossy().into_owned()),
        folders: Vec::new(),
        files: Vec::new(),
    };
    // A folder that cannot be read is listed without its files.
    let Ok(entries) = std::fs::read_dir(dir) else {
        return folder;
    };
    for entry in entries.flatten() {
        if scan.entries >= MAX_ENTRIES {
            scan.truncated = true;
            break;
        }
        scan.entries += 1;
        let name = entry.file_name();
        if is_skipped(&name) {
            continue;
        }
        let Ok(file_type) = entry.file_type() else {
            continue;
        };
        let path = entry.path();
        if file_type.is_dir() {
            if depth >= MAX_DEPTH {
                scan.truncated = true;
                continue;
            }
            let sub = scan_folder(&path, depth + 1, scan);
            if !sub.folders.is_empty() || !sub.files.is_empty() {
                folder.folders.push(sub);
            }
        } else if has_extension(&path, MARKDOWN_EXTENSIONS) && (file_type.is_file() || path.is_file()) {
            folder.files.push(FileEntry {
                // A symbolic link to a file as `open_document` gives it, so that the sidebar finds the document shown.
                path: if file_type.is_symlink() { canonical(path) } else { to_string(&path) },
                name: name.to_string_lossy().into_owned(),
            });
        }
    }
    folder
}

/// Whether a change of `path` may change the list of the sidebar, whose `folders` were listed: a Markdown file or a
/// folder added, removed or renamed in them, or one of them removed or renamed. Not the files of other types, nor
/// the folders it skips or did not look into (`MAX_DEPTH`, `MAX_ENTRIES`), whose changes may be many.
fn changes_list(folders: &HashSet<PathBuf>, path: &Path) -> bool {
    if folders.contains(path) {
        return true;
    }
    path.file_name().is_some_and(|name| !is_skipped(name))
        && path.parent().is_some_and(|parent| folders.contains(parent))
        && (has_extension(path, MARKDOWN_EXTENSIONS) || path.is_dir())
}

/// Watches the folders the sidebar lists, and tells the window when a Markdown file or a folder is added, removed or
/// renamed in them. Without the cache of file ids of the debouncer, which would read all the folders below `root`
/// (the renames are not followed: the folder is listed again).
fn watch_folders(window: &Window, root: &Path, folders: Vec<PathBuf>) -> Result<FolderWatcher, String> {
    let app = window.app_handle().clone();
    let label = window.label().to_string();
    let target = to_string(root);
    let listed: HashSet<PathBuf> = folders.iter().cloned().collect();
    let handler = move |result: DebounceEventResult| {
        let Ok(events) = result else {
            return;
        };
        let changed = events.iter().any(|event| {
            matches!(
                event.kind,
                EventKind::Any | EventKind::Create(_) | EventKind::Remove(_) | EventKind::Modify(ModifyKind::Name(_))
            ) && event.paths.iter().any(|path| changes_list(&listed, path))
        });
        if changed {
            let _ = app.emit_to(label.as_str(), "folder-changed", &target);
        }
    };
    let mut debouncer = new_debouncer_opt(DEBOUNCE, None, handler, NoCache, notify::Config::default())
        .map_err(|e| e.to_string())?;
    watch_listed(&mut debouncer, root, &folders)?;
    Ok(debouncer)
}

/// How many folders the sidebar of a window watches on Linux, where each one takes an inotify watch of the user's
/// limited number (`fs.inotify.max_user_watches`), shared with the other apps. The changes in the others are not
/// followed.
#[cfg(target_os = "linux")]
const MAX_WATCHED_FOLDERS: usize = 1_000;

/// Linux: each folder listed on its own, rather than all those below `root`, which inotify would watch one by one,
/// also those the sidebar skips (`.git`, `node_modules`).
#[cfg(target_os = "linux")]
fn watch_listed(debouncer: &mut FolderWatcher, root: &Path, folders: &[PathBuf]) -> Result<(), String> {
    for folder in folders.iter().take(MAX_WATCHED_FOLDERS) {
        match debouncer.watch(folder, RecursiveMode::NonRecursive) {
            Ok(()) => {}
            // The others are still watched (e.g. no more inotify watches for this one).
            Err(error) if folder != root => eprintln!("Could not watch {}: {error}", folder.display()),
            Err(error) => return Err(error.to_string()),
        }
    }
    Ok(())
}

/// Windows and macOS: the whole folder at once. On Windows, a watch of each subfolder would keep the folders above it
/// from being renamed or deleted.
#[cfg(not(target_os = "linux"))]
fn watch_listed(debouncer: &mut FolderWatcher, root: &Path, _folders: &[PathBuf]) -> Result<(), String> {
    debouncer.watch(root, RecursiveMode::Recursive).map_err(|e| e.to_string())
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

/// Asks where to save the HTML export of the window's document, starting from `name` in `dir`. None when canceled.
#[tauri::command]
async fn choose_export_target(
    window: Window,
    targets: State<'_, ExportTargets>,
    dir: String,
    name: String,
    title: String,
) -> Result<Option<String>, String> {
    // Blocking is fine here: an async command does not run on the main thread, where the dialog is shown.
    let chosen = window
        .dialog()
        .file()
        .set_parent(&window)
        .set_title(title)
        .set_directory(dir)
        .set_file_name(name)
        .add_filter("HTML", &["html", "htm"])
        .blocking_save_file();
    let Some(chosen) = chosen else {
        return Ok(None);
    };
    let mut path = chosen.into_path().map_err(|e| e.to_string())?;
    // Always an HTML file, also when the dialog does not add the extension of its filter (GTK), so that
    // `open_export` opens it in the browser rather than in another app.
    if !has_extension(&path, &["html", "htm"]) {
        let mut name = path.file_name().unwrap_or_default().to_owned();
        name.push(".html");
        path.set_file_name(name);
    }
    let result = to_string(&path);
    targets.0.lock().unwrap_or_else(PoisonError::into_inner).insert(window.label().to_string(), path);
    Ok(Some(result))
}

/// The file chosen to export to in the window.
fn export_target(window: &Window, targets: &ExportTargets) -> Result<PathBuf, String> {
    let targets = targets.0.lock().unwrap_or_else(PoisonError::into_inner);
    targets.get(window.label()).cloned().ok_or_else(|| "No file was chosen to export to.".to_string())
}

/// Saves the HTML export of the window's document, to the file chosen for it (`choose_export_target`).
#[tauri::command]
async fn write_export(window: Window, targets: State<'_, ExportTargets>, html: String) -> Result<(), String> {
    let target = export_target(&window, &targets)?;
    std::fs::write(target, html).map_err(|e| e.to_string())
}

/// Opens the HTML export of the window's document in the default browser.
#[tauri::command]
async fn open_export(app: AppHandle, window: Window, targets: State<'_, ExportTargets>) -> Result<(), String> {
    let target = export_target(&window, &targets)?;
    app.opener().open_path(to_string(&target), None::<&str>).map_err(|e| e.to_string())
}

/// Reads a local image of the window's document for its HTML export, as raw bytes. Only an image file in the folder of
/// the document (or below it), also when its symbolic links are followed: the export links the others instead of
/// embedding them, as the extension does with the images outside the folders its preview shows.
#[tauri::command]
async fn read_image(window: Window, windows: State<'_, Windows>, path: String) -> Result<Response, String> {
    let document = shown_document(&window, &windows);
    let folder = document.as_deref().map(Path::new).and_then(Path::parent).ok_or("The window shows no document.")?;
    let path = dunce::canonicalize(&path).map_err(|e| e.to_string())?;
    if !path.is_file() || !has_extension(&path, IMAGE_EXTENSIONS) || !path.starts_with(folder) {
        return Err("Not an image in the folder of the document.".to_string());
    }
    std::fs::read(&path).map(Response::new).map_err(|e| e.to_string())
}

/// The file the window shows.
fn shown_document(window: &Window, windows: &Windows) -> Option<String> {
    windows.0.lock().unwrap_or_else(PoisonError::into_inner).shown.get(window.label()).cloned()
}

// ---------------------------------------------------------------------------
// Git history of the document of a window, which the webview compares it with (the sidebar's History tab).

/// The arguments of `git log` listing the commits of a file (given after them), the same as `gitLogArgs` in
/// src/gitLog.ts (whose test checks them), which parses the output (`parseGitLog`).
const GIT_LOG_ARGS: &[&str] = &[
    "log",
    "--follow",
    "-z",
    "--diff-filter=d",
    "-n200",
    "--format=%x1e%H%x1f%h%x1f%an%x1f%aI%x1f%s",
    "--name-only",
    "--",
];

/// Why git could not give the history (`GitErrorKind` in src/gitCli.ts).
#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
enum GitErrorKind {
    NotFound,
    NotRepository,
    Failed,
}

/// The error of the git commands (`git_log`…): its message is an English text of git or of the app.
#[derive(Serialize)]
struct GitError {
    kind: GitErrorKind,
    message: String,
}

impl GitError {
    fn failed(message: impl Into<String>) -> Self {
        GitError { kind: GitErrorKind::Failed, message: message.into() }
    }
}

/// The git to run: on the PATH, or on macOS that of Homebrew first. An app started from the Finder has only the
/// folders of the system on its PATH, whose git (/usr/bin/git) asks to install the Command Line Tools when they are
/// missing.
#[cfg(target_os = "macos")]
fn git_program() -> PathBuf {
    ["/opt/homebrew/bin/git", "/usr/local/bin/git"]
        .iter()
        .map(PathBuf::from)
        .find(|path| path.is_file())
        .unwrap_or_else(|| PathBuf::from("git"))
}

#[cfg(not(target_os = "macos"))]
fn git_program() -> PathBuf {
    PathBuf::from("git")
}

/// How long `git pull` may take: it is stopped after that, e.g. when ssh waits for a passphrase nobody can type.
const GIT_PULL_TIMEOUT: Duration = Duration::from_secs(120);

/// The arguments of a git command.
fn git_args(args: &[&str]) -> Vec<OsString> {
    args.iter().map(OsString::from).collect()
}

/// Runs git in `dir`, without a shell (nor a console window on Windows), and returns what it writes.
async fn run_git(dir: PathBuf, args: Vec<OsString>) -> Result<Vec<u8>, GitError> {
    run_git_with(dir, args, None).await
}

/// `run_git`, stopping git after `timeout` when given.
async fn run_git_with(dir: PathBuf, args: Vec<OsString>, timeout: Option<Duration>) -> Result<Vec<u8>, GitError> {
    tauri::async_runtime::spawn_blocking(move || {
        let mut command = Command::new(git_program());
        command
            // Not the fsmonitor of the repository, which would start a daemon (or run a hook) for a read, nor the
            // check of the signatures, which would run the gpg program of the repository's config for each commit.
            .args(["-c", "core.fsmonitor=false", "-c", "log.showSignature=false"])
            .args(&args)
            .current_dir(&dir)
            // The messages in English, which are told apart below.
            .env("LC_ALL", "C")
            // No prompt for a user name or a password (`git pull`), which nobody would answer.
            .env("GIT_TERMINAL_PROMPT", "0")
            .stdin(Stdio::null())
            .stdout(Stdio::piped())
            .stderr(Stdio::piped());
        #[cfg(windows)]
        {
            use std::os::windows::process::CommandExt;
            const CREATE_NO_WINDOW: u32 = 0x0800_0000;
            command.creation_flags(CREATE_NO_WINDOW);
        }
        let child = command.spawn().map_err(|error| GitError {
            // Not when the folder is missing (the document's folder deleted or renamed), which fails the same way.
            kind: if error.kind() == std::io::ErrorKind::NotFound && dir.is_dir() {
                GitErrorKind::NotFound
            } else {
                GitErrorKind::Failed
            },
            message: error.to_string(),
        })?;
        let output = match timeout {
            Some(timeout) => wait_until(child, timeout)?,
            None => child.wait_with_output().map_err(|error| GitError::failed(error.to_string()))?,
        };
        if output.status.success() {
            return Ok(output.stdout);
        }
        // Without the hints on the commands to run instead (`git pull` diverging), which the user does not run here.
        let stderr = String::from_utf8_lossy(&output.stderr)
            .lines()
            .filter(|line| !line.starts_with("hint:"))
            .collect::<Vec<_>>()
            .join("\n")
            .trim()
            .to_string();
        if stderr.to_ascii_lowercase().contains("not a git repository") {
            return Err(GitError { kind: GitErrorKind::NotRepository, message: stderr });
        }
        Err(GitError::failed(if stderr.is_empty() { output.status.to_string() } else { stderr }))
    })
    .await
    .map_err(|error| GitError::failed(error.to_string()))?
}

/// Reads all of a pipe of a child process on another thread.
fn read_pipe(pipe: Option<impl Read + Send + 'static>) -> Receiver<Vec<u8>> {
    let (sender, receiver) = mpsc::channel();
    std::thread::spawn(move || {
        let mut bytes = Vec::new();
        if let Some(mut pipe) = pipe {
            let _ = pipe.read_to_end(&mut bytes);
        }
        let _ = sender.send(bytes);
    });
    receiver
}

/// Waits for git to end, and kills it after `timeout`.
fn wait_until(mut child: Child, timeout: Duration) -> Result<Output, GitError> {
    let failed = |error: std::io::Error| GitError::failed(error.to_string());
    // Read while it runs, so that it does not wait for its pipes to be read.
    let stdout = read_pipe(child.stdout.take());
    let stderr = read_pipe(child.stderr.take());
    let deadline = Instant::now() + timeout;
    let status = loop {
        if let Some(status) = child.try_wait().map_err(failed)? {
            break status;
        }
        if Instant::now() >= deadline {
            let _ = child.kill();
            let _ = child.wait();
            // Without waiting for the pipes, which a program started by git (ssh) may keep open.
            return Err(GitError::failed("Git did not finish in time."));
        }
        std::thread::sleep(Duration::from_millis(100));
    };
    // A program started by git may still hold them for a moment.
    let read = |receiver: Receiver<Vec<u8>>| receiver.recv_timeout(Duration::from_secs(5)).unwrap_or_default();
    Ok(Output { status, stdout: read(stdout), stderr: read(stderr) })
}

/// Lists the commits of the window's document with `git log` (the output of `GIT_LOG_ARGS`, which the webview
/// parses), and keeps them for `git_show`. Only that document: the webview gives no path.
#[tauri::command]
async fn git_log(window: Window, windows: State<'_, Windows>, histories: State<'_, Histories>) -> Result<String, GitError> {
    let file = shown_document(&window, &windows).ok_or_else(|| GitError::failed("The window shows no document."))?;
    let path = Path::new(&file);
    let (Some(dir), Some(name)) = (path.parent(), path.file_name()) else {
        return Err(GitError::failed("The file has no folder."));
    };
    let mut args = git_args(GIT_LOG_ARGS);
    args.push(name.to_owned());
    let output = String::from_utf8_lossy(&run_git(dir.to_path_buf(), args).await?).into_owned();
    let history = History { file: file.clone(), revisions: logged_revisions(&output) };
    // Unless the window opened another document meanwhile, whose history may have been read already.
    if shown_document(&window, &windows).as_ref() == Some(&file) {
        histories.0.lock().unwrap_or_else(PoisonError::into_inner).insert(window.label().to_string(), history);
    }
    Ok(output)
}

/// The commits of the output of `git log` with `GIT_LOG_ARGS`, each with the path of the file in it, as `parseGitLog`
/// in src/gitLog.ts reads them: `\x1e<hash>\x1f…\0`, then `\n<path>\0` (none for a merge, which has the path of the
/// commit before it, or else after it).
fn logged_revisions(output: &str) -> HashSet<(String, String)> {
    let mut revisions: Vec<(String, Option<String>)> = Vec::new();
    for record in output.split('\x1e').skip(1) {
        let mut parts = record.split('\0');
        let Some(hash) = parts.next().and_then(|header| header.split('\x1f').next()).filter(|hash| !hash.is_empty())
        else {
            continue;
        };
        let path = parts.map(|part| part.strip_prefix('\n').unwrap_or(part)).find(|part| !part.is_empty());
        revisions.push((hash.to_string(), path.map(str::to_string)));
    }
    for i in (0..revisions.len().saturating_sub(1)).rev() {
        if revisions[i].1.is_none() {
            revisions[i].1 = revisions[i + 1].1.clone();
        }
    }
    for i in 1..revisions.len() {
        if revisions[i].1.is_none() {
            revisions[i].1 = revisions[i - 1].1.clone();
        }
    }
    revisions.into_iter().filter_map(|(hash, path)| Some((hash, path?))).collect()
}

/// The content of the window's document in a commit listed by `git_log`, at its path in that commit.
#[tauri::command]
async fn git_show(
    window: Window,
    windows: State<'_, Windows>,
    histories: State<'_, Histories>,
    hash: String,
    path: String,
) -> Result<String, GitError> {
    let file = shown_document(&window, &windows).ok_or_else(|| GitError::failed("The window shows no document."))?;
    let listed = histories
        .0
        .lock()
        .unwrap_or_else(PoisonError::into_inner)
        .get(window.label())
        .is_some_and(|history| history.file == file && history.revisions.contains(&(hash.clone(), path.clone())));
    if !listed {
        return Err(GitError::failed("Not a commit of the history of the document."));
    }
    let dir = Path::new(&file).parent().ok_or_else(|| GitError::failed("The file has no folder."))?;
    let bytes = run_git(dir.to_path_buf(), vec!["show".into(), format!("{hash}:{path}").into()]).await?;
    let mut text = String::from_utf8(bytes).map_err(|_| GitError::failed("The file is not UTF-8 text."))?;
    if text.starts_with('\u{feff}') {
        text.remove(0);
    }
    Ok(text)
}

/// The branches of the repository of a document, for the History tab (`git_branches`).
#[derive(Serialize, Debug, PartialEq)]
struct BranchList {
    /// The branch checked out: none when HEAD is detached.
    current: Option<String>,
    /// The short hash of the commit checked out when HEAD is detached.
    detached: Option<String>,
    /// The local branches, with the current one, also before its first commit.
    local: Vec<String>,
    /// The branches of the remotes (`origin/feature`) that have no local branch of the same name yet: switching to
    /// one creates it.
    remote: Vec<String>,
}

/// The folder git runs in for the document `file`: its folder, or the nearest one above it that is there (after
/// switching to a branch without it), so that its repository can be switched back.
fn git_dir(file: &str) -> Result<PathBuf, GitError> {
    Path::new(file)
        .ancestors()
        .skip(1)
        .find(|dir| dir.is_dir())
        .map(Path::to_path_buf)
        .ok_or_else(|| GitError::failed("The file has no folder."))
}

/// The arguments of `git for-each-ref` listing the branches, each on a line, after `*` for the one checked out (else
/// a space), which `parse_branches` reads.
const GIT_BRANCHES_ARGS: &[&str] = &["for-each-ref", "--format=%(HEAD)%(refname)", "refs/heads", "refs/remotes"];

/// The branch checked out in the output of `git for-each-ref` with `GIT_BRANCHES_ARGS`: none when HEAD is detached,
/// or before the first commit of the branch.
fn checked_out(refs: &str) -> Option<String> {
    refs.lines().find_map(|line| line.strip_prefix("*refs/heads/")).map(str::to_string)
}

/// The branches of the output of `git for-each-ref` with `GIT_BRANCHES_ARGS`, given the names of the remotes
/// (`git remote`) and the branch checked out.
fn parse_branches(refs: &str, remotes: &str, current: Option<String>, detached: Option<String>) -> BranchList {
    let remotes: Vec<&str> = remotes.lines().map(str::trim).filter(|remote| !remote.is_empty()).collect();
    let mut local: Vec<String> = Vec::new();
    let mut remote: Vec<(String, String)> = Vec::new();
    for line in refs.lines() {
        let refname = line.get(1..).unwrap_or_default();
        if let Some(name) = refname.strip_prefix("refs/heads/") {
            local.push(name.to_string());
        } else if let Some(name) = refname.strip_prefix("refs/remotes/") {
            // Without the longest remote it starts with: a remote may have a `/` in its name.
            let branch = remotes
                .iter()
                .filter_map(|remote| name.strip_prefix(remote).and_then(|rest| rest.strip_prefix('/')))
                .min_by_key(|branch| branch.len());
            // Not `origin/HEAD`, which points to another branch of the remote.
            if let Some(branch) = branch.filter(|branch| *branch != "HEAD") {
                remote.push((name.to_string(), branch.to_string()));
            }
        }
    }
    if let Some(current) = current.as_ref().filter(|current| !local.contains(current)) {
        local.push(current.clone());
        local.sort();
    }
    let remote = remote.into_iter().filter(|(_, branch)| !local.contains(branch)).map(|(name, _)| name).collect();
    BranchList { detached: if current.is_none() { detached } else { None }, current, local, remote }
}

/// What git writes, without the line break at its end.
fn git_text(bytes: Vec<u8>) -> String {
    String::from_utf8_lossy(&bytes).trim().to_string()
}

/// Lists the branches of the repository of the window's document, and keeps them for `git_switch`.
#[tauri::command]
async fn git_branches(
    window: Window,
    windows: State<'_, Windows>,
    lists: State<'_, BranchLists>,
) -> Result<BranchList, GitError> {
    let file = shown_document(&window, &windows).ok_or_else(|| GitError::failed("The window shows no document."))?;
    let dir = git_dir(&file)?;
    let refs = String::from_utf8_lossy(&run_git(dir.clone(), git_args(GIT_BRANCHES_ARGS)).await?).into_owned();
    let remotes = run_git(dir.clone(), git_args(&["remote"])).await?;
    let mut current = checked_out(&refs);
    let mut detached = None;
    if current.is_none() {
        // A branch without commits yet, which has no ref, else a detached HEAD (empty).
        let branch = git_text(run_git(dir.clone(), git_args(&["branch", "--show-current"])).await?);
        if branch.is_empty() {
            detached = run_git(dir, git_args(&["rev-parse", "--short", "HEAD"])).await.ok().map(git_text);
        } else {
            current = Some(branch);
        }
    }
    let list = parse_branches(&refs, &String::from_utf8_lossy(&remotes), current, detached);
    // Unless the window opened another document meanwhile.
    if shown_document(&window, &windows).as_ref() == Some(&file) {
        let listed = ListedBranches {
            file,
            local: list.local.iter().cloned().collect(),
            remote: list.remote.iter().cloned().collect(),
        };
        lists.0.lock().unwrap_or_else(PoisonError::into_inner).insert(window.label().to_string(), listed);
    }
    Ok(list)
}

/// Switches the repository of the window's document to one of the branches listed by `git_branches`: a local one,
/// or a branch of a remote (`remote`), for which a local branch that tracks it is created. git fails and changes
/// nothing when the changes not committed would be lost.
#[tauri::command]
async fn git_switch(
    window: Window,
    windows: State<'_, Windows>,
    lists: State<'_, BranchLists>,
    name: String,
    remote: bool,
) -> Result<(), GitError> {
    let file = shown_document(&window, &windows).ok_or_else(|| GitError::failed("The window shows no document."))?;
    let listed = lists.0.lock().unwrap_or_else(PoisonError::into_inner).get(window.label()).is_some_and(|list| {
        list.file == file && if remote { list.remote.contains(&name) } else { list.local.contains(&name) }
    });
    // Not an option either, though git does not let a branch start with `-`.
    if !listed || name.starts_with('-') {
        return Err(GitError::failed("Not a branch of the repository of the document."));
    }
    let mut args = git_args(&["switch"]);
    if remote {
        args.push("--track".into());
    }
    args.push(name.into());
    run_git(git_dir(&file)?, args).await.map(drop)
}

/// What `git_pull` returns.
#[derive(Serialize)]
struct Pulled {
    /// Whether commits were pulled: false when the branch was up to date.
    updated: bool,
}

/// Pulls the branch of the repository of the window's document, only when it can be fast-forwarded: git fails when
/// the branch has commits of its own, has no upstream, or when the changes not committed would be lost.
#[tauri::command]
async fn git_pull(window: Window, windows: State<'_, Windows>) -> Result<Pulled, GitError> {
    let file = shown_document(&window, &windows).ok_or_else(|| GitError::failed("The window shows no document."))?;
    let dir = git_dir(&file)?;
    let head = || run_git(dir.clone(), git_args(&["rev-parse", "HEAD"]));
    let before = head().await.ok();
    // Not a rebase either, whatever the config of the repository (`pull.rebase`). Quiet: only the errors, without the
    // progress of the fetch.
    let args = git_args(&["pull", "--quiet", "--no-rebase", "--ff-only"]);
    run_git_with(dir.clone(), args, Some(GIT_PULL_TIMEOUT)).await?;
    let after = head().await.ok();
    Ok(Pulled { updated: before != after })
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
        .manage(FolderWatches::default())
        .manage(AllowedImages::default())
        .manage(Windows::default())
        .manage(ExportTargets::default())
        .manage(Histories::default())
        .manage(BranchLists::default())
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
            open_folder,
            close_folder,
            read_design_docs,
            is_folder,
            allow_images,
            open_url,
            open_path,
            choose_export_target,
            write_export,
            open_export,
            read_image,
            git_log,
            git_show,
            git_branches,
            git_switch,
            git_pull
        ])
        .on_window_event(|window, event| {
            if let WindowEvent::Destroyed = event {
                let label = window.label();
                window.state::<Watches>().0.lock().unwrap_or_else(PoisonError::into_inner).remove(label);
                window.state::<FolderWatches>().0.lock().unwrap_or_else(PoisonError::into_inner).remove(label);
                window.state::<ExportTargets>().0.lock().unwrap_or_else(PoisonError::into_inner).remove(label);
                window.state::<Histories>().0.lock().unwrap_or_else(PoisonError::into_inner).remove(label);
                window.state::<BranchLists>().0.lock().unwrap_or_else(PoisonError::into_inner).remove(label);
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

#[cfg(test)]
mod tests {
    use super::*;

    fn record(hash: &str, path: Option<&str>) -> String {
        let path = path.map(|path| format!("\n{path}\0")).unwrap_or_default();
        format!("\x1e{hash}\x1f{}\x1fAuthor\x1f2026-10-01T12:00:00+09:00\x1fSubject\0{path}", &hash[..7])
    }

    fn pair(hash: &str, path: &str) -> (String, String) {
        (hash.to_string(), path.to_string())
    }

    #[test]
    fn logged_revisions_pair_each_commit_with_its_path() {
        let (a, b) = ("a".repeat(40), "b".repeat(40));
        let output = record(&a, Some("docs/new.md")) + &record(&b, Some("docs/old.md"));
        let revisions = logged_revisions(&output);
        assert_eq!(revisions, HashSet::from([pair(&a, "docs/new.md"), pair(&b, "docs/old.md")]));
        // Not the path of another commit.
        assert!(!revisions.contains(&pair(&b, "docs/new.md")));
    }

    #[test]
    fn logged_revisions_give_a_merge_the_path_of_the_commit_before_it() {
        let (a, b, c) = ("a".repeat(40), "b".repeat(40), "c".repeat(40));
        let output = record(&a, None) + &record(&b, Some("old.md")) + &record(&c, None);
        assert_eq!(logged_revisions(&output), HashSet::from([pair(&a, "old.md"), pair(&b, "old.md"), pair(&c, "old.md")]));
    }

    fn names(names: &[&str]) -> Vec<String> {
        names.iter().map(|name| name.to_string()).collect()
    }

    #[test]
    fn parse_branches_lists_the_remote_branches_without_a_local_one() {
        let refs = " refs/heads/feature/a\n*refs/heads/main\n refs/remotes/origin/HEAD\n refs/remotes/origin/feature/a\n \
                    refs/remotes/origin/feature/b\n refs/remotes/origin/main\n refs/remotes/team/x/fix\n";
        assert_eq!(checked_out(refs).as_deref(), Some("main"));
        let list = parse_branches(refs, "origin\nteam/x\n", checked_out(refs), None);
        assert_eq!(
            list,
            BranchList {
                current: Some("main".to_string()),
                detached: None,
                local: names(&["feature/a", "main"]),
                remote: names(&["origin/feature/b", "team/x/fix"]),
            }
        );
    }

    #[test]
    fn parse_branches_tell_a_detached_head_and_a_branch_without_commits() {
        assert_eq!(checked_out(" refs/heads/main\n"), None);
        let detached = parse_branches(" refs/heads/main\n", "", None, Some("abc1234".to_string()));
        assert_eq!((detached.current, detached.detached, detached.local), (None, Some("abc1234".to_string()), names(&["main"])));
        // A new repository: its branch has no ref yet.
        let unborn = parse_branches("", "", Some("main".to_string()), Some("ignored".to_string()));
        assert_eq!((unborn.current, unborn.detached, unborn.local), (Some("main".to_string()), None, names(&["main"])));
    }

    #[test]
    fn read_head_reads_the_files_that_start_with_a_front_matter() {
        let dir = std::env::temp_dir().join(format!("mddv-read-head-{}", std::process::id()));
        std::fs::create_dir_all(&dir).unwrap();
        let file = |name: &str, bytes: &[u8]| {
            let path = dir.join(name);
            std::fs::write(&path, bytes).unwrap();
            path
        };
        let front_matter = "---\ntype: design_doc\n---\n";
        assert_eq!(read_head(&file("a.md", front_matter.as_bytes())).as_deref(), Some(front_matter));
        assert_eq!(read_head(&file("bom.md", b"\xEF\xBB\xBF---\n")).as_deref(), Some("---\n"));
        assert_eq!(read_head(&file("b.md", b"# Title\n---\n")), None);
        assert_eq!(read_head(&file("short.md", b"--")), None);
        // Cut before a character that does not end within HEAD_BYTES.
        let mut long = b"---\n".to_vec();
        long.resize(HEAD_BYTES as usize - 1, b'a');
        long.extend("あ".as_bytes());
        assert_eq!(read_head(&file("long.md", &long)).map(|head| head.len()), Some(HEAD_BYTES as usize - 1));
        std::fs::remove_dir_all(&dir).unwrap();
    }
}
