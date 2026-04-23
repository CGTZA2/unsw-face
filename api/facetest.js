import fs from "node:fs/promises";
import path from "node:path";
import crypto from "node:crypto";
import multer from "multer";
import AdmZip from "adm-zip";
import { parse as parseCsv } from "csv-parse/sync";
import { newId, nowIso, userAgentHash } from "./db.js";

const FACE_TEST_PHASES = new Set([
  "study",
  "memory_old",
  "memory_new",
  "practice_matching",
  "matching",
]);

const ASSET_ROLES = new Set([
  "study",
  "memory_old",
  "memory_new",
  "practice_target",
  "practice_probe",
  "matching_target",
  "matching_probe",
]);

const REQUIRED_BULK_IMPORT_HEADERS = [
  "asset_key",
  "relative_path",
  "population_slug",
  "asset_role",
  "display_label",
];

const bulkImportUpload = multer({
  storage: multer.memoryStorage(),
  limits: {
    fileSize: 250 * 1024 * 1024,
  },
});

function getFaceTestAssetDir() {
  return process.env.FACETEST_ASSET_DIR
    ? path.resolve(process.env.FACETEST_ASSET_DIR)
    : path.join(process.cwd(), "data", "assets");
}

function sanitizeSlug(value) {
  return String(value || "")
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

function sanitizeFileName(value) {
  const cleaned = String(value || "").replace(/[^a-zA-Z0-9._-]+/g, "-");
  return cleaned.length ? cleaned : "asset.bin";
}

function sanitizeAssetKey(value) {
  return String(value || "").trim();
}

function inferMimeType(fileName) {
  const extension = path.extname(String(fileName || "")).toLowerCase();
  return (
    {
      ".png": "image/png",
      ".jpg": "image/jpeg",
      ".jpeg": "image/jpeg",
      ".gif": "image/gif",
      ".webp": "image/webp",
      ".bmp": "image/bmp",
      ".tif": "image/tiff",
      ".tiff": "image/tiff",
    }[extension] || "application/octet-stream"
  );
}

function requireString(value) {
  return typeof value === "string" && value.trim().length > 0;
}

function asJson(value, fallback) {
  if (!value) return fallback;
  try {
    return JSON.parse(value);
  } catch {
    return fallback;
  }
}

function parseBooleanLike(value, fallback = true) {
  if (value === undefined || value === null || value === "") return fallback;
  const normalized = String(value).trim().toLowerCase();
  if (["1", "true", "yes", "y"].includes(normalized)) return true;
  if (["0", "false", "no", "n"].includes(normalized)) return false;
  return fallback;
}

function normalizeZipRelativePath(value) {
  const normalized = String(value || "")
    .trim()
    .replace(/\\/g, "/")
    .replace(/^\.\/+/, "")
    .replace(/^\/+/, "");
  if (!normalized || normalized.split("/").some((segment) => segment === "..")) {
    return null;
  }
  return normalized;
}

function badRequest(res, message, status = 400) {
  return res.status(status).json({ error: message });
}

function hasAdminAccess(req) {
  const configuredToken = process.env.FACETEST_ADMIN_TOKEN;
  const providedToken = req.get("x-facetest-admin-token") || req.query.token;
  if (configuredToken) {
    return providedToken === configuredToken;
  }
  const ip = req.ip || req.socket?.remoteAddress || "";
  return ip === "::1" || ip === "127.0.0.1" || ip === "::ffff:127.0.0.1";
}

function requireAdmin(req, res) {
  if (!hasAdminAccess(req)) {
    res.status(403).json({ error: "forbidden" });
    return false;
  }
  return true;
}

function buildCsv(rows) {
  if (!rows.length) {
    return "";
  }
  const headers = [...new Set(rows.flatMap((row) => Object.keys(row)))];
  return [
    headers.join(","),
    ...rows.map((row) =>
      headers
        .map((header) => `"${String(row[header] ?? "").replace(/"/g, '""')}"`)
        .join(","),
    ),
  ].join("\n");
}

function randomize(items) {
  const copy = [...items];
  for (let index = copy.length - 1; index > 0; index -= 1) {
    const swapIndex = crypto.randomInt(index + 1);
    [copy[index], copy[swapIndex]] = [copy[swapIndex], copy[index]];
  }
  return copy;
}

function parsePopulation(row) {
  return {
    ...row,
    metadata: asJson(row.metadata_json, {}),
  };
}

function parseAsset(row) {
  return {
    ...row,
    metadata: asJson(row.metadata_json, {}),
  };
}

function parseRule(row) {
  return {
    ...row,
    filters: asJson(row.filters_json, {}),
  };
}

function parseFormDef(row) {
  return {
    id: row.id,
    study_version_id: row.study_version_id,
    pages: asJson(row.pages_json, {}),
    demographicsSchema: asJson(row.demographics_schema_json, []),
    contactSchema: asJson(row.contact_schema_json, []),
    settings: asJson(row.settings_json, {}),
    created_at: row.created_at,
    updated_at: row.updated_at,
  };
}

async function ensureAssetDirectory() {
  await fs.mkdir(getFaceTestAssetDir(), { recursive: true });
}

async function writeAssetBuffer({ assetId, fileName, buffer }) {
  await ensureAssetDirectory();
  const directory = path.join(getFaceTestAssetDir(), assetId);
  await fs.mkdir(directory, { recursive: true });
  const safeName = sanitizeFileName(fileName);
  const absolutePath = path.join(directory, safeName);
  await fs.writeFile(absolutePath, buffer);
  return {
    absolutePath,
    publicPath: `/api/facetest/assets/${assetId}/${safeName}`,
  };
}

async function writeAssetFile({ assetId, fileName, base64Data }) {
  return writeAssetBuffer({
    assetId,
    fileName,
    buffer: Buffer.from(base64Data, "base64"),
  });
}

async function deleteAssetFile(filePath) {
  try {
    await fs.rm(path.dirname(filePath), { recursive: true, force: true });
  } catch {}
}

function audit(db, action, targetType, targetId, detail) {
  db.prepare(`
    INSERT INTO facetest_admin_audit (id, action, target_type, target_id, detail_json, created_at)
    VALUES (?, ?, ?, ?, ?, ?)
  `).run(newId(), action, targetType, targetId ?? null, JSON.stringify(detail ?? {}), nowIso());
}

function getStudyById(db, studyId) {
  return db.prepare("SELECT * FROM facetest_studies WHERE id = ? LIMIT 1").get(studyId);
}

function getStudyBySlug(db, slug) {
  return db.prepare("SELECT * FROM facetest_studies WHERE slug = ? LIMIT 1").get(slug);
}

function getVersionById(db, versionId) {
  return db.prepare(`
    SELECT v.*, s.slug AS study_slug, s.title AS study_title, s.status AS study_status
    FROM facetest_study_versions v
    JOIN facetest_studies s ON s.id = v.study_id
    WHERE v.id = ?
    LIMIT 1
  `).get(versionId);
}

function getLatestPublishedVersionForStudy(db, studyId) {
  return db.prepare(`
    SELECT *
    FROM facetest_study_versions
    WHERE study_id = ? AND status = 'published'
    ORDER BY published_at DESC, version_number DESC
    LIMIT 1
  `).get(studyId);
}

function getFormDefByVersion(db, versionId) {
  const row = db.prepare("SELECT * FROM facetest_form_defs WHERE study_version_id = ? LIMIT 1").get(versionId);
  return row ? parseFormDef(row) : null;
}

function getRulesForVersion(db, versionId) {
  return db.prepare(`
    SELECT *
    FROM facetest_selection_rules
    WHERE study_version_id = ?
    ORDER BY phase, created_at
  `).all(versionId).map(parseRule);
}

function getPopulationsForStudy(db, studyId) {
  return db.prepare(`
    SELECT *
    FROM facetest_populations
    WHERE study_id = ?
    ORDER BY label
  `).all(studyId).map(parsePopulation);
}

function getAssetsForStudy(db, studyId) {
  return db.prepare(`
    SELECT *
    FROM facetest_assets
    WHERE study_id = ?
    ORDER BY created_at DESC
  `).all(studyId).map(parseAsset);
}

function getPopulationBySlug(db, studyId, slug) {
  return db.prepare(`
    SELECT *
    FROM facetest_populations
    WHERE study_id = ? AND slug = ?
    LIMIT 1
  `).get(studyId, slug);
}

function getExistingAssetKeys(db, studyId) {
  return new Set(
    db.prepare(`
      SELECT asset_key
      FROM facetest_assets
      WHERE study_id = ? AND asset_key IS NOT NULL
    `)
      .all(studyId)
      .map((row) => row.asset_key),
  );
}

function parseBulkManifestCsv(buffer) {
  let headers = [];
  const rows = parseCsv(buffer, {
    bom: true,
    columns: (columnNames) => {
      headers = columnNames.map((columnName) => String(columnName || "").trim());
      return headers;
    },
    relax_column_count: true,
    skip_empty_lines: true,
    trim: true,
  });
  return { headers, rows };
}

function parseImportMetadata(rawValue, rowNumber, issues) {
  if (!requireString(rawValue)) return {};
  try {
    return JSON.parse(rawValue);
  } catch {
    issues.push({
      rowNumber,
      assetKey: null,
      status: "failed",
      message: "metadata_json must contain valid JSON when provided",
    });
    return null;
  }
}

function validateImportRowShape(row, rowNumber, populationsBySlug, zipEntriesByPath, seenAssetKeys) {
  const issues = [];
  const assetKey = sanitizeAssetKey(row.asset_key);
  const relativePath = normalizeZipRelativePath(row.relative_path);
  const populationSlug = sanitizeSlug(row.population_slug);
  const assetRole = String(row.asset_role || "").trim();
  const displayLabel = String(row.display_label || "").trim();
  const identityId = String(row.identity_id || "").trim() || null;
  const trialSetId = String(row.trial_set_id || "").trim() || null;
  const expectedSide = String(row.expected_side || "").trim() || null;
  const metadata = parseImportMetadata(row.metadata_json, rowNumber, issues);
  const isAvailable = parseBooleanLike(row.is_available, true);

  if (!requireString(assetKey)) {
    issues.push({ rowNumber, assetKey: null, status: "failed", message: "asset_key is required" });
  } else if (seenAssetKeys.has(assetKey)) {
    issues.push({ rowNumber, assetKey, status: "failed", message: "asset_key is duplicated inside this zip" });
  } else {
    seenAssetKeys.add(assetKey);
  }

  if (!relativePath) {
    issues.push({ rowNumber, assetKey, status: "failed", message: "relative_path is required and must stay inside the zip" });
  } else if (!zipEntriesByPath.has(relativePath)) {
    issues.push({ rowNumber, assetKey, status: "failed", message: `relative_path does not exist in zip: ${relativePath}` });
  }

  if (!requireString(populationSlug)) {
    issues.push({ rowNumber, assetKey, status: "failed", message: "population_slug is required" });
  } else if (!populationsBySlug.has(populationSlug)) {
    issues.push({ rowNumber, assetKey, status: "failed", message: `unknown population_slug: ${populationSlug}` });
  }

  if (!ASSET_ROLES.has(assetRole)) {
    issues.push({ rowNumber, assetKey, status: "failed", message: `unsupported asset_role: ${assetRole || "missing"}` });
  }

  if (!requireString(displayLabel)) {
    issues.push({ rowNumber, assetKey, status: "failed", message: "display_label is required" });
  }

  if ((assetRole === "study" || assetRole === "memory_old") && !requireString(identityId)) {
    issues.push({ rowNumber, assetKey, status: "failed", message: "identity_id is required for study and memory_old rows" });
  }

  if ((assetRole.endsWith("_target") || assetRole.endsWith("_probe")) && !requireString(trialSetId)) {
    issues.push({ rowNumber, assetKey, status: "failed", message: "trial_set_id is required for matching and practice rows" });
  }

  if (assetRole.endsWith("_probe") && !["left", "right"].includes(expectedSide || "")) {
    issues.push({ rowNumber, assetKey, status: "failed", message: "expected_side must be left or right for probe rows" });
  }

  if (metadata === null) {
    return { issues };
  }

  const zipEntry = relativePath ? zipEntriesByPath.get(relativePath) : null;
  const fileName = zipEntry ? path.basename(zipEntry.entryName) : null;

  return {
    issues,
    row: {
      rowNumber,
      assetKey,
      relativePath,
      populationSlug,
      assetRole,
      displayLabel,
      identityId,
      trialSetId,
      expectedSide,
      metadata,
      isAvailable,
      populationId: populationsBySlug.get(populationSlug)?.id || null,
      zipEntry,
      fileName,
    },
  };
}

function parseBulkImportArchive(buffer, populationsBySlug) {
  let zip;
  try {
    zip = new AdmZip(buffer);
  } catch {
    return {
      issues: [{ rowNumber: 0, assetKey: null, status: "failed", message: "uploaded file is not a readable zip archive" }],
      rows: [],
    };
  }

  const fileEntries = zip
    .getEntries()
    .filter((entry) => !entry.isDirectory)
    .map((entry) => ({
      ...entry,
      normalizedPath: normalizeZipRelativePath(entry.entryName),
    }))
    .filter((entry) => entry.normalizedPath);

  const zipEntriesByPath = new Map(fileEntries.map((entry) => [entry.normalizedPath, entry]));
  const manifestEntry = zipEntriesByPath.get("manifest.csv");
  if (!manifestEntry) {
    return {
      issues: [{ rowNumber: 0, assetKey: null, status: "failed", message: "zip must contain manifest.csv at its root" }],
      rows: [],
    };
  }

  let manifest;
  try {
    manifest = parseBulkManifestCsv(manifestEntry.getData());
  } catch (error) {
    return {
      issues: [{ rowNumber: 0, assetKey: null, status: "failed", message: `manifest.csv could not be parsed: ${error.message}` }],
      rows: [],
    };
  }

  const missingHeaders = REQUIRED_BULK_IMPORT_HEADERS.filter((header) => !manifest.headers.includes(header));
  if (missingHeaders.length) {
    return {
      issues: [
        {
          rowNumber: 0,
          assetKey: null,
          status: "failed",
          message: `manifest.csv is missing required headers: ${missingHeaders.join(", ")}`,
        },
      ],
      rows: [],
    };
  }

  const seenAssetKeys = new Set();
  const issues = [];
  const rows = [];

  manifest.rows.forEach((rawRow, index) => {
    const rowNumber = index + 2;
    const result = validateImportRowShape(rawRow, rowNumber, populationsBySlug, zipEntriesByPath, seenAssetKeys);
    issues.push(...result.issues);
    if (result.row) {
      rows.push(result.row);
    }
  });

  return { issues, rows };
}

function ensureDraftVersion(version, res) {
  if (!version) {
    badRequest(res, "unknown version", 404);
    return false;
  }
  if (version.status !== "draft") {
    badRequest(res, "version is immutable once published; clone it to continue", 409);
    return false;
  }
  return true;
}

function filterAssetsByMetadata(assets, filters) {
  if (!filters || typeof filters !== "object") {
    return assets;
  }
  const metadata = filters.metadata;
  if (!metadata || typeof metadata !== "object") {
    return assets;
  }
  return assets.filter((asset) =>
    Object.entries(metadata).every(([key, expected]) => asset.metadata?.[key] === expected),
  );
}

function groupBy(items, keyFn) {
  const grouped = new Map();
  for (const item of items) {
    const key = keyFn(item);
    if (!grouped.has(key)) {
      grouped.set(key, []);
    }
    grouped.get(key).push(item);
  }
  return grouped;
}

function buildTrialSetPool(assets, targetRole, probeRole, populationId, filters = {}) {
  const filtered = assets.filter((asset) => {
    if (!asset.is_available) return false;
    if (populationId && asset.population_id !== populationId) return false;
    return true;
  });
  const targets = filterAssetsByMetadata(
    filtered.filter((asset) => asset.asset_role === targetRole && asset.trial_set_id),
    filters,
  );
  const probes = filtered.filter((asset) => asset.asset_role === probeRole && asset.trial_set_id);
  const probesBySet = groupBy(probes, (asset) => asset.trial_set_id);
  return targets
    .map((target) => ({
      target,
      probes: (probesBySet.get(target.trial_set_id) || []).filter((probe) => requireString(probe.expected_side)),
    }))
    .filter((entry) => entry.probes.length >= 4);
}

function buildStudyIdentityPool(assets, populationId, filters = {}) {
  const studyAssets = filterAssetsByMetadata(
    assets.filter(
      (asset) =>
        asset.is_available &&
        asset.asset_role === "study" &&
        requireString(asset.identity_id) &&
        (!populationId || asset.population_id === populationId),
    ),
    filters,
  );
  const memoryOldAssets = assets.filter(
    (asset) =>
      asset.is_available &&
      asset.asset_role === "memory_old" &&
      requireString(asset.identity_id) &&
      (!populationId || asset.population_id === populationId),
  );
  const oldByIdentity = groupBy(memoryOldAssets, (asset) => asset.identity_id);
  const grouped = groupBy(studyAssets, (asset) => asset.identity_id);
  return [...grouped.entries()]
    .filter(([identityId]) => (oldByIdentity.get(identityId) || []).length > 0)
    .map(([identityId, studyChoices]) => ({
      identityId,
      studyChoices,
      oldChoices: oldByIdentity.get(identityId),
    }));
}

function buildMemoryNewPool(assets, populationId, filters = {}) {
  const filtered = filterAssetsByMetadata(
    assets.filter(
      (asset) =>
        asset.is_available &&
        asset.asset_role === "memory_new" &&
        (!populationId || asset.population_id === populationId),
    ),
    filters,
  );
  return [...groupBy(filtered, (asset) => asset.identity_id || asset.id).values()].map((entries) => randomize(entries)[0]);
}

function selectUniqueItems(pool, count, descriptor) {
  const chosen = randomize(pool).slice(0, count);
  if (chosen.length < count) {
    throw new Error(`Not enough eligible ${descriptor}. Needed ${count}, found ${chosen.length}.`);
  }
  return chosen;
}

function validatePhaseRules(assets, rules) {
  const errors = [];
  const studyRules = rules.filter((rule) => rule.phase === "study");
  const memoryOldRules = rules.filter((rule) => rule.phase === "memory_old");
  const memoryNewRules = rules.filter((rule) => rule.phase === "memory_new");
  const practiceRules = rules.filter((rule) => rule.phase === "practice_matching");
  const matchingRules = rules.filter((rule) => rule.phase === "matching");

  const usedStudyIdentityIds = new Set();
  for (const rule of studyRules) {
    const pool = buildStudyIdentityPool(assets, rule.population_id, rule.filters)
      .filter((entry) => !usedStudyIdentityIds.has(entry.identityId));
    if (pool.length < rule.count) {
      errors.push(`Study rule for population ${rule.population_id || "any"} needs ${rule.count} eligible identities but found ${pool.length}.`);
      continue;
    }
    randomize(pool)
      .slice(0, Number(rule.count))
      .forEach((entry) => usedStudyIdentityIds.add(entry.identityId));
  }

  const totalStudyCount = studyRules.reduce((sum, rule) => sum + Number(rule.count), 0);
  const totalMemoryOldCount = memoryOldRules.reduce((sum, rule) => sum + Number(rule.count), 0);
  if (memoryOldRules.length && totalMemoryOldCount !== totalStudyCount) {
    errors.push("memory_old rule counts must match the total study rule count.");
  }

  const usedMemoryNewIds = new Set([...usedStudyIdentityIds]);
  for (const rule of memoryNewRules) {
    const pool = buildMemoryNewPool(assets, rule.population_id, rule.filters)
      .filter((asset) => !asset.identity_id || !usedMemoryNewIds.has(asset.identity_id));
    if (pool.length < rule.count) {
      errors.push(`Memory-new rule for population ${rule.population_id || "any"} needs ${rule.count} assets but found ${pool.length}.`);
      continue;
    }
    randomize(pool)
      .slice(0, Number(rule.count))
      .forEach((asset) => {
        if (asset.identity_id) usedMemoryNewIds.add(asset.identity_id);
      });
  }

  const usedPracticeSetIds = new Set();
  for (const rule of practiceRules) {
    const pool = buildTrialSetPool(assets, "practice_target", "practice_probe", rule.population_id, rule.filters)
      .filter((entry) => !usedPracticeSetIds.has(entry.target.trial_set_id));
    if (pool.length < rule.count) {
      errors.push(`Practice matching rule for population ${rule.population_id || "any"} needs ${rule.count} trial sets but found ${pool.length}.`);
      continue;
    }
    randomize(pool)
      .slice(0, Number(rule.count))
      .forEach((entry) => usedPracticeSetIds.add(entry.target.trial_set_id));
  }

  const usedMatchingSetIds = new Set();
  for (const rule of matchingRules) {
    const pool = buildTrialSetPool(assets, "matching_target", "matching_probe", rule.population_id, rule.filters)
      .filter((entry) => !usedMatchingSetIds.has(entry.target.trial_set_id));
    if (pool.length < rule.count) {
      errors.push(`Matching rule for population ${rule.population_id || "any"} needs ${rule.count} trial sets but found ${pool.length}.`);
      continue;
    }
    randomize(pool)
      .slice(0, Number(rule.count))
      .forEach((entry) => usedMatchingSetIds.add(entry.target.trial_set_id));
  }

  return errors;
}

function buildPublishedSnapshot({ study, version, formDef, rules, populations }) {
  return {
    study: {
      id: study.id,
      slug: study.slug,
      title: study.title,
      status: study.status,
      notes: study.notes ?? "",
    },
    version: {
      id: version.id,
      version_number: version.version_number,
      published_at: version.published_at,
      changelog: version.changelog ?? "",
    },
    pages: formDef.pages,
    demographicsSchema: formDef.demographicsSchema,
    contactSchema: formDef.contactSchema,
    settings: formDef.settings,
    rules: rules.map((rule) => ({
      id: rule.id,
      phase: rule.phase,
      population_id: rule.population_id,
      count: rule.count,
      filters: rule.filters,
    })),
    populations: populations.map((population) => ({
      id: population.id,
      slug: population.slug,
      label: population.label,
      description: population.description ?? "",
      metadata: population.metadata,
    })),
  };
}

function resolveRunConfiguration(db, study, version, snapshot) {
  const assets = getAssetsForStudy(db, study.id);
  const rules = snapshot.rules || [];
  const studyEntries = [];
  const seenStudyIdentityIds = new Set();

  for (const rule of rules.filter((entry) => entry.phase === "study")) {
    const pool = buildStudyIdentityPool(assets, rule.population_id, rule.filters)
      .filter((entry) => !seenStudyIdentityIds.has(entry.identityId));
    const selected = selectUniqueItems(pool, Number(rule.count), "study identities");
    for (const entry of selected) {
      seenStudyIdentityIds.add(entry.identityId);
      studyEntries.push({
        identityId: entry.identityId,
        studyAsset: randomize(entry.studyChoices)[0],
        oldAsset: randomize(entry.oldChoices)[0],
      });
    }
  }

  const memoryNewEntries = [];
  const usedNewIdentityIds = new Set([...seenStudyIdentityIds]);
  for (const rule of rules.filter((entry) => entry.phase === "memory_new")) {
    const pool = buildMemoryNewPool(assets, rule.population_id, rule.filters)
      .filter((asset) => !asset.identity_id || !usedNewIdentityIds.has(asset.identity_id));
    const selected = selectUniqueItems(pool, Number(rule.count), "memory-new assets");
    for (const asset of selected) {
      if (asset.identity_id) {
        usedNewIdentityIds.add(asset.identity_id);
      }
      memoryNewEntries.push(asset);
    }
  }

  const practiceTrials = [];
  const usedPracticeSetIds = new Set();
  for (const rule of rules.filter((entry) => entry.phase === "practice_matching")) {
    const pool = buildTrialSetPool(assets, "practice_target", "practice_probe", rule.population_id, rule.filters)
      .filter((entry) => !usedPracticeSetIds.has(entry.target.trial_set_id));
    const selected = selectUniqueItems(pool, Number(rule.count), "practice matching sets");
    for (const entry of selected) {
      usedPracticeSetIds.add(entry.target.trial_set_id);
      practiceTrials.push(formatResolvedMatchingTrial(entry));
    }
  }

  const matchingTrials = [];
  const usedMatchingSetIds = new Set();
  for (const rule of rules.filter((entry) => entry.phase === "matching")) {
    const pool = buildTrialSetPool(assets, "matching_target", "matching_probe", rule.population_id, rule.filters)
      .filter((entry) => !usedMatchingSetIds.has(entry.target.trial_set_id));
    const selected = selectUniqueItems(pool, Number(rule.count), "matching sets");
    for (const entry of selected) {
      usedMatchingSetIds.add(entry.target.trial_set_id);
      matchingTrials.push(formatResolvedMatchingTrial(entry));
    }
  }

  return {
    studyFaces: randomize(
      studyEntries.map((entry) => formatResolvedAsset(entry.studyAsset)),
    ),
    memoryTrials: randomize([
      ...studyEntries.map((entry) => ({
        ...formatResolvedAsset(entry.oldAsset),
        trialType: "OLD",
      })),
      ...memoryNewEntries.map((asset) => ({
        ...formatResolvedAsset(asset),
        trialType: "NEW",
      })),
    ]),
    practiceTrials: randomize(practiceTrials),
    matchingTrials: randomize(matchingTrials),
  };
}

function formatResolvedAsset(asset) {
  return {
    assetId: asset.id,
    url: asset.public_path,
    fileName: asset.file_name,
    role: asset.asset_role,
    populationId: asset.population_id ?? null,
    identityId: asset.identity_id ?? null,
    trialSetId: asset.trial_set_id ?? null,
    metadata: asset.metadata ?? {},
  };
}

function formatResolvedMatchingTrial(entry) {
  const probes = randomize(entry.probes).slice(0, 4);
  return {
    id: entry.target.trial_set_id,
    target: formatResolvedAsset(entry.target),
    stimuli: probes.map(formatResolvedAsset),
    answers: probes.map((probe) => probe.expected_side),
  };
}

function archiveRawRow(db, runId, rowType, data) {
  db.prepare(`
    INSERT INTO facetest_raw_rows (id, run_id, row_type, created_at, data_json)
    VALUES (?, ?, ?, ?, ?)
  `).run(newId(), runId, rowType, nowIso(), JSON.stringify(data ?? {}));
}

function getRunById(db, runId) {
  return db.prepare("SELECT * FROM facetest_runs WHERE id = ? LIMIT 1").get(runId);
}

function requireActiveRun(db, runId, res) {
  const run = getRunById(db, runId);
  if (!run) {
    badRequest(res, "unknown run", 404);
    return null;
  }
  if (run.status !== "active") {
    badRequest(res, "run is already completed", 409);
    return null;
  }
  return run;
}

function flattenRunRows(rows) {
  return rows.map((row) => ({
    ...row,
    data: asJson(row.data_json, {}),
  }));
}

export function registerFaceTestRoutes(app, db) {
  app.get("/api/facetest/public/studies", (_req, res) => {
    const studies = db.prepare(`
      SELECT *
      FROM facetest_studies
      WHERE status = 'active'
      ORDER BY title
    `).all();

    const payload = studies
      .map((study) => {
        const publishedVersion = getLatestPublishedVersionForStudy(db, study.id);
        if (!publishedVersion) {
          return null;
        }
        return {
          id: study.id,
          slug: study.slug,
          title: study.title,
          notes: study.notes ?? "",
          publishedVersion: {
            id: publishedVersion.id,
            versionNumber: publishedVersion.version_number,
            publishedAt: publishedVersion.published_at,
          },
        };
      })
      .filter(Boolean);

    return res.json({ ok: true, studies: payload });
  });

  app.get("/api/facetest/assets/:assetId/:fileName?", (req, res) => {
    const asset = db.prepare("SELECT * FROM facetest_assets WHERE id = ? LIMIT 1").get(req.params.assetId);
    if (!asset || Number(asset.is_available) !== 1) {
      return res.status(404).end();
    }
    res.type(asset.mime_type || "application/octet-stream");
    return res.sendFile(path.resolve(asset.file_path));
  });

  app.post("/api/facetest/runs/start", (req, res) => {
    const requestedSlug = sanitizeSlug(req.body?.study_slug);
    let study = requestedSlug ? getStudyBySlug(db, requestedSlug) : null;
    if (requestedSlug && !study) {
      return badRequest(res, "requested study was not found", 404);
    }
    if (!study) {
      study = db.prepare(`
        SELECT *
        FROM facetest_studies
        WHERE status = 'active'
        ORDER BY created_at
        LIMIT 1
      `).get();
    }
    if (!study) {
      return badRequest(res, "no active face-test study is available", 404);
    }

    const version = getLatestPublishedVersionForStudy(db, study.id);
    if (!version) {
      return badRequest(res, "study has no published version", 404);
    }

    const snapshot = asJson(version.published_snapshot_json, null);
    if (!snapshot) {
      return badRequest(res, "published study snapshot is missing", 500);
    }

    let resolved;
    try {
      resolved = resolveRunConfiguration(db, study, version, snapshot);
    } catch (error) {
      return badRequest(res, error.message, 409);
    }

    const runId = newId();
    const browserId = requireString(req.body?.browser_id) ? String(req.body.browser_id).trim() : newId();
    const startedAt = nowIso();

    db.prepare(`
      INSERT INTO facetest_runs (
        id, study_id, study_version_id, study_slug, browser_id, started_at, completed_at, status,
        user_agent_hash, config_snapshot_json, resolved_stimuli_json, score_json, pii_contact_email
      )
      VALUES (?, ?, ?, ?, ?, ?, NULL, 'active', ?, ?, ?, NULL, NULL)
    `).run(
      runId,
      study.id,
      version.id,
      study.slug,
      browserId,
      startedAt,
      userAgentHash(req.get("user-agent") || ""),
      JSON.stringify(snapshot),
      JSON.stringify(resolved),
    );

    archiveRawRow(db, runId, "run-start", {
      run_id: runId,
      study_slug: study.slug,
      study_version_id: version.id,
      started_at: startedAt,
      browser_id: browserId,
    });

    return res.status(201).json({
      ok: true,
      runId,
      study: snapshot.study,
      version: snapshot.version,
      pages: snapshot.pages,
      demographicsSchema: snapshot.demographicsSchema,
      contactSchema: snapshot.contactSchema,
      settings: snapshot.settings,
      resolvedStimuli: resolved,
    });
  });

  app.post("/api/facetest/runs/:id/forms", (req, res) => {
    const run = requireActiveRun(db, req.params.id, res);
    if (!run) return;

    const section = String(req.body?.section || "").trim();
    const responses = req.body?.responses;
    if (!requireString(section) || !responses || typeof responses !== "object") {
      return badRequest(res, "section and responses are required");
    }

    if (section === "contact" && requireString(responses.email)) {
      db.prepare("UPDATE facetest_runs SET pii_contact_email = ? WHERE id = ?").run(String(responses.email).trim(), run.id);
    }

    db.prepare(`
      INSERT INTO facetest_run_forms (id, run_id, section, responses_json, created_at)
      VALUES (?, ?, ?, ?, ?)
    `).run(newId(), run.id, section, JSON.stringify(responses), nowIso());

    archiveRawRow(db, run.id, `form-${section}`, { section, responses });
    return res.status(201).json({ ok: true });
  });

  app.post("/api/facetest/runs/:id/events", (req, res) => {
    const run = requireActiveRun(db, req.params.id, res);
    if (!run) return;

    const eventType = String(req.body?.event_type || "").trim();
    if (!requireString(eventType)) {
      return badRequest(res, "event_type is required");
    }

    const phase = requireString(req.body?.phase) ? String(req.body.phase).trim() : null;
    const eventIndex = Number.isInteger(req.body?.event_index) ? req.body.event_index : null;
    const payload = req.body?.payload && typeof req.body.payload === "object" ? req.body.payload : {};

    db.prepare(`
      INSERT INTO facetest_run_events (id, run_id, phase, event_type, event_index, payload_json, created_at)
      VALUES (?, ?, ?, ?, ?, ?, ?)
    `).run(newId(), run.id, phase, eventType, eventIndex, JSON.stringify(payload), nowIso());

    archiveRawRow(db, run.id, "event", {
      phase,
      event_type: eventType,
      event_index: eventIndex,
      payload,
    });

    return res.status(201).json({ ok: true });
  });

  app.post("/api/facetest/runs/:id/memory-trials", (req, res) => {
    const run = requireActiveRun(db, req.params.id, res);
    if (!run) return;

    const { trial_index: trialIndex, asset_id: assetId = null, stimulus_url: stimulusUrl, trial_type: trialType, response, rt_ms: rtMs, correct, points } = req.body ?? {};
    if (!Number.isInteger(trialIndex) || trialIndex < 1) {
      return badRequest(res, "trial_index must be a positive integer");
    }
    if (!requireString(stimulusUrl) || !["OLD", "NEW"].includes(trialType) || !requireString(response)) {
      return badRequest(res, "stimulus_url, trial_type, and response are required");
    }
    if (!Number.isInteger(rtMs) || rtMs < 0 || !Number.isInteger(points)) {
      return badRequest(res, "rt_ms and points must be integers");
    }

    db.prepare(`
      INSERT INTO facetest_memory_trials (
        id, run_id, trial_index, asset_id, stimulus_url, trial_type, response, rt_ms, correct, points, created_at
      )
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(newId(), run.id, trialIndex, assetId, stimulusUrl, trialType, response, rtMs, correct ? 1 : 0, points, nowIso());

    archiveRawRow(db, run.id, "memory-trial", {
      trial_index: trialIndex,
      asset_id: assetId,
      stimulus_url: stimulusUrl,
      trial_type: trialType,
      response,
      rt_ms: rtMs,
      correct: Boolean(correct),
      points,
    });

    return res.status(201).json({ ok: true });
  });

  app.post("/api/facetest/runs/:id/matching-trials", (req, res) => {
    const run = requireActiveRun(db, req.params.id, res);
    if (!run) return;

    const {
      phase,
      trial_index: trialIndex,
      trial_identifier: trialIdentifier = null,
      target_asset_id: targetAssetId = null,
      target_url: targetUrl,
      details,
      points,
    } = req.body ?? {};

    if (!["practice_matching", "matching"].includes(phase)) {
      return badRequest(res, "phase must be practice_matching or matching");
    }
    if (!Number.isInteger(trialIndex) || trialIndex < 1 || !requireString(targetUrl) || !Array.isArray(details) || !Number.isInteger(points)) {
      return badRequest(res, "phase, trial_index, target_url, details, and points are required");
    }

    db.prepare(`
      INSERT INTO facetest_matching_trials (
        id, run_id, phase, trial_index, trial_identifier, target_asset_id, target_url, details_json, points, created_at
      )
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(newId(), run.id, phase, trialIndex, trialIdentifier, targetAssetId, targetUrl, JSON.stringify(details), points, nowIso());

    archiveRawRow(db, run.id, "matching-trial", {
      phase,
      trial_index: trialIndex,
      trial_identifier: trialIdentifier,
      target_asset_id: targetAssetId,
      target_url: targetUrl,
      details,
      points,
    });

    return res.status(201).json({ ok: true });
  });

  app.post("/api/facetest/runs/:id/complete", (req, res) => {
    const run = requireActiveRun(db, req.params.id, res);
    if (!run) return;

    const score = {
      memoryPoints: Number(req.body?.memoryPoints || 0),
      matchPoints: Number(req.body?.matchPoints || 0),
      overallPercent: Number(req.body?.overallPercent || 0),
    };
    const completedAt = nowIso();

    db.prepare(`
      UPDATE facetest_runs
      SET completed_at = ?, status = 'completed', score_json = ?
      WHERE id = ?
    `).run(completedAt, JSON.stringify(score), run.id);

    archiveRawRow(db, run.id, "run-complete", {
      completed_at: completedAt,
      ...score,
    });

    return res.status(201).json({ ok: true });
  });

  app.get("/api/facetest/admin/studies", (req, res) => {
    if (!requireAdmin(req, res)) return;
    const studies = db.prepare(`
      SELECT s.*,
        (
          SELECT MAX(version_number)
          FROM facetest_study_versions v
          WHERE v.study_id = s.id
        ) AS latest_version_number,
        (
          SELECT MAX(published_at)
          FROM facetest_study_versions v
          WHERE v.study_id = s.id AND v.status = 'published'
        ) AS latest_published_at
      FROM facetest_studies s
      ORDER BY s.title
    `).all();

    return res.json({ ok: true, studies });
  });

  app.post("/api/facetest/admin/studies", (req, res) => {
    if (!requireAdmin(req, res)) return;
    const title = String(req.body?.title || "").trim();
    const slug = sanitizeSlug(req.body?.slug || title);
    const status = ["active", "archived"].includes(req.body?.status) ? req.body.status : "active";
    const notes = requireString(req.body?.notes) ? String(req.body.notes).trim() : "";
    if (!requireString(title) || !requireString(slug)) {
      return badRequest(res, "title and slug are required");
    }
    if (getStudyBySlug(db, slug)) {
      return badRequest(res, "study slug already exists", 409);
    }

    const studyId = newId();
    const timestamp = nowIso();
    db.prepare(`
      INSERT INTO facetest_studies (id, slug, title, status, notes, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?)
    `).run(studyId, slug, title, status, notes, timestamp, timestamp);

    audit(db, "create-study", "study", studyId, { slug, title });
    return res.status(201).json({ ok: true, study: getStudyById(db, studyId) });
  });

  app.patch("/api/facetest/admin/studies/:id", (req, res) => {
    if (!requireAdmin(req, res)) return;
    const study = getStudyById(db, req.params.id);
    if (!study) return badRequest(res, "unknown study", 404);

    const title = requireString(req.body?.title) ? String(req.body.title).trim() : study.title;
    const slug = requireString(req.body?.slug) ? sanitizeSlug(req.body.slug) : study.slug;
    const status = ["active", "archived"].includes(req.body?.status) ? req.body.status : study.status;
    const notes = req.body?.notes === undefined ? study.notes : String(req.body.notes || "");

    const existing = getStudyBySlug(db, slug);
    if (existing && existing.id !== study.id) {
      return badRequest(res, "study slug already exists", 409);
    }

    db.prepare(`
      UPDATE facetest_studies
      SET slug = ?, title = ?, status = ?, notes = ?, updated_at = ?
      WHERE id = ?
    `).run(slug, title, status, notes, nowIso(), study.id);

    audit(db, "update-study", "study", study.id, { slug, title, status });
    return res.json({ ok: true, study: getStudyById(db, study.id) });
  });

  app.get("/api/facetest/admin/studies/:id/versions", (req, res) => {
    if (!requireAdmin(req, res)) return;
    const versions = db.prepare(`
      SELECT *
      FROM facetest_study_versions
      WHERE study_id = ?
      ORDER BY version_number DESC
    `).all(req.params.id);
    return res.json({ ok: true, versions });
  });

  app.post("/api/facetest/admin/studies/:id/versions", (req, res) => {
    if (!requireAdmin(req, res)) return;
    const study = getStudyById(db, req.params.id);
    if (!study) return badRequest(res, "unknown study", 404);

    const latestNumber = db.prepare(`
      SELECT COALESCE(MAX(version_number), 0) AS value
      FROM facetest_study_versions
      WHERE study_id = ?
    `).get(study.id).value;

    const versionId = newId();
    const timestamp = nowIso();
    const parentVersionId = requireString(req.body?.parent_version_id) ? String(req.body.parent_version_id).trim() : null;
    db.prepare(`
      INSERT INTO facetest_study_versions (
        id, study_id, version_number, status, changelog, parent_version_id, created_at, updated_at, published_at, published_snapshot_json
      )
      VALUES (?, ?, ?, 'draft', ?, ?, ?, ?, NULL, NULL)
    `).run(versionId, study.id, Number(latestNumber) + 1, String(req.body?.changelog || ""), parentVersionId, timestamp, timestamp);

    const sourceVersionId = parentVersionId || (requireString(req.body?.source_version_id) ? String(req.body.source_version_id).trim() : null);
    if (sourceVersionId) {
      const sourceFormDef = getFormDefByVersion(db, sourceVersionId);
      if (sourceFormDef) {
        db.prepare(`
          INSERT INTO facetest_form_defs (
            id, study_version_id, pages_json, demographics_schema_json, contact_schema_json, settings_json, created_at, updated_at
          )
          VALUES (?, ?, ?, ?, ?, ?, ?, ?)
        `).run(
          newId(),
          versionId,
          JSON.stringify(sourceFormDef.pages),
          JSON.stringify(sourceFormDef.demographicsSchema),
          JSON.stringify(sourceFormDef.contactSchema),
          JSON.stringify(sourceFormDef.settings),
          timestamp,
          timestamp,
        );
      }

      const rules = getRulesForVersion(db, sourceVersionId);
      for (const rule of rules) {
        db.prepare(`
          INSERT INTO facetest_selection_rules (
            id, study_version_id, phase, population_id, count, filters_json, created_at, updated_at
          )
          VALUES (?, ?, ?, ?, ?, ?, ?, ?)
        `).run(newId(), versionId, rule.phase, rule.population_id, rule.count, JSON.stringify(rule.filters), timestamp, timestamp);
      }
    }

    audit(db, "create-version", "study_version", versionId, { study_id: study.id, parent_version_id: sourceVersionId });
    return res.status(201).json({ ok: true, version: getVersionById(db, versionId) });
  });

  app.post("/api/facetest/admin/versions/:id/clone", (req, res) => {
    if (!requireAdmin(req, res)) return;
    const version = getVersionById(db, req.params.id);
    if (!version) return badRequest(res, "unknown version", 404);
    const study = getStudyById(db, version.study_id);
    const latestNumber = db.prepare(`
      SELECT COALESCE(MAX(version_number), 0) AS value
      FROM facetest_study_versions
      WHERE study_id = ?
    `).get(study.id).value;
    const versionId = newId();
    const timestamp = nowIso();
    const changelog = requireString(req.body?.changelog) ? String(req.body.changelog).trim() : `Cloned from version ${version.version_number}`;

    db.prepare(`
      INSERT INTO facetest_study_versions (
        id, study_id, version_number, status, changelog, parent_version_id, created_at, updated_at, published_at, published_snapshot_json
      )
      VALUES (?, ?, ?, 'draft', ?, ?, ?, ?, NULL, NULL)
    `).run(versionId, study.id, Number(latestNumber) + 1, changelog, version.id, timestamp, timestamp);

    const sourceFormDef = getFormDefByVersion(db, version.id);
    if (sourceFormDef) {
      db.prepare(`
        INSERT INTO facetest_form_defs (
          id, study_version_id, pages_json, demographics_schema_json, contact_schema_json, settings_json, created_at, updated_at
        )
        VALUES (?, ?, ?, ?, ?, ?, ?, ?)
      `).run(
        newId(),
        versionId,
        JSON.stringify(sourceFormDef.pages),
        JSON.stringify(sourceFormDef.demographicsSchema),
        JSON.stringify(sourceFormDef.contactSchema),
        JSON.stringify(sourceFormDef.settings),
        timestamp,
        timestamp,
      );
    }

    const rules = getRulesForVersion(db, version.id);
    for (const rule of rules) {
      db.prepare(`
        INSERT INTO facetest_selection_rules (
          id, study_version_id, phase, population_id, count, filters_json, created_at, updated_at
        )
        VALUES (?, ?, ?, ?, ?, ?, ?, ?)
      `).run(newId(), versionId, rule.phase, rule.population_id, rule.count, JSON.stringify(rule.filters), timestamp, timestamp);
    }

    audit(db, "clone-version", "study_version", versionId, { source_version_id: version.id });
    return res.status(201).json({ ok: true, version: getVersionById(db, versionId) });
  });

  app.get("/api/facetest/admin/versions/:id", (req, res) => {
    if (!requireAdmin(req, res)) return;
    const version = getVersionById(db, req.params.id);
    if (!version) return badRequest(res, "unknown version", 404);
    return res.json({
      ok: true,
      version,
      formDef: getFormDefByVersion(db, version.id),
      rules: getRulesForVersion(db, version.id),
    });
  });

  app.patch("/api/facetest/admin/versions/:id", (req, res) => {
    if (!requireAdmin(req, res)) return;
    const version = getVersionById(db, req.params.id);
    if (!ensureDraftVersion(version, res)) return;

    const changelog = req.body?.changelog === undefined ? version.changelog : String(req.body.changelog || "");
    db.prepare(`
      UPDATE facetest_study_versions
      SET changelog = ?, updated_at = ?
      WHERE id = ?
    `).run(changelog, nowIso(), version.id);

    audit(db, "update-version", "study_version", version.id, { changelog });
    return res.json({ ok: true, version: getVersionById(db, version.id) });
  });

  app.get("/api/facetest/admin/versions/:id/forms", (req, res) => {
    if (!requireAdmin(req, res)) return;
    const version = getVersionById(db, req.params.id);
    if (!version) return badRequest(res, "unknown version", 404);
    return res.json({ ok: true, formDef: getFormDefByVersion(db, version.id) });
  });

  app.put("/api/facetest/admin/versions/:id/forms", (req, res) => {
    if (!requireAdmin(req, res)) return;
    const version = getVersionById(db, req.params.id);
    if (!ensureDraftVersion(version, res)) return;

    const pages = req.body?.pages && typeof req.body.pages === "object" ? req.body.pages : null;
    const demographicsSchema = Array.isArray(req.body?.demographicsSchema) ? req.body.demographicsSchema : null;
    const contactSchema = Array.isArray(req.body?.contactSchema) ? req.body.contactSchema : [];
    const settings = req.body?.settings && typeof req.body.settings === "object" ? req.body.settings : null;

    if (!pages || !demographicsSchema || !settings) {
      return badRequest(res, "pages, demographicsSchema, and settings are required");
    }

    const existing = getFormDefByVersion(db, version.id);
    const timestamp = nowIso();
    if (existing) {
      db.prepare(`
        UPDATE facetest_form_defs
        SET pages_json = ?, demographics_schema_json = ?, contact_schema_json = ?, settings_json = ?, updated_at = ?
        WHERE study_version_id = ?
      `).run(
        JSON.stringify(pages),
        JSON.stringify(demographicsSchema),
        JSON.stringify(contactSchema),
        JSON.stringify(settings),
        timestamp,
        version.id,
      );
    } else {
      db.prepare(`
        INSERT INTO facetest_form_defs (
          id, study_version_id, pages_json, demographics_schema_json, contact_schema_json, settings_json, created_at, updated_at
        )
        VALUES (?, ?, ?, ?, ?, ?, ?, ?)
      `).run(
        newId(),
        version.id,
        JSON.stringify(pages),
        JSON.stringify(demographicsSchema),
        JSON.stringify(contactSchema),
        JSON.stringify(settings),
        timestamp,
        timestamp,
      );
    }

    audit(db, "save-form-def", "study_version", version.id, {});
    return res.json({ ok: true, formDef: getFormDefByVersion(db, version.id) });
  });

  app.get("/api/facetest/admin/versions/:id/selection-rules", (req, res) => {
    if (!requireAdmin(req, res)) return;
    const version = getVersionById(db, req.params.id);
    if (!version) return badRequest(res, "unknown version", 404);
    return res.json({ ok: true, rules: getRulesForVersion(db, version.id) });
  });

  app.put("/api/facetest/admin/versions/:id/selection-rules", (req, res) => {
    if (!requireAdmin(req, res)) return;
    const version = getVersionById(db, req.params.id);
    if (!ensureDraftVersion(version, res)) return;
    const rules = Array.isArray(req.body?.rules) ? req.body.rules : null;
    if (!rules) return badRequest(res, "rules array is required");

    for (const rule of rules) {
      if (!FACE_TEST_PHASES.has(rule.phase)) {
        return badRequest(res, `unsupported phase: ${rule.phase}`);
      }
      if (!Number.isInteger(rule.count) || rule.count < 0) {
        return badRequest(res, "rule counts must be non-negative integers");
      }
    }

    db.prepare("DELETE FROM facetest_selection_rules WHERE study_version_id = ?").run(version.id);
    const timestamp = nowIso();
    for (const rule of rules) {
      db.prepare(`
        INSERT INTO facetest_selection_rules (
          id, study_version_id, phase, population_id, count, filters_json, created_at, updated_at
        )
        VALUES (?, ?, ?, ?, ?, ?, ?, ?)
      `).run(
        newId(),
        version.id,
        rule.phase,
        rule.population_id || null,
        rule.count,
        JSON.stringify(rule.filters || {}),
        timestamp,
        timestamp,
      );
    }

    audit(db, "save-selection-rules", "study_version", version.id, { count: rules.length });
    return res.json({ ok: true, rules: getRulesForVersion(db, version.id) });
  });

  app.post("/api/facetest/admin/versions/:id/publish", (req, res) => {
    if (!requireAdmin(req, res)) return;
    const version = getVersionById(db, req.params.id);
    if (!ensureDraftVersion(version, res)) return;
    const study = getStudyById(db, version.study_id);
    const formDef = getFormDefByVersion(db, version.id);
    const rules = getRulesForVersion(db, version.id);
    const populations = getPopulationsForStudy(db, version.study_id);
    const assets = getAssetsForStudy(db, version.study_id);
    const errors = [];

    if (!formDef) {
      errors.push("forms/settings are required before publishing");
    }

    if (formDef && (!Array.isArray(formDef.demographicsSchema) || !formDef.demographicsSchema.length)) {
      errors.push("at least one demographics field is required");
    }
    if (formDef && !formDef.pages?.consent?.length) {
      errors.push("consent pages are required");
    }
    if (
      formDef &&
      (!formDef.pages?.studyInstructions?.length ||
        !formDef.pages?.memoryInstructions?.length ||
        !formDef.pages?.matchingInstructions?.length)
    ) {
      errors.push("study, memory, and matching instruction pages are required");
    }
    if (!rules.some((rule) => rule.phase === "study")) {
      errors.push("at least one study selection rule is required");
    }
    if (!rules.some((rule) => rule.phase === "memory_new")) {
      errors.push("at least one memory_new selection rule is required");
    }
    if (!rules.some((rule) => rule.phase === "practice_matching")) {
      errors.push("at least one practice_matching selection rule is required");
    }
    if (!rules.some((rule) => rule.phase === "matching")) {
      errors.push("at least one matching selection rule is required");
    }

    errors.push(...validatePhaseRules(assets, rules));
    if (errors.length) {
      return res.status(409).json({ error: "version validation failed", validationErrors: errors });
    }

    const publishedAt = nowIso();
    const snapshot = buildPublishedSnapshot({
      study,
      version: { ...version, published_at: publishedAt },
      formDef,
      rules,
      populations,
    });

    db.prepare(`
      UPDATE facetest_study_versions
      SET status = 'published', published_at = ?, updated_at = ?, published_snapshot_json = ?
      WHERE id = ?
    `).run(publishedAt, publishedAt, JSON.stringify(snapshot), version.id);

    audit(db, "publish-version", "study_version", version.id, { published_at: publishedAt });
    return res.json({ ok: true, version: getVersionById(db, version.id), snapshot });
  });

  app.get("/api/facetest/admin/populations", (req, res) => {
    if (!requireAdmin(req, res)) return;
    const studyId = String(req.query.study_id || "").trim();
    if (!requireString(studyId)) {
      return badRequest(res, "study_id is required");
    }
    return res.json({ ok: true, populations: getPopulationsForStudy(db, studyId) });
  });

  app.post("/api/facetest/admin/populations", (req, res) => {
    if (!requireAdmin(req, res)) return;
    const studyId = String(req.body?.study_id || "").trim();
    const label = String(req.body?.label || "").trim();
    const slug = sanitizeSlug(req.body?.slug || label);
    if (!requireString(studyId) || !requireString(label) || !requireString(slug)) {
      return badRequest(res, "study_id, label, and slug are required");
    }
    if (!getStudyById(db, studyId)) {
      return badRequest(res, "unknown study", 404);
    }

    const id = newId();
    const timestamp = nowIso();
    db.prepare(`
      INSERT INTO facetest_populations (
        id, study_id, slug, label, description, metadata_json, active, created_at, updated_at
      )
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      id,
      studyId,
      slug,
      label,
      String(req.body?.description || ""),
      JSON.stringify(req.body?.metadata || {}),
      req.body?.active === false ? 0 : 1,
      timestamp,
      timestamp,
    );

    audit(db, "create-population", "population", id, { study_id: studyId, slug, label });
    return res.status(201).json({ ok: true, population: getPopulationsForStudy(db, studyId).find((entry) => entry.id === id) });
  });

  app.patch("/api/facetest/admin/populations/:id", (req, res) => {
    if (!requireAdmin(req, res)) return;
    const row = db.prepare("SELECT * FROM facetest_populations WHERE id = ? LIMIT 1").get(req.params.id);
    if (!row) return badRequest(res, "unknown population", 404);
    const slug = requireString(req.body?.slug) ? sanitizeSlug(req.body.slug) : row.slug;
    const label = requireString(req.body?.label) ? String(req.body.label).trim() : row.label;
    const description = req.body?.description === undefined ? row.description : String(req.body.description || "");
    const metadata = req.body?.metadata === undefined ? asJson(row.metadata_json, {}) : req.body.metadata;
    const active = req.body?.active === undefined ? row.active : (req.body.active ? 1 : 0);

    db.prepare(`
      UPDATE facetest_populations
      SET slug = ?, label = ?, description = ?, metadata_json = ?, active = ?, updated_at = ?
      WHERE id = ?
    `).run(slug, label, description, JSON.stringify(metadata || {}), active, nowIso(), row.id);

    audit(db, "update-population", "population", row.id, { slug, label, active });
    return res.json({ ok: true, population: getPopulationsForStudy(db, row.study_id).find((entry) => entry.id === row.id) });
  });

  app.get("/api/facetest/admin/assets", (req, res) => {
    if (!requireAdmin(req, res)) return;
    const studyId = String(req.query.study_id || "").trim();
    if (!requireString(studyId)) {
      return badRequest(res, "study_id is required");
    }
    return res.json({ ok: true, assets: getAssetsForStudy(db, studyId) });
  });

  app.post("/api/facetest/admin/imports/assets", bulkImportUpload.single("archive"), async (req, res) => {
    if (!requireAdmin(req, res)) return;
    const studyId = String(req.body?.study_id || "").trim();
    if (!requireString(studyId)) {
      return badRequest(res, "study_id is required");
    }
    const study = getStudyById(db, studyId);
    if (!study) {
      return badRequest(res, "unknown study", 404);
    }
    if (!req.file?.buffer?.length) {
      return badRequest(res, "zip archive is required in the archive field");
    }

    const populationsBySlug = new Map(getPopulationsForStudy(db, studyId).map((population) => [population.slug, population]));
    const parsed = parseBulkImportArchive(req.file.buffer, populationsBySlug);
    if (parsed.issues.length) {
      return res.status(422).json({
        error: "bulk import validation failed",
        summary: {
          totalRows: parsed.rows.length,
          created: 0,
          skipped: 0,
          failed: parsed.issues.length,
        },
        results: parsed.issues,
        validationErrors: parsed.issues.map((issue) => `row ${issue.rowNumber}: ${issue.message}`),
      });
    }

    const existingAssetKeys = getExistingAssetKeys(db, studyId);
    const rowsToCreate = [];
    const results = [];

    for (const row of parsed.rows) {
      if (existingAssetKeys.has(row.assetKey)) {
        results.push({
          rowNumber: row.rowNumber,
          assetKey: row.assetKey,
          status: "skipped",
          message: "asset_key already exists for this study",
        });
      } else {
        rowsToCreate.push(row);
      }
    }

    const writtenPaths = [];
    try {
      db.exec("BEGIN IMMEDIATE");
      for (const row of rowsToCreate) {
        const assetId = newId();
        const fileBuffer = row.zipEntry.getData();
        const saved = await writeAssetBuffer({
          assetId,
          fileName: row.fileName,
          buffer: fileBuffer,
        });
        writtenPaths.push(saved.absolutePath);
        const timestamp = nowIso();

        db.prepare(`
          INSERT INTO facetest_assets (
            id, study_id, asset_key, population_id, display_label, asset_role, identity_id, trial_set_id, expected_side,
            file_name, mime_type, file_path, public_path, metadata_json, is_available, created_at, updated_at
          )
          VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        `).run(
          assetId,
          studyId,
          row.assetKey,
          row.populationId,
          row.displayLabel,
          row.assetRole,
          row.identityId,
          row.trialSetId,
          row.expectedSide,
          sanitizeFileName(row.fileName),
          inferMimeType(row.fileName),
          saved.absolutePath,
          saved.publicPath,
          JSON.stringify(row.metadata || {}),
          row.isAvailable ? 1 : 0,
          timestamp,
          timestamp,
        );

        results.push({
          rowNumber: row.rowNumber,
          assetKey: row.assetKey,
          status: "created",
          message: "imported",
        });
      }
      db.exec("COMMIT");
    } catch (error) {
      try {
        db.exec("ROLLBACK");
      } catch {}
      await Promise.all(writtenPaths.map((filePath) => deleteAssetFile(filePath)));
      return res.status(500).json({
        error: `bulk import failed: ${error.message}`,
      });
    }

    audit(db, "bulk-import-assets", "study", studyId, {
      file_name: req.file.originalname,
      total_rows: parsed.rows.length,
      created: results.filter((entry) => entry.status === "created").length,
      skipped: results.filter((entry) => entry.status === "skipped").length,
    });

    return res.status(201).json({
      ok: true,
      summary: {
        totalRows: parsed.rows.length,
        created: results.filter((entry) => entry.status === "created").length,
        skipped: results.filter((entry) => entry.status === "skipped").length,
        failed: 0,
      },
      results,
      assets: getAssetsForStudy(db, studyId),
    });
  });

  app.post("/api/facetest/admin/assets", async (req, res) => {
    if (!requireAdmin(req, res)) return;
    const studyId = String(req.body?.study_id || "").trim();
    const fileName = String(req.body?.file_name || "").trim();
    const mimeType = String(req.body?.mime_type || "application/octet-stream").trim();
    const base64Data = String(req.body?.data_base64 || "").trim();
    const assetRole = String(req.body?.asset_role || "").trim();
    const assetKey = sanitizeAssetKey(req.body?.asset_key || newId());
    if (!requireString(studyId) || !requireString(fileName) || !requireString(base64Data) || !ASSET_ROLES.has(assetRole)) {
      return badRequest(res, "study_id, file_name, data_base64, and a supported asset_role are required");
    }
    if (!getStudyById(db, studyId)) {
      return badRequest(res, "unknown study", 404);
    }
    if (req.body?.population_id) {
      const population = db.prepare("SELECT id FROM facetest_populations WHERE id = ? LIMIT 1").get(req.body.population_id);
      if (!population) {
        return badRequest(res, "unknown population", 404);
      }
    }
    if ((assetRole === "study" || assetRole === "memory_old") && !requireString(req.body?.identity_id)) {
      return badRequest(res, "identity_id is required for study and memory_old assets");
    }
    if ((assetRole.endsWith("_target") || assetRole.endsWith("_probe")) && !requireString(req.body?.trial_set_id)) {
      return badRequest(res, "trial_set_id is required for matching assets");
    }
    if (assetRole.endsWith("_probe") && !["left", "right"].includes(req.body?.expected_side)) {
      return badRequest(res, "expected_side must be left or right for matching probes");
    }
    if (getExistingAssetKeys(db, studyId).has(assetKey)) {
      return badRequest(res, `asset_key already exists for this study: ${assetKey}`, 409);
    }

    const assetId = newId();
    const saved = await writeAssetFile({ assetId, fileName, base64Data });
    const timestamp = nowIso();
    db.prepare(`
      INSERT INTO facetest_assets (
        id, study_id, asset_key, population_id, display_label, asset_role, identity_id, trial_set_id, expected_side,
        file_name, mime_type, file_path, public_path, metadata_json, is_available, created_at, updated_at
      )
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      assetId,
      studyId,
      assetKey,
      req.body?.population_id || null,
      String(req.body?.display_label || fileName),
      assetRole,
      req.body?.identity_id || null,
      req.body?.trial_set_id || null,
      req.body?.expected_side || null,
      sanitizeFileName(fileName),
      mimeType,
      saved.absolutePath,
      saved.publicPath,
      JSON.stringify(req.body?.metadata || {}),
      req.body?.is_available === false ? 0 : 1,
      timestamp,
      timestamp,
    );

    audit(db, "upload-asset", "asset", assetId, {
      study_id: studyId,
      asset_key: assetKey,
      asset_role: assetRole,
    });
    return res.status(201).json({ ok: true, asset: getAssetsForStudy(db, studyId).find((entry) => entry.id === assetId) });
  });

  app.patch("/api/facetest/admin/assets/:id", (req, res) => {
    if (!requireAdmin(req, res)) return;
    const row = db.prepare("SELECT * FROM facetest_assets WHERE id = ? LIMIT 1").get(req.params.id);
    if (!row) return badRequest(res, "unknown asset", 404);

    const displayLabel = req.body?.display_label === undefined ? row.display_label : String(req.body.display_label || row.file_name);
    const identityId = req.body?.identity_id === undefined ? row.identity_id : (req.body.identity_id || null);
    const trialSetId = req.body?.trial_set_id === undefined ? row.trial_set_id : (req.body.trial_set_id || null);
    const expectedSide = req.body?.expected_side === undefined ? row.expected_side : (req.body.expected_side || null);
    const metadata = req.body?.metadata === undefined ? asJson(row.metadata_json, {}) : req.body.metadata;
    const isAvailable = req.body?.is_available === undefined ? row.is_available : (req.body.is_available ? 1 : 0);
    const populationId = req.body?.population_id === undefined ? row.population_id : (req.body.population_id || null);

    db.prepare(`
      UPDATE facetest_assets
      SET population_id = ?, display_label = ?, identity_id = ?, trial_set_id = ?, expected_side = ?,
          metadata_json = ?, is_available = ?, updated_at = ?
      WHERE id = ?
    `).run(populationId, displayLabel, identityId, trialSetId, expectedSide, JSON.stringify(metadata || {}), isAvailable, nowIso(), row.id);

    audit(db, "update-asset", "asset", row.id, { is_available: isAvailable });
    return res.json({ ok: true, asset: getAssetsForStudy(db, row.study_id).find((entry) => entry.id === row.id) });
  });

  app.delete("/api/facetest/admin/assets/:id", async (req, res) => {
    if (!requireAdmin(req, res)) return;
    const row = db.prepare("SELECT * FROM facetest_assets WHERE id = ? LIMIT 1").get(req.params.id);
    if (!row) return badRequest(res, "unknown asset", 404);
    db.prepare("DELETE FROM facetest_assets WHERE id = ?").run(row.id);
    await deleteAssetFile(row.file_path);
    audit(db, "delete-asset", "asset", row.id, {});
    return res.status(204).end();
  });

  app.get("/api/facetest/admin/reports/runs", (req, res) => {
    if (!requireAdmin(req, res)) return;
    const studyId = String(req.query.study_id || "").trim();
    const where = [];
    const values = [];
    if (requireString(studyId)) {
      where.push("r.study_id = ?");
      values.push(studyId);
    }
    const sql = `
      SELECT r.*, s.title AS study_title, v.version_number
      FROM facetest_runs r
      JOIN facetest_studies s ON s.id = r.study_id
      JOIN facetest_study_versions v ON v.id = r.study_version_id
      ${where.length ? `WHERE ${where.join(" AND ")}` : ""}
      ORDER BY r.started_at DESC
    `;
    const runs = db.prepare(sql).all(...values).map((row) => ({
      ...row,
      score: asJson(row.score_json, null),
    }));
    return res.json({ ok: true, runs });
  });

  app.get("/api/facetest/admin/reports/runs/:id", (req, res) => {
    if (!requireAdmin(req, res)) return;
    const run = db.prepare(`
      SELECT r.*, s.title AS study_title, v.version_number
      FROM facetest_runs r
      JOIN facetest_studies s ON s.id = r.study_id
      JOIN facetest_study_versions v ON v.id = r.study_version_id
      WHERE r.id = ?
      LIMIT 1
    `).get(req.params.id);
    if (!run) return badRequest(res, "unknown run", 404);

    return res.json({
      ok: true,
      run: {
        ...run,
        score: asJson(run.score_json, null),
        config_snapshot: asJson(run.config_snapshot_json, {}),
        resolved_stimuli: asJson(run.resolved_stimuli_json, {}),
      },
      forms: db.prepare("SELECT * FROM facetest_run_forms WHERE run_id = ? ORDER BY created_at").all(run.id).map((row) => ({
        ...row,
        responses: asJson(row.responses_json, {}),
      })),
      events: db.prepare("SELECT * FROM facetest_run_events WHERE run_id = ? ORDER BY created_at").all(run.id).map((row) => ({
        ...row,
        payload: asJson(row.payload_json, {}),
      })),
      memoryTrials: db.prepare("SELECT * FROM facetest_memory_trials WHERE run_id = ? ORDER BY trial_index").all(run.id),
      matchingTrials: db.prepare("SELECT * FROM facetest_matching_trials WHERE run_id = ? ORDER BY phase, trial_index").all(run.id).map((row) => ({
        ...row,
        details: asJson(row.details_json, []),
      })),
      rawRows: flattenRunRows(
        db.prepare("SELECT * FROM facetest_raw_rows WHERE run_id = ? ORDER BY created_at").all(run.id),
      ),
    });
  });

  app.get("/api/facetest/admin/reports/export/:kind.csv", (req, res) => {
    if (!requireAdmin(req, res)) return;
    const kind = String(req.params.kind || "").trim();
    let rows;
    if (kind === "runs") {
      rows = db.prepare(`
        SELECT r.id, r.study_slug, r.study_version_id, r.browser_id, r.started_at, r.completed_at, r.status,
               r.pii_contact_email, r.score_json, s.title AS study_title, v.version_number
        FROM facetest_runs r
        JOIN facetest_studies s ON s.id = r.study_id
        JOIN facetest_study_versions v ON v.id = r.study_version_id
        ORDER BY r.started_at DESC
      `).all().map((row) => ({ ...row, score_json: row.score_json || "" }));
    } else if (kind === "memory") {
      rows = db.prepare("SELECT * FROM facetest_memory_trials ORDER BY created_at DESC").all();
    } else if (kind === "matching") {
      rows = db.prepare("SELECT * FROM facetest_matching_trials ORDER BY created_at DESC").all();
    } else if (kind === "forms") {
      rows = db.prepare("SELECT * FROM facetest_run_forms ORDER BY created_at DESC").all();
    } else if (kind === "raw") {
      rows = db.prepare("SELECT * FROM facetest_raw_rows ORDER BY created_at DESC").all();
    } else {
      return badRequest(res, "unsupported export kind", 404);
    }

    res.type("text/csv");
    return res.send(buildCsv(rows));
  });
}
