# UNSW Face

`unsw-face` is a standalone face-test application with:

- `index.html` for participants
- `admin.html` for researchers
- `api/` for the independent Express + SQLite backend
- `server/` for pdhahn deployment examples

This repo is intentionally separate from `r4psy2026`. It has its own database, asset directory, environment variables, service definition, and Caddy config.

## Local Structure

- `api/app.js` boots the standalone API and static-file serving
- `api/facetest.js` contains the study/version/admin/run/report routes
- `api/db.js` bootstraps the face-test-only SQLite schema
- `api/test/facetest.test.js` covers publish validation and participant/admin flows
- `server/facetest-setup.md` documents standalone deployment on pdhahn

## Runtime Requirements

- Node 22+ is required because the backend uses `node:sqlite`
- `.env` should define the standalone `FACETEST_*` variables
- uploaded assets are served by the API under `/api/facetest/assets/...`

## Environment Variables

- `FACETEST_API_PORT`
- `FACETEST_DB_PATH`
- `FACETEST_ASSET_DIR`
- `FACETEST_ADMIN_TOKEN`
- `FACETEST_PEPPER`

See [.env.example](./.env.example) for the expected shape.

## Running The App

```bash
npm install
npm start
```

The Express app serves both the static frontend and the API, so for local use you can open:

- `http://localhost:4311/index.html`
- `http://localhost:4311/admin.html`

## Researcher Setup Flow

1. Open `admin.html`.
2. Enter the `FACETEST_ADMIN_TOKEN`.
3. Create a study.
4. Create a draft version.
5. Add populations.
6. Upload and tag face assets.
7. Save pages, form schemas, settings, and selection rules.
8. Publish the version.
9. Open `index.html` to run participants against the published study.

## More Documentation

- [code_guide.md](./code_guide.md) for developer handoff
- [data_dictionary.md](./data_dictionary.md) for stored tables, fields, and exports
- [server/facetest-setup.md](./server/facetest-setup.md) for standalone pdhahn deployment
