const app = document.getElementById("app");
const API_BASE = resolveApiBase();
const BROWSER_ID_KEY = "facetest-browser-id";

const state = {
  browserId: getOrCreateBrowserId(),
  studies: [],
  runId: null,
  study: null,
  version: null,
  pages: {},
  demographicsSchema: [],
  contactSchema: [],
  settings: {},
  resolvedStimuli: null,
  demographics: {},
  contact: {},
  memoryResults: [],
  matchingResults: [],
};

main().catch(renderFatalError);

async function main() {
  state.studies = await fetchJson(`${API_BASE}/public/studies`).then((body) => body.studies || []);
  if (!state.studies.length) {
    renderUnavailable();
    return;
  }

  const selectedStudy = await showLanding();
  const run = await startRun(selectedStudy.slug);

  state.runId = run.runId;
  state.study = run.study;
  state.version = run.version;
  state.pages = run.pages || {};
  state.demographicsSchema = run.demographicsSchema || [];
  state.contactSchema = run.contactSchema || [];
  state.settings = run.settings || {};
  state.resolvedStimuli = run.resolvedStimuli;

  await showConsent();
  await maybeShowPages("Disclaimer", state.pages.disclaimer, "Continue", "disclaimer");
  await maybeShowPages("Part 1", state.pages.studyInstructions, "Begin Memory Learning", "study-instructions");
  await requestFullscreenSafe();
  await runStudyPhase();
  await maybeShowPages("Part 2", state.pages.memoryInstructions, "Begin Memory Test", "memory-instructions");
  await runMemoryPhase();
  await maybeShowPages("Part 3", state.pages.matchingInstructions, "Begin Practice", "matching-instructions");
  await runMatchingBlock(state.resolvedStimuli.practiceTrials || [], true);
  await maybeShowPages("Practice Complete", state.pages.practiceComplete, "Begin Real Trials", "practice-complete");
  await runMatchingBlock(state.resolvedStimuli.matchingTrials || [], false);
  await collectContact();
  await maybeShowPages("Final Note", state.pages.finalNote, "See Results", "final-note");
  await completeRun();
  renderResults();
}

async function fetchJson(url, options = {}) {
  const response = await fetch(url, {
    ...options,
    headers: {
      "Content-Type": "application/json",
      ...(options.headers || {}),
    },
  });

  if (!response.ok) {
    let errorText = `${response.status} ${response.statusText}`;
    try {
      const payload = await response.json();
      errorText = payload.error || payload.validationErrors?.join("\n") || errorText;
    } catch {}
    throw new Error(errorText);
  }

  if (response.status === 204) {
    return {};
  }

  return response.json();
}

function getOrCreateBrowserId() {
  const existing = localStorage.getItem(BROWSER_ID_KEY);
  if (existing) return existing;
  const created = (crypto?.randomUUID?.() || `${Date.now()}-${Math.random()}`).toString();
  localStorage.setItem(BROWSER_ID_KEY, created);
  return created;
}

function resolveApiBase() {
  const configured = document.querySelector('meta[name="facetest-api-base"]')?.content;
  if (configured) {
    return configured.replace(/\/+$/, "");
  }
  const here = new URL(window.location.href);
  const isNestedSubdir = /\/facetest-clone\/(?:index\.html)?$/i.test(here.pathname);
  return isNestedSubdir
    ? new URL("../api/facetest", here).pathname.replace(/\/+$/, "")
    : new URL("api/facetest", here).pathname.replace(/\/+$/, "");
}

function renderBaseScreen({ step, title, subtitle = "", sideHtml = "", bodyHtml = "", actions = [] }) {
  const actionMarkup = actions
    .map(
      (action) =>
        `<button id="${action.id}" class="button ${action.className || "button-primary"}" ${action.disabled ? "disabled" : ""}>${action.label}</button>`,
    )
    .join("");

  app.innerHTML = `
    <section class="screen">
      <div class="screen-grid">
        <aside class="panel side-panel">
          <p class="step-label">${step}</p>
          ${sideHtml}
        </aside>
        <section class="panel content-panel">
          <h2 class="screen-title">${title}</h2>
          ${subtitle ? `<p class="screen-subtitle">${subtitle}</p>` : ""}
          <div class="body-stack">${bodyHtml}</div>
          <div class="actions">${actionMarkup}</div>
        </section>
      </div>
    </section>
  `;
}

