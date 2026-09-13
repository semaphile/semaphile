use semaphile_os::File;
use std::io::{self, Write};
use std::path::Path;

fn main() -> io::Result<()> {
    let path = std::env::args().nth(1).expect("lock path");
    let file = File::open(Path::new(&path))?;
    file.lock_lifetime()?;
    println!("locked");
    io::stdout().flush()?;
    let mut line = String::new();
    io::stdin().read_line(&mut line)?;
    file.close()?;
    println!("released");
    io::stdout().flush()?;
    line.clear();
    io::stdin().read_line(&mut line)?;
    Ok(())
}
