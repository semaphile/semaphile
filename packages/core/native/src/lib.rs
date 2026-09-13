//! Private Node-API ownership boundary. Only the coordinator calls these APIs.
//! Dedicated OS threads enqueue completion; they never wait for JavaScript.
use napi::bindgen_prelude::*;
use napi::threadsafe_function::{ThreadsafeFunction, ThreadsafeFunctionCallMode};
use napi::JsValue;
use napi_derive::napi;
use semaphile_os::{File, Subscription, Wake};
use std::collections::BTreeSet;
use std::path::PathBuf;
use std::sync::{Arc, Mutex, Weak};
use std::time::Duration;

fn error(value: impl std::fmt::Display) -> Error {
    Error::from_reason(value.to_string())
}

struct FileEntry {
    file: File,
    lifetime: bool,
    gate: bool,
}
#[derive(Default)]
struct Registry {
    files: Vec<Weak<FileEntry>>,
    // A wrapper being collected must not retire a live owner's lifetime lock.
    lifetimes: Vec<Arc<FileEntry>>,
    waits: Vec<Weak<Subscription>>,
    notifications: BTreeSet<PathBuf>,
    active_gates: usize,
    closed: bool,
}

impl Registry {
    fn notify_retirement(&self) -> Result<()> {
        let mut errors = Vec::new();
        for path in &self.notifications {
            if let Err(e) = File::open_existing(path).and_then(|file| file.pulse()) {
                // Removed/renamed paths already invalidate existing subscribers.
                // Cleanup must not recreate them or prevent other handles closing.
                if e.kind() != std::io::ErrorKind::NotFound {
                    errors.push(e.to_string());
                }
            }
        }
        if errors.is_empty() {
            Ok(())
        } else {
            Err(error(errors.join("; ")))
        }
    }
    fn require_open(&self) -> Result<()> {
        if self.closed {
            Err(error("native context closed"))
        } else {
            Ok(())
        }
    }
    fn close(&mut self) -> Result<()> {
        if self.closed {
            return Ok(());
        }
        if self.active_gates != 0 {
            return Err(error("cannot close a context inside a gate callback"));
        }
        self.closed = true;
        let mut errors = Vec::new();
        // Wait threads do not acquire the registry mutex during completion.
        for wait in self.waits.iter().filter_map(Weak::upgrade) {
            if let Err(e) = wait.close() {
                errors.push(e.to_string());
            }
        }
        let files: Vec<_> = self.files.iter().filter_map(Weak::upgrade).collect();
        for entry in files.iter().filter(|e| e.lifetime) {
            if let Err(e) = entry.file.close() {
                errors.push(e.to_string());
            }
        }
        // Signal after lifetime retirement, including abnormal environment cleanup.
        // A reader either observes retirement or receives a later recheck hint.
        if let Err(e) = self.notify_retirement() {
            errors.push(e.to_string());
        }
        self.lifetimes.clear();
        for entry in files.iter().rev().filter(|e| !e.lifetime) {
            if let Err(e) = entry.file.close() {
                errors.push(e.to_string());
            }
        }
        if errors.is_empty() {
            Ok(())
        } else {
            Err(error(errors.join("; ")))
        }
    }
}

// Do not partially retire an owner when a synchronous gate callback attempts
// reentrant context shutdown. The scope also unwinds on callback errors.
struct GateScope(Arc<Mutex<Registry>>);
impl GateScope {
    fn enter(registry: &Arc<Mutex<Registry>>) -> Result<Self> {
        let mut state = registry.lock().map_err(error)?;
        state.require_open()?;
        if state.active_gates != 0 {
            return Err(error("nested gate callbacks are not supported"));
        }
        state.active_gates += 1;
        Ok(Self(registry.clone()))
    }
}
impl Drop for GateScope {
    fn drop(&mut self) {
        if let Ok(mut registry) = self.0.lock() {
            registry.active_gates -= 1;
        }
    }
}

#[napi]
pub struct NativeContext {
    registry: Arc<Mutex<Registry>>,
}

#[napi]
impl NativeContext {
    #[napi(constructor)]
    pub fn new(env: Env) -> Result<Self> {
        let registry = Arc::new(Mutex::new(Registry::default()));
        let weak = Arc::downgrade(&registry);
        env.add_env_cleanup_hook(weak, |weak| {
            if let Some(registry) = weak.upgrade() {
                if let Ok(mut registry) = registry.lock() {
                    let _ = registry.close();
                }
            }
        })?;
        Ok(Self { registry })
    }