function sessionInfoHtml(extraHtml = "") {
  return `
    <div class="body-stack">
      <div class="mini-panel">
        <strong>Study</strong>
        <p class="panel-copy">${escapeHtml(state.study?.title || "Not started")}</p>
      </div>
      <div class="mini-panel">
        <strong>Run</strong>
        <p class="panel-copy">${state.runId ? escapeHtml(state.runId) : "Pending"}</p>
      </div>
      <div class="mini-panel">
        <strong>Browser</strong>
        <p class="panel-copy">${escapeHtml(state.browserId)}</p>
      </div>
      ${extraHtml}
    </div>
  `;
}

function renderUnavailable() {
  app.innerHTML = `
    <section class="screen">
      <article class="panel hero">
        <div class="hero-copy">
          <p class="eyebrow">Face Test</p>
          <h2>No Published Study Available</h2>
          <p>
            The participant app is now server-backed. A researcher needs to create and publish a
            study version in the admin area before the test can start.
          </p>
          <div class="hero-actions">
            <a class="button button-primary" href="./admin.html">Open Admin</a>
          </div>
        </div>
      </article>
    </section>
  `;
}

function showLanding() {
  return new Promise((resolve) => {
    app.innerHTML = `
      <section class="screen">
        <article class="panel hero">
          <div class="hero-copy">
            <p class="eyebrow">Server-Backed Study</p>
            <h2>Face Test Participant Portal</h2>
            <p>
              This version loads a published study configuration from the server, records all run
              data centrally, and uses a frozen random stimulus draw for each participant.
            </p>
            <div class="field field-full">
              <label for="study-select">Select Study</label>
              <select id="study-select">
                ${state.studies
                  .map(
                    (study) =>
                      `<option value="${study.slug}">${escapeHtml(study.title)} (v${study.publishedVersion.versionNumber})</option>`,
                  )
                  .join("")}
              </select>
            </div>
            <div class="hero-actions">
              <button id="start-run" class="button button-primary">Start Test</button>
              <a class="button button-secondary" href="./admin.html">Admin</a>
            </div>
          </div>
          <div class="hero-aside">
            <div class="notice-card">
              <strong>Anonymous Access</strong>
              <p class="panel-copy">
                This study is configured for anonymous participant access. Your browser receives a
                generated run ID after the server resolves the stimulus set.
              </p>
            </div>
            <div class="notice-card">
              <strong>Server Recording</strong>
              <p class="panel-copy">
                Consent, forms, events, trials, and final scores are all stored on the server for
                researcher reporting and export.
              </p>
            </div>
          </div>
        </article>
      </section>
    `;

    document.getElementById("start-run").addEventListener("click", () => {
      const slug = document.getElementById("study-select").value;
      resolve(state.studies.find((study) => study.slug === slug) || state.studies[0]);
    });
  });
}

async function startRun(studySlug) {
  return fetchJson(`${API_BASE}/runs/start`, {
    method: "POST",
    body: JSON.stringify({
      study_slug: studySlug,
      browser_id: state.browserId,
    }),
  });
}

async function showConsent() {
  const pages = normalizePages(state.pages.consent, [
    "<p><strong>Consent</strong></p><p>By continuing, you consent to take part in this face-test study.</p>",
  ]);

  for (let index = 0; index < pages.length; index += 1) {
    renderBaseScreen({
      step: "Consent",
      title: "Participant Consent",
      subtitle: `Page ${index + 1} of ${pages.length}`,
      sideHtml: sessionInfoHtml(),
      bodyHtml: `
        <div class="copy-box">${pages[index]}</div>
        ${
          index === pages.length - 1
            ? `<label class="check-row"><input id="consent-checkbox" type="checkbox"><span>I have read the consent information and agree to continue.</span></label>`
            : ""
        }
      `,
      actions: [
        {
          id: "consent-next",
          label: index === pages.length - 1 ? "Continue" : "Next",
          className: "button-primary",
          disabled: index === pages.length - 1,
        },
      ],
    });

    await postEvent("instruction-page-view", "consent", {
      pageIndex: index + 1,
      totalPages: pages.length,
    });

    if (index === pages.length - 1) {
      const checkbox = document.getElementById("consent-checkbox");
      const button = document.getElementById("consent-next");
      checkbox.addEventListener("change", () => {
        button.disabled = !checkbox.checked;
      });
      await waitForClick(button);
    } else {
      await waitForClick(document.getElementById("consent-next"));
    }
  }

  await submitFormSection("consent", {
    agreed: true,
    agreed_at: new Date().toISOString(),
  });
}

