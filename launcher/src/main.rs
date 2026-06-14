#![cfg_attr(target_os = "windows", windows_subsystem = "windows")]

use std::process::{Command, Stdio};
use std::thread::sleep;
use std::time::Duration;
use std::net::TcpStream;
use std::path::PathBuf;

const SEA_BINARY: &[u8] = include_bytes!(concat!(env!("OUT_DIR"), "/sea_binary.bin"));

fn data_dir() -> PathBuf {
    let base = if cfg!(target_os = "windows") {
        std::env::var("LOCALAPPDATA")
            .map(PathBuf::from)
            .unwrap_or_else(|_| {
                let home = std::env::var("USERPROFILE").unwrap_or_else(|_| ".".into());
                PathBuf::from(home).join("AppData").join("Local")
            })
    } else {
        let home = std::env::var("HOME").unwrap_or_else(|_| ".".into());
        PathBuf::from(std::env::var("XDG_DATA_HOME")
            .unwrap_or_else(|_| format!("{}/.local/share", home)))
    };
    base.join("OpenFox")
}

fn sea_path() -> PathBuf {
    let name = if cfg!(target_os = "windows") { "openfox-core.exe" } else { "openfox-core" };
    data_dir().join(name)
}

fn extract_sea() -> PathBuf {
    let path = sea_path();
    if !path.exists() {
        let parent = path.parent().unwrap();
        std::fs::create_dir_all(parent).ok();
        std::fs::write(&path, SEA_BINARY).expect("Failed to extract SEA binary");
        #[cfg(unix)]
        {
            use std::os::unix::fs::PermissionsExt;
            std::fs::set_permissions(&path, std::fs::Permissions::from_mode(0o755)).ok();
        }
    }
    path
}

fn wait_for_server(port: u16, timeout_secs: u64) -> bool {
    let start = std::time::Instant::now();
    while start.elapsed().as_secs() < timeout_secs {
        if TcpStream::connect(format!("127.0.0.1:{}", port)).is_ok() {
            return true;
        }
        sleep(Duration::from_millis(200));
    }
    false
}

fn main() {
    let sea_path = extract_sea();
    let port: u16 = std::env::var("OPENFOX_PORT")
        .ok()
        .and_then(|p| p.parse().ok())
        .unwrap_or(11369);

    let mut child = match Command::new(&sea_path)
        .env("OPENFOX_PORT", port.to_string())
        .env("OPENFOX_HOST", "127.0.0.1")
        .stdin(Stdio::null())
        .stdout(Stdio::null())
        .stderr(Stdio::null())
        .spawn()
    {
        Ok(c) => c,
        Err(e) => {
            eprintln!("Failed to start OpenFox server: {}", e);
            let _ = webview::WebView::new(
                "OpenFox - Error",
                webview::Content::Url("about:blank"),
                600, 200, false, false,
            );
            return;
        }
    };

    if !wait_for_server(port, 30) {
        eprintln!("Server did not start within 30 seconds");
        child.kill().ok();
        child.wait().ok();
        return;
    }

    let url = format!("http://127.0.0.1:{}", port);
    let webview = webview::WebView::new(
        "OpenFox",
        webview::Content::Url(&url),
        1200, 800, true, false,
    )
    .expect("Failed to create WebView window");

    webview.join();
    child.kill().ok();
    child.wait().ok();
}