    #[napi]
    pub fn open(&self, path: String, role: String) -> Result<NativeFile> {
        if !["file", "gate", "notification", "lifetime"].contains(&role.as_str()) {
            return Err(error("invalid file role"));
        }
        let mut registry = self.registry.lock().map_err(error)?;
        registry.require_open()?;
        let path = PathBuf::from(path);
        let entry = Arc::new(FileEntry {
            file: File::open(&path).map_err(error)?,
            lifetime: role == "lifetime",
            gate: role == "gate",
        });
        if role == "notification" {
            registry.notifications.insert(path);
        }
        registry.files.retain(|item| item.strong_count() != 0);
        registry.files.push(Arc::downgrade(&entry));
        if entry.lifetime {
            registry.lifetimes.push(entry.clone());
        }
        Ok(NativeFile {
            entry,
            _registry: self.registry.clone(),
        })
    }

    #[napi]
    pub fn subscribe(&self, path: String) -> Result<NativeSubscription> {
        let mut registry = self.registry.lock().map_err(error)?;
        registry.require_open()?;
        let path = PathBuf::from(path);
        let wait =
            Arc::new(Subscription::open(&path).map_err(|e| error(format!("subscribe: {e}")))?);
        registry.notifications.insert(path);
        registry.waits.retain(|item| item.strong_count() != 0);
        registry.waits.push(Arc::downgrade(&wait));
        Ok(NativeSubscription {
            wait,
            _registry: self.registry.clone(),
        })
    }

    #[napi]
    pub fn alive(&self, path: String) -> Result<bool> {
        self.registry.lock().map_err(error)?.require_open()?;
        semaphile_os::alive(&PathBuf::from(path)).map_err(error)
    }

    #[napi]
    pub fn close(&self) -> Result<()> {
        self.registry.lock().map_err(error)?.close()
    }
}

impl Drop for Registry {
    fn drop(&mut self) {
        let _ = self.close();
    }
}

#[napi]
pub struct NativeFile {
    entry: Arc<FileEntry>,
    _registry: Arc<Mutex<Registry>>,
}

#[napi]
impl NativeFile {
    #[napi]
    pub fn with_gate<'env>(
        &self,
        callback: Function<'env, (), Unknown<'env>>,
    ) -> Result<Unknown<'env>> {
        if !self.entry.gate {
            return Err(error("file is not a coordination gate"));
        }
        let _scope = GateScope::enter(&self._registry)?;
        let gate = self.entry.file.gate().map_err(error)?;
        let result = callback.call(());
        let released = gate.release().map_err(error);
        let value = result?;
        released?;
        if value.is_promise()? {
            return Err(error("gate callback must be synchronous"));
        }
        Ok(value)
    }

    #[napi]
    pub fn lock_lifetime(&self) -> Result<()> {
        self._registry.lock().map_err(error)?.require_open()?;
        if !self.entry.lifetime {
            return Err(error("file is not a lifetime lock"));
        }
        self.entry.file.lock_lifetime().map_err(error)
    }
    #[napi]
    pub fn pulse(&self) -> Result<()> {
        self._registry.lock().map_err(error)?.require_open()?;
        self.entry.file.pulse().map_err(error)
    }
    #[napi]
    pub fn close(&self) -> Result<()> {
        let mut registry = self._registry.lock().map_err(error)?;
        self.entry.file.close().map_err(error)?;
        if self.entry.lifetime {
            // Signal even on a repeated close so a failed notification can be retried.
            registry
                .lifetimes
                .retain(|entry| !Arc::ptr_eq(entry, &self.entry));
            registry.notify_retirement()?;
        }
        Ok(())
    }
}

#[napi]
pub struct NativeSubscription {
    wait: Arc<Subscription>,
    _registry: Arc<Mutex<Registry>>,
}

#[napi]
impl NativeSubscription {
    #[napi]
    pub fn watch_owner(&self, pid: i32) -> Result<bool> {
        self.wait.watch_owner(pid).map_err(error)
    }
    #[napi]
    pub fn start(
        &self,
        timeout_ms: Option<u32>,
        completion: ThreadsafeFunction<u32>,
    ) -> Result<()> {
        self.wait
            .start(
                timeout_ms.map(|ms| Duration::from_millis(ms as u64)),
                move |result| {
                    let result = result
                        .map(|wake| match wake {
                            Wake::Deadline => 0,
                            Wake::Changed => 1,
                            Wake::Cancelled => 2,
                        })
                        .map_err(error);
                    // Completion is enqueued without waiting for JS; close can safely join.
                    completion.call(result, ThreadsafeFunctionCallMode::NonBlocking);
                },
            )
            .map_err(error)
    }
    #[napi]
    pub fn cancel(&self) -> Result<()> {
        self.wait.cancel().map_err(error)
    }
    #[napi]
    pub fn close(&self) -> Result<()> {
        self.wait.close().map_err(error)
    }
}
