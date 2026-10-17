use serde_json::{json, Value};
use std::{
    fs,
    io::{BufRead, BufReader, Write},
    path::{Path, PathBuf},
    process::{Child, ChildStdin, Command, Stdio},
    sync::{
        atomic::{AtomicBool, AtomicU64, Ordering},
        Arc, Mutex,
    },
    thread,
    time::{Duration, Instant},
};
use tauri::{AppHandle, Emitter, Manager, State};

const MAX_TEXT_LENGTH: usize = 4_000;

struct EngineProcess {
    child: Child,
    stdin: ChildStdin,
}

#[derive(Default)]
pub struct SpeechEngine {
    process: Mutex<Option<EngineProcess>>,
    speaking: Arc<AtomicBool>,
    current_request_id: Arc<AtomicU64>,
    next_request_id: AtomicU64,
    process_generation: Arc<AtomicU64>,
    request_started_at: Arc<Mutex<Option<(u64, Instant)>>>,
}

impl SpeechEngine {
    fn send(&self, app: &AppHandle, model_dir: &Path, message: &Value) -> Result<(), String> {
        let mut process = self
            .process
            .lock()
            .map_err(|_| "Speech engine process lock is unavailable.".to_string())?;

        let exited = match process.as_mut() {
            Some(engine) => engine
                .child
                .try_wait()
                .map_err(|error| format!("Could not check the speech engine: {error}"))?
                .is_some(),
            None => false,
        };
        if exited {
            *process = None;
        }

        if process.is_none() {
            let generation = self.process_generation.fetch_add(1, Ordering::Relaxed) + 1;
            *process = Some(spawn_engine(
                app,
                model_dir,
                Arc::clone(&self.speaking),
                Arc::clone(&self.current_request_id),
                Arc::clone(&self.process_generation),
                generation,
                Arc::clone(&self.request_started_at),
            )?);
        }

        let engine = process
            .as_mut()
            .expect("speech process was just initialized");
        if let Err(error) = writeln!(engine.stdin, "{message}") {
            let _ = engine.child.kill();
            *process = None;
            self.speaking.store(false, Ordering::Release);
            return Err(format!(
                "Could not send a request to the speech engine: {error}"
            ));
        }
        if let Err(error) = engine.stdin.flush() {
            let _ = engine.child.kill();
            *process = None;
            self.speaking.store(false, Ordering::Release);
            return Err(format!("Could not flush a speech request: {error}"));
        }
        Ok(())
    }

    pub fn shutdown(&self) {
        let Ok(mut process) = self.process.lock() else {
            return;
        };
        let Some(mut engine) = process.take() else {
            return;
        };

        let _ = writeln!(engine.stdin, "{{\"type\":\"shutdown\"}}");
        let _ = engine.stdin.flush();
        let deadline = Instant::now() + Duration::from_secs(2);
        loop {
            match engine.child.try_wait() {
                Ok(Some(_)) => break,
                Ok(None) if Instant::now() < deadline => {
                    thread::sleep(Duration::from_millis(50));
                }
                _ => {
                    let _ = engine.child.kill();
                    let _ = engine.child.wait();
                    break;
                }
            }
        }
        self.speaking.store(false, Ordering::Release);
    }
}

impl Drop for SpeechEngine {
    fn drop(&mut self) {
        self.shutdown();
    }
}

#[tauri::command]
pub fn speech_speak(
    app: AppHandle,
    engine: State<'_, SpeechEngine>,
    text: String,
) -> Result<u64, String> {
    let text = text.trim();
    let text_length = text.chars().count();
    if text_length == 0 || text_length > MAX_TEXT_LENGTH {
        return Err(format!(
            "Speech text must contain 1 to {MAX_TEXT_LENGTH} characters."
        ));
    }

    let model_dir = model_directory(&app)?;
    let request_id = engine.next_request_id.fetch_add(1, Ordering::Relaxed) + 1;
    engine
        .current_request_id
        .store(request_id, Ordering::Release);
    *engine
        .request_started_at
        .lock()
        .map_err(|_| "Speech timing lock is unavailable.".to_string())? =
        Some((request_id, Instant::now()));
    engine.speaking.store(true, Ordering::Release);

    let result = engine.send(
        &app,
        &model_dir,
        &json!({
            "type": "speak",
            "request_id": request_id,
            "text": text
        }),
    );
    if result.is_err() {
        engine.speaking.store(false, Ordering::Release);
    }
    result.map(|()| request_id)
}

#[tauri::command]
pub fn speech_stop(engine: State<'_, SpeechEngine>) -> Result<(), String> {
    engine.speaking.store(false, Ordering::Release);
    let mut process = engine
        .process
        .lock()
        .map_err(|_| "Speech engine process lock is unavailable.".to_string())?;
    let Some(current) = process.as_mut() else {
        return Ok(());
    };
    if current
        .child
        .try_wait()
        .map_err(|error| format!("Could not check the speech engine: {error}"))?
        .is_some()
    {
        *process = None;
        return Ok(());
    }
    if let Err(error) =
        writeln!(current.stdin, "{{\"type\":\"stop\"}}").and_then(|()| current.stdin.flush())
    {
        let _ = current.child.kill();
        *process = None;
        return Err(format!("Could not stop speech: {error}"));
    }
    Ok(())
}

