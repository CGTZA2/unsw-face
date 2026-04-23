import fs from "node:fs/promises";
import path from "node:path";
import crypto from "node:crypto";
import { DatabaseSync } from "node:sqlite";

export const DEFAULT_DB_PATH = path.join(process.cwd(), "data", "unsw-face.sqlite");

function addColumnIfMissing(db, tableName, columnName, definition) {
  const columns = db.prepare(`PRAGMA table_info(${tableName})`).all();
  const exists = columns.some((column) => column.name === columnName);
  if (!exists) {
    db.exec(`ALTER TABLE ${tableName} ADD COLUMN ${columnName} ${definition}`);
  }
}

export async function ensureDatabase(dbPath = process.env.FACETEST_DB_PATH || DEFAULT_DB_PATH) {
  await fs.mkdir(path.dirname(dbPath), { recursive: true });
  const db = new DatabaseSync(dbPath);
  db.exec("PRAGMA foreign_keys = ON");
  db.exec("PRAGMA journal_mode = WAL");
  db.exec(`
    CREATE TABLE IF NOT EXISTS facetest_studies (
      id TEXT PRIMARY KEY,
      slug TEXT NOT NULL UNIQUE,
      title TEXT NOT NULL,
      status TEXT NOT NULL DEFAULT 'active',
      notes TEXT,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS facetest_study_versions (
      id TEXT PRIMARY KEY,
      study_id TEXT NOT NULL,
      version_number INTEGER NOT NULL,
      status TEXT NOT NULL DEFAULT 'draft',
      changelog TEXT,
      parent_version_id TEXT,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      published_at TEXT,
      published_snapshot_json TEXT,
      FOREIGN KEY(study_id) REFERENCES facetest_studies(id) ON DELETE CASCADE
    );

    CREATE UNIQUE INDEX IF NOT EXISTS idx_facetest_versions_study_number
      ON facetest_study_versions(study_id, version_number);

    CREATE TABLE IF NOT EXISTS facetest_form_defs (
      id TEXT PRIMARY KEY,
      study_version_id TEXT NOT NULL,
      pages_json TEXT NOT NULL,
      demographics_schema_json TEXT NOT NULL,
      contact_schema_json TEXT NOT NULL,
      settings_json TEXT NOT NULL,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      FOREIGN KEY(study_version_id) REFERENCES facetest_study_versions(id) ON DELETE CASCADE
    );

    CREATE UNIQUE INDEX IF NOT EXISTS idx_facetest_form_defs_version
      ON facetest_form_defs(study_version_id);

    CREATE TABLE IF NOT EXISTS facetest_populations (
      id TEXT PRIMARY KEY,
      study_id TEXT NOT NULL,
      slug TEXT NOT NULL,
      label TEXT NOT NULL,
      description TEXT,
      metadata_json TEXT NOT NULL DEFAULT '{}',
      active INTEGER NOT NULL DEFAULT 1,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      FOREIGN KEY(study_id) REFERENCES facetest_studies(id) ON DELETE CASCADE
    );

    CREATE UNIQUE INDEX IF NOT EXISTS idx_facetest_populations_study_slug
      ON facetest_populations(study_id, slug);

    CREATE TABLE IF NOT EXISTS facetest_assets (
      id TEXT PRIMARY KEY,
      study_id TEXT NOT NULL,
      asset_key TEXT,
      population_id TEXT,
      display_label TEXT,
      asset_role TEXT NOT NULL,
      identity_id TEXT,
      trial_set_id TEXT,
      expected_side TEXT,
      file_name TEXT NOT NULL,
      mime_type TEXT NOT NULL,
      file_path TEXT NOT NULL,
      public_path TEXT NOT NULL,
      metadata_json TEXT NOT NULL DEFAULT '{}',
      is_available INTEGER NOT NULL DEFAULT 1,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      FOREIGN KEY(study_id) REFERENCES facetest_studies(id) ON DELETE CASCADE,
      FOREIGN KEY(population_id) REFERENCES facetest_populations(id) ON DELETE SET NULL
    );

    CREATE INDEX IF NOT EXISTS idx_facetest_assets_study_role
      ON facetest_assets(study_id, asset_role);
    CREATE INDEX IF NOT EXISTS idx_facetest_assets_identity
      ON facetest_assets(study_id, identity_id);
    CREATE INDEX IF NOT EXISTS idx_facetest_assets_trial_set
      ON facetest_assets(study_id, trial_set_id);

    CREATE TABLE IF NOT EXISTS facetest_selection_rules (
      id TEXT PRIMARY KEY,
      study_version_id TEXT NOT NULL,
      phase TEXT NOT NULL,
      population_id TEXT,
      count INTEGER NOT NULL,
      filters_json TEXT NOT NULL DEFAULT '{}',
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      FOREIGN KEY(study_version_id) REFERENCES facetest_study_versions(id) ON DELETE CASCADE,
      FOREIGN KEY(population_id) REFERENCES facetest_populations(id) ON DELETE SET NULL
    );

    CREATE INDEX IF NOT EXISTS idx_facetest_selection_rules_version_phase
      ON facetest_selection_rules(study_version_id, phase);

    CREATE TABLE IF NOT EXISTS facetest_runs (
      id TEXT PRIMARY KEY,
      study_id TEXT NOT NULL,
      study_version_id TEXT NOT NULL,
      study_slug TEXT NOT NULL,
      browser_id TEXT NOT NULL,
      started_at TEXT NOT NULL,
      completed_at TEXT,
      status TEXT NOT NULL DEFAULT 'active',
      user_agent_hash TEXT NOT NULL,
      config_snapshot_json TEXT NOT NULL,
      resolved_stimuli_json TEXT NOT NULL,
      score_json TEXT,
      pii_contact_email TEXT,
      FOREIGN KEY(study_id) REFERENCES facetest_studies(id),
      FOREIGN KEY(study_version_id) REFERENCES facetest_study_versions(id)
    );

    CREATE INDEX IF NOT EXISTS idx_facetest_runs_study
      ON facetest_runs(study_id, started_at);
    CREATE INDEX IF NOT EXISTS idx_facetest_runs_version
      ON facetest_runs(study_version_id, started_at);
    CREATE INDEX IF NOT EXISTS idx_facetest_runs_status
      ON facetest_runs(status, started_at);

    CREATE TABLE IF NOT EXISTS facetest_run_forms (
      id TEXT PRIMARY KEY,
      run_id TEXT NOT NULL,
      section TEXT NOT NULL,
      responses_json TEXT NOT NULL,
      created_at TEXT NOT NULL,
      FOREIGN KEY(run_id) REFERENCES facetest_runs(id) ON DELETE CASCADE
    );

    CREATE INDEX IF NOT EXISTS idx_facetest_run_forms_run
      ON facetest_run_forms(run_id, section);

    CREATE TABLE IF NOT EXISTS facetest_run_events (
      id TEXT PRIMARY KEY,
      run_id TEXT NOT NULL,
      phase TEXT,
      event_type TEXT NOT NULL,
      event_index INTEGER,
      payload_json TEXT NOT NULL,
      created_at TEXT NOT NULL,
      FOREIGN KEY(run_id) REFERENCES facetest_runs(id) ON DELETE CASCADE
    );

    CREATE INDEX IF NOT EXISTS idx_facetest_run_events_run
      ON facetest_run_events(run_id, created_at);

    CREATE TABLE IF NOT EXISTS facetest_memory_trials (
      id TEXT PRIMARY KEY,
      run_id TEXT NOT NULL,
      trial_index INTEGER NOT NULL,
      asset_id TEXT,
      stimulus_url TEXT NOT NULL,
      trial_type TEXT NOT NULL,
      response TEXT NOT NULL,
      rt_ms INTEGER NOT NULL,
      correct INTEGER NOT NULL,
      points INTEGER NOT NULL,
      created_at TEXT NOT NULL,
      FOREIGN KEY(run_id) REFERENCES facetest_runs(id) ON DELETE CASCADE
    );

    CREATE INDEX IF NOT EXISTS idx_facetest_memory_trials_run
      ON facetest_memory_trials(run_id, trial_index);

    CREATE TABLE IF NOT EXISTS facetest_matching_trials (
      id TEXT PRIMARY KEY,
      run_id TEXT NOT NULL,
      phase TEXT NOT NULL,
      trial_index INTEGER NOT NULL,
      trial_identifier TEXT,
      target_asset_id TEXT,
      target_url TEXT NOT NULL,
      details_json TEXT NOT NULL,
      points INTEGER NOT NULL,
      created_at TEXT NOT NULL,
      FOREIGN KEY(run_id) REFERENCES facetest_runs(id) ON DELETE CASCADE
    );

    CREATE INDEX IF NOT EXISTS idx_facetest_matching_trials_run
      ON facetest_matching_trials(run_id, phase, trial_index);

    CREATE TABLE IF NOT EXISTS facetest_raw_rows (
      id TEXT PRIMARY KEY,
      run_id TEXT NOT NULL,
      row_type TEXT NOT NULL,
      created_at TEXT NOT NULL,
      data_json TEXT NOT NULL,
      FOREIGN KEY(run_id) REFERENCES facetest_runs(id) ON DELETE CASCADE
    );

    CREATE INDEX IF NOT EXISTS idx_facetest_raw_rows_run
      ON facetest_raw_rows(run_id, created_at);

    CREATE TABLE IF NOT EXISTS facetest_admin_audit (
      id TEXT PRIMARY KEY,
      action TEXT NOT NULL,
      target_type TEXT NOT NULL,
      target_id TEXT,
      detail_json TEXT NOT NULL,
      created_at TEXT NOT NULL
    );
  `);

  addColumnIfMissing(db, "facetest_assets", "asset_key", "TEXT");
  db.exec(`
    CREATE UNIQUE INDEX IF NOT EXISTS idx_facetest_assets_study_asset_key
      ON facetest_assets(study_id, asset_key)
      WHERE asset_key IS NOT NULL;
  `);

  return db;
}

export function nowIso() {
  return new Date().toISOString();
}

export function userAgentHash(value = "") {
  return crypto.createHash("sha256").update(value).digest("hex");
}

export function newId() {
  return crypto.randomUUID();
}
