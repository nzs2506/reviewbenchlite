#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

use tauri::Manager;

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
        .run(tauri::generate_context!())
        .expect("failed to run BenchReview Lite");
}
