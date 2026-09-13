use semaphile_os::{alive, File, Subscription, Wake};
use std::io::{BufRead, BufReader, Write};
use std::path::{Path, PathBuf};
use std::process::{Child, Command, Stdio};
use std::sync::{
    atomic::{AtomicUsize, Ordering},
    mpsc,
};
use std::time::Duration;

fn directory() -> PathBuf {
    static NEXT: AtomicUsize = AtomicUsize::new(0);
    let path = Path::new(env!("CARGO_MANIFEST_DIR"))
        .join("../../../../.tmp/native-rust")
        .join(format!(
            "{}-{}",
            std::process::id(),
            NEXT.fetch_add(1, Ordering::Relaxed)
        ));
    std::fs::create_dir_all(&path).unwrap();
    path
}

struct Owner(Child);
impl Drop for Owner {
    fn drop(&mut self) {
        let _ = self.0.kill();
        let _ = self.0.wait();
    }
}
fn owner(path: &Path) -> (Owner, BufReader<std::process::ChildStdout>) {
    let mut child = Command::new(env!("CARGO_BIN_EXE_coordination-probe"))
        .arg(path)
        .stdin(Stdio::piped())
        .stdout(Stdio::piped())
        .spawn()
        .unwrap();
    let mut reader = BufReader::new(child.stdout.take().unwrap());
    let mut line = String::new();
    reader.read_line(&mut line).unwrap();
    assert_eq!(line.trim(), "locked");
    (Owner(child), reader)
}

#[test]
fn unrelated_owner_release_and_crash_reclaim() {
    let path = directory().join("owner");
    let (mut holder, mut reader) = owner(&path);
    assert!(alive(&path).unwrap());
    writeln!(holder.0.stdin.as_mut().unwrap(), "release").unwrap();
    let mut line = String::new();
    reader.read_line(&mut line).unwrap();
    assert_eq!(line.trim(), "released");
    assert!(!alive(&path).unwrap());
    assert!(holder.0.try_wait().unwrap().is_none());
    drop(holder);
    let (mut holder, _reader) = owner(&path);
    assert!(alive(&path).unwrap());
    holder.0.kill().unwrap();
    holder.0.wait().unwrap();
    assert!(!alive(&path).unwrap());
}

#[test]
fn blocking_gate_wakes_on_unrelated_owner_release() {
    let path = directory().join("gate");
    let (mut holder, _reader) = owner(&path);
    let (tx, rx) = mpsc::channel();
    let waiter = std::thread::spawn(move || {
        let file = File::open(&path).unwrap();
        let guard = file.gate().unwrap();
        tx.send(()).unwrap();
        guard.release().unwrap();
    });
    assert!(rx.recv_timeout(Duration::from_millis(25)).is_err());
    writeln!(holder.0.stdin.as_mut().unwrap(), "release").unwrap();
    rx.recv_timeout(Duration::from_secs(3)).unwrap();
    waiter.join().unwrap();
}

#[test]
fn scope_unwind_releases_gate_and_close_is_idempotent() {
    let path = directory().join("gate");
    let file = File::open(&path).unwrap();
    let _ = std::panic::catch_unwind(|| {
        let _gate = file.gate().unwrap();
        assert!(file.close().is_err());
        panic!("unwind fixture");
    });
    assert!(!alive(&path).unwrap());
    // Mutex poisoning makes reuse fail, but destruction still owns and closes fd.
    drop(file);
    let file = File::open(&path).unwrap();
    file.close().unwrap();
    file.close().unwrap();
    assert!(file.pulse().is_err());
}

fn subscription() -> (Subscription, File, PathBuf) {
    let path = directory().join("notify");
    let file = File::open(&path).unwrap();
    (Subscription::open(&path).unwrap(), file, path)
}

#[test]
fn notification_survives_subscribe_to_wait_gap() {
    let (wait, file, _) = subscription();
    file.pulse().unwrap();
    let (tx, rx) = mpsc::channel();
    wait.start(Some(Duration::from_secs(2)), move |result| {
        tx.send(result).unwrap();
    })
    .unwrap();
    assert_eq!(
        rx.recv_timeout(Duration::from_secs(3)).unwrap().unwrap(),
        Wake::Changed
    );
    wait.close().unwrap();
}

#[test]
fn cancellation_and_close_join_idle_wait_without_polling() {
    let (wait, _, _) = subscription();
    let (tx, rx) = mpsc::channel();
    wait.start(None, move |result| {
        tx.send(result).unwrap();
    })
    .unwrap();
    assert!(rx.recv_timeout(Duration::from_millis(25)).is_err());
    wait.close().unwrap();
    assert_eq!(rx.try_recv().unwrap().unwrap(), Wake::Cancelled);
    wait.close().unwrap();
    assert!(wait.start(None, |_| {}).is_err());
}

