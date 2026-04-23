const app = document.getElementById("admin-app");
const API_BASE = `${resolveApiBase()}/admin`;
const TOKEN_KEY = "facetest-admin-token";
const PAGE_SEPARATOR = "\n\n---\n\n";

const DEFAULT_PAGE_CONFIG = {
  consent: [
    "<p><strong>Consent</strong></p><p>By continuing, you consent to take part in this face-test study.</p>",
  ],
  disclaimer: [
    "<p><strong>Important note</strong></p><p>This study should be completed on a desktop or laptop computer.</p>",
  ],
  studyInstructions: [
    "<p><strong>Memory Learning Phase Instructions</strong></p><p>You will be shown a series of faces to memorise.</p>",
  ],
  memoryInstructions: [
    "<p><strong>Memory Test Instructions</strong></p><p>Decide whether each person appeared in the learning phase.</p>",
  ],
  matchingInstructions: [
    "<p><strong>Sorting Instructions</strong></p><p>Move matching faces to the right and nonmatching faces to the left.</p>",
  ],
  practiceComplete: [
    "<p><strong>End of practice trials.</strong></p><p>Click below to begin the scored matching trials.</p>",
  ],
  finalNote: [
    "<p><strong>Final note</strong></p><p>You are about to see your scores.</p>",
  ],
  resultsDisclosure: [
    "<p>These results are for research and informational purposes.</p>",
  ],
};

const DEFAULT_DEMOGRAPHICS_SCHEMA = [
  { key: "age", label: "Age In Years", type: "number", required: false, help: "Optional numeric age." },
  {
    key: "ageBracket",
    label: "Age Bracket",
    type: "select",
    required: true,
    options: ["Under 18", "18-24", "25-34", "35-44", "45-54", "55-64", "65-74", "75-84", "85 or older"],
  },
  {
    key: "gender",
    label: "Gender",
    type: "select",
    required: true,
    options: ["Male", "Female", "Non-binary", "My gender is not listed here", "I prefer not to say"],
  },
  {
    key: "ethnicity",
    label: "Ethnic Background",
    type: "select",
    required: true,
    options: [
      "Aboriginal or Torres Strait Islander",
      "African",
      "European or other Caucasian",
      "East Asian e.g. Chinese, Hong Konger",
      "South Asian e.g. Indian, Bangladeshi",
      "Southeast Asian e.g. Thai, Vietnamese",
      "Middle Eastern",
      "Hispanic",
      "Pacific Islander",
      "Mixed",
      "Other",
    ],
  },
];

const DEFAULT_CONTACT_SCHEMA = [
  {
    key: "email",
    label: "Email Address",
    type: "email",
    required: false,
    help: "Optional contact address stored separately from core trial data.",
  },
];

const DEFAULT_SETTINGS = {
  viewingTimeMs: 5000,
  benchmarks: {
    top5: 72,
    top10: 69,
    top25: 65,
    top50: 61,
  },
};

const SAMPLE_MANIFEST_CSV = [
  "asset_key,relative_path,population_slug,asset_role,display_label,identity_id,trial_set_id,expected_side,is_available,metadata_json",
  'study-a-001,assets/population-a/study/study-a-001.png,population-a,study,Study A 001,identity-a-001,,,true,"{""sex"":""female"",""source"":""pilot""}"',
  'memory-old-a-001,assets/population-a/memory_old/memory-old-a-001.png,population-a,memory_old,Memory Old A 001,identity-a-001,,,true,"{}"',
  'memory-new-a-101,assets/population-a/memory_new/memory-new-a-101.png,population-a,memory_new,Memory New A 101,identity-a-101,,,true,"{}"',
  'practice-target-001,assets/population-a/practice_target/practice-target-001.png,population-a,practice_target,Practice Target 001,,practice-001,,true,"{}"',
  'practice-probe-001,assets/population-a/practice_probe/practice-probe-001.png,population-a,practice_probe,Practice Probe 001,,practice-001,left,true,"{}"',
  'matching-target-001,assets/population-b/matching_target/matching-target-001.png,population-b,matching_target,Matching Target 001,,matching-001,,true,"{}"',
  'matching-probe-001,assets/population-b/matching_probe/matching-probe-001.png,population-b,matching_probe,Matching Probe 001,,matching-001,right,true,"{}"',
].join("\n");

const state = {
  token: localStorage.getItem(TOKEN_KEY) || "",
  studies: [],
  selectedStudyId: "",
  versions: [],
  selectedVersionId: "",
  selectedVersion: null,
  selectedFormDef: null,
  selectedRules: [],
  populations: [],
  assets: [],
  runs: [],
  importReport: null,
};

main().catch(renderFatalError);

async function main() {
  renderShell();
  bindStaticHandlers();
  renderImportReport();
  await refreshStudies();
}

function resolveApiBase() {
  const configured = document.querySelector('meta[name="facetest-api-base"]')?.content;
  if (configured) {
    return configured.replace(/\/+$/, "");
  }
  const here = new URL(window.location.href);
  const isNestedSubdir = /\/facetest-clone\/(?:admin\.html)?$/i.test(here.pathname);
  return isNestedSubdir
    ? new URL("../api/facetest", here).pathname.replace(/\/+$/, "")
    : new URL("api/facetest", here).pathname.replace(/\/+$/, "");
}

