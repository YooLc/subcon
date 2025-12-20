---
icon: lucide/group
---

# Proxy Group

Proxy groups are defined in TOML files imported by `[[custom_groups]]`, such as
`conf/snippets/groups.toml`.

## Group fields
| Field | Type | Description |
| --- | --- | --- |
| `name` | string | Group name shown in output. |
| `type` | string | Group type, for example `select` or `url-test`. |
| `rule` | string list | Members or match rules. |
| `url` | string | Test URL for `url-test` groups. |
| `interval` | integer | Test interval in seconds. |

## Rules and resolution

Rules can reference:

- A literal proxy name.
- A regex that matches proxy names.
- Another group using `[]` before group name, e.g. `[]DIRECT`.

Order matters. Rules are applied top to bottom, and matches are appended.

??? info "Example group"
    ```toml
    [[groups]]
    name = "Auto"
    type = "url-test"
    url = "https://www.gstatic.com/generate_204"
    interval = 300
    rule = ["(US|JP|SG)", "[]DIRECT"]
    ```

!!! warning
    Group references must exist. Unknown groups cause a render failure.
