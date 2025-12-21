---
icon: lucide/box
---

# Docker Deployment

The published image includes a working example config from `example/conf`. You
can use it directly or mount your own configuration.

## Docker run
=== "Quick start (built-in example)"
    ```bash
    docker run --rm -p 25500:25500 ghcr.io/yoolc/subcon:latest
    ```

=== "Use local example config"
    ```bash
    docker run --rm -p 25500:25500 \
      -v "$PWD/example/conf:/app/conf" \
      ghcr.io/yoolc/subcon:latest
    ```

=== "Custom config and schema"
    ```bash
    docker run --rm -p 25500:25500 \
      -v "/path/to/conf:/app/conf" \
      -v "/path/to/schema:/app/schema" \
      ghcr.io/yoolc/subcon:latest
    ```

!!! note
    Ensure `server.listen = "0.0.0.0"` so the container can accept traffic.

## Docker Compose
The repository includes an example compose file:

```bash
docker compose -f example/docker-compose.yaml up -d
```

This mounts `example/conf` into `/app/conf` and exposes port 25500. Adjust the
volume path if you use your own config directory.

## Verify
```bash
curl "http://127.0.0.1:25500/sub?target=clash"
```

## Security checklist
- Keep `network.allowed_domain` minimal.
- Rotate `common.api_access_token` if it leaks.
- Avoid binding to public interfaces without access controls.
