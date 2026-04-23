# Code Guide

This guide is for the next engineer or agent taking over the standalone `unsw-face` implementation.

## Current Architecture

The app is split into:

- participant frontend in `index.html` + `app.js`
- admin frontend in `admin.html` + `admin.js`
- backend routes in `api/facetest.js`
- schema bootstrap in `api/db.js`
- standalone Express entrypoint in `api/app.js`
- standalone process entrypoint in `api/server.js`

The old `window.FACE_TEST_DATA` runtime model is no longer the primary path. The participant app now starts by calling the backend, which creates a run tied to a published study version and returns a frozen resolved stimulus set for that participant.

## Key Model

The central server-side model is:

- `facetest_studies`
- `facetest_study_versions`
- `facetest_form_defs`
- `facetest_populations`
- `facetest_assets`
- `facetest_selection_rules`
- `facetest_runs`
- `facetest_run_forms`
- `facetest_run_events`
- `facetest_memory_trials`
- `facetest_matching_trials`
- `facetest_raw_rows`
- `facetest_admin_audit`

Important runtime rule:

- published versions are immutable
- participant runs always resolve against a published version snapshot
- runs store both normalized trial data and raw row/event archives

## Backend Responsibilities

`api/facetest.js` handles three major areas:

1. Admin CRUD and publishing
2. Participant run lifecycle
3. Reporting and CSV export

Notable backend behaviors:

- admin auth uses the standalone `x-facetest-admin-token` header
- uploaded assets are written to the filesystem under `FACETEST_ASSET_DIR` or `data/assets`
- matching trials are grouped via `trial_set_id`
- study and memory-old linkage depends on shared `identity_id`
- publish validation checks that a version is complete and that sampling rules can be satisfied

## Frontend Responsibilities

### Participant app

`app.js` now:

- loads available public studies
- starts a run on the server
- renders consent, configurable pages, demographics, contact, and all task phases
- posts forms, events, memory trials, matching trials, and completion data back to the API

The participant app assumes:

- study faces are in `resolvedStimuli.studyFaces`
- memory trials are in `resolvedStimuli.memoryTrials`
- practice and scored matching trials contain target/stimuli/answers

### Admin app

`admin.js` is a practical research control panel, not a full design system app.

It supports:

- creating/opening studies
- creating/cloning versions
- saving page/form/settings config
- creating populations
- uploading assets
- saving selection rules
- publishing versions
- loading runs and downloading CSV exports

## Asset Conventions

The current implementation relies on these asset roles:

- `study`
- `memory_old`
- `memory_new`
- `practice_target`
- `practice_probe`
- `matching_target`
- `matching_probe`

Conventions that matter:

- `study` and `memory_old` assets should share an `identity_id`
- each matching/practice set needs one target plus at least four probes sharing the same `trial_set_id`
- probe assets require `expected_side` of `left` or `right`

## Selection Rules

Selection rules are stored per version and phase.

Supported phases:

- `study`
- `memory_old`
- `memory_new`
- `practice_matching`
- `matching`

Current v1 behavior:

- study rules select unique identities from `study` assets and derive matching `memory_old` assets from those identities
- memory-new rules draw random nonstudied assets from `memory_new`
- practice and scored matching rules draw random `trial_set_id` groups
- balancing is per-run random, not quota-balanced across participants

## Important Constraints

- The standalone API accepts JSON bodies up to `10mb` to support base64 image uploads. If researchers upload large images, consider moving to multipart upload or client-side resizing.
- The admin UI currently stores page arrays via textarea separators and demographics/rule/settings config as JSON textareas. This is functional, but not yet polished.
- The participant app assumes a 40-point memory section and 80-point scored matching section when computing results, matching the original recreation.
- The browser code auto-derives `/api/facetest` and can also be overridden with a `<meta name="facetest-api-base">`.

## Recommended Next Improvements

- Replace base64 JSON uploads with multipart upload for larger files.
- Add richer admin editing for page blocks and form fields.
- Add deletion/editing UI for existing populations/assets/rules.
- Add per-run detail view links in the admin UI.
- Add browser-based E2E verification once Node/browser tooling is available in the environment.
- Add migration/bootstrap tooling if you want to ingest the original legacy asset bundle into the admin-managed schema automatically.

## Verification Caveat

I was not able to run the Node test suite in this environment because no `node` binary was available on the PATH. The standalone backend tests are in `api/test/facetest.test.js`, but they still need to be executed in a machine or CI environment with Node available.
