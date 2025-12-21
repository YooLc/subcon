[English](README.md) | [简体中文](README.zh-CN.md)

![subcon](https://socialify.git.ci/yoolc/subcon/image?custom_language=OpenAI&description=1&font=Inter&forks=1&issues=1&language=1&name=1&pattern=Plus&pulls=1&stargazers=1&theme=Auto)

# subcon

Subscription converter server that renders Clash and Surge configs from local profiles or remote subscriptions. Conversion logic is driven by `schema/` and `conf/` configs, so you can tune behavior without recompiling the project.

## Documentation
[Documentation](docs/index.md)

## Support Matrix
| Software | Import | Export | Notes |
| -- | -- | -- | -- |
| Clash | Yes | Yes | Import expects Clash profile YAML. |
| Surge | No | Yes | VLESS not supported |

## Build
- Install a Rust toolchain that supports the 2024 edition (Rust 1.85+ recommended).
```bash
cargo build --release
```

## Run
```bash
cargo run -- --pref conf/pref.toml
```

The server binds to `server.listen` and `server.port` from `pref.toml`.
