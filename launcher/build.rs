use std::{env, fs, path::Path};

fn main() {
    // webview crate needs advapi32 on Windows for registry functions
    if cfg!(target_os = "windows") {
        println!("cargo:rustc-link-lib=advapi32");
    }

    // Path to the SEA binary is passed via OPENFOX_SEA_PATH env var
    // or defaults to ../out/openfox-core
    let sea_path = env::var("OPENFOX_SEA_PATH")
        .unwrap_or_else(|_| {
            let root = Path::new(env!("CARGO_MANIFEST_DIR")).parent().unwrap();
            let name = if cfg!(windows) { "openfox-core.exe" } else { "openfox-core" };
            root.join("out").join(name).to_string_lossy().to_string()
        });

    println!("cargo:rerun-if-env-changed=OPENFOX_SEA_PATH");
    println!("cargo:rerun-if-changed={}", sea_path);

    let sea_bytes = fs::read(&sea_path).expect("Failed to read SEA binary");
    let out_dir = env::var("OUT_DIR").unwrap();
    let dest = Path::new(&out_dir).join("sea_binary.bin");
    fs::write(&dest, &sea_bytes).expect("Failed to write embedded SEA");
}
