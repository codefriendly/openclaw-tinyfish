# Changelog

## 0.9.0 — 2026-10-23

- Fail closed when an authoritative runtime credential snapshot is absent or revoked.
- Do not reuse stale registration config when current plugin config is omitted.
- Remove plugin environment credential fallback. The host must materialize SecretRefs.
- Add synthetic-store installed-host coverage for materialization, rotation, revocation and incomplete inventory. Offline tests deny socket connections.
- Support native search, advanced search, JavaScript-rendered fetch and optional account-gated highlights.
- Keep native fetch and highlights disabled by default.

No OpenClaw core changes.