async function maybeShowPages(step, pages, finalLabel, phaseKey) {
  const normalized = normalizePages(pages);
  if (!normalized.length) {
    return;
  }
  for (let index = 0; index < normalized.length; index += 1) {
    renderBaseScreen({
      step,
      title: "Instructions",
      subtitle: `Page ${index + 1} of ${normalized.length}`,
      sideHtml: sessionInfoHtml(),
      bodyHtml: `<div class="copy-box">${normalized[index]}</div>`,
      actions: [
        {
          id: "next-page",
          label: index === normalized.length - 1 ? finalLabel : "Next",
          className: index === normalized.length - 1 ? "button-primary" : "button-secondary",
        },
      ],
    });

    await postEvent("instruction-page-view", phaseKey, {
      pageIndex: index + 1,
      totalPages: normalized.length,
    });
    await waitForClick(document.getElementById("next-page"));
  }
}

async function collectDemographics() {
  const values = await renderDynamicFormScreen({
    step: "Demographics",
    title: "Participant Questions",
    subtitle: "These questions are configured by the published study version.",
    fields: state.demographicsSchema,
    initialValues: state.demographics,
    submitLabel: "Continue",
  });
  state.demographics = values;
  await submitFormSection("demographics", values);
}

async function collectContact() {
  const schema = state.contactSchema.length
    ? state.contactSchema
    : [
        {
          key: "email",
          label: "Email Address",
          type: "email",
          required: false,
          help: "Optional. If provided, it is stored separately for researcher contact workflows.",
        },
      ];
  const values = await renderDynamicFormScreen({
    step: "Contact",
    title: "Optional Contact Details",
    subtitle: "The study can store optional contact information separately from the main run data.",
    fields: schema,
    initialValues: state.contact,
    submitLabel: "Continue To Results",
  });
  state.contact = values;
  await submitFormSection("contact", values);
}

function renderDynamicFormScreen({ step, title, subtitle, fields, initialValues, submitLabel }) {
  return new Promise((resolve) => {
    renderBaseScreen({
      step,
      title,
      subtitle,
      sideHtml: sessionInfoHtml(),
      bodyHtml: `
        <form id="dynamic-form" class="fields">
          ${fields.map((field) => renderField(field, initialValues[field.key] ?? "")).join("")}
        </form>
      `,
      actions: [{ id: "form-submit", label: submitLabel, className: "button-primary" }],
    });

    const form = document.getElementById("dynamic-form");
    document.getElementById("form-submit").addEventListener("click", () => {
      if (!form.reportValidity()) {
        return;
      }
      const values = {};
      for (const field of fields) {
        const element = form.querySelector(`[name="${field.key}"]`);
        if (!element) continue;
        if (field.type === "checkbox") {
          values[field.key] = Boolean(element.checked);
        } else {
          values[field.key] = element.value;
        }
      }
      resolve(values);
    });
  });
}

function renderField(field, value) {
  const type = field.type || "text";
  const required = field.required ? "required" : "";
  const placeholder = field.placeholder ? `placeholder="${escapeAttribute(field.placeholder)}"` : "";
  const help = field.help ? `<p class="field-help">${escapeHtml(field.help)}</p>` : "";
  const label = escapeHtml(field.label || field.key);
  const key = escapeAttribute(field.key);

  if (type === "textarea") {
    return `
      <div class="field field-full">
        <label for="${key}">${label}</label>
        <textarea id="${key}" name="${key}" rows="4" ${required} ${placeholder}>${escapeHtml(value)}</textarea>
        ${help}
      </div>
    `;
  }

  if (type === "select") {
    const options = normalizeOptions(field.options || []);
    return `
      <div class="field">
        <label for="${key}">${label}</label>
        <select id="${key}" name="${key}" ${required}>
          <option value="">Select an option</option>
          ${options
            .map(
              (option) =>
                `<option value="${escapeAttribute(option.value)}" ${String(value) === option.value ? "selected" : ""}>${escapeHtml(option.label)}</option>`,
            )
            .join("")}
        </select>
        ${help}
      </div>
    `;
  }

  if (type === "checkbox") {
    return `
      <div class="field field-full">
        <label class="check-row">
          <input id="${key}" name="${key}" type="checkbox" ${value ? "checked" : ""}>
          <span>${label}</span>
        </label>
        ${help}
      </div>
    `;
  }

  return `
    <div class="field">
      <label for="${key}">${label}</label>
      <input id="${key}" name="${key}" type="${escapeAttribute(type)}" value="${escapeAttribute(value)}" ${required} ${placeholder}>
      ${help}
    </div>
  `;
}