function renderShell() {
  app.innerHTML = `
    <section class="screen">
      <div class="body-stack">
        <article class="panel content-panel">
          <h2 class="screen-title">Admin Access</h2>
          <p class="screen-subtitle">Use the shared admin token configured on the server.</p>
          <div class="fields">
            <div class="field field-full">
              <label for="admin-token">Admin Token</label>
              <input id="admin-token" type="password" value="${escapeAttribute(state.token)}" placeholder="Optional if local loopback access is allowed">
            </div>
          </div>
          <div class="actions">
            <button id="save-token" class="button button-primary">Save Token</button>
            <button id="reload-admin" class="button button-secondary">Reload Admin Data</button>
            <a class="button button-quiet" href="./index.html">Participant App</a>
          </div>
        </article>

        <article class="panel content-panel">
          <h2 class="screen-title">Studies</h2>
          <div class="fields">
            <div class="field">
              <label for="study-title">Title</label>
              <input id="study-title" type="text" placeholder="Population comparison study">
            </div>
            <div class="field">
              <label for="study-slug">Slug</label>
              <input id="study-slug" type="text" placeholder="population-comparison">
            </div>
            <div class="field field-full">
              <label for="study-notes">Notes</label>
              <textarea id="study-notes" rows="3" placeholder="Optional researcher notes"></textarea>
            </div>
          </div>
          <div class="actions">
            <button id="create-study" class="button button-primary">Create Study</button>
          </div>
          <div id="study-list" class="table-wrap"></div>
        </article>

        <article class="panel content-panel">
          <h2 class="screen-title">Versions</h2>
          <p class="screen-subtitle" id="selected-study-label">Select a study to manage versions.</p>
          <div class="actions">
            <button id="create-version" class="button button-primary" disabled>Create Draft Version</button>
            <button id="clone-version" class="button button-secondary" disabled>Clone Selected Version</button>
          </div>
          <div id="version-list" class="table-wrap"></div>
        </article>

        <article class="panel content-panel">
          <h2 class="screen-title">Forms And Pages</h2>
          <p class="screen-subtitle">Editable participant content plus demographics/contact schemas.</p>
          <div class="actions">
            <button id="load-defaults" class="button button-secondary" disabled>Load Defaults</button>
            <button id="save-forms" class="button button-primary" disabled>Save Forms And Settings</button>
            <button id="publish-version" class="button button-warning" disabled>Publish Selected Version</button>
          </div>
          <div class="body-stack">
            <div class="field field-full">
              <label for="pages-consent">Consent Pages</label>
              <textarea id="pages-consent" rows="6" disabled></textarea>
            </div>
            <div class="field field-full">
              <label for="pages-disclaimer">Disclaimer / Information Pages</label>
              <textarea id="pages-disclaimer" rows="6" disabled></textarea>
            </div>
            <div class="field field-full">
              <label for="pages-study">Study Instruction Pages</label>
              <textarea id="pages-study" rows="6" disabled></textarea>
            </div>
            <div class="field field-full">
              <label for="pages-memory">Memory Instruction Pages</label>
              <textarea id="pages-memory" rows="6" disabled></textarea>
            </div>
            <div class="field field-full">
              <label for="pages-matching">Matching Instruction Pages</label>
              <textarea id="pages-matching" rows="6" disabled></textarea>
            </div>
            <div class="field field-full">
              <label for="pages-practice">Practice Complete Pages</label>
              <textarea id="pages-practice" rows="4" disabled></textarea>
            </div>
            <div class="field field-full">
              <label for="pages-final">Final Note Pages</label>
              <textarea id="pages-final" rows="4" disabled></textarea>
            </div>
            <div class="field field-full">
              <label for="pages-results">Results Disclosure Pages</label>
              <textarea id="pages-results" rows="4" disabled></textarea>
            </div>
            <div class="field field-full">
              <label for="demographics-schema">Demographics Schema JSON</label>
              <textarea id="demographics-schema" rows="10" disabled></textarea>
            </div>
            <div class="field field-full">
              <label for="contact-schema">Contact Schema JSON</label>
              <textarea id="contact-schema" rows="6" disabled></textarea>
            </div>
            <div class="field field-full">
              <label for="settings-json">Settings JSON</label>
              <textarea id="settings-json" rows="8" disabled></textarea>
            </div>
          </div>
        </article>

        <article class="panel content-panel">
          <h2 class="screen-title">Populations</h2>
          <div class="fields">
            <div class="field">
              <label for="population-label">Label</label>
              <input id="population-label" type="text" placeholder="Population A">
            </div>
            <div class="field">
              <label for="population-slug">Slug</label>
              <input id="population-slug" type="text" placeholder="population-a">
            </div>
            <div class="field field-full">
              <label for="population-description">Description</label>
              <textarea id="population-description" rows="3" placeholder="Optional metadata for the sampling pool"></textarea>
            </div>
          </div>
          <div class="actions">
            <button id="create-population" class="button button-primary" disabled>Add Population</button>
          </div>
          <div id="population-list" class="table-wrap"></div>
        </article>

        <article class="panel content-panel">
          <h2 class="screen-title">Bulk Asset Import</h2>
          <p class="screen-subtitle">Upload one zip containing <code>manifest.csv</code> plus images under <code>assets/...</code>. The manifest is authoritative; folder names are for your convenience.</p>
          <div class="fields">
            <div class="field">
              <label for="bulk-asset-archive">Zip Archive</label>
              <input id="bulk-asset-archive" type="file" accept=".zip,application/zip">
            </div>
            <div class="field">
              <label>Recommended Layout</label>
              <div class="copy-box compact-copy">
                <p><code>manifest.csv</code> at the zip root</p>
                <p><code>assets/&lt;population_slug&gt;/&lt;asset_role&gt;/&lt;filename&gt;</code></p>
              </div>
            </div>
          </div>
          <div class="actions">
            <button id="bulk-import-assets" class="button button-primary" disabled>Import Zip Batch</button>
            <button id="download-sample-manifest" class="button button-secondary">Download Sample Manifest</button>
          </div>
          <div id="bulk-import-report" class="table-wrap"></div>
        </article>

        <article class="panel content-panel">
          <h2 class="screen-title">Single Asset Maintenance</h2>
          <p class="screen-subtitle">Use this only for small corrections or one-off additions. Large batches should go through the zip importer.</p>
          <div class="fields">
            <div class="field">
              <label for="asset-file">Image File</label>
              <input id="asset-file" type="file" accept="image/*">
            </div>
            <div class="field">
              <label for="asset-label">Display Label</label>
              <input id="asset-label" type="text" placeholder="Face A1 study image">
            </div>
            <div class="field">
              <label for="asset-population">Population</label>
              <select id="asset-population" disabled></select>
            </div>
            <div class="field">
              <label for="asset-role">Role</label>
              <select id="asset-role">
                <option value="study">study</option>
                <option value="memory_old">memory_old</option>
                <option value="memory_new">memory_new</option>
                <option value="practice_target">practice_target</option>
                <option value="practice_probe">practice_probe</option>
                <option value="matching_target">matching_target</option>
                <option value="matching_probe">matching_probe</option>
              </select>
            </div>
            <div class="field">
              <label for="asset-key">Asset Key</label>
              <input id="asset-key" type="text" placeholder="optional-stable-key">
            </div>
            <div class="field">
              <label for="asset-identity">Identity ID</label>
              <input id="asset-identity" type="text" placeholder="identity-001">
            </div>
            <div class="field">
              <label for="asset-trial-set">Trial Set ID</label>
              <input id="asset-trial-set" type="text" placeholder="set-001">
            </div>
            <div class="field">
              <label for="asset-expected-side">Expected Side</label>
              <select id="asset-expected-side">
                <option value="">N/A</option>
                <option value="left">left</option>
                <option value="right">right</option>
              </select>
            </div>
            <div class="field field-full">
              <label for="asset-metadata">Metadata JSON</label>
              <textarea id="asset-metadata" rows="4" placeholder='{"source":"pilot","sex":"female"}'></textarea>
            </div>
          </div>
          <div class="actions">
            <button id="upload-asset" class="button button-primary" disabled>Upload Asset</button>
          </div>
          <div id="asset-list" class="table-wrap"></div>
        </article>

        <article class="panel content-panel">
          <h2 class="screen-title">Selection Rules</h2>
          <p class="screen-subtitle">Enter a JSON array of phase rules. Supported phases: study, memory_old, memory_new, practice_matching, matching.</p>
          <div class="field field-full">
            <label for="selection-rules">Rules JSON</label>
            <textarea id="selection-rules" rows="12" disabled></textarea>
          </div>
          <div class="actions">
            <button id="save-rules" class="button button-primary" disabled>Save Selection Rules</button>
          </div>
        </article>

        <article class="panel content-panel">
          <h2 class="screen-title">Runs And Exports</h2>
          <div class="actions">
            <button id="load-runs" class="button button-secondary" disabled>Load Runs</button>
            <a id="export-runs" class="button button-quiet" href="#" target="_blank">Export Runs CSV</a>
            <a id="export-memory" class="button button-quiet" href="#" target="_blank">Export Memory CSV</a>
            <a id="export-matching" class="button button-quiet" href="#" target="_blank">Export Matching CSV</a>
            <a id="export-forms" class="button button-quiet" href="#" target="_blank">Export Forms CSV</a>
            <a id="export-raw" class="button button-quiet" href="#" target="_blank">Export Raw Rows CSV</a>
          </div>
          <div id="run-list" class="table-wrap"></div>
        </article>

        <article class="panel content-panel">
          <h2 class="screen-title">Usage Notes</h2>
          <div class="copy-box">
            <p>Separate pages inside the page textareas with <code>${escapeHtml(PAGE_SEPARATOR)}</code>.</p>
            <p>For bulk imports, use a stable <code>asset_key</code> per row. Existing keys are skipped, not overwritten.</p>
            <p>For matching assets, assign one target asset and at least four probe assets to the same <code>trial_set_id</code>.</p>
            <p>Study assets and <code>memory_old</code> assets should share the same <code>identity_id</code> so old-memory trials can be derived from studied identities.</p>
          </div>
        </article>
      </div>
    </section>
  `;
}

