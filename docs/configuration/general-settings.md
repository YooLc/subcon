---
icon: lucide/sliders
---

# General Settings

`conf/pref.toml` defines global behavior for Subcon. Paths are resolved from
the project root.

## Pref structure
```toml
version = 1

[common]
schema = "schema"
clash_rule_base = "conf/base/clash.yml"
surge_rule_base = "conf/base/surge.cfg"
default_url = ["conf/profiles/example.yaml"]
api_access_token = "change-me"
enable_insert = true
insert_url = ["conf/profiles/extra.yaml"]
prepend_insert_url = true
sort = true

[node_pref]
udp = true
tfo = false

[managed_config]
write_managed_config = true
managed_config_prefix = "https://sub.example.com"
config_update_interval = 86400
config_update_strict = false

[network]
enable = true
dir = "conf/cache"
ttl_seconds = 86400
allowed_domain = ["example.com"]

[[custom_groups]]
import = "conf/snippets/groups.toml"

[ruleset]
enabled = true

[[rulesets]]
import = "conf/snippets/rulesets.toml"

[server]
listen = "0.0.0.0"
port = 25500
```

## Common settings
| Key | Type | Purpose |
| --- | --- | --- |
| `common.schema` | string | Path to the schema directory. |
| `common.clash_rule_base` | string | Base Clash config template. |
| `common.surge_rule_base` | string | Base Surge config template. |
| `common.default_url` | string list | Local profile paths for default requests. |
| `common.api_access_token` | string | Token required to include inserts. |
| `common.enable_insert` | bool | Enable insert profile behavior. |
| `common.insert_url` | string list | Profiles to inject with a valid token. |
| `common.prepend_insert_url` | bool | Prepend inserts before defaults. |
| `common.sort` | bool | Sort proxies by name before rendering. |

## Server settings
| Key | Type | Purpose |
| --- | --- | --- |
| `server.listen` | string | Bind address for the HTTP server. |
| `server.port` | integer | Bind port for the HTTP server. |

## Node preferences
`node_pref` applies optional overrides when the schema supports them.

| Key | Type | Purpose |
| --- | --- | --- |
| `node_pref.udp` | bool | Enable or disable UDP. |
| `node_pref.tfo` | bool | Enable or disable TCP Fast Open. |
| `node_pref.skip-cert-verify` | bool | Toggle certificate verification. |

## Managed config (Surge)
If enabled, Subcon writes a `#!MANAGED-CONFIG` line for Surge outputs.

| Key | Type | Purpose |
| --- | --- | --- |
| `managed_config.write_managed_config` | bool | Toggle managed config line. |
| `managed_config_prefix` | string | Base URL without a trailing slash. |
| `config_update_interval` | integer | Refresh interval in seconds. |
| `config_update_strict` | bool | Whether Surge enforces strict updates. |

## Network settings
Network settings control remote fetch behavior, caching, and allowlists.
The cache directory is cleared on every startup, so do not place important files there.

| Key | Type | Purpose |
| --- | --- | --- |
| `network.enable` | bool | Enable cache reads and writes (defaults to true). |
| `network.dir` | string | Directory for cached responses (relative to project root unless absolute). |
| `network.ttl_seconds` | integer | Default cache TTL in seconds (default 86400). |
| `network.allowed_domain` | string list | Allowlist for remote `url` fetch. |

When `network.enable` is false, Subcon always fetches remote content and skips cache reads and writes.

!!! warning
    If `network.allowed_domain` is empty, all `url` requests are rejected.

## Groups and rulesets
Use TOML imports to keep large config files manageable.

- `[[custom_groups]]` imports group definitions from a TOML file.
- `[ruleset].enabled` toggles rule generation.
- `[[rulesets]]` imports rule mappings from a TOML file.

=== "Local only"
    Use local profiles without a `url` parameter.
    ```toml
    [common]
    default_url = ["conf/profiles/example.yaml"]
    # network.allowed_domain can stay empty when not using remote URLs.
    ```

=== "Remote allowed"
    Use a remote subscription URL.
    ```toml
    [network]
    allowed_domain = ["example.com"]
    ```