function normalizeOptions(options) {
  return options.map((option) =>
    typeof option === "string"
      ? { value: option, label: option }
      : { value: String(option.value), label: option.label ?? String(option.value) },
  );
}

function normalizePages(pages, fallback = []) {
  if (Array.isArray(pages) && pages.length) {
    return pages;
  }
  if (typeof pages === "string" && pages.trim()) {
    return [pages];
  }
  return fallback;
}

async function runStudyPhase() {
  await collectDemographics();
  const studyFaces = state.resolvedStimuli.studyFaces || [];
  const viewingTimeMs = Number(state.settings.viewingTimeMs || 5000);

  for (let index = 0; index < studyFaces.length; index += 1) {
    const face = studyFaces[index];
    app.innerHTML = `
      <section class="screen">
        <article class="panel trial-shell">
          <div class="trial-header">
            <div>
              <p class="step-label">Part 1 Of 3</p>
              <h2 class="panel-title">Remember This Person</h2>
            </div>
            <div class="pill-row">
              <span class="pill-neutral">Study Face ${index + 1} of ${studyFaces.length}</span>
              <span class="pill-neutral">${Math.round(viewingTimeMs / 1000)} seconds</span>
            </div>
          </div>
          <div class="progress-bar"><span id="study-progress"></span></div>
          <div class="stimulus-frame">
            <img src="${face.url}" alt="Study face ${index + 1}">
          </div>
          <p class="trial-note">Faces advance automatically during the learning phase.</p>
        </article>
      </section>
    `;

    await postEvent("study-exposure", "study", {
      trialIndex: index + 1,
      assetId: face.assetId,
      stimulusUrl: face.url,
      viewedMs: viewingTimeMs,
    }, index + 1);
    await animateProgress(document.getElementById("study-progress"), viewingTimeMs);
  }
}

async function runMemoryPhase() {
  const trials = state.resolvedStimuli.memoryTrials || [];
  for (let index = 0; index < trials.length; index += 1) {
    const trial = trials[index];
    const result = await showMemoryTrial(trial, index + 1, trials.length);
    state.memoryResults.push(result);
    await fetchJson(`${API_BASE}/runs/${state.runId}/memory-trials`, {
      method: "POST",
      body: JSON.stringify({
        trial_index: index + 1,
        asset_id: trial.assetId || null,
        stimulus_url: trial.url,
        trial_type: trial.trialType,
        response: result.response,
        rt_ms: result.rtMs,
        correct: result.correct,
        points: result.points,
      }),
    });
  }
}

function showMemoryTrial(trial, trialNumber, totalTrials) {
  return new Promise((resolve) => {
    app.innerHTML = `
      <section class="screen">
        <article class="panel trial-shell">
          <div class="trial-header">
            <div>
              <p class="step-label">Part 2 Of 3</p>
              <h2 class="panel-title">Did You Study This Person?</h2>
            </div>
            <div class="pill-row">
              <span class="pill-neutral">Memory Trial ${trialNumber} of ${totalTrials}</span>
              <span class="pill-neutral">Keys: Y / N</span>
            </div>
          </div>
          <div class="stimulus-frame">
            <img src="${trial.url}" alt="Memory trial face ${trialNumber}">
          </div>
          <div class="response-grid">
            <button id="memory-yes" class="button button-primary response-button">
              <strong>Y For Yes</strong>
              This person was shown during the learning phase.
            </button>
            <button id="memory-no" class="button button-secondary response-button">
              <strong>N For No</strong>
              This person was not shown during the learning phase.
            </button>
          </div>
        </article>
      </section>
    `;

    const started = performance.now();
    const finish = (response) => {
      window.removeEventListener("keydown", handleKeydown);
      const rtMs = Math.round(performance.now() - started);
      const correct =
        (trial.trialType === "OLD" && response === "Y") ||
        (trial.trialType === "NEW" && response === "N");
      resolve({
        response,
        rtMs,
        correct,
        points: correct ? 1 : 0,
      });
    };

    const handleKeydown = (event) => {
      const key = event.key.toLowerCase();
      if (key === "y") finish("Y");
      if (key === "n") finish("N");
    };

    document.getElementById("memory-yes").addEventListener("click", () => finish("Y"), { once: true });
    document.getElementById("memory-no").addEventListener("click", () => finish("N"), { once: true });
    window.addEventListener("keydown", handleKeydown);
  });
}

