# Face Test Data Dictionary

This document describes the face-test-specific tables and the main data each one stores.

## Core Configuration Tables

### `facetest_studies`

- `id`: internal UUID
- `slug`: public study identifier used in run start requests
- `title`: researcher-facing/public-facing title
- `status`: `active` or `archived`
- `notes`: researcher notes
- `created_at`
- `updated_at`

### `facetest_study_versions`

- `id`: internal UUID
- `study_id`: parent study
- `version_number`: integer version sequence within the study
- `status`: `draft` or `published`
- `changelog`: researcher note for what changed
- `parent_version_id`: source version when cloned
- `created_at`
- `updated_at`
- `published_at`
- `published_snapshot_json`: frozen published configuration snapshot used for reproducible runs

### `facetest_form_defs`

- `id`
- `study_version_id`
- `pages_json`: configurable participant-facing pages
- `demographics_schema_json`: configured demographics form schema
- `contact_schema_json`: configured contact form schema
- `settings_json`: timing + benchmark config
- `created_at`
- `updated_at`

### `facetest_populations`

- `id`
- `study_id`
- `slug`
- `label`
- `description`
- `metadata_json`
- `active`
- `created_at`
- `updated_at`

### `facetest_assets`

- `id`
- `study_id`
- `asset_key`: stable external key used by bulk-import deduplication
- `population_id`
- `display_label`
- `asset_role`
- `identity_id`
- `trial_set_id`
- `expected_side`
- `file_name`
- `mime_type`
- `file_path`: server filesystem path
- `public_path`: API-served asset URL
- `metadata_json`
- `is_available`
- `created_at`
- `updated_at`

Asset-role meanings:

- `study`: learning-phase face
- `memory_old`: old-memory face linked to a studied identity
- `memory_new`: unseen identity for the memory test
- `practice_target` / `practice_probe`
- `matching_target` / `matching_probe`

### `facetest_selection_rules`

- `id`
- `study_version_id`
- `phase`: `study`, `memory_old`, `memory_new`, `practice_matching`, or `matching`
- `population_id`
- `count`
- `filters_json`: optional metadata filter object
- `created_at`
- `updated_at`

## Participant Run Tables

### `facetest_runs`

- `id`: run UUID
- `study_id`
- `study_version_id`
- `study_slug`
- `browser_id`: anonymous browser/session identifier from the participant frontend
- `started_at`
- `completed_at`
- `status`: `active` or `completed`
- `user_agent_hash`
- `config_snapshot_json`: frozen version snapshot used for this run
- `resolved_stimuli_json`: exact stimuli selected for this run
- `score_json`: summary score object
- `pii_contact_email`: optional contact email, stored separately from raw trial rows

### `facetest_run_forms`

- `id`
- `run_id`
- `section`: e.g. `consent`, `demographics`, `contact`
- `responses_json`
- `created_at`

### `facetest_run_events`

- `id`
- `run_id`
- `phase`
- `event_type`
- `event_index`
- `payload_json`
- `created_at`

Typical uses:

- instruction page views
- study exposures
- preview events
- fullscreen state
- results view

### `facetest_memory_trials`

- `id`
- `run_id`
- `trial_index`
- `asset_id`
- `stimulus_url`
- `trial_type`: `OLD` or `NEW`
- `response`
- `rt_ms`
- `correct`
- `points`
- `created_at`

### `facetest_matching_trials`

- `id`
- `run_id`
- `phase`: `practice_matching` or `matching`
- `trial_index`
- `trial_identifier`: usually the matching `trial_set_id`
- `target_asset_id`
- `target_url`
- `details_json`: per-probe classifications and answer key
- `points`
- `created_at`

`details_json` stores rows like:

- `assetId`
- `path`
- `expected`
- `assigned`
- `correct`

### `facetest_raw_rows`

- `id`
- `run_id`
- `row_type`
- `created_at`
- `data_json`

This stores a row archive close to the event/CSV style of the earlier local-only implementation.

Examples:

- `run-start`
- `form-demographics`
- `form-contact`
- `event`
- `memory-trial`
- `matching-trial`
- `run-complete`

### `facetest_admin_audit`

- `id`
- `action`
- `target_type`
- `target_id`
- `detail_json`
- `created_at`

This is an admin-operation audit trail for study/version/population/asset changes.

## Export Endpoints

The current implementation exposes CSV exports for:

- runs
- memory trials
- matching trials
- forms
- raw rows

### Runs export

Includes:

- run identity and timestamps
- study slug/title
- version number
- status
- optional contact email
- score JSON

### Memory export

Includes all columns from `facetest_memory_trials`.

### Matching export

Includes all columns from `facetest_matching_trials`, including `details_json`.

### Forms export

Includes all columns from `facetest_run_forms`.

### Raw export

Includes all columns from `facetest_raw_rows`.

## Bulk Import Interface

Admin bulk asset import endpoint:

- `POST /api/facetest/admin/imports/assets`

Request shape:

- multipart upload
- `study_id` form field
- `archive` file field containing one zip

Zip contents:

- `manifest.csv` at zip root
- image files referenced by `relative_path`

Manifest columns:

- required: `asset_key`, `relative_path`, `population_slug`, `asset_role`, `display_label`
- conditional: `identity_id`, `trial_set_id`, `expected_side`
- optional: `is_available`, `metadata_json`

Duplicate policy:

- uniqueness is `study_id + asset_key`
- existing keys are skipped, not overwritten

## PII Note

Optional participant contact email is stored in `facetest_runs.pii_contact_email` and also submitted through the `contact` form flow. Researchers should treat any exports containing this field as sensitive and remove it when sharing trial data more broadly.