function bindStaticHandlers() {
  document.getElementById("save-token").addEventListener("click", async () => {
    state.token = document.getElementById("admin-token").value.trim();
    localStorage.setItem(TOKEN_KEY, state.token);
    await refreshStudies();
  });

  document.getElementById("reload-admin").addEventListener("click", async () => {
    state.token = document.getElementById("admin-token").value.trim();
    await refreshStudies();
  });

  document.getElementById("create-study").addEventListener("click", createStudy);
  document.getElementById("create-version").addEventListener("click", () => createVersion(false));
  document.getElementById("clone-version").addEventListener("click", () => createVersion(true));
  document.getElementById("load-defaults").addEventListener("click", loadDefaultsIntoEditors);
  document.getElementById("save-forms").addEventListener("click", saveFormsAndSettings);
  document.getElementById("publish-version").addEventListener("click", publishVersion);
  document.getElementById("create-population").addEventListener("click", createPopulation);
  document.getElementById("bulk-import-assets").addEventListener("click", bulkImportAssets);
  document.getElementById("download-sample-manifest").addEventListener("click", downloadSampleManifest);
  document.getElementById("upload-asset").addEventListener("click", uploadAsset);
  document.getElementById("save-rules").addEventListener("click", saveRules);
  document.getElementById("load-runs").addEventListener("click", loadRuns);
}

