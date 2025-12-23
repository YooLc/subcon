---
icon: lucide/list
---

# Changelog

## 0.5.0
- Web UI refinements: broadened online editors for profiles/rules/groups/schema and improved panel workflows.
- OOBE now requires setting `api_access_token` before continuing.
- Debian package: add systemd service unit with default `/etc/subcon/conf/pref.toml` config path.

## 0.4.0
- Added VMess protocol schema.
- Improved Web UI token flow with warnings and guided api_access_token setup.
- Fix: make `conf/` writable by default.
- CI: fix Debian release packaging.

## 0.3.0
- Added embedded web control panel with friendly editors + Monaco code mode for profiles, rules, and schema.
- Added control panel actions for reload/restart and live log viewing.
- Added subscription builder, groups view, and cache inspector.
- Added login gate with token auth and same-origin CSRF enforcement for /api.
- Added /api/ping health check and tightened API cache headers for dynamic responses.

## 0.2.1
- Fix: Surge DST-PORT rules are now emitted as DEST-PORT.

## 0.2.0
Highlights since 0.1.0:

- Added URL-based ruleset fetch support (HTTP/HTTPS).
- Added a shared network layer with caching for outgoing requests.
- Rule ordering now prioritizes domain rules before IP rules.
- Refreshed example configuration (groups/rulesets, remote allowlist).
- Packaging updates: release archives include `conf/` + `schema/`, Debian installs to `/etc/subcon` with runtime fallback.
- Documentation expanded (Get Started and Configuration).

## 0.1.0
- Initial release with Clash/Surge rendering and release workflow.
