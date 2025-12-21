---
icon: lucide/terminal
---

# Installation

Choose the option that best fits your environment.

## Release archive (recommended)
Download the matching archive from [GitHub Releases](https://github.com/YooLc/subcon/releases)
and extract it. The archive contains a `subcon/` directory with the binary,
`conf/`, and `schema/`.

=== "Linux / macOS (tar.gz)"
    ```bash
    tar xzf subcon-v0.2.0-x86_64-unknown-linux-gnu.tar.gz
    cd subcon
    ./subcon --pref conf/pref.toml
    ```

=== "Windows (zip)"
    ```powershell
    Expand-Archive .\subcon-v0.2.0-x86_64-pc-windows-msvc.zip
    cd subcon
    .\subcon.exe --pref conf\pref.toml
    ```

Replace the archive name with the release version and target you downloaded.

## Debian package (Linux)
Install the `.deb` package and run the binary from your PATH.

```bash
sudo dpkg -i subcon_*_amd64.deb
subcon
```

The package installs configuration under `/etc/subcon/conf` and schema under
`/etc/subcon/schema`. The default `conf/pref.toml` lookup falls back to
`/etc/subcon/conf/pref.toml` when it is not found in the working directory.

## Build from source

### Prerequisites
- Rust 1.85+ (Rust 2024 edition)
- Git
- A writable working directory for `conf/` and `schema/`

!!! note "Rust edition"
    Subcon targets the Rust 2024 edition. Use a recent toolchain to avoid
    compiler errors.

### Install Rust
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

### Build
```bash
cargo build --release
```

### Run
```bash
cargo run -- --pref conf/pref.toml
```

Or run the release binary:
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