async function adminFetch(url, options = {}) {
  const isFormData = typeof FormData !== "undefined" && options.body instanceof FormData;
  const response = await fetch(url, {
    ...options,
    headers: {
      ...(!isFormData && options.body ? { "Content-Type": "application/json" } : {}),
      ...(state.token ? { "x-facetest-admin-token": state.token } : {}),
      ...(options.headers || {}),
    },
  });

  if (!response.ok) {
    let message = `${response.status} ${response.statusText}`;
    try {
      const payload = await response.json();
      message = payload.error || payload.validationErrors?.join("\n") || message;
    } catch {}
    throw new Error(message);
  }

  if (response.status === 204) {
    return {};
  }
  return response.json();
}

async function refreshStudies() {
  try {
    const body = await adminFetch(`${API_BASE}/studies`);
    state.studies = body.studies || [];
    if (state.selectedStudyId && !state.studies.some((study) => study.id === state.selectedStudyId)) {
      state.selectedStudyId = "";
    }
    renderStudyList();
    updateExportLinks();
    if (state.selectedStudyId) {
      await selectStudy(state.selectedStudyId);
    } else {
      clearStudyScopedViews();
    }
  } catch (error) {
    renderError("study-list", error);
  }
}

function renderStudyList() {
  const container = document.getElementById("study-list");
  if (!state.studies.length) {
    container.innerHTML = "<p class='panel-copy'>No studies yet.</p>";
    return;
  }
  container.innerHTML = `
    <table class="admin-table">
      <thead>
        <tr><th>Title</th><th>Slug</th><th>Status</th><th>Published</th><th></th></tr>
      </thead>
      <tbody>
        ${state.studies
          .map(
            (study) => `
              <tr>
                <td>${escapeHtml(study.title)}</td>
                <td><code>${escapeHtml(study.slug)}</code></td>
                <td>${escapeHtml(study.status)}</td>
                <td>${escapeHtml(study.latest_published_at || "—")}</td>
                <td><button class="button button-secondary study-open" data-study-id="${study.id}">Open</button></td>
              </tr>
            `,
          )
          .join("")}
      </tbody>
    </table>
  `;
  container.querySelectorAll(".study-open").forEach((button) => {
    button.addEventListener("click", async () => {
      await selectStudy(button.dataset.studyId);
    });
  });
}

async function createStudy() {
  try {
    await adminFetch(`${API_BASE}/studies`, {
      method: "POST",
      body: JSON.stringify({
        title: document.getElementById("study-title").value.trim(),
        slug: document.getElementById("study-slug").value.trim(),
        notes: document.getElementById("study-notes").value.trim(),
      }),
    });
    document.getElementById("study-title").value = "";
    document.getElementById("study-slug").value = "";
    document.getElementById("study-notes").value = "";
    await refreshStudies();
  } catch (error) {
    alert(error.message);
  }
}

async function selectStudy(studyId) {
  state.selectedStudyId = studyId;
  state.selectedVersionId = "";
  state.selectedVersion = null;
  state.selectedFormDef = null;
  state.selectedRules = [];
  state.importReport = null;

  document.getElementById("selected-study-label").textContent =
    state.studies.find((study) => study.id === studyId)?.title || "Selected study";

  document.getElementById("create-version").disabled = false;
  document.getElementById("create-population").disabled = false;
  document.getElementById("bulk-import-assets").disabled = false;
  document.getElementById("upload-asset").disabled = false;
  document.getElementById("load-runs").disabled = false;
  renderImportReport();

  await Promise.all([loadVersions(), loadPopulations(), loadAssets(), loadRuns()]);
  updateExportLinks();
}

