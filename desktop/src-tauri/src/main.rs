#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

use tauri::Manager;

#[tauri::command]
fn set_page_zoom(window: tauri::WebviewWindow, zoom: f64) -> Result<(), String> {
    // Keep the desktop UI readable while still allowing a compact table view.
    // This is native WebKit zoom, not CSS scaling, so the complete webview
    // changes size together (like a browser page).
    window
        .set_zoom(zoom.clamp(0.55, 1.25))
        .map_err(|error| error.to_string())
}

fn create_local_workspace(app: &tauri::App) -> Result<(), Box<dyn std::error::Error>> {
    let root = app.path().document_dir()?.join("BenchReview Lite");
    for folder in [
        "Игры",
        "Тренировки",
        "Упражнения",
        "Состав",
        "Выгрузки",
        "Резервы",
    ] {
        std::fs::create_dir_all(root.join(folder))?;
    }
    Ok(())
}

fn main() {
    tauri::Builder::default()
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_fs::init())
        .plugin(tauri_plugin_opener::init())
        .setup(|app| {
            if let Err(error) = create_local_workspace(app) {
                eprintln!("Unable to create BenchReview Lite workspace: {error}");
            }
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![set_page_zoom])
        .run(tauri::generate_context!())
        .expect("failed to run BenchReview Lite");
}
