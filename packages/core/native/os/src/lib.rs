//! Owned local coordination primitives. No JavaScript, SQLite, or polling.
//!
//! A subscription is armed before the authoritative state check. Its resources
//! outlive the blocking thread even if its caller cancels or drops the object.
use std::ffi::CString;
use std::io;
use std::os::fd::{AsRawFd, FromRawFd, OwnedFd};
use std::os::unix::ffi::OsStrExt;
use std::path::Path;
use std::sync::{Arc, Mutex, MutexGuard};
use std::thread::{self, JoinHandle};
use std::time::{Duration, Instant};

#[cfg(target_os = "linux")]
#[path = "linux.rs"]
mod platform;
#[cfg(target_os = "macos")]
#[path = "macos.rs"]
mod platform;

fn invalid(message: &str) -> io::Error {
    io::Error::new(io::ErrorKind::InvalidInput, message)
}

fn path_string(path: &Path) -> io::Result<CString> {
    CString::new(path.as_os_str().as_bytes()).map_err(|_| invalid("path contains NUL"))
}

fn owned(fd: libc::c_int) -> io::Result<OwnedFd> {
    if fd < 0 {
        Err(io::Error::last_os_error())
    } else {
        // SAFETY: every call passes a newly created, uniquely owned descriptor.
        Ok(unsafe { OwnedFd::from_raw_fd(fd) })
    }
}

fn open(path: &Path, create: bool) -> io::Result<OwnedFd> {
    let name = path_string(path)?;
    let flags = libc::O_RDWR | libc::O_CLOEXEC | libc::O_NOFOLLOW;
    // SAFETY: name is a live NUL-terminated string and flags/mode are valid.
    owned(unsafe {
        libc::open(
            name.as_ptr(),
            flags | if create { libc::O_CREAT } else { 0 },
            0o600,
        )
    })
}

fn flock(fd: &OwnedFd, operation: i32) -> io::Result<()> {
    loop {
        // SAFETY: fd remains owned for this call. flock does not consume it.
        if unsafe { libc::flock(fd.as_raw_fd(), operation) } == 0 {
            return Ok(());
        }
        let error = io::Error::last_os_error();
        if error.kind() != io::ErrorKind::Interrupted {
            return Err(error);
        }
    }
}

/// The descriptor never leaves this object. Reentrant access fails instead of
/// deadlocking a thread that already holds the gate through a scoped callback.
pub struct File {
    fd: Mutex<Option<OwnedFd>>,
}

impl File {
    pub fn open_existing(path: &Path) -> io::Result<Self> {
        Ok(Self {
            fd: Mutex::new(Some(open(path, false)?)),
        })
    }
    pub fn open(path: &Path) -> io::Result<Self> {
        Ok(Self {
            fd: Mutex::new(Some(open(path, true)?)),
        })
    }

    fn access(&self) -> io::Result<MutexGuard<'_, Option<OwnedFd>>> {
        let guard = self
            .fd
            .try_lock()
            .map_err(|_| invalid("resource is already borrowed"))?;
        if guard.is_none() {
            return Err(invalid("resource is closed"));
        }
        Ok(guard)
    }

    pub fn close(&self) -> io::Result<()> {
        let mut guard = self
            .fd
            .try_lock()
            .map_err(|_| invalid("resource is already borrowed"))?;
        guard.take();
        Ok(())
    }

    /// Hold a lifetime lock until explicit close or object destruction.
    pub fn lock_lifetime(&self) -> io::Result<()> {
        let guard = self.access()?;
        flock(guard.as_ref().unwrap(), libc::LOCK_EX)
    }

    pub fn gate(&self) -> io::Result<Gate<'_>> {
        let guard = self.access()?;
        flock(guard.as_ref().unwrap(), libc::LOCK_EX)?;
        Ok(Gate { guard })
    }

    pub fn pulse(&self) -> io::Result<()> {
        let guard = self.access()?;
        loop {
            // SAFETY: the one-byte buffer and owned fd live through pwrite.
            let n = unsafe {
                libc::pwrite(
                    guard.as_ref().unwrap().as_raw_fd(),
                    b"!".as_ptr().cast(),
                    1,
                    0,
                )
            };
            if n == 1 {
                return Ok(());
            }
            let error = io::Error::last_os_error();
            if n >= 0 {
                return Err(io::Error::new(
                    io::ErrorKind::WriteZero,
                    "notification write",
                ));
            }
            if error.kind() != io::ErrorKind::Interrupted {
                return Err(error);
            }
        }
    }
}

pub struct Gate<'a> {
    guard: MutexGuard<'a, Option<OwnedFd>>,
}

impl Gate<'_> {
    /// Explicit release exposes unlock errors; Drop is the unwind fallback.
    pub fn release(mut self) -> io::Result<()> {
        let fd = self.guard.as_ref().unwrap();
        let result = flock(fd, libc::LOCK_UN);
        // Keep Drop's second unlock harmless on error as well as success.
        if result.is_err() {
            self.guard.take();
        }
        result
    }
}

impl Drop for Gate<'_> {
    fn drop(&mut self) {
        if let Some(fd) = self.guard.as_ref() {
            let _ = flock(fd, libc::LOCK_UN);
        }
    }
}