async function loadVersions() {
  try {
    const body = await adminFetch(`${API_BASE}/studies/${state.selectedStudyId}/versions`);
    state.versions = body.versions || [];
    renderVersions();
  } catch (error) {
    renderError("version-list", error);
  }
}

function renderVersions() {
  const container = document.getElementById("version-list");
  if (!state.versions.length) {
    container.innerHTML = "<p class='panel-copy'>No versions yet.</p>";
    document.getElementById("clone-version").disabled = true;
    return;
  }
  container.innerHTML = `
    <table class="admin-table">
      <thead>
        <tr><th>Version</th><th>Status</th><th>Published</th><th>Changelog</th><th></th></tr>
      </thead>
      <tbody>
        ${state.versions
          .map(
            (version) => `
              <tr>
                <td>v${version.version_number}</td>
                <td>${escapeHtml(version.status)}</td>
                <td>${escapeHtml(version.published_at || "—")}</td>
                <td>${escapeHtml(version.changelog || "")}</td>
                <td><button class="button button-secondary version-open" data-version-id="${version.id}">Open</button></td>
              </tr>
            `,
          )
          .join("")}
      </tbody>
    </table>
  `;
  container.querySelectorAll(".version-open").forEach((button) => {
    button.addEventListener("click", async () => {
      await selectVersion(button.dataset.versionId);
    });
  });
}

async function createVersion(cloneSelected) {
  try {
    const sourceVersionId = cloneSelected ? state.selectedVersionId : null;
    await adminFetch(`${API_BASE}/studies/${state.selectedStudyId}/versions`, {
      method: "POST",
      body: JSON.stringify(
        sourceVersionId
          ? {
              source_version_id: sourceVersionId,
              parent_version_id: sourceVersionId,
              changelog: `Cloned from ${state.selectedVersion?.version_number || "selected version"}`,
            }
          : {},
      ),
    });
    await loadVersions();
  } catch (error) {
    alert(error.message);
  }
}

async function selectVersion(versionId) {
  state.selectedVersionId = versionId;
  try {
    const body = await adminFetch(`${API_BASE}/versions/${versionId}`);
    state.selectedVersion = body.version;
    state.selectedFormDef = body.formDef;
    state.selectedRules = body.rules || [];
    const editable = state.selectedVersion.status === "draft";

    document.getElementById("clone-version").disabled = false;
    document.getElementById("load-defaults").disabled = !editable;
    document.getElementById("save-forms").disabled = !editable;
    document.getElementById("save-rules").disabled = !editable;
    document.getElementById("publish-version").disabled = !editable;

    setEditorDisabled(!editable);
    hydrateEditors();
  } catch (error) {
    alert(error.message);
  }
}

function hydrateEditors() {
  const formDef = state.selectedFormDef || {
    pages: DEFAULT_PAGE_CONFIG,
    demographicsSchema: DEFAULT_DEMOGRAPHICS_SCHEMA,
    contactSchema: DEFAULT_CONTACT_SCHEMA,
    settings: DEFAULT_SETTINGS,
  };
  document.getElementById("pages-consent").value = pagesToText(formDef.pages?.consent);
  document.getElementById("pages-disclaimer").value = pagesToText(formDef.pages?.disclaimer);
  document.getElementById("pages-study").value = pagesToText(formDef.pages?.studyInstructions);
  document.getElementById("pages-memory").value = pagesToText(formDef.pages?.memoryInstructions);
  document.getElementById("pages-matching").value = pagesToText(formDef.pages?.matchingInstructions);
  document.getElementById("pages-practice").value = pagesToText(formDef.pages?.practiceComplete);
  document.getElementById("pages-final").value = pagesToText(formDef.pages?.finalNote);
  document.getElementById("pages-results").value = pagesToText(formDef.pages?.resultsDisclosure);
  document.getElementById("demographics-schema").value = JSON.stringify(formDef.demographicsSchema || [], null, 2);
  document.getElementById("contact-schema").value = JSON.stringify(formDef.contactSchema || [], null, 2);
  document.getElementById("settings-json").value = JSON.stringify(formDef.settings || DEFAULT_SETTINGS, null, 2);
  document.getElementById("selection-rules").value = JSON.stringify(state.selectedRules || [], null, 2);
}

