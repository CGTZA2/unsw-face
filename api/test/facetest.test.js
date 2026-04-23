import test from "node:test";
import assert from "node:assert/strict";
import os from "node:os";
import path from "node:path";
import fs from "node:fs/promises";
import { createApp } from "../app.js";

const TINY_PNG_BASE64 =
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+X2z8AAAAASUVORK5CYII=";

async function startServer() {
  const dbPath = path.join(os.tmpdir(), `unsw-face-${Date.now()}-${Math.random()}.sqlite`);
  const assetDir = path.join(os.tmpdir(), `unsw-face-assets-${Date.now()}-${Math.random()}`);
  const previousPepper = process.env.FACETEST_PEPPER;
  const previousAssetDir = process.env.FACETEST_ASSET_DIR;
  process.env.FACETEST_PEPPER = `test-pepper-${Date.now()}-${Math.random()}`;
  process.env.FACETEST_ASSET_DIR = assetDir;

  const app = await createApp({ dbPath });
  const server = await new Promise((resolve) => {
    const instance = app.listen(0, () => resolve(instance));
  });
  const address = server.address();
  const base = `http://127.0.0.1:${address.port}`;

  return {
    app,
    base,
    assetDir,
    async close() {
      await new Promise((resolve, reject) => server.close((error) => (error ? reject(error) : resolve())));
      await fs.rm(dbPath, { force: true });
      await fs.rm(assetDir, { recursive: true, force: true });
      if (previousPepper === undefined) delete process.env.FACETEST_PEPPER;
      else process.env.FACETEST_PEPPER = previousPepper;
      if (previousAssetDir === undefined) delete process.env.FACETEST_ASSET_DIR;
      else process.env.FACETEST_ASSET_DIR = previousAssetDir;
    },
  };
}

async function api(server, pathname, { method = "GET", body, headers = {} } = {}) {
  const response = await fetch(`${server.base}${pathname}`, {
    method,
    headers: {
      ...(body ? { "Content-Type": "application/json" } : {}),
      ...headers,
    },
    body: body ? JSON.stringify(body) : undefined,
  });
  const text = await response.text();
  let json = null;
  try {
    json = text ? JSON.parse(text) : null;
  } catch {}
  return { response, json, text };
}

async function createStudy(server, title = "Face Test Study") {
  const result = await api(server, "/api/facetest/admin/studies", {
    method: "POST",
    body: {
      title,
      slug: title.toLowerCase().replace(/\s+/g, "-"),
      notes: "Research notes",
    },
  });
  assert.equal(result.response.status, 201);
  return result.json.study;
}

async function createVersion(server, studyId, sourceVersionId = null) {
  const result = await api(server, `/api/facetest/admin/studies/${studyId}/versions`, {
    method: "POST",
    body: sourceVersionId
      ? {
          source_version_id: sourceVersionId,
          parent_version_id: sourceVersionId,
        }
      : {},
  });
  assert.equal(result.response.status, 201);
  return result.json.version;
}

async function createPopulation(server, studyId, label, slug) {
  const result = await api(server, "/api/facetest/admin/populations", {
    method: "POST",
    body: {
      study_id: studyId,
      label,
      slug,
      description: `${label} description`,
    },
  });
  assert.equal(result.response.status, 201);
  return result.json.population;
}

async function uploadAsset(server, studyId, populationId, overrides) {
  const result = await api(server, "/api/facetest/admin/assets", {
    method: "POST",
    body: {
      study_id: studyId,
      population_id: populationId,
      file_name: `${overrides.display_label || overrides.asset_role}.png`,
      mime_type: "image/png",
      data_base64: TINY_PNG_BASE64,
      display_label: overrides.display_label,
      asset_role: overrides.asset_role,
      identity_id: overrides.identity_id || null,
      trial_set_id: overrides.trial_set_id || null,
      expected_side: overrides.expected_side || null,
      metadata: overrides.metadata || {},
    },
  });
  assert.equal(result.response.status, 201);
  return result.json.asset;
}

