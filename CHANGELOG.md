# Changelog

All notable changes follow [Keep a Changelog](https://keepachangelog.com/en/1.1.0/) and Semantic Versioning.

## [Unreleased]

### Added

- Added an interactive and automation-friendly `setup:auth` wizard that validates Google/local configuration, generates a session secret and writes an ignored environment file.
- Added a complete Google Cloud OAuth setup and troubleshooting guide for local, Docker and production deployments.

### Changed

- `npm start` automatically loads `.env` and `.env.local` when present.
- Google authentication permits HTTP only for Google-supported loopback callback URLs; non-loopback deployments still require HTTPS.

### Fixed

- Local developer sign-out now revokes a real server-side session and remains signed out after refresh.
- Signed-out local mode presents an explicit local login instead of a disabled Google route or stale account controls.

### Documentation

- Added the reusable cross-application identity, session, audit and Node/Python adapter blueprint.

## [0.10.0] - 2026-08-28

### Added

- Invited Google OIDC identities, secure server-side sessions, CSRF protection and a loopback-only local developer profile.
- Single-owner projects, global teams, project roles, reporters, assignees, reviewers and followers.
- A guarded backlog-to-done workflow with conditional review, explanatory handoffs and identity-aware audit events.
- Deduplicated in-app notifications and ownership/team controls in project and work-item views.
- A dry-run-first, backed-up and idempotent collaboration migration.

## [0.9.0] - 2026-08-28

### Added

- İş kayıtlarına kalıcı kullanıcı notları ve otomatik değişiklik geçmişi içeren Jira benzeri aktivite akışı eklendi.
- Durum, ekip, öncelik, planlama, açıklama ve dosya işlemleri append-only olaylar olarak kaydediliyor.
- Aktivite yazımları ETag/`If-Match` eşzamanlılık korumasına alındı ve Türkçe/İngilizce arayüz desteği eklendi.

## [0.6.2] - 2026-08-26

### Changed

- Refined the planned-time control into a tighter single visual field.
- Added readable hover, focus and busy states to primary actions.
- Replaced the letter-like app mark with a compact backlog-to-done card motif.

## [0.6.1] - 2026-08-26

### Changed

- Moved work-item metadata into a compact toolbar above the content area.
- Combined the planned date and optional time into one visually unified scheduling field.
- Reduced the action sidebar width to prioritize readable task content.
- Replaced the primitive evidence form with a click, drag-and-drop and clipboard upload zone.
- Added evidence thumbnails, full-screen lightbox previews and guarded image removal.
- Improved the contrast and visual hierarchy of links, inline code and table content.

## [0.6.0] - 2026-08-26

### Added

- A distinct Sprintmark brand mark and a focused version-only application header.
- Always-available status and priority controls in the work-item detail panel.
- Server-owned completion timestamps with exact and relative completion times.
- A one-click action to complete or reopen work without editing its content.

## [0.5.0] - 2026-08-26

### Added

- Stable project, sprint and work-item identities with canonical URLs.
- Calendar and backlog views with drag-and-drop scheduling.
- Project dashboards and Markdown WYSIWYG editing.
- Clipboard and evidence image uploads through expiring draft sessions.
- Priority levels, filters, scheduled times, Turkish and English UI modes.
- Docker and GitHub Container Registry distribution.

[Unreleased]: https://github.com/mugulhan/sprintmark/compare/v0.10.0...HEAD
[0.10.0]: https://github.com/mugulhan/sprintmark/compare/v0.9.0...v0.10.0
[0.9.0]: https://github.com/mugulhan/sprintmark/compare/v0.6.2...v0.9.0
[0.6.2]: https://github.com/mugulhan/sprintmark/compare/v0.6.1...v0.6.2
[0.6.1]: https://github.com/mugulhan/sprintmark/compare/v0.6.0...v0.6.1
[0.6.0]: https://github.com/mugulhan/sprintmark/compare/v0.5.0...v0.6.0
[0.5.0]: https://github.com/mugulhan/sprintmark/releases/tag/v0.5.0
