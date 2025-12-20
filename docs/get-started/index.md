---
icon: lucide/package-open
tags:
  - Get started
  - Setup
---

# Get Started

This section gets you from clone to a working `/sub` endpoint with a minimal,
safe configuration. Follow the path that matches your deployment style.

## Choose your path
=== "Local build"
    - Install Rust with rustup.
    - Build and run the binary.
    - Edit `conf/pref.toml` for your environment.

    Continue at [Installation](installation.md).

=== "Docker"
    - Run the published image with `docker run`, or use Docker Compose.
    - Mount `example/conf` or your own config into `/app/conf`.
    - Expose the bind port.

    Continue at [Docker Deployment](docker.md).

!!! note
    If you only need a quick smoke test, a local build is faster than Docker.

## Baseline configuration
At minimum, make sure these fields are set in `conf/pref.toml`:

- `common.schema`
- `common.clash_rule_base`
- `common.surge_rule_base`
- `common.default_url` or a plan to pass `url`
- `common.allowed_domain` when using remote subscriptions

??? example "Minimal configuration scaffold"
    ```toml
    [common]
    schema = "schema"
    clash_rule_base = "conf/base/clash.yml"
    surge_rule_base = "conf/base/surge.cfg"
    default_url = ["conf/profiles/example.yaml"]
    allowed_domain = ["example.com"]

    [server]
    listen = "0.0.0.0"
    port = 25500
    ```

## Run and verify
=== "Run"
    ```bash
    cargo run -- --pref conf/pref.toml
    ```

=== "Verify"
    ```bash
    curl "http://127.0.0.1:25500/sub?target=clash"
    ```

## Next steps
- Review [General Settings](../configuration/general-settings.md).
- Define proxy sources in [Proxy](../configuration/proxy.md).
- Troubleshoot errors in [Troubleshooting](troubleshooting.md).
