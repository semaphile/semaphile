use crate::{owned, path_string, Wake};
use std::io;
use std::os::fd::{AsRawFd, OwnedFd};
use std::path::Path;
use std::sync::Mutex;
use std::time::Instant;

pub struct Events {
    event: OwnedFd,
    notification: OwnedFd,
    owners: Mutex<Vec<OwnedFd>>,
}

fn add(event: &OwnedFd, fd: &OwnedFd, tag: u64) -> io::Result<()> {
    let mut entry = libc::epoll_event {
        events: libc::EPOLLIN as u32,
        u64: tag,
    };
    // SAFETY: both descriptors and the epoll_event remain valid throughout registration.
    if unsafe {
        libc::epoll_ctl(
            event.as_raw_fd(),
            libc::EPOLL_CTL_ADD,
            fd.as_raw_fd(),
            &mut entry,
        )
    } < 0
    {
        return Err(io::Error::last_os_error());
    }
    Ok(())
}

impl Events {
    pub fn open(path: &Path, cancellation: &OwnedFd) -> io::Result<Self> {
        // SAFETY: both calls return fresh descriptors with the requested flags.
        let event = owned(unsafe { libc::epoll_create1(libc::EPOLL_CLOEXEC) })?;
        let notification =
            owned(unsafe { libc::inotify_init1(libc::IN_CLOEXEC | libc::IN_NONBLOCK) })?;
        let path = path_string(path)?;
        // SAFETY: path is live and NUL-terminated; notification is an inotify descriptor.
        if unsafe {
            libc::inotify_add_watch(
                notification.as_raw_fd(),
                path.as_ptr(),
                libc::IN_MODIFY | libc::IN_DELETE_SELF | libc::IN_MOVE_SELF,
            )
        } < 0
        {
            return Err(io::Error::last_os_error());
        }
        add(&event, &notification, 1)?;
        add(&event, cancellation, 2)?;
        Ok(Self {
            event,
            notification,
            owners: Mutex::new(Vec::new()),
        })
    }

    pub fn watch_owner(&self, pid: i32) -> io::Result<bool> {
        // SAFETY: pid was validated positive; zero is the documented flags value.
        let raw = unsafe { libc::syscall(libc::SYS_pidfd_open, pid, 0) };
        if raw < 0 {
            let error = io::Error::last_os_error();
            if error.raw_os_error() == Some(libc::ESRCH) {
                return Ok(false);
            }
            return Err(error);
        }
        let fd = owned(raw as i32)?;
        add(&self.event, &fd, 3)?;
        self.owners
            .lock()
            .map_err(|_| io::Error::other("poisoned process watches"))?
            .push(fd);
        Ok(true)
    }

    fn notifications(&self) -> io::Result<()> {
        let mut buffer = [0u8; 8192];
        let count = loop {
            // SAFETY: buffer is writable for its full length; notification remains owned.
            let count = unsafe {
                libc::read(
                    self.notification.as_raw_fd(),
                    buffer.as_mut_ptr().cast(),
                    buffer.len(),
                )
            };
            if count >= 0 {
                break count as usize;
            }
            let error = io::Error::last_os_error();
            if error.kind() != io::ErrorKind::Interrupted {
                return Err(error);
            }
        };
        let mut offset = 0;
        while offset < count {
            if count - offset < 16 {
                return Err(io::Error::other("truncated notification"));
            }
            // Decode bytes instead of casting possibly unaligned kernel records.
            let mask = u32::from_ne_bytes(buffer[offset + 4..offset + 8].try_into().unwrap());
            let length =
                u32::from_ne_bytes(buffer[offset + 12..offset + 16].try_into().unwrap()) as usize;
            if mask
                & (libc::IN_Q_OVERFLOW
                    | libc::IN_IGNORED
                    | libc::IN_DELETE_SELF
                    | libc::IN_MOVE_SELF
                    | libc::IN_UNMOUNT)
                != 0
            {
                return Err(io::Error::other("notification overflow or invalidation"));
            }
            if length > count - offset - 16 {
                return Err(io::Error::other("truncated notification name"));
            }
            offset += 16 + length;
        }
        Ok(())
    }

    pub fn wait(&self, deadline: Option<Instant>) -> io::Result<Wake> {
        loop {
            let remaining = deadline.map_or(-1, |at| {
                let duration = at.saturating_duration_since(Instant::now());
                duration
                    .as_millis()
                    .saturating_add(u128::from(duration.subsec_nanos() % 1_000_000 != 0))
                    .min(i32::MAX as u128) as i32
            });
            let mut out = libc::epoll_event { events: 0, u64: 0 };
            // SAFETY: output holds one event, and the queue is retained through this blocking call.
            let n = unsafe { libc::epoll_wait(self.event.as_raw_fd(), &mut out, 1, remaining) };
            if n > 0 {
                if out.events & libc::EPOLLERR as u32 != 0
                    || (out.events & libc::EPOLLHUP as u32 != 0 && out.u64 != 3)
                {
                    return Err(io::Error::other("wait descriptor failure"));
                }
                if out.u64 == 1 {
                    self.notifications()?;
                }
                return Ok(if out.u64 == 2 {
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
