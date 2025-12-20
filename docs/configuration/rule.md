---
icon: lucide/layout-list
---

# Rule

Rulesets map rule lists to proxy groups. They are enabled by `[ruleset]` and
loaded from `[[rulesets]]` imports.

## Ruleset mapping
```toml
[[rulesets]]
group = "Auto"
ruleset = "conf/rules/Global.list"

[[rulesets]]
group = "Direct"
ruleset = "[]GEOIP,CN"

[[rulesets]]
group = "Final"
ruleset = "[]FINAL"
```

`ruleset` can reference a file path or define a single inline rule using `[]`.

!!! warning
    `FINAL` is not a valid rule line in list files. Use `[]FINAL` in the
    ruleset mapping instead.

## Rule list format
Rule list files are plain text with one rule per line.

```text
DOMAIN-SUFFIX,example.com
IP-CIDR,1.1.1.1/32,no-resolve
PROCESS-NAME,git
```

Comments with `#` or `//` are ignored.

## Common rule types
| Category | Examples |
| --- | --- |
| Domain | `DOMAIN`, `DOMAIN-SUFFIX`, `DOMAIN-KEYWORD`, `DOMAIN-REGEX` |
| IP | `IP-CIDR`, `IP-CIDR6`, `GEOIP`, `IP-ASN` |
| Process | `PROCESS-NAME`, `PROCESS-PATH`, `PROCESS-NAME-REGEX` |
| Ports | `DST-PORT`, `SRC-PORT`, `IN-PORT` |
| Logic | `AND`, `OR`, `NOT`, `MATCH` |

## Flags

`no-resolve` can be appended to rule lines. Example:

```text
IP-CIDR,1.1.1.1/32,no-resolve
```

## Output notes
Clash renders `FINAL` as `MATCH` in the generated config for compatibility.