async function runMatchingBlock(trials, isPractice) {
  for (let index = 0; index < trials.length; index += 1) {
    const trial = trials[index];
    await showMatchingPreview(trial, index + 1, trials.length, isPractice);
    const result = await showMatchingSorter(trial, index + 1, trials.length, isPractice);
    state.matchingResults.push(result);
    await fetchJson(`${API_BASE}/runs/${state.runId}/matching-trials`, {
      method: "POST",
      body: JSON.stringify({
        phase: isPractice ? "practice_matching" : "matching",
        trial_index: index + 1,
        trial_identifier: trial.id,
        target_asset_id: trial.target.assetId || null,
        target_url: trial.target.url,
        details: result.details,
        points: result.points,
      }),
    });
  }
}

async function showMatchingPreview(trial, trialNumber, totalTrials, isPractice) {
  const viewingTimeMs = Number(state.settings.viewingTimeMs || 5000);
  app.innerHTML = `
    <section class="screen">
      <article class="panel trial-shell">
        <div class="trial-header">
          <div>
            <p class="step-label">${isPractice ? "Practice Preview" : "Part 3 Of 3"}</p>
            <h2 class="panel-title">Target Face</h2>
          </div>
          <div class="pill-row">
            <span class="pill-neutral">${isPractice ? "Practice" : "Scored"} Trial ${trialNumber} of ${totalTrials}</span>
            <span class="pill-neutral">${Math.round(viewingTimeMs / 1000)} seconds</span>
          </div>
        </div>
        <div class="progress-bar"><span id="preview-progress"></span></div>
        <div class="stimulus-frame">
          <img src="${trial.target.url}" alt="Target face for trial ${trialNumber}">
        </div>
        <p class="trial-note">Memorise the target. The target disappears before the classification step.</p>
      </article>
    </section>
  `;

  await postEvent("matching-preview", isPractice ? "practice_matching" : "matching", {
    trialIndex: trialNumber,
    trialId: trial.id,
    targetAssetId: trial.target.assetId || null,
    targetUrl: trial.target.url,
  }, trialNumber);
  await animateProgress(document.getElementById("preview-progress"), viewingTimeMs);
}

