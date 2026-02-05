---
icon: lucide/link
---

# URI Format

Subcon can import and export proxies as URI lines. Each non-empty line is parsed
independently. Lines beginning with `#` or `//` are ignored.

Format:

```
protocol://auth@server:port?key=value&key=value#name
```

`protocol` becomes the proxy `type`. `server`, `port`, and `name` come from the
authority section and fragment.

## Auth mapping
| Protocol | URI auth | Schema field(s) |
| --- | --- | --- |
| `vless` | `uuid` | `uuid` |
| `vmess` | `uuid` | `uuid` |
| `trojan` | `password` | `password` |
| `anytls` | `password` | `password` |
| `hysteria2` | `password` | `password` |
| `shadowsocks` | `cipher:password` | `cipher`, `password` |
| `http` | `username:password` | `username`, `password` |
| `socks5` | `username:password` | `username`, `password` |

## Query mapping
`security` is handled specially. When present, it is copied to `security` and
also sets `tls` to `true` unless the value is `none`.

List fields accept comma-separated values. Boolean fields accept `1/0`,
`true/false`, `yes/no`, or `on/off`.

| URI key (aliases) | Schema field | Type |
| --- | --- | --- |
| `type`, `network` | `network` | string |
| `sni` | `sni` | string |
| `servername`, `server-name` | `servername` | string |
| `alpn` | `alpn` | list |
| `skip-cert-verify`, `allow-insecure`, `allowinsecure` | `skip-cert-verify` | boolean |
| `fp`, `client-fingerprint`, `clientfingerprint` | `client-fingerprint` | string |
| `fingerprint` | `fingerprint` | string |
| `flow` | `flow` | string |
| `encryption` | `encryption` | string |
| `packet-encoding`, `packetencoding` | `packet-encoding` | string |
| `alter-id`, `alterid` | `alterId` | integer |
| `global-padding`, `globalpadding` | `global-padding` | boolean |
| `authenticated-length`, `authenticatedlength` | `authenticated-length` | boolean |
| `udp` | `udp` | boolean |
| `tfo` | `tfo` | boolean |
| `mptcp` | `mptcp` | boolean |
| `udp-over-tcp`, `udpovertcp` | `udp-over-tcp` | boolean |
| `udp-over-tcp-version`, `udpovertcpversion` | `udp-over-tcp-version` | integer |
| `ports` | `ports` | string |
| `up` | `up` | string |
| `down` | `down` | string |
| `obfs` | `obfs` | string |
| `obfs-password`, `obfspassword` | `obfs-password` | string |
| `idle-session-check-interval`, `idlesessioncheckinterval` | `idle-session-check-interval` | integer |
| `idle-session-timeout`, `idlesessiontimeout` | `idle-session-timeout` | integer |
| `min-idle-session`, `minidlesession` | `min-idle-session` | integer |
| `cipher` | `cipher` | string |
| `plugin` | `plugin` | string |
| `ip-version`, `ipversion` | `ip-version` | string |
| `interface-name`, `interfacename` | `interface-name` | string |
| `routing-mark`, `routingmark` | `routing-mark` | integer |
| `dialer-proxy`, `dialerproxy` | `dialer-proxy` | string |
| `ip` | `ip` | string |
| `ipv6` | `ipv6` | string |
| `private-key`, `privatekey` | `private-key` | string |
| `public-key`, `publickey` | `public-key` | string |
| `pre-shared-key`, `presharedkey` | `pre-shared-key` | string |
| `reserved` | `reserved` | string |
| `mtu` | `mtu` | integer |
| `remote-dns-resolve`, `remotednsresolve` | `remote-dns-resolve` | boolean |
| `allowed-ips`, `allowedips` | `allowed-ips` | list |
| `dns` | `dns` | list |
| `certificate` | `certificate` | string |

Fields not listed above (for example `ws-opts`, `grpc-opts`, `http-opts`,
`h2-opts`, `smux`, `plugin-opts`, `reality-opts`, and `ech-opts`) are ignored
by the URI parser/exporter for now.
