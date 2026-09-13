fn main() {
    napi_build::setup();
    // macOS otherwise embeds Cargo's absolute output path as the library ID.
    if matches!(std::env::var("CARGO_CFG_TARGET_OS").as_deref(), Ok("macos")) {
        println!("cargo::rustc-link-arg-cdylib=-Wl,-install_name,@rpath/libsemaphile_native.dylib");
    }
}
