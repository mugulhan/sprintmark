<p align="center">
  <img src="public/sprintmark-mark.svg" width="72" height="72" alt="Sprintmark logo">
</p>

# Sprintmark

Sprintmark is a local-first, file-backed project and sprint tracker. It combines a calendar, backlog, project dashboards, drag-and-drop scheduling, Markdown-rich work items, priorities, evidence galleries, and clipboard image uploads without requiring a database or cloud account.

> [!WARNING]
> Sprintmark 0.7.1 is a single-user application with no authentication. Bind it to `127.0.0.1` or place it behind your own authenticated reverse proxy. Do not expose it directly to the public internet.

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

```bash
docker compose up --build
```

Persistent data is stored in the `sprintmark-data` volume. The default Compose mapping listens only on `127.0.0.1:4310`.

## Configuration

| Variable                    | Default         | Purpose                                       |
| --------------------------- | --------------- | --------------------------------------------- |
| `SPRINTMARK_DATA_DIR`       | `./data`        | Projects, work items, sprints and attachments |
| `SPRINTMARK_TIMEZONE`       | System timezone | Calendar and timestamp display                |
| `SPRINTMARK_DEFAULT_LOCALE` | `en`            | Initial UI language (`en` or `tr`)            |
| `SPRINTMARK_HOST` / `HOST`  | `127.0.0.1`     | Listen address                                |
| `SPRINTMARK_PORT` / `PORT`  | `4310`          | Listen port                                   |

## Development

```bash
npm ci
npm run lint
npm run format:check
npm test
```

Work item bodies remain Markdown. Body images keep an 8 MB limit. Evidence accepts signature- and type-validated PNG, JPEG, WebP, GIF, PDF, CSV, JSON, text, Markdown, XLSX and DOCX files up to 25 MB each, with a 20-file per-item limit. Safe `data/` and `docs/evidence/` paths referenced by a work item can be opened without copying them into managed storage.

Status, priority and schedule metadata can be changed directly from the work-item panel. Completion and reopening are explicit actions: the server records the completion instant automatically, and the UI shows both the exact timestamp and its relative age.

To migrate a v1 file workspace without inventing unknown historical completion times:

```bash
npm run migrate:v2 -- --workspace=/path/to/workspace --dry-run
npm run migrate:v2 -- --workspace=/path/to/workspace
```

See [CONTRIBUTING.md](CONTRIBUTING.md), [SECURITY.md](SECURITY.md), and the [Turkish guide](docs/README.tr.md).

## License

Copyright 2026 Muhammet Gülhan. Licensed under the [Apache License 2.0](LICENSE).