async function saveForms(server, versionId) {
  const result = await api(server, `/api/facetest/admin/versions/${versionId}/forms`, {
    method: "PUT",
    body: {
      pages: {
        consent: ["<p>Consent</p>"],
        disclaimer: ["<p>Disclaimer</p>"],
        studyInstructions: ["<p>Study instructions</p>"],
        memoryInstructions: ["<p>Memory instructions</p>"],
        matchingInstructions: ["<p>Matching instructions</p>"],
        practiceComplete: ["<p>Practice complete</p>"],
        finalNote: ["<p>Final note</p>"],
        resultsDisclosure: ["<p>Results disclosure</p>"],
      },
      demographicsSchema: [
        { key: "ageBracket", label: "Age bracket", type: "select", required: true, options: ["18-24", "25-34"] },
      ],
      contactSchema: [
        { key: "email", label: "Email", type: "email", required: false },
      ],
      settings: {
        viewingTimeMs: 10,
        benchmarks: {
          top5: 72,
          top10: 69,
          top25: 65,
          top50: 61,
        },
      },
    },
  });
  assert.equal(result.response.status, 200);
}

async function saveRules(server, versionId, rules) {
  const result = await api(server, `/api/facetest/admin/versions/${versionId}/selection-rules`, {
    method: "PUT",
    body: { rules },
  });
  assert.equal(result.response.status, 200);
}

async function publishVersion(server, versionId) {
  const result = await api(server, `/api/facetest/admin/versions/${versionId}/publish`, {
    method: "POST",
    body: {},
  });
  assert.equal(result.response.status, 200);
  return result.json.version;
}

async function createPublishedStudy(server) {
  const study = await createStudy(server, "Population Comparison");
  const version = await createVersion(server, study.id);
  const popA = await createPopulation(server, study.id, "Population A", "population-a");
  const popB = await createPopulation(server, study.id, "Population B", "population-b");

  await saveForms(server, version.id);

  await uploadAsset(server, study.id, popA.id, {
    display_label: "Study A",
    asset_role: "study",
    identity_id: "identity-a",
  });
  await uploadAsset(server, study.id, popA.id, {
    display_label: "Memory Old A",
    asset_role: "memory_old",
    identity_id: "identity-a",
  });
  await uploadAsset(server, study.id, popB.id, {
    display_label: "Study B",
    asset_role: "study",
    identity_id: "identity-b",
  });
  await uploadAsset(server, study.id, popB.id, {
    display_label: "Memory Old B",
    asset_role: "memory_old",
    identity_id: "identity-b",
  });
  await uploadAsset(server, study.id, popA.id, {
    display_label: "Memory New A",
    asset_role: "memory_new",
    identity_id: "identity-new-a",
  });
  await uploadAsset(server, study.id, popB.id, {
    display_label: "Memory New B",
    asset_role: "memory_new",
    identity_id: "identity-new-b",
  });

  await uploadAsset(server, study.id, popA.id, {
    display_label: "Practice Target",
    asset_role: "practice_target",
    trial_set_id: "practice-1",
  });
  await uploadAsset(server, study.id, popA.id, {
    display_label: "Practice Probe 1",
    asset_role: "practice_probe",
    trial_set_id: "practice-1",
    expected_side: "right",
  });
  await uploadAsset(server, study.id, popA.id, {
    display_label: "Practice Probe 2",
    asset_role: "practice_probe",
    trial_set_id: "practice-1",
    expected_side: "left",
  });
  await uploadAsset(server, study.id, popA.id, {
    display_label: "Practice Probe 3",
    asset_role: "practice_probe",
    trial_set_id: "practice-1",
    expected_side: "right",
  });
  await uploadAsset(server, study.id, popA.id, {
    display_label: "Practice Probe 4",
    asset_role: "practice_probe",
    trial_set_id: "practice-1",
    expected_side: "left",
  });

  await uploadAsset(server, study.id, popB.id, {
    display_label: "Matching Target",
    asset_role: "matching_target",
    trial_set_id: "matching-1",
  });
  await uploadAsset(server, study.id, popB.id, {
    display_label: "Matching Probe 1",
    asset_role: "matching_probe",
    trial_set_id: "matching-1",
    expected_side: "left",
  });
  await uploadAsset(server, study.id, popB.id, {
    display_label: "Matching Probe 2",
    asset_role: "matching_probe",
    trial_set_id: "matching-1",
    expected_side: "right",
  });
  await uploadAsset(server, study.id, popB.id, {
    display_label: "Matching Probe 3",
    asset_role: "matching_probe",
    trial_set_id: "matching-1",
    expected_side: "left",
  });
  await uploadAsset(server, study.id, popB.id, {
    display_label: "Matching Probe 4",
    asset_role: "matching_probe",
    trial_set_id: "matching-1",
    expected_side: "right",
  });

  await saveRules(server, version.id, [
    { phase: "study", population_id: popA.id, count: 1, filters: {} },
    { phase: "study", population_id: popB.id, count: 1, filters: {} },
    { phase: "memory_old", population_id: null, count: 2, filters: {} },
    { phase: "memory_new", population_id: null, count: 2, filters: {} },
    { phase: "practice_matching", population_id: popA.id, count: 1, filters: {} },
    { phase: "matching", population_id: popB.id, count: 1, filters: {} },
  ]);

  await publishVersion(server, version.id);
  return { study, version };
}

