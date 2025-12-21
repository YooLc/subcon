---
icon: lucide/package-open
tags:
  - Get started
  - Setup
---

# Get Started

This section gets you from download or clone to a working `/sub` endpoint with a
minimal, safe configuration. Follow the path that matches your deployment style.

## Choose your path
=== "Docker (recommended)"
    - Run the published image with `docker run`, or use Docker Compose.
    - Mount `example/conf` or your own config into `/app/conf`.
    - Expose the bind port.

    Continue at [Docker Deployment](docker.md).

=== "Release package"
    - Download the release archive or Debian package.
    - Use the bundled `conf/` and `schema/` as a starting point.
    - Run the binary from the extracted folder or your PATH.

    Continue at [Installation](installation.md).

=== "Local build"
    - Install Rust with rustup.
    - Build and run the binary.
    - Edit `conf/pref.toml` for your environment.

    Continue at [Installation](installation.md).

!!! note
    For a quick start, Docker or release packages are the fastest.

## Baseline configuration
At minimum, make sure these fields are set in `conf/pref.toml`:

- `common.schema`
- `common.clash_rule_base`
- `common.surge_rule_base`
- `common.default_url` or a plan to pass `url`
- `common.api_access_token` if you plan to use the Web UI or `/api`
- `network.allowed_domain` when using remote subscriptions

!!! warning
    The Web UI and `/api` require `common.api_access_token`. If you plan to use insert profiles, this token is also required to include inserts. Keep `pref.toml` private (do not commit or share it).

    You can generate a token with:
    ```bash
    openssl rand -base64 32
    ```

??? example "Minimal configuration scaffold"
    ```toml
    [common]
    schema = "schema"
    clash_rule_base = "conf/base/clash.yml"
    surge_rule_base = "conf/base/surge.cfg"
    default_url = ["conf/profiles/example.yaml"]

    [network]
    allowed_domain = ["example.com"]

    [server]
    listen = "0.0.0.0"
    port = 25500
    ```

## Run
=== "Docker"
    ```bash
    docker run --rm -p 25500:25500 ghcr.io/yoolc/subcon:latest
    ```

=== "Local binary"
    ```bash
    ./subcon --pref conf/pref.toml
    ```

## Verify
```bash
curl "http://127.0.0.1:25500/sub?target=clash"
```

## Web UI
Open the control panel in your browser:

- `http://127.0.0.1:25500/`
- Enter the server URL (same origin) and `common.api_access_token` to sign in.
- Use Logout to clear credentials stored in the browser.

## Next steps
- Review [General Settings](../configuration/general-settings.md).
- Define proxy sources in [Proxy](../configuration/proxy.md).
- Troubleshoot errors in [Troubleshooting](troubleshooting.md).
