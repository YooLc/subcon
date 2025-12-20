[English](README.md) | [简体中文](README.zh-CN.md)

![subcon](https://socialify.git.ci/yoolc/subcon/image?custom_language=OpenAI&description=1&font=Inter&forks=1&issues=1&language=1&name=1&pattern=Plus&pulls=1&stargazers=1&theme=Auto)

# subcon

订阅转换服务，可将本地 profiles 或远程订阅渲染为 Clash 和 Surge 配置。转换逻辑由 `schema/` 和 `conf/` 配置驱动，无需重新编译即可调整。

## 支持矩阵
| 软件 | 导入 | 导出 | 备注 |
| -- | -- | -- | -- |
| Clash | 是 | 是 | 导入需要 Clash 配置 YAML。 |
| Surge | 否 | 是 | 不支持 VLESS。 |

## 编译
- 安装支持 2024 edition 的 Rust 工具链 (推荐 Rust 1.85+).
```bash
cargo build --release
```

## 运行
```bash
cargo run -- --pref conf/pref.toml
```

服务监听地址来自 `pref.toml` 的 `server.listen` 和 `server.port`.