#[tauri::command]
pub fn speech_is_speaking(engine: State<'_, SpeechEngine>) -> Result<bool, String> {
    let mut process = engine
        .process
        .lock()
        .map_err(|_| "Speech engine process lock is unavailable.".to_string())?;
    if let Some(current) = process.as_mut() {
        if current
            .child
            .try_wait()
            .map_err(|error| format!("Could not check the speech engine: {error}"))?
            .is_some()
        {
            *process = None;
            engine.speaking.store(false, Ordering::Release);
        }
    }
    Ok(engine.speaking.load(Ordering::Acquire))
}

fn model_directory(app: &AppHandle) -> Result<PathBuf, String> {
    let app_data_dir = app
        .path()
        .app_data_dir()
        .map_err(|error| format!("Could not locate Milly's application data: {error}"))?;

    if cfg!(debug_assertions) {
        let development_assets = Path::new(env!("CARGO_MANIFEST_DIR"))
            .parent()
            .expect("Tauri project has a parent application directory")
            .join("test-pet-audio");
        if development_assets.join("kokoro-v1.0.onnx").is_file()
            && development_assets.join("voices-v1.0.bin").is_file()
        {
            return Ok(development_assets);
        }
    }

    let model_dir = app_data_dir.join("models");
    fs::create_dir_all(&model_dir)
        .map_err(|error| format!("Could not create the local model directory: {error}"))?;
    Ok(model_dir)
}

fn spawn_engine(
    app: &AppHandle,
    model_dir: &Path,
    speaking: Arc<AtomicBool>,
    current_request_id: Arc<AtomicU64>,
    process_generation: Arc<AtomicU64>,
    generation: u64,
    request_started_at: Arc<Mutex<Option<(u64, Instant)>>>,
) -> Result<EngineProcess, String> {
    let mut command = engine_command(app)?;
    let mut child = command
        .arg("--model-dir")
        .arg(model_dir)
        .stdin(Stdio::piped())
        .stdout(Stdio::piped())
        .stderr(Stdio::piped())
        .spawn()
        .map_err(|error| format!("Could not start the local speech engine: {error}"))?;

    let stdin = child
        .stdin
        .take()
        .ok_or_else(|| "Speech engine input pipe was not available.".to_string())?;
    let stdout = child
        .stdout
        .take()
        .ok_or_else(|| "Speech engine output pipe was not available.".to_string())?;
    let stderr = child
        .stderr
        .take()
        .ok_or_else(|| "Speech engine diagnostics pipe was not available.".to_string())?;

    let event_app = app.clone();
    thread::spawn(move || {
        for line in BufReader::new(stdout).lines() {
            match line {
                Ok(line) => match serde_json::from_str::<Value>(&line) {
                    Ok(mut event) => {
                        let request_id = event.get("request_id").and_then(Value::as_u64);
                        let status = event
                            .get("status")
                            .and_then(Value::as_str)
                            .unwrap_or("")
                            .to_string();
                        let is_current = request_id
                            .map(|id| id == current_request_id.load(Ordering::Acquire))
                            .unwrap_or(false);
                        if is_current && status == "first_audio" {
                            if let (Some(request_id), Ok(started_at)) =
                                (request_id, request_started_at.lock())
                            {
                                if let Some((started_id, started_at)) = *started_at {
                                    if started_id == request_id {
                                        if let Some(payload) = event.as_object_mut() {
                                            payload.insert(
                                                "request_to_first_audio_ms".to_string(),
                                                json!(started_at.elapsed().as_millis()),
                                            );
                                        }
                                    }
                                }
                            }
                        }
                        if is_current && matches!(status.as_str(), "finished" | "stopped" | "error")
                        {
                            speaking.store(false, Ordering::Release);
                        }
                        if let Err(error) = event_app.emit("speech-event", event) {
                            log::warn!("Could not forward speech status to the UI: {error}");
                        }
                    }
                    Err(error) => log::warn!("Invalid speech engine event: {error}"),
                },
                Err(error) => {
                    log::warn!("Could not read speech engine output: {error}");
                    break;
                }
            }
        }
        if process_generation.load(Ordering::Acquire) == generation {
            speaking.store(false, Ordering::Release);
        }
    });

    thread::spawn(move || {
        for line in BufReader::new(stderr).lines() {
            match line {
                Ok(line) => log::info!("Kokoro: {line}"),
                Err(error) => {
                    log::warn!("Could not read speech engine diagnostics: {error}");
                    break;
                }
            }
        }
    });

    Ok(EngineProcess { child, stdin })
}

fn engine_command(app: &AppHandle) -> Result<Command, String> {
    let bundled_executable = app
        .path()
        .resource_dir()
        .map_err(|error| format!("Could not locate bundled speech engine: {error}"))?
        .join("milly-tts")
        .join(if cfg!(windows) {
            "milly-tts.exe"
        } else {
            "milly-tts"
        });
    if bundled_executable.is_file() {
        return Ok(Command::new(bundled_executable));
    }

    if cfg!(debug_assertions) {
        let project_root = Path::new(env!("CARGO_MANIFEST_DIR"))
            .parent()
            .expect("Tauri project has a parent application directory");
        let python = project_root
            .join("test-pet-audio")
            .join(".venv")
            .join("Scripts")
            .join("python.exe");
        let script = project_root.join("speech-engine").join("engine.py");
        if python.is_file() {
            let mut command = Command::new(python);
            command.arg(script);
            return Ok(command);
        }
        return Err(
            "The local speech engine is not ready. Build its standalone Windows runtime with speech-engine/build.ps1."
                .to_string(),
        );
    }

    Err("The bundled local speech engine is missing.".to_string())
}