function showMatchingSorter(trial, trialNumber, totalTrials, isPractice) {
  return new Promise((resolve) => {
    app.innerHTML = `
      <section class="screen">
        <article class="panel trial-shell">
          <div class="trial-header">
            <div>
              <p class="step-label">${isPractice ? "Practice Sort" : "Part 3 Of 3"}</p>
              <h2 class="panel-title">Classify The Four Faces</h2>
            </div>
            <div class="pill-row">
              <span class="pill-neutral">${isPractice ? "Practice" : "Scored"} Trial ${trialNumber} of ${totalTrials}</span>
            </div>
          </div>
          <div class="sort-layout">
            <section class="zone" data-zone="left">
              <div class="zone-header"><h3>Nonmatch Left</h3><span class="zone-count" id="count-left">0</span></div>
              <div class="cards" id="zone-left"></div>
            </section>
            <section class="zone" data-zone="center">
              <div class="zone-header"><h3>Waiting Area</h3><span class="zone-count" id="count-center">${trial.stimuli.length}</span></div>
              <div class="cards" id="zone-center"></div>
            </section>
            <section class="zone" data-zone="right">
              <div class="zone-header"><h3>Matching Right</h3><span class="zone-count" id="count-right">0</span></div>
              <div class="cards" id="zone-right"></div>
            </section>
          </div>
          <div class="inline-actions">
            <button id="submit-sort" class="button button-warning" disabled>Submit Classifications</button>
            <button id="reset-sort" class="button button-quiet">Reset Trial</button>
          </div>
        </article>
      </section>
    `;

    const assignments = Object.fromEntries(trial.stimuli.map((stimulus) => [stimulus.assetId || stimulus.url, "center"]));
    const containers = {
      left: document.getElementById("zone-left"),
      center: document.getElementById("zone-center"),
      right: document.getElementById("zone-right"),
    };
    const countNodes = {
      left: document.getElementById("count-left"),
      center: document.getElementById("count-center"),
      right: document.getElementById("count-right"),
    };
    const cards = new Map();
    const keyFor = (stimulus) => stimulus.assetId || stimulus.url;

    const updateCounts = () => {
      const counts = { left: 0, center: 0, right: 0 };
      Object.values(assignments).forEach((zone) => {
        counts[zone] += 1;
      });
      countNodes.left.textContent = counts.left;
      countNodes.center.textContent = counts.center;
      countNodes.right.textContent = counts.right;
      document.getElementById("submit-sort").disabled = counts.center > 0;
    };

    const moveStimulus = (stimulus, zone) => {
      const key = keyFor(stimulus);
      assignments[key] = zone;
      containers[zone].appendChild(cards.get(key));
      updateCounts();
    };

    const createCard = (stimulus) => {
      const card = document.createElement("article");
      card.className = "card";
      card.draggable = true;
      card.innerHTML = `
        <img src="${stimulus.url}" alt="Candidate face">
        <div class="card-actions">
          <button type="button" data-zone="left">Nonmatch</button>
          <button type="button" data-zone="right">Match</button>
        </div>
      `;
      const key = keyFor(stimulus);
      card.addEventListener("dragstart", (event) => {
        event.dataTransfer.setData("text/plain", key);
        card.classList.add("dragging");
      });
      card.addEventListener("dragend", () => {
        card.classList.remove("dragging");
      });
      card.querySelectorAll("button").forEach((button) => {
        button.addEventListener("click", () => moveStimulus(stimulus, button.dataset.zone));
      });
      return card;
    };

    trial.stimuli.forEach((stimulus) => {
      const key = keyFor(stimulus);
      cards.set(key, createCard(stimulus));
      moveStimulus(stimulus, "center");
    });

    document.querySelectorAll(".zone").forEach((zoneElement) => {
      zoneElement.addEventListener("dragover", (event) => event.preventDefault());
      zoneElement.addEventListener("drop", (event) => {
        event.preventDefault();
        const key = event.dataTransfer.getData("text/plain");
        const stimulus = trial.stimuli.find((entry) => keyFor(entry) === key);
        if (stimulus) {
          moveStimulus(stimulus, zoneElement.dataset.zone);
        }
      });
    });

    document.getElementById("reset-sort").addEventListener("click", () => {
      trial.stimuli.forEach((stimulus) => moveStimulus(stimulus, "center"));
    });

    document.getElementById("submit-sort").addEventListener("click", () => {
      const details = trial.stimuli.map((stimulus, index) => {
        const key = keyFor(stimulus);
        const assigned = assignments[key];
        const expected = trial.answers[index];
        return {
          assetId: stimulus.assetId || null,
          path: stimulus.url,
          expected,
          assigned,
          correct: expected === assigned,
        };
      });
      resolve({
        points: details.filter((detail) => detail.correct).length,
        details,
      });
    });

    updateCounts();
  });
}

async function submitFormSection(section, responses) {
  await fetchJson(`${API_BASE}/runs/${state.runId}/forms`, {
    method: "POST",
    body: JSON.stringify({ section, responses }),
  });
}

async function postEvent(eventType, phase, payload = {}, eventIndex = null) {
  await fetchJson(`${API_BASE}/runs/${state.runId}/events`, {
    method: "POST",
    body: JSON.stringify({
      event_type: eventType,
      phase,
      event_index: Number.isInteger(eventIndex) ? eventIndex : null,
      payload,
    }),
  });
}

async function completeRun() {
  const scores = computeScores();
  await fetchJson(`${API_BASE}/runs/${state.runId}/complete`, {
    method: "POST",
    body: JSON.stringify(scores),
  });
}

