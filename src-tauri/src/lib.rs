mod engine;
#[cfg(target_os = "macos")]
mod power;
mod storage;

use chrono::Local;
use engine::{Engine, Mode, Session, SessionInput, Snapshot};
use std::{
    sync::Mutex,
    time::{Duration, Instant, SystemTime},
};
use storage::Repository;
use tauri::{AppHandle, Emitter, Manager, State};
use tauri_plugin_notification::NotificationExt;

struct Runtime {
    engine: Engine,
    repository: Repository,
    last_tick: Instant,
    last_wall: SystemTime,
    last_save: Instant,
    saved_revision: u64,
    storage_error: Option<String>,
}

impl Runtime {
    fn reset_clock(&mut self) {
        self.last_tick = Instant::now();
        self.last_wall = SystemTime::now();
    }

    fn settle(&mut self) -> bool {
        let instant = Instant::now();
        let wall = SystemTime::now();
        let elapsed = instant.duration_since(self.last_tick);
        let wall_elapsed = wall.duration_since(self.last_wall).unwrap_or_default();
        self.last_wall = wall;
        // Backup for missed native sleep events, suspend, or a stalled process. Never grant
        // hours of study time on wake. Fractional milliseconds are retained between ticks.
        if elapsed > Duration::from_secs(5) || wall_elapsed > Duration::from_secs(5) {
            self.engine.pause_for_sleep();
            self.last_tick = instant;
            return false;
        }
        let milliseconds = elapsed.as_millis() as u64;
        self.last_tick += Duration::from_millis(milliseconds);
        self.engine.advance(milliseconds, Local::now())
    }

    fn checkpoint(&mut self) {
        match self.repository.save(&self.engine.data) {
            Ok(()) => {
                self.storage_error = None;
                self.saved_revision = self.engine.revision;
            }
            Err(error) => {
                self.engine.pause();
                self.storage_error = Some(format!(
                    "Your timers are paused because your progress could not be saved: {error}"
                ));
            }
        }
        self.last_save = Instant::now();
    }

    fn snapshot(&self) -> Snapshot {
        self.engine
            .snapshot(Local::now(), self.storage_error.clone())
    }
}

type TimerState = Mutex<Runtime>;

fn publish(app: &AppHandle, snapshot: &Snapshot, budget_empty: bool) {
    let _ = app.emit("timer-state", snapshot);
    if budget_empty && snapshot.notifications_enabled {
        if let Ok(tauri::plugin::PermissionState::Granted) = app.notification().permission_state() {
            let _ = app
                .notification()
                .builder()
                .title("Your playtime reserve is empty")
                .body("Time for a study break. Your play timer has stopped; WoW is still open.")
                .show();
        }
    }
}

#[tauri::command]
fn get_state(app: AppHandle, state: State<'_, TimerState>) -> Result<Snapshot, String> {
    let mut runtime = state.lock().map_err(|e| e.to_string())?;
    let empty = runtime.settle();
    if empty {
        runtime.checkpoint();
    }
    let snapshot = runtime.snapshot();
    drop(runtime);
    publish(&app, &snapshot, empty);
    Ok(snapshot)
}

#[tauri::command]
fn start_timer(
    mode: Mode,
    app: AppHandle,
    state: State<'_, TimerState>,
) -> Result<Snapshot, String> {
    let mut runtime = state.lock().map_err(|e| e.to_string())?;
    let empty = runtime.settle();
    let result = if runtime.storage_error.is_some() {
        Err("Progress cannot be saved. Wait for storage to recover before starting a timer.".into())
    } else {
        runtime.engine.start(mode, Local::now())
    };
    runtime.reset_clock();
    runtime.checkpoint();
    let snapshot = runtime.snapshot();
    drop(runtime);
    publish(&app, &snapshot, empty);
    result?;
    Ok(snapshot)
}

#[tauri::command]
fn pause_timer(app: AppHandle, state: State<'_, TimerState>) -> Result<Snapshot, String> {
    let mut runtime = state.lock().map_err(|e| e.to_string())?;
    let empty = runtime.settle();
    runtime.engine.pause();
    runtime.checkpoint();
    let snapshot = runtime.snapshot();
    drop(runtime);
    publish(&app, &snapshot, empty);
    Ok(snapshot)
}

#[tauri::command]
fn set_notifications(
    enabled: bool,
    app: AppHandle,
    state: State<'_, TimerState>,
) -> Result<Snapshot, String> {
    let mut runtime = state.lock().map_err(|e| e.to_string())?;
    runtime.engine.data.notifications_enabled = enabled;
    runtime.engine.revision += 1;
    runtime.checkpoint();
    let snapshot = runtime.snapshot();
    drop(runtime);
    publish(&app, &snapshot, false);
    Ok(snapshot)
}

#[tauri::command]
fn list_sessions(app: AppHandle, state: State<'_, TimerState>) -> Result<Vec<Session>, String> {
    let mut runtime = state.lock().map_err(|e| e.to_string())?;
    let empty = runtime.settle();
    if empty {
        runtime.checkpoint();
    }
    let sessions = runtime.engine.list_sessions();
    let snapshot = runtime.snapshot();
    drop(runtime);
    publish(&app, &snapshot, empty);
    Ok(sessions)
}