test("published face-test study can start runs, record data, and export reports", async () => {
  const server = await startServer();
  try {
    const { study } = await createPublishedStudy(server);

    let result = await api(server, "/api/facetest/public/studies");
    assert.equal(result.response.status, 200);
    assert.equal(result.json.studies.length, 1);
    assert.equal(result.json.studies[0].slug, study.slug);

    result = await api(server, "/api/facetest/runs/start", {
      method: "POST",
      body: {
        study_slug: study.slug,
        browser_id: "browser-public-1",
      },
    });
    assert.equal(result.response.status, 201);
    const run = result.json;
    assert.ok(run.runId);
    assert.equal(run.resolvedStimuli.studyFaces.length, 2);
    assert.equal(run.resolvedStimuli.memoryTrials.length, 4);
    assert.equal(run.resolvedStimuli.practiceTrials.length, 1);
    assert.equal(run.resolvedStimuli.matchingTrials.length, 1);

    result = await api(server, `/api/facetest/runs/${run.runId}/forms`, {
      method: "POST",
      body: {
        section: "demographics",
        responses: { ageBracket: "25-34" },
      },
    });
    assert.equal(result.response.status, 201);

    result = await api(server, `/api/facetest/runs/${run.runId}/forms`, {
      method: "POST",
      body: {
        section: "contact",
        responses: { email: "person@example.com" },
      },
    });
    assert.equal(result.response.status, 201);

    result = await api(server, `/api/facetest/runs/${run.runId}/events`, {
      method: "POST",
      body: {
        phase: "study",
        event_type: "study-exposure",
        event_index: 1,
        payload: { assetId: run.resolvedStimuli.studyFaces[0].assetId },
      },
    });
    assert.equal(result.response.status, 201);

    for (let index = 0; index < run.resolvedStimuli.memoryTrials.length; index += 1) {
      const trial = run.resolvedStimuli.memoryTrials[index];
      result = await api(server, `/api/facetest/runs/${run.runId}/memory-trials`, {
        method: "POST",
        body: {
          trial_index: index + 1,
          asset_id: trial.assetId,
          stimulus_url: trial.url,
          trial_type: trial.trialType,
          response: trial.trialType === "OLD" ? "Y" : "N",
          rt_ms: 123,
          correct: true,
          points: 1,
        },
      });
      assert.equal(result.response.status, 201);
    }

    for (const [index, trial] of run.resolvedStimuli.practiceTrials.entries()) {
      result = await api(server, `/api/facetest/runs/${run.runId}/matching-trials`, {
        method: "POST",
        body: {
          phase: "practice_matching",
          trial_index: index + 1,
          trial_identifier: trial.id,
          target_asset_id: trial.target.assetId,
          target_url: trial.target.url,
          details: trial.stimuli.map((stimulus, stimulusIndex) => ({
            assetId: stimulus.assetId,
            path: stimulus.url,
            expected: trial.answers[stimulusIndex],
            assigned: trial.answers[stimulusIndex],
            correct: true,
          })),
          points: 4,
        },
      });
      assert.equal(result.response.status, 201);
    }

    for (const [index, trial] of run.resolvedStimuli.matchingTrials.entries()) {
      result = await api(server, `/api/facetest/runs/${run.runId}/matching-trials`, {
        method: "POST",
        body: {
          phase: "matching",
          trial_index: index + 1,
          trial_identifier: trial.id,
          target_asset_id: trial.target.assetId,
          target_url: trial.target.url,
          details: trial.stimuli.map((stimulus, stimulusIndex) => ({
            assetId: stimulus.assetId,
            path: stimulus.url,
            expected: trial.answers[stimulusIndex],
            assigned: trial.answers[stimulusIndex],
            correct: true,
          })),
          points: 4,
        },
      });
      assert.equal(result.response.status, 201);
    }

    result = await api(server, `/api/facetest/runs/${run.runId}/complete`, {
      method: "POST",
      body: {
        memoryPoints: 4,
        matchPoints: 4,
        overallPercent: 7,
      },
    });
    assert.equal(result.response.status, 201);

    result = await api(server, `/api/facetest/admin/reports/runs?study_id=${encodeURIComponent(study.id)}`);
    assert.equal(result.response.status, 200);
    assert.equal(result.json.runs.length, 1);
    assert.equal(result.json.runs[0].pii_contact_email, "person@example.com");

    result = await api(server, `/api/facetest/admin/reports/runs/${run.runId}`);
    assert.equal(result.response.status, 200);
    assert.equal(result.json.forms.length, 2);
    assert.equal(result.json.memoryTrials.length, 4);
    assert.equal(result.json.matchingTrials.length, 2);
    assert.ok(result.json.rawRows.length >= 6);

    result = await api(server, "/api/facetest/admin/reports/export/raw.csv");
    assert.equal(result.response.status, 200);
    assert.match(result.text, /run-complete/);

    const counts = {
      runs: server.app.locals.db.prepare("SELECT COUNT(*) AS count FROM facetest_runs").get().count,
      forms: server.app.locals.db.prepare("SELECT COUNT(*) AS count FROM facetest_run_forms").get().count,
      memory: server.app.locals.db.prepare("SELECT COUNT(*) AS count FROM facetest_memory_trials").get().count,
      matching: server.app.locals.db.prepare("SELECT COUNT(*) AS count FROM facetest_matching_trials").get().count,
    };
    assert.equal(counts.runs, 1);
    assert.equal(counts.forms, 2);
    assert.equal(counts.memory, 4);
    assert.equal(counts.matching, 2);
  } finally {
    await server.close();
  }
});

