<p align="center">
  <img src="public/sprintmark-mark.svg" width="72" height="72" alt="Sprintmark logo">
</p>

# Sprintmark

Sprintmark is a file-backed, multi-user project and sprint tracker. It combines a calendar, backlog, project ownership, global teams, assignments, reviews, notifications, Markdown-rich work items and evidence files without requiring a database.

## Requirements

- Node.js 22+
- npm 10+
- Docker 25+ (optional)

## Quick start

```bash
git clone https://github.com/mugulhan/sprintmark.git
cd sprintmark
npm ci
npm start
```

Open <http://127.0.0.1:4310>. The first workspace is empty; create a project in the UI or run `npm run seed:demo`.

## Docker

Copy `.env.example` to `.env`, configure the Google client, an HTTPS `BASE_URL`, a strong session secret and at least one bootstrap administrator before starting the production container.

```bash
docker compose up --build
```

Persistent data is stored in the `sprintmark-data` volume. The default Compose mapping listens only on `127.0.0.1:4310`.

## Configuration

| Variable                    | Default         | Purpose                                          |
| --------------------------- | --------------- | ------------------------------------------------ |
| `SPRINTMARK_DATA_DIR`       | `./data`        | Projects, work items, identities and attachments |
| `SPRINTMARK_TIMEZONE`       | System timezone | Calendar and timestamp display                   |
| `SPRINTMARK_DEFAULT_LOCALE` | `en`            | Initial UI language (`en` or `tr`)               |
| `SPRINTMARK_HOST` / `HOST`  | `127.0.0.1`     | Listen address                                   |
| `SPRINTMARK_PORT` / `PORT`  | `4310`          | Listen port                                      |
| `SPRINTMARK_AUTH_MODE`      | auto            | `google`, or `local` on loopback only            |
| `CLIENT_ID`                 | â€”             | Google OAuth client ID                           |
| `CLIENT_SECRET`             | â€”             | Google OAuth client secret                       |
| `BASE_URL`                  | local URL       | Exact externally visible application URL         |
| `SESSION_SECRET`            | â€”             | Long random secret used to protect sessions      |
| `BOOTSTRAP_ADMIN_EMAILS`    | â€”             | Comma-separated initial invited administrators   |

## Development

```bash
npm ci
npm run lint
npm run format:check
npm test
```

Work item bodies remain Markdown. Body images keep an 8 MB limit. Evidence accepts signature- and type-validated PNG, JPEG, WebP, GIF, PDF, CSV, JSON, text, Markdown, XLSX and DOCX files up to 25 MB each, with a 20-file per-item limit. Safe `data/` and `docs/evidence/` paths referenced by a work item can be opened without copying them into managed storage.

Status, priority and schedule metadata can be changed directly from the work-item panel. Completion and reopening are explicit actions: the server records the completion instant automatically, and the UI shows both the exact timestamp and its relative age.

Each work item also has a persistent activity timeline. User notes, field changes and evidence-file operations are stored with timestamps and protected by optimistic concurrency; activity history is returned only by the detail API so calendar and backlog payloads remain compact.

Google mode stores only an opaque server-side session cookie. Google access and refresh tokens are never persisted. Every mutation derives its actor from that session and requires a CSRF token plus optimistic `If-Match` where an existing record is changed. Local developer authentication is deliberately restricted to loopback addresses and uses an explicit, revocable sign-in session.

Run the collaboration migration as a write-free dry-run first. `--apply` creates a timestamped workspace backup before changing projects or work items, and is safe to run again:

```bash
npm run migrate:collaboration -- --workspace=/path/to/workspace
npm run migrate:collaboration -- --workspace=/path/to/workspace --apply
```

See [the collaboration architecture](docs/COLLABORATION_ARCHITECTURE.md) for the ownership, team, workflow and audit model.

See [the application identity and session platform blueprint](docs/AUTH_PLATFORM_BLUEPRINT.md) for the reusable Node/Python contracts, adapters, security invariants and portfolio rollout plan.

To migrate a v1 file workspace without inventing unknown historical completion times:

```bash
npm run migrate:v2 -- --workspace=/path/to/workspace --dry-run
npm run migrate:v2 -- --workspace=/path/to/workspace
```

See [CONTRIBUTING.md](CONTRIBUTING.md), [SECURITY.md](SECURITY.md), and the [Turkish guide](docs/README.tr.md).

## License

Copyright 2026 Muhammet Gülhan. Licensed under the [Apache License 2.0](LICENSE).
