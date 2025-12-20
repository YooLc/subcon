---
icon: lucide/settings
---

# Configuration

Subcon reads `conf/pref.toml` on startup (or the path supplied by `--pref`).
Most behavior is driven by three layers: config, profiles, and schema.

``` mermaid
graph TD
  A[pref.toml] --> B[Profile paths]
  B --> C[Schema registry]
  C --> D[Targets: Clash / Surge]
```

## File map
| Path | Role |
| --- | --- |
| `conf/pref.toml` | Global settings and feature switches. |
| `conf/profiles/` | Local proxy lists. |
| `conf/base/` | Target base templates. |
| `conf/snippets/` | Proxy groups and rulesets. |
| `conf/rules/` | Rule list files referenced by rulesets. |
| `schema/` | Protocol schemas and target mapping. |

## Configuration checklist
- Ensure `common.schema` points to `schema/`.
- Point base templates to `conf/base/*`.
- Set `common.allowed_domain` if you will use `url`.
- Verify `server.listen` and `server.port`.

!!! note
    The docs in this section only cover fields used by Subcon. Extra keys are
    ignored.

## Explore this section
- [General Settings](general-settings.md)
- [Proxy](proxy.md)
- [Proxy Group](proxy-group.md)
- [Rule](rule.md)
