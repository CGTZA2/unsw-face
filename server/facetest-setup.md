# Face Test Deployment On pdhahn Server

This guide assumes `CGTZA2/unsw-face` is the canonical repo and that the face test is deployed as a fully independent application.

The standalone runtime shape is:

- Caddy serves static files from the `unsw-face` checkout
- Caddy reverse-proxies `/api/*` to the `unsw-face` Node/Express process
- Node runs as its own `unsw-face.service`
- SQLite and uploaded face assets live under the `unsw-face` data directory

## Recommended Layout

Example directories:

- app/service root: `/opt/unsw-face`
- SQLite DB: `/opt/unsw-face/data/unsw-face.sqlite`
- uploaded face assets: `/opt/unsw-face/data/assets`
- systemd environment file: `/opt/unsw-face/.env`

## Required Environment Variables

These are the important server-side variables for the face test:

- `FACETEST_API_PORT`
  Node/Express listen port, e.g. `4311`
- `FACETEST_DB_PATH`
  SQLite database path
- `FACETEST_ASSET_DIR`
  Filesystem directory for uploaded face assets
- `FACETEST_ADMIN_TOKEN`
  Shared token for admin access
- `FACETEST_PEPPER`
  Reserved app secret for future token/session hardening

## Static Files To Deploy

Deploy the repo checkout itself so the server serves:

- `index.html`
- `admin.html`
- `app.js`
- `admin.js`
- `app.css`

The participant/admin code auto-derives the API path when hosted at the site root. If you host it differently, add:

```html
<meta name="facetest-api-base" content="/api/facetest">
```

## Caddy Pattern

Recommended route shape:

- participant/admin static files served from the face-test site root
- `/api/*` proxied to Node

Example site block:

```caddy
unsw-face.cogbook.org {
        handle /api/* {
        reverse_proxy localhost:4311
    }

    handle {
        root * /opt/unsw-face
        try_files {path} {path}.html {path}/
        file_server
    }
}
```

## Node Service

Use a dedicated service such as `server/unsw-face.service.example`.

Make sure the service user can write to:

- the SQLite directory
- the face-test asset directory

## Publish / Rollback Flow

Researcher workflow:

1. Open `admin.html`
2. Create or open a study
3. Create a draft version
4. Upload/tag assets
5. Save pages/forms/settings/rules
6. Publish the version

Rollback workflow:

- do not edit the published version in place
- clone the last published version to a new draft
- fix the draft
- publish the new draft
- if necessary, archive the study or point participants to a different study slug

Because participant runs always store a frozen version snapshot, historical runs remain analyzable even after later versions are published.

## Backup

Back up both:

- the SQLite DB file
- the uploaded asset directory

SQLite alone is not enough because asset rows reference server-stored image files.

Recommended backup set:

- `/opt/unsw-face/data/unsw-face.sqlite`
- `/opt/unsw-face/data/assets/`

## Validation Before Going Live

Before opening the study to participants:

1. Confirm the admin token works in `admin.html`
2. Create a test study and publish one version
3. Start one participant run through `index.html`
4. Submit forms and complete the run
5. Verify:
   - rows exist in `facetest_runs`
   - forms, memory trials, matching trials, and raw rows were written
   - CSV exports download from the admin page
   - uploaded assets open under `/api/facetest/assets/...`

## Current Limitation

The current admin upload flow sends base64 JSON payloads to the API. This is simple and portable, but less efficient than multipart upload for large files. If researchers will upload many large images, a future improvement should move asset ingestion to multipart upload plus optional client-side resizing.
