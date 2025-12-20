---
icon: lucide/home
---

# Subcon

![Cover](https://socialify.git.ci/yoolc/subcon/image?custom_language=OpenAI&description=1&font=Inter&forks=1&issues=1&language=1&name=1&pattern=Plus&pulls=1&stargazers=1&theme=Auto)

Subcon is a subscription converter server that renders Clash and Surge configs
from local profiles or remote subscriptions. Conversion is driven by `schema/`
and `conf/`, so you can tune behavior without recompiling.

!!! info "Why Subcon"
    - Schema-driven mapping keeps protocol support consistent.
    - Profiles and rules live on disk for quick iteration.
    - A single `/sub` endpoint delivers target-specific output.

## Request flow
``` mermaid
graph LR
  A[Profiles or remote URL] --> B[Schema registry]
  B --> C[Optional inserts and node prefs]
  C --> D[Target renderer]
  D --> E[Clash or Surge output]
```

## Support matrix
| Software | Import | Export | Notes |
| --- | --- | --- | --- |
| Clash | Yes | Yes | Import expects Clash profile YAML. |
| Surge | No | Yes | VLESS not supported. |

## Quick start
=== "Local profiles"
    ```bash
    curl "http://127.0.0.1:25500/sub?target=clash"
    ```

=== "Remote subscription"
    ```bash
    curl "http://127.0.0.1:25500/sub?target=clash&url=https://example.com/sub"
    ```

!!! danger "Security note"

    To prevent abuse and ensure security, remote subscription `url` requests are restricted by `common.allowed_domain`.

## Request parameters
| Name | Required | Description |
| --- | --- | --- |
| `target` | yes | `clash` or `surge`. |
| `url` | no | Remote subscription URL. |
| `token` | no | Matches `common.api_access_token` to include inserts. |

??? info "Where configs come from"
    - `conf/base/` provides base templates.
    - `conf/snippets/` defines proxy groups and rulesets.
    - `conf/profiles/` supplies local proxy lists.
    - `schema/` maps protocols to each target.

## Project layout
- `conf/` - runtime configuration, profiles, and rules.
- `schema/` - protocol schemas and target mapping.
- `src/` - server and renderer implementation.
- `docs/` - documentation sources.

## Next steps
- [Get Started](get-started/index.md)
- [Configuration](configuration/index.md)
