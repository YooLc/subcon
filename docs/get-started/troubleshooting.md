---
icon: lucide/alert-triangle
---

# Troubleshooting

## Startup issues
| Symptom | Likely cause | Fix |
| --- | --- | --- |
| `failed to read pref file` | Wrong `--pref` path | Verify the file path. |
| `failed to parse pref file` | Invalid TOML | Recheck commas, quotes, and tables. |
| `common.schema must be set` | Missing `common.schema` | Point to `schema/`. |
| `failed to bind` | Port already in use | Change `server.port`. |

## Request errors
| Message | Cause | Fix |
| --- | --- | --- |
| `unsupported target` | Invalid `target` query | Use `clash` or `surge`. |
| `domain not allowed` | Host not in `network.allowed_domain` | Add the hostname. |
| `allowed-domain list is empty` | `network.allowed_domain` is empty | Populate the allowlist. |
| `failed to fetch subscription` | Remote fetch failed | Check URL, network, and format. |

## Output issues
| Symptom | Likely cause | Fix |
| --- | --- | --- |
| Empty proxy list | Profiles are empty or wrong path | Check `common.default_url`. |
| Missing rules | `ruleset.enabled` is false | Enable rulesets. |
| 500 errors | Bad group or ruleset config | Check `conf/snippets/*.toml`. |

## Debugging
=== "Verbose logs"
    ```bash
    RUST_LOG=debug cargo run -- --pref conf/pref.toml
    ```

=== "Backtraces"
    ```bash
    RUST_BACKTRACE=1 RUST_LOG=debug cargo run -- --pref conf/pref.toml
    ```

=== "Request trace"
    ```bash
    curl -v "http://127.0.0.1:25500/sub?target=clash"
    ```

??? info "Group and rule config checks"
    - Ensure group references use `[]Group Name`.
    - Regex patterns must compile.
    - Use `[]FINAL` in rulesets, not `FINAL` in rule files.