function computeScores() {
  return {
    memoryPoints: state.memoryResults.reduce((sum, trial) => sum + trial.points, 0),
    matchPoints: state.matchingResults
      .filter((trial) => !trial.practice)
      .reduce((sum, trial) => sum + trial.points, 0),
    overallPercent: Math.round(
      ((state.memoryResults.reduce((sum, trial) => sum + trial.points, 0) +
        state.matchingResults.filter((trial) => !trial.practice).reduce((sum, trial) => sum + trial.points, 0)) /
        120) *
        100,
    ),
  };
}

function renderResults() {
  const scores = computeScores();
  const benchmarks = state.settings.benchmarks || {};
  const resultPages = normalizePages(state.pages.resultsDisclosure);

  app.innerHTML = `
    <section class="screen">
      <article class="panel hero">
        <div class="hero-copy">
          <p class="eyebrow">Results</p>
          <h2>Face Test Complete</h2>
          <p class="results-copy">
            This run was recorded on the server under study <strong>${escapeHtml(state.study.title)}</strong>,
            version ${state.version.version_number}.
          </p>
          <div class="results-grid">
            <div class="score-card">
              <h3>Memory Test</h3>
              <div class="score-value">${scores.memoryPoints}<span class="pill-neutral"> / 40</span></div>
            </div>
            <div class="score-card">
              <h3>Sorting Test</h3>
              <div class="score-value">${scores.matchPoints}<span class="pill-neutral"> / 80</span></div>
            </div>
            <div class="score-card">
              <h3>Overall</h3>
              <div class="score-value">${scores.overallPercent}%</div>
            </div>
          </div>
          <div class="hero-actions">
            <button id="restart-run" class="button button-primary">Restart</button>
          </div>
        </div>
        <div class="hero-aside">
          <div class="notice-card">
            <strong>Benchmarks</strong>
            <p class="panel-copy">Top 5%: ${escapeHtml(String(benchmarks.top5 ?? "n/a"))}% and above</p>
            <p class="panel-copy">Top 10%: ${escapeHtml(String(benchmarks.top10 ?? "n/a"))}% and above</p>
            <p class="panel-copy">Top 25%: ${escapeHtml(String(benchmarks.top25 ?? "n/a"))}% and above</p>
            <p class="panel-copy">Top 50%: ${escapeHtml(String(benchmarks.top50 ?? "n/a"))}% and above</p>
          </div>
          ${
            resultPages.length
              ? `<div class="notice-card"><strong>Study Notes</strong>${resultPages
                  .map((page) => `<div class="panel-copy">${page}</div>`)
                  .join("")}</div>`
              : ""
          }
        </div>
      </article>
    </section>
  `;

  postEvent("results-view", "results", scores).catch(() => {});
  document.getElementById("restart-run").addEventListener("click", () => window.location.reload());
}

function waitForClick(element) {
  return new Promise((resolve) => element.addEventListener("click", resolve, { once: true }));
}

function animateProgress(fillElement, durationMs) {
  return new Promise((resolve) => {
    const started = performance.now();
    const tick = (now) => {
      const progress = Math.min((now - started) / durationMs, 1);
      fillElement.style.width = `${progress * 100}%`;
      if (progress < 1) {
        window.requestAnimationFrame(tick);
      } else {
        resolve();
      }
    };
    window.requestAnimationFrame(tick);
  });
}

async function requestFullscreenSafe() {
  if (!document.documentElement.requestFullscreen) {
    return;
  }
  try {
    await document.documentElement.requestFullscreen();
    await postEvent("fullscreen-entered", "session", {});
  } catch {
    await postEvent("fullscreen-unavailable", "session", {});
  }
}

function renderFatalError(error) {
  console.error(error);
  app.innerHTML = `
    <section class="screen">
      <article class="panel content-panel">
        <p class="step-label">Error</p>
        <h2 class="screen-title">The face test hit an unexpected problem.</h2>
        <p class="screen-subtitle">Check that the API is running and that a study has been published.</p>
        <pre class="copy-box">${escapeHtml(String(error))}</pre>
        <div class="actions">
          <button id="reload-page" class="button button-primary">Reload</button>
          <a class="button button-secondary" href="./admin.html">Admin</a>
        </div>
      </article>
    </section>
  `;
  document.getElementById("reload-page")?.addEventListener("click", () => window.location.reload());
}

function escapeHtml(text) {
  return String(text)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;");
}

function escapeAttribute(text) {
  return escapeHtml(String(text)).replaceAll('"', "&quot;");
}