function loadDefaultsIntoEditors() {
  document.getElementById("pages-consent").value = pagesToText(DEFAULT_PAGE_CONFIG.consent);
  document.getElementById("pages-disclaimer").value = pagesToText(DEFAULT_PAGE_CONFIG.disclaimer);
  document.getElementById("pages-study").value = pagesToText(DEFAULT_PAGE_CONFIG.studyInstructions);
  document.getElementById("pages-memory").value = pagesToText(DEFAULT_PAGE_CONFIG.memoryInstructions);
  document.getElementById("pages-matching").value = pagesToText(DEFAULT_PAGE_CONFIG.matchingInstructions);
  document.getElementById("pages-practice").value = pagesToText(DEFAULT_PAGE_CONFIG.practiceComplete);
  document.getElementById("pages-final").value = pagesToText(DEFAULT_PAGE_CONFIG.finalNote);
  document.getElementById("pages-results").value = pagesToText(DEFAULT_PAGE_CONFIG.resultsDisclosure);
  document.getElementById("demographics-schema").value = JSON.stringify(DEFAULT_DEMOGRAPHICS_SCHEMA, null, 2);
  document.getElementById("contact-schema").value = JSON.stringify(DEFAULT_CONTACT_SCHEMA, null, 2);
  document.getElementById("settings-json").value = JSON.stringify(DEFAULT_SETTINGS, null, 2);
}

async function saveFormsAndSettings() {
  try {
    await adminFetch(`${API_BASE}/versions/${state.selectedVersionId}/forms`, {
      method: "PUT",
      body: JSON.stringify({
        pages: collectPagesFromEditors(),
        demographicsSchema: parseJsonTextarea("demographics-schema"),
        contactSchema: parseJsonTextarea("contact-schema"),
        settings: parseJsonTextarea("settings-json"),
      }),
    });
    await selectVersion(state.selectedVersionId);
    alert("Forms and settings saved.");
  } catch (error) {
    alert(error.message);
  }
}

async function publishVersion() {
  try {
    const body = await adminFetch(`${API_BASE}/versions/${state.selectedVersionId}/publish`, {
      method: "POST",
      body: JSON.stringify({}),
    });
    alert(`Published version ${body.version.version_number}.`);
    await loadVersions();
    await selectVersion(state.selectedVersionId);
    await refreshStudies();
  } catch (error) {
    alert(error.message);
  }
}

async function loadPopulations() {
  try {
    const body = await adminFetch(`${API_BASE}/populations?study_id=${encodeURIComponent(state.selectedStudyId)}`);
    state.populations = body.populations || [];
    renderPopulations();
    renderPopulationSelect();
  } catch (error) {
    renderError("population-list", error);
  }
}

function renderPopulations() {
  const container = document.getElementById("population-list");
  if (!state.populations.length) {
    container.innerHTML = "<p class='panel-copy'>No populations configured yet.</p>";
    return;
  }
  container.innerHTML = `
    <table class="admin-table">
      <thead><tr><th>Label</th><th>Slug</th><th>Description</th></tr></thead>
      <tbody>
        ${state.populations
          .map(
            (population) => `
              <tr>
                <td>${escapeHtml(population.label)}</td>
                <td><code>${escapeHtml(population.slug)}</code></td>
                <td>${escapeHtml(population.description || "")}</td>
              </tr>
            `,
          )
          .join("")}
      </tbody>
    </table>
  `;
}

function renderPopulationSelect() {
  const select = document.getElementById("asset-population");
  select.disabled = false;
  select.innerHTML = `
    <option value="">No population</option>
    ${state.populations
      .map((population) => `<option value="${population.id}">${escapeHtml(population.label)}</option>`)
      .join("")}
  `;
}

async function createPopulation() {
  try {
    await adminFetch(`${API_BASE}/populations`, {
      method: "POST",
      body: JSON.stringify({
        study_id: state.selectedStudyId,
        label: document.getElementById("population-label").value.trim(),
        slug: document.getElementById("population-slug").value.trim(),
        description: document.getElementById("population-description").value.trim(),
      }),
    });
    document.getElementById("population-label").value = "";
    document.getElementById("population-slug").value = "";
    document.getElementById("population-description").value = "";
    await loadPopulations();
  } catch (error) {
    alert(error.message);
  }
}

async function loadAssets() {
  try {
    const body = await adminFetch(`${API_BASE}/assets?study_id=${encodeURIComponent(state.selectedStudyId)}`);
    state.assets = body.assets || [];
    renderAssets();
  } catch (error) {
    renderError("asset-list", error);
  }
}

function renderAssets() {
  const container = document.getElementById("asset-list");
  if (!state.assets.length) {
    container.innerHTML = "<p class='panel-copy'>No assets imported yet.</p>";
    return;
  }
  container.innerHTML = `
    <table class="admin-table">
      <thead><tr><th>Key</th><th>Label</th><th>Role</th><th>Population</th><th>Identity</th><th>Trial Set</th><th>Preview</th></tr></thead>
      <tbody>
        ${state.assets
          .map((asset) => {
            const population = state.populations.find((entry) => entry.id === asset.population_id);
            return `
              <tr>
                <td><code>${escapeHtml(asset.asset_key || "—")}</code></td>
                <td>${escapeHtml(asset.display_label || asset.file_name)}</td>
                <td><code>${escapeHtml(asset.asset_role)}</code></td>
                <td>${escapeHtml(population?.label || "—")}</td>
                <td>${escapeHtml(asset.identity_id || "—")}</td>
                <td>${escapeHtml(asset.trial_set_id || "—")}</td>
                <td><a href="${asset.public_path}" target="_blank">open</a></td>
              </tr>
            `;
          })
          .join("")}
      </tbody>
    </table>
  `;
}

