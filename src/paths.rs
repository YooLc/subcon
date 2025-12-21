use std::path::{Path, PathBuf};

const SYSTEM_BASE_DIR: &str = "/etc/subcon";

pub fn resolve_path(base_dir: &Path, input: impl AsRef<Path>) -> PathBuf {
    let input = input.as_ref();
    if input.is_absolute() {
        return input.to_path_buf();
    }

    let local = base_dir.join(input);
    if local.exists() {
        return local;
    }

    let system = Path::new(SYSTEM_BASE_DIR).join(input);
    if system.exists() {
        return system;
    }

    local
}
