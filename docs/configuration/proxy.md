---
icon: lucide/network
---

# Proxy

Subcon loads proxies from local profiles and optionally from a remote
subscription URL.

## Profiles
Profiles are YAML files that contain a top-level `proxies` list.

```yaml
proxies:
  - name: Example Trojan
    type: trojan
    server: example.com
    port: 443
    password: "replace-me" # (1)
```

1. Required fields vary by protocol. Check the schema file for each protocol.

!!! note
    Local profiles are loaded from `common.default_url` when `url` is not
    supplied in the request.

## Supported protocols
Schema files in `schema/` define which protocols are supported. Typical
protocols include:

- `trojan`
- `shadowsocks`
- `vmess`
- `vless`
- `wireguard`
- `hysteria2`
- `http`
- `socks5`

!!! warning
    Surge export does not support VLESS.

## Remote subscriptions
To pull a subscription URL, pass `url` and ensure the hostname is listed in
`network.allowed_domain`.

```bash
curl "http://127.0.0.1:25500/sub?target=clash&url=https://example.com/sub"
```

## Node preference overrides
`node_pref` can set common flags across all proxies when supported by the
schema. See [General Settings](general-settings.md).

## Schema customization
Each protocol schema lives under `schema/` and can include shared definitions
from `schema/include/`. Edit these files to add fields or adjust target mapping.