test("published versions are immutable and cloning creates a new draft", async () => {
  const server = await startServer();
  try {
    const { study, version } = await createPublishedStudy(server);

    let result = await api(server, `/api/facetest/admin/versions/${version.id}/forms`, {
      method: "PUT",
      body: {
        pages: { consent: ["<p>Changed</p>"] },
        demographicsSchema: [],
        contactSchema: [],
        settings: {},
      },
    });
    assert.equal(result.response.status, 409);

    result = await api(server, `/api/facetest/admin/studies/${study.id}/versions`, {
      method: "POST",
      body: {
        source_version_id: version.id,
        parent_version_id: version.id,
      },
    });
    assert.equal(result.response.status, 201);
    assert.equal(result.json.version.status, "draft");

    result = await api(server, `/api/facetest/admin/versions/${result.json.version.id}`);
    assert.equal(result.response.status, 200);
    assert.equal(result.json.rules.length, 6);
    assert.equal(result.json.formDef.pages.consent.length, 1);
  } finally {
    await server.close();
  }
});

test("publish rejects incomplete study versions", async () => {
  const server = await startServer();
  try {
    const study = await createStudy(server, "Incomplete Study");
    const version = await createVersion(server, study.id);

    const result = await api(server, `/api/facetest/admin/versions/${version.id}/publish`, {
      method: "POST",
      body: {},
    });
    assert.equal(result.response.status, 409);
    assert.match(result.json.validationErrors.join("\n"), /forms\/settings are required|consent pages are required/);
  } finally {
    await server.close();
  }
});