function renderImportReport() {
  const container = document.getElementById("bulk-import-report");
  if (!state.importReport) {
    container.innerHTML = "<p class='panel-copy'>No bulk imports run yet.</p>";
    return;
  }

  const { summary, results } = state.importReport;
  container.innerHTML = `
    <div class="body-stack">
      <div class="pill-row">
        <span class="pill">Rows ${escapeHtml(String(summary.totalRows ?? 0))}</span>
        <span class="pill">Created ${escapeHtml(String(summary.created ?? 0))}</span>
        <span class="pill">Skipped ${escapeHtml(String(summary.skipped ?? 0))}</span>
        <span class="pill">Failed ${escapeHtml(String(summary.failed ?? 0))}</span>
      </div>
      ${
        results?.length
          ? `
            <table class="admin-table">
              <thead><tr><th>Row</th><th>Asset Key</th><th>Status</th><th>Message</th></tr></thead>
              <tbody>
                ${results
                  .map(
                    (entry) => `
                      <tr>
                        <td>${escapeHtml(String(entry.rowNumber ?? "—"))}</td>
                        <td><code>${escapeHtml(entry.assetKey || "—")}</code></td>
                        <td>${escapeHtml(entry.status || "unknown")}</td>
                        <td>${escapeHtml(entry.message || "")}</td>
                      </tr>
                    `,
                  )
                  .join("")}
              </tbody>
            </table>
          `
          : "<p class='panel-copy'>No row-level import messages were returned.</p>"
      }
    </div>
  `;
}

async function bulkImportAssets() {
  try {
    const archive = document.getElementById("bulk-asset-archive").files[0];
    if (!archive) {
      throw new Error("Select a zip archive first.");
    }

    const formData = new FormData();
    formData.set("study_id", state.selectedStudyId);
    formData.set("archive", archive, archive.name);

    const response = await fetch(`${API_BASE}/imports/assets`, {
      method: "POST",
      headers: {
        ...(state.token ? { "x-facetest-admin-token": state.token } : {}),
      },
      body: formData,
    });

    const payload = await response.json().catch(() => ({}));
    state.importReport = {
      summary: payload.summary || { totalRows: 0, created: 0, skipped: 0, failed: 1 },
      results: payload.results || [],
    };
    renderImportReport();

    if (!response.ok) {
      throw new Error(payload.error || `${response.status} ${response.statusText}`);
    }

    document.getElementById("bulk-asset-archive").value = "";
    state.assets = payload.assets || [];
    renderAssets();
    alert(`Bulk import complete. Created ${payload.summary.created}, skipped ${payload.summary.skipped}.`);
  } catch (error) {
    if (!state.importReport) {
      renderError("bulk-import-report", error);
    }
    alert(error.message);
  }
}

async function uploadAsset() {
  try {
    const file = document.getElementById("asset-file").files[0];
    if (!file) {
      throw new Error("Select an image file first.");
    }
    const base64 = await fileToBase64(file);

    await adminFetch(`${API_BASE}/assets`, {
      method: "POST",
      body: JSON.stringify({
        study_id: state.selectedStudyId,
        population_id: document.getElementById("asset-population").value || null,
        display_label: document.getElementById("asset-label").value.trim() || file.name,
        asset_role: document.getElementById("asset-role").value,
        asset_key: document.getElementById("asset-key").value.trim() || null,
        identity_id: document.getElementById("asset-identity").value.trim() || null,
        trial_set_id: document.getElementById("asset-trial-set").value.trim() || null,
        expected_side: document.getElementById("asset-expected-side").value || null,
        metadata: parseLooseJson(document.getElementById("asset-metadata").value.trim()),
        file_name: file.name,
        mime_type: file.type || "application/octet-stream",
        data_base64: base64,
      }),
    });

    document.getElementById("asset-file").value = "";
    document.getElementById("asset-label").value = "";
    document.getElementById("asset-key").value = "";
    document.getElementById("asset-identity").value = "";
    document.getElementById("asset-trial-set").value = "";
    document.getElementById("asset-expected-side").value = "";
    document.getElementById("asset-metadata").value = "";
    await loadAssets();
  } catch (error) {
    alert(error.message);
  }
}

async function saveRules() {
  try {
    await adminFetch(`${API_BASE}/versions/${state.selectedVersionId}/selection-rules`, {
      method: "PUT",
      body: JSON.stringify({
        rules: parseJsonTextarea("selection-rules"),
      }),
    });
    await selectVersion(state.selectedVersionId);
    alert("Selection rules saved.");
  } catch (error) {
    alert(error.message);
  }
}

async function loadRuns() {
  if (!state.selectedStudyId) return;
  try {
    const body = await adminFetch(`${API_BASE}/reports/runs?study_id=${encodeURIComponent(state.selectedStudyId)}`);
    state.runs = body.runs || [];
    renderRuns();
  } catch (error) {
    renderError("run-list", error);
  }
}

