---
icon: lucide/terminal
---

# Installation

## Prerequisites
- Rust 1.85+ (Rust 2024 edition)
- Git
- A writable working directory for `conf/` and `schema/`

!!! note "Rust edition"
    Subcon targets the Rust 2024 edition. Use a recent toolchain to avoid
    compiler errors.

## Install Rust
=== "macOS / Linux"
    ```bash
    curl --proto '=https' --tlsv1.2 -sSf https://sh.rustup.rs | sh
    source "$HOME/.cargo/env"
    rustup update stable
    ```

=== "Windows"
    ```powershell
    winget install -e --id Rustlang.Rustup
    ```

## Build
```bash
cargo build --release
```

## Run
```bash
cargo run -- --pref conf/pref.toml
```

Or use the release binary:
```bash
./target/release/subcon --pref conf/pref.toml
```

## Verify
```bash
curl "http://127.0.0.1:25500/sub?target=clash"
```

??? info "Common flags"
    - `--pref`: path to `pref.toml` (default `conf/pref.toml`)

## Next steps
- Review [General Settings](../configuration/general-settings.md).
- Add or edit profiles in [Proxy](../configuration/proxy.md).
