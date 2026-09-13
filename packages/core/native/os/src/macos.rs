use crate::{owned, path_string, Wake};
use std::io;
use std::os::fd::{AsRawFd, OwnedFd};
use std::path::Path;
use std::ptr;
use std::time::Instant;

pub struct Events {
    event: OwnedFd,
    _notification: OwnedFd,
}

fn change(ident: usize, filter: i16, flags: u16, fflags: u32) -> libc::kevent {
    libc::kevent {
        ident,
        filter,
        flags,
        fflags,
        data: 0,
        udata: ptr::null_mut(),
    }
}

impl Events {
    pub fn open(path: &Path, cancellation: &OwnedFd) -> io::Result<Self> {
        // SAFETY: kqueue returns a fresh descriptor; fcntl only sets its flags.
        let event = owned(unsafe { libc::kqueue() })?;
        if unsafe { libc::fcntl(event.as_raw_fd(), libc::F_SETFD, libc::FD_CLOEXEC) } < 0 {
            return Err(io::Error::last_os_error());
        }
        let path = path_string(path)?;
        // SAFETY: path remains live and properly terminated throughout open.
        let notification = owned(unsafe {
            libc::open(
                path.as_ptr(),
                libc::O_RDONLY | libc::O_CLOEXEC | libc::O_NOFOLLOW,
            )
        })?;
        let changes = [
            change(
                notification.as_raw_fd() as usize,
                libc::EVFILT_VNODE,
                libc::EV_ADD | libc::EV_CLEAR,
                libc::NOTE_WRITE | libc::NOTE_DELETE | libc::NOTE_RENAME | libc::NOTE_REVOKE,
            ),
            change(
                cancellation.as_raw_fd() as usize,
                libc::EVFILT_READ,
                libc::EV_ADD,
                0,
            ),
        ];
        // SAFETY: changes is correctly sized; no output buffer is requested.
        if unsafe {
            libc::kevent(
                event.as_raw_fd(),
                changes.as_ptr(),
                2,
                ptr::null_mut(),
                0,
                ptr::null(),
            )
        } < 0
        {
            return Err(io::Error::last_os_error());
        }
        Ok(Self {
            event,
            _notification: notification,
        })
    }

    pub fn watch_owner(&self, pid: i32) -> io::Result<bool> {
        let entry = change(
            pid as usize,
            libc::EVFILT_PROC,
            libc::EV_ADD | libc::EV_ONESHOT,
            libc::NOTE_EXIT,
        );
        // SAFETY: entry remains live; registering an exit watch does not signal pid.
        if unsafe {
            libc::kevent(
                self.event.as_raw_fd(),
                &entry,
                1,
                ptr::null_mut(),
                0,
                ptr::null(),
            )
        } < 0
        {
            let error = io::Error::last_os_error();
            if error.raw_os_error() == Some(libc::ESRCH) {
                return Ok(false);
            }
            return Err(error);
        }
        Ok(true)
    }

    pub fn wait(&self, deadline: Option<Instant>) -> io::Result<Wake> {
        loop {
            let remaining = deadline.map(|at| at.saturating_duration_since(Instant::now()));
            let timeout = remaining.map(|d| libc::timespec {
                tv_sec: d.as_secs() as i64,
                tv_nsec: d.subsec_nanos() as i64,
            });
            let mut out = change(0, 0, 0, 0);
            // SAFETY: out and optional timeout are live; the queue is retained by the caller's Arc.
            let n = unsafe {
                libc::kevent(
                    self.event.as_raw_fd(),
                    ptr::null(),
                    0,
                    &mut out,
                    1,
                    timeout.as_ref().map_or(ptr::null(), |t| t),
                )
            };
            if n > 0 {
                if out.flags & libc::EV_ERROR != 0 {
                    return Err(io::Error::from_raw_os_error(out.data as i32));
                }
                if out.filter == libc::EVFILT_VNODE
                    && out.fflags & (libc::NOTE_DELETE | libc::NOTE_RENAME | libc::NOTE_REVOKE) != 0
                {
                    return Err(io::Error::other("notification file invalidated"));
                }
                return Ok(if out.filter == libc::EVFILT_READ {
                    Wake::Cancelled
                } else {
                    Wake::Changed
                });
            }
            if n == 0 {
                return Ok(Wake::Deadline);
            }
            let error = io::Error::last_os_error();
            if error.kind() != io::ErrorKind::Interrupted {
                return Err(error);
            }
        }
    }
}