function renderRuns() {
  const container = document.getElementById("run-list");
  if (!state.runs.length) {
    container.innerHTML = "<p class='panel-copy'>No runs recorded yet.</p>";
    return;
  }
  container.innerHTML = `
    <table class="admin-table">
      <thead><tr><th>Started</th><th>Status</th><th>Version</th><th>Score</th><th>Contact</th><th>Run ID</th></tr></thead>
      <tbody>
        ${state.runs
          .map(
            (run) => `
              <tr>
                <td>${escapeHtml(run.started_at)}</td>
                <td>${escapeHtml(run.status)}</td>
                <td>v${escapeHtml(String(run.version_number))}</td>
                <td>${escapeHtml(run.score?.overallPercent !== undefined ? `${run.score.overallPercent}%` : "—")}</td>
                <td>${escapeHtml(run.pii_contact_email || "—")}</td>
                <td><code>${escapeHtml(run.id)}</code></td>
              </tr>
            `,
          )
          .join("")}
      </tbody>
    </table>
  `;
}

function updateExportLinks() {
  const tokenQuery = state.token ? `?token=${encodeURIComponent(state.token)}` : "";
  document.getElementById("export-runs").href = `${API_BASE}/reports/export/runs.csv${tokenQuery}`;
  document.getElementById("export-memory").href = `${API_BASE}/reports/export/memory.csv${tokenQuery}`;
  document.getElementById("export-matching").href = `${API_BASE}/reports/export/matching.csv${tokenQuery}`;
  document.getElementById("export-forms").href = `${API_BASE}/reports/export/forms.csv${tokenQuery}`;
  document.getElementById("export-raw").href = `${API_BASE}/reports/export/raw.csv${tokenQuery}`;
}

function clearStudyScopedViews() {
  document.getElementById("selected-study-label").textContent = "Select a study to manage versions.";
  document.getElementById("version-list").innerHTML = "";
  document.getElementById("population-list").innerHTML = "";
  document.getElementById("asset-list").innerHTML = "";
  document.getElementById("bulk-import-report").innerHTML = "";
  document.getElementById("run-list").innerHTML = "";
  document.getElementById("create-version").disabled = true;
  document.getElementById("clone-version").disabled = true;
  document.getElementById("create-population").disabled = true;
  document.getElementById("bulk-import-assets").disabled = true;
  document.getElementById("upload-asset").disabled = true;
  document.getElementById("load-runs").disabled = true;
  state.importReport = null;
  setEditorDisabled(true);
}

function setEditorDisabled(disabled) {
  [
    "pages-consent",
    "pages-disclaimer",
    "pages-study",
    "pages-memory",
    "pages-matching",
    "pages-practice",
    "pages-final",
    "pages-results",
    "demographics-schema",
    "contact-schema",
    "settings-json",
    "selection-rules",
  ].forEach((id) => {
    document.getElementById(id).disabled = disabled;
  });
}

function collectPagesFromEditors() {
  return {
    consent: textToPages(document.getElementById("pages-consent").value),
    disclaimer: textToPages(document.getElementById("pages-disclaimer").value),
    studyInstructions: textToPages(document.getElementById("pages-study").value),
    memoryInstructions: textToPages(document.getElementById("pages-memory").value),
    matchingInstructions: textToPages(document.getElementById("pages-matching").value),
    practiceComplete: textToPages(document.getElementById("pages-practice").value),
    finalNote: textToPages(document.getElementById("pages-final").value),
    resultsDisclosure: textToPages(document.getElementById("pages-results").value),
  };
}

function textToPages(value) {
  return String(value || "")
    .split(PAGE_SEPARATOR)
    .map((page) => page.trim())
    .filter(Boolean);
}

function pagesToText(pages) {
  return (Array.isArray(pages) ? pages : []).join(PAGE_SEPARATOR);
}

function parseJsonTextarea(id) {
  return JSON.parse(document.getElementById(id).value.trim() || "null");
}

function parseLooseJson(value) {
  if (!value) return {};
  return JSON.parse(value);
}

function downloadSampleManifest() {
  const blob = new Blob([SAMPLE_MANIFEST_CSV], { type: "text/csv;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = "manifest.csv";
  document.body.appendChild(link);
  link.click();
  link.remove();
  URL.revokeObjectURL(url);
}

function fileToBase64(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onerror = () => reject(reader.error || new Error("Failed to read file"));
    reader.onload = () => {
      const result = String(reader.result || "");
      const base64 = result.includes(",") ? result.split(",")[1] : result;
      resolve(base64);
    };
    reader.readAsDataURL(file);
  });
}

function renderError(id, error) {
  document.getElementById(id).innerHTML = `<p class="panel-copy">${escapeHtml(String(error.message || error))}</p>`;
}

function renderFatalError(error) {
  console.error(error);
  app.innerHTML = `
    <article class="panel content-panel">
      <p class="step-label">Error</p>
      <h2 class="screen-title">Admin UI failed to load.</h2>
      <pre class="copy-box">${escapeHtml(String(error))}</pre>
    </article>
  `;
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