/// A PID is only a wakeup hint. Reclaim authority comes from this separate
/// open-file description, never from process existence alone.
pub fn alive(path: &Path) -> io::Result<bool> {
    let fd = open(path, false)?;
    match flock(&fd, libc::LOCK_EX | libc::LOCK_NB) {
        Ok(()) => Ok(false),
        Err(error) if error.kind() == io::ErrorKind::WouldBlock => Ok(true),
        Err(error) => Err(error),
    }
}

fn pipe() -> io::Result<(OwnedFd, OwnedFd)> {
    let mut fds = [-1; 2];
    #[cfg(target_os = "linux")]
    // SAFETY: fds has room for the two descriptors returned by pipe2.
    let result = unsafe { libc::pipe2(fds.as_mut_ptr(), libc::O_CLOEXEC | libc::O_NONBLOCK) };
    #[cfg(target_os = "macos")]
    // SAFETY: fds has room for the two descriptors returned by pipe.
    let result = unsafe { libc::pipe(fds.as_mut_ptr()) };
    if result < 0 {
        return Err(io::Error::last_os_error());
    }
    let read = owned(fds[0])?;
    let write = owned(fds[1])?;
    #[cfg(target_os = "macos")]
    for fd in [&read, &write] {
        // SAFETY: both descriptors remain owned; these commands set flags only.
        if unsafe { libc::fcntl(fd.as_raw_fd(), libc::F_SETFD, libc::FD_CLOEXEC) } < 0
            || unsafe { libc::fcntl(fd.as_raw_fd(), libc::F_SETFL, libc::O_NONBLOCK) } < 0
        {
            return Err(io::Error::last_os_error());
        }
    }
    Ok((read, write))
}

struct Resources {
    events: platform::Events,
    _read: OwnedFd,
    write: OwnedFd,
}

impl Resources {
    fn cancel(&self) -> io::Result<()> {
        loop {
            // SAFETY: the buffer and fd remain alive through write.
            let n = unsafe { libc::write(self.write.as_raw_fd(), b"!".as_ptr().cast(), 1) };
            if n == 1 {
                return Ok(());
            }
            let error = io::Error::last_os_error();
            if error.kind() == io::ErrorKind::WouldBlock {
                return Ok(());
            }
            if error.kind() != io::ErrorKind::Interrupted {
                return Err(error);
            }
        }
    }
}

#[derive(Debug, PartialEq, Eq)]
pub enum Wake {
    Deadline,
    Changed,
    Cancelled,
}

struct State {
    resources: Option<Arc<Resources>>,
    thread: Option<JoinHandle<()>>,
    started: bool,
}

/// One armed, single-use subscription. Its close operation joins only its own
/// dedicated thread. No JS callback or shared execution pool is needed to exit.
pub struct Subscription {
    state: Mutex<State>,
}

impl Subscription {
    pub fn open(path: &Path) -> io::Result<Self> {
        let (read, write) = pipe()?;
        let events = platform::Events::open(path, &read)?;
        Ok(Self {
            state: Mutex::new(State {
                resources: Some(Arc::new(Resources {
                    events,
                    _read: read,
                    write,
                })),
                thread: None,
                started: false,
            }),
        })
    }

    pub fn watch_owner(&self, pid: i32) -> io::Result<bool> {
        if pid <= 0 {
            return Err(invalid("invalid PID"));
        }
        let state = self
            .state
            .lock()
            .map_err(|_| invalid("poisoned subscription"))?;
        if state.started {
            return Err(invalid("subscription already started"));
        }
        state
            .resources
            .as_ref()
            .ok_or_else(|| invalid("subscription closed"))?
            .events
            .watch_owner(pid)
    }

    pub fn start(
        &self,
        timeout: Option<Duration>,
        completion: impl FnOnce(io::Result<Wake>) + Send + 'static,
    ) -> io::Result<()> {
        if timeout.is_some_and(|duration| duration > Duration::from_millis(i32::MAX as u64)) {
            return Err(invalid("timeout exceeds native timer range"));
        }
        let mut state = self
            .state
            .lock()
            .map_err(|_| invalid("poisoned subscription"))?;
        if state.started {
            return Err(invalid("subscription already started"));
        }
        let resources = state
            .resources
            .as_ref()
            .ok_or_else(|| invalid("subscription closed"))?
            .clone();
        // Capture the deadline before thread dispatch, so scheduling delay counts.
        let deadline = timeout.map(|duration| Instant::now() + duration);
        let thread = thread::Builder::new()
            .name("semaphile-wait".into())
            .spawn(move || {
                completion(resources.events.wait(deadline));
            })?;
        state.started = true;
        state.thread = Some(thread);
        Ok(())
    }

    pub fn cancel(&self) -> io::Result<()> {
        let state = self
            .state
            .lock()
            .map_err(|_| invalid("poisoned subscription"))?;
        match &state.resources {
            Some(resources) => resources.cancel(),
            None => Ok(()),
        }
    }

    pub fn close(&self) -> io::Result<()> {
        let mut state = self
            .state
            .lock()
            .map_err(|_| invalid("poisoned subscription"))?;
        // Retain this mutex through join so concurrent closes all await completion.
        // Completion must not call Subscription methods; the binding enqueues a JS reply.
        let cancellation = state.resources.as_ref().map(|r| r.cancel()).transpose();
        if let Some(thread) = state.thread.take() {
            thread
                .join()
                .map_err(|_| io::Error::other("native wait thread panicked"))?;
        }
        state.resources.take();
        cancellation.map(|_| ())
    }
}

impl Drop for Subscription {
    fn drop(&mut self) {
        let _ = self.close();
    }
}
