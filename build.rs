use std::{env, path::PathBuf, process::Command};

fn main() {
    let manifest_dir = PathBuf::from(env::var("CARGO_MANIFEST_DIR").unwrap());
    let web_dir = manifest_dir.join("src").join("web");
    let out_index = web_dir.join("out").join("index.html");

    if !web_dir.exists() {
        return;
    }

    println!("cargo:rerun-if-changed=build.rs");
    println!("cargo:rerun-if-changed=src/web");
    println!("cargo:rerun-if-changed=src/web/package.json");
    println!("cargo:rerun-if-changed=src/web/pnpm-lock.yaml");

    if env::var_os("SUBCON_WEB_SKIP").is_some() {
        if !out_index.exists() {
            panic!(
                "SUBCON_WEB_SKIP is set but {} is missing. Run `pnpm -C src/web build` first.",
                out_index.display()
            );
        }
        return;
    }

    run_cmd("pnpm", &["install", "--frozen-lockfile"], &web_dir);
    run_cmd("pnpm", &["build"], &web_dir);
}

fn run_cmd(bin: &str, args: &[&str], dir: &PathBuf) {
    let status = Command::new(bin)
        .args(args)
        .current_dir(dir)
        .status()
        .unwrap_or_else(|err| panic!("failed to run {bin}: {err}"));

    if !status.success() {
        panic!("{bin} {:?} failed with status {:?}", args, status);
    }
}
