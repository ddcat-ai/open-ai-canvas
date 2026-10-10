//! keep-awake：壳存活期间阻止系统空闲休眠。平台差异各自隔离在下面的分支里。

use std::process::Child;
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::Mutex;

/// macOS 用 `caffeinate` 子进程，Windows 用 `SetThreadExecutionState`（无线程子进程）。
pub struct KeepAwake {
    enabled: AtomicBool,
    child: Mutex<Option<Child>>,
}

impl KeepAwake {
    pub const fn new() -> Self {
        Self {
            enabled: AtomicBool::new(false),
            child: Mutex::new(None),
        }
    }

    pub fn set(&self, enabled: bool) {
        if self.enabled.swap(enabled, Ordering::SeqCst) == enabled {
            return;
        }
        #[cfg(target_os = "macos")]
        {
            let mut slot = crate::state::lock(&self.child);
            if enabled {
                match std::process::Command::new("/usr/bin/caffeinate")
                    .arg("-i")
                    .spawn()
                {
                    Ok(child) => *slot = Some(child),
                    // 起不来就如实回落，不把「没生效」当成「已开启」。
                    Err(_) => self.enabled.store(false, Ordering::SeqCst),
                }
            } else if let Some(mut child) = slot.take() {
                let _ = child.kill();
                let _ = child.wait();
            }
        }
        #[cfg(target_os = "windows")]
        {
            set_execution_state(enabled);
        }
        #[cfg(not(any(target_os = "macos", target_os = "windows")))]
        {
            // Linux 暂不实现：宁可如实不生效，也不假装开启。
        }
    }
}

#[cfg(target_os = "windows")]
fn set_execution_state(enabled: bool) {
    const ES_CONTINUOUS: u32 = 0x8000_0000;
    const ES_SYSTEM_REQUIRED: u32 = 0x0000_0001;

    extern "system" {
        fn SetThreadExecutionState(flags: u32) -> u32;
    }

    let flags = if enabled {
        ES_CONTINUOUS | ES_SYSTEM_REQUIRED
    } else {
        ES_CONTINUOUS
    };
    unsafe {
        SetThreadExecutionState(flags);
    }
}