fn correct_sessions(
    app: AppHandle,
    state: State<'_, TimerState>,
    correction: impl FnOnce(&mut Engine) -> Result<bool, String>,
) -> Result<Snapshot, String> {
    let mut runtime = state.lock().map_err(|e| e.to_string())?;
    let mut empty = runtime.settle();
    let mut candidate = runtime.engine.clone();
    let result = if runtime.storage_error.is_some() {
        Err(
            "Progress cannot be saved. Wait for storage to recover before changing sessions."
                .into(),
        )
    } else {
        correction(&mut candidate).and_then(|became_empty| {
            // Commit only after the atomic save succeeds. Failed writes leave the original
            // entries intact and pause the timer; no optimistic deletion of user data.
            runtime.repository.save(&candidate.data).map_err(|error| {
                runtime.engine.pause();
                runtime.storage_error = Some(format!(
                    "Session changes were not saved. Your timers are paused: {error}"
                ));
                error
            })?;
            runtime.engine = candidate;
            runtime.saved_revision = runtime.engine.revision;
            runtime.last_save = Instant::now();
            empty |= became_empty;
            Ok(())
        })
    };
    if empty && result.is_err() {
        runtime.checkpoint();
    }
    let snapshot = runtime.snapshot();
    drop(runtime);
    publish(&app, &snapshot, empty);
    result?;
    Ok(snapshot)
}

#[tauri::command]
fn save_session(
    id: Option<u64>,
    input: SessionInput,
    app: AppHandle,
    state: State<'_, TimerState>,
) -> Result<Snapshot, String> {
    correct_sessions(app, state, |engine| {
        engine.save_session(id, input, Local::now())
    })
}

#[tauri::command]
fn delete_session(
    id: u64,
    app: AppHandle,
    state: State<'_, TimerState>,
) -> Result<Snapshot, String> {
    correct_sessions(app, state, |engine| engine.delete_session(id))
}

pub(crate) fn pause_for_system_sleep(app: &AppHandle) {
    if let Some(state) = app.try_state::<TimerState>() {
        if let Ok(mut runtime) = state.lock() {
            let empty = runtime.settle();
            runtime.engine.pause_for_sleep();
            runtime.reset_clock();
            runtime.checkpoint();
            let snapshot = runtime.snapshot();
            drop(runtime);
            publish(app, &snapshot, empty);
        }
    }
}

pub(crate) fn reset_after_wake(app: &AppHandle) {
    if let Some(state) = app.try_state::<TimerState>() {
        if let Ok(mut runtime) = state.lock() {
            runtime.reset_clock();
        }
    }
}

pub fn run() {
    let app = tauri::Builder::default()
        .plugin(tauri_plugin_single_instance::init(|app, _, _| {
            if let Some(window) = app.get_webview_window("main") {
                let _ = window.unminimize();
                let _ = window.show();
                let _ = window.set_focus();
            }
        }))
        .plugin(tauri_plugin_notification::init())
        .invoke_handler(tauri::generate_handler![
            get_state,
            start_timer,
            pause_timer,
            set_notifications,
            list_sessions,
            save_session,
            delete_session
        ])
        .setup(|app| {
            let repository = Repository::new(app.path().app_data_dir()?.join("state.json"));
            let data = repository.load().map_err(std::io::Error::other)?;
            app.manage(Mutex::new(Runtime {
                engine: Engine::new(data),
                repository,
                last_tick: Instant::now(),
                last_wall: SystemTime::now(),
                last_save: Instant::now(),
                saved_revision: 0,
                storage_error: None,
            }));
            #[cfg(target_os = "macos")]
            power::watch(app.handle().clone());

            let handle = app.handle().clone();
            std::thread::Builder::new()
                .name("rested-clock".into())
                .spawn(move || {
                    let mut previous: Option<(u64, String, Option<String>)> = None;
                    loop {
                        std::thread::sleep(Duration::from_millis(250));
                        let state = handle.state::<TimerState>();
                        let Ok(mut runtime) = state.lock() else { break };
                        let empty = runtime.settle();
                        let dirty = runtime.engine.revision != runtime.saved_revision
                            || runtime.storage_error.is_some();
                        if empty || (dirty && runtime.last_save.elapsed() >= Duration::from_secs(5))
                        {
                            runtime.checkpoint();
                        }
                        let snapshot = runtime.snapshot();
                        drop(runtime);
                        let key = (
                            snapshot.revision,
                            snapshot.today.date.clone(),
                            snapshot.storage_error.clone(),
                        );
                        if previous.as_ref() != Some(&key) {
                            publish(&handle, &snapshot, empty);
                            previous = Some(key);
                        }
                    }
                })?;
            Ok(())
        })
        .build(tauri::generate_context!())
        .expect("Rested could not start. Existing saved data has not been reset.");

    app.run(|app, event| {
        if matches!(
            event,
            tauri::RunEvent::ExitRequested { .. } | tauri::RunEvent::Exit
        ) {
            if let Some(state) = app.try_state::<TimerState>() {
                if let Ok(mut runtime) = state.lock() {
                    let empty = runtime.settle();
                    runtime.engine.pause();
                    runtime.checkpoint();
                    let snapshot = runtime.snapshot();
                    drop(runtime);
                    publish(app, &snapshot, empty);
                }
            }
        }
    });
}