#[test]
fn drop_joins_and_does_not_affect_other_subscriptions() {
    let (first, _, _) = subscription();
    let (second, file, _) = subscription();
    let (tx, rx) = mpsc::channel();
    first
        .start(None, move |r| {
            tx.send(r).unwrap();
        })
        .unwrap();
    drop(first);
    assert_eq!(rx.try_recv().unwrap().unwrap(), Wake::Cancelled);
    let (tx, rx) = mpsc::channel();
    second
        .start(None, move |r| {
            tx.send(r).unwrap();
        })
        .unwrap();
    file.pulse().unwrap();
    assert_eq!(
        rx.recv_timeout(Duration::from_secs(3)).unwrap().unwrap(),
        Wake::Changed
    );
}

#[test]
fn native_exit_watch_wakes_and_does_not_signal_owner() {
    let (wait, _, _) = subscription();
    let path = directory().join("owner");
    let (mut holder, _) = owner(&path);
    assert!(wait.watch_owner(holder.0.id() as i32).unwrap());
    let (tx, rx) = mpsc::channel();
    wait.start(None, move |r| {
        tx.send(r).unwrap();
    })
    .unwrap();
    assert!(holder.0.try_wait().unwrap().is_none());
    holder.0.kill().unwrap();
    assert_eq!(
        rx.recv_timeout(Duration::from_secs(3)).unwrap().unwrap(),
        Wake::Changed
    );
    holder.0.wait().unwrap();
}

#[test]
fn invalidation_fails_explicitly() {
    let (wait, _, path) = subscription();
    std::fs::rename(&path, path.with_extension("moved")).unwrap();
    let (tx, rx) = mpsc::channel();
    wait.start(Some(Duration::from_secs(1)), move |r| {
        tx.send(r).unwrap();
    })
    .unwrap();
    assert!(rx.recv_timeout(Duration::from_secs(2)).unwrap().is_err());
}

#[test]
fn deadline_and_single_use_validation() {
    let (wait, _, _) = subscription();
    let (tx, rx) = mpsc::channel();
    wait.start(Some(Duration::ZERO), move |r| {
        tx.send(r).unwrap();
    })
    .unwrap();
    assert_eq!(
        rx.recv_timeout(Duration::from_secs(1)).unwrap().unwrap(),
        Wake::Deadline
    );
    assert!(wait.start(None, |_| {}).is_err());
    assert!(wait.watch_owner(std::process::id() as i32).is_err());
    assert!(wait.watch_owner(0).is_err());
}

#[test]
fn concurrent_close_waits_for_native_completion_before_both_return() {
    let (wait, _, _) = subscription();
    let wait = std::sync::Arc::new(wait);
    let (entered_tx, entered_rx) = mpsc::channel();
    let (continue_tx, continue_rx) = mpsc::channel();
    wait.start(None, move |result| {
        assert_eq!(result.unwrap(), Wake::Cancelled);
        entered_tx.send(()).unwrap();
        continue_rx.recv_timeout(Duration::from_secs(3)).unwrap();
    })
    .unwrap();
    let (finished_tx, finished_rx) = mpsc::channel();
    let first = {
        let wait = wait.clone();
        let finished = finished_tx.clone();
        std::thread::spawn(move || {
            wait.close().unwrap();
            finished.send(()).unwrap();
        })
    };
    entered_rx.recv_timeout(Duration::from_secs(3)).unwrap();
    let second = {
        let wait = wait.clone();
        std::thread::spawn(move || {
            wait.close().unwrap();
            finished_tx.send(()).unwrap();
        })
    };
    assert!(finished_rx.recv_timeout(Duration::from_millis(25)).is_err());
    continue_tx.send(()).unwrap();
    first.join().unwrap();
    second.join().unwrap();
    assert_eq!(finished_rx.try_iter().count(), 2);
}

#[test]
fn repeated_close_under_descriptor_reuse_does_not_close_new_resources() {
    for _ in 0..64 {
        let (old, _, _) = subscription();
        old.start(None, |_| {}).unwrap();
        old.close().unwrap();
        let path = directory().join("replacement-owner");
        let replacement = File::open(&path).unwrap();
        replacement.lock_lifetime().unwrap();
        let (new, notification, _) = subscription();
        let (tx, rx) = mpsc::channel();
        new.start(None, move |result| {
            tx.send(result).unwrap();
        })
        .unwrap();
        old.close().unwrap();
        drop(old);
        assert!(alive(&path).unwrap());
        notification.pulse().unwrap();
        assert_eq!(
            rx.recv_timeout(Duration::from_secs(3)).unwrap().unwrap(),
            Wake::Changed
        );
        new.close().unwrap();
    }
}

#[test]
fn normal_owner_exit_wakes_subscription() {
    let (wait, _, _) = subscription();
    let path = directory().join("owner");
    let (mut holder, _reader) = owner(&path);
    assert!(wait.watch_owner(holder.0.id() as i32).unwrap());
    let (tx, rx) = mpsc::channel();
    wait.start(None, move |result| {
        tx.send(result).unwrap();
    })
    .unwrap();
    writeln!(holder.0.stdin.as_mut().unwrap(), "release\nexit").unwrap();
    assert_eq!(
        rx.recv_timeout(Duration::from_secs(3)).unwrap().unwrap(),
        Wake::Changed
    );
    holder.0.wait().unwrap();
    assert!(!alive(&path).unwrap());
}
