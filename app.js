const app = document.getElementById("app");
const data = window.FACE_TEST_DATA;

const state = {
  subjectId: Math.floor(Math.random() * 100000000),
  subjectId2: Math.floor(Math.random() * 100000000),
  sessionStartedAt: new Date().toISOString(),
  demographics: {
    age: "",
    ageBracket: "",
    gender: "",
    ethnicity: "",
  },
  contactEmail: "",
  records: [],
  studyOrder: shuffle([...data.studyFaces]),
  memoryOrder: shuffle([...data.memoryTrials]),
  memoryResults: [],
  matchingResults: [],
};

const ageChoices = [
  "Under 18",
  "18-24",
  "25-34",
  "35-44",
  "45-54",
  "55-64",
  "65-74",
  "75-84",
  "85 or older",
];

const genderChoices = [
  "Male",
  "Female",
  "Non-binary",
  "My gender is not listed here",
  "I prefer not to say",
];

const ethnicityChoices = [
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
];

const disclaimerPages = [
  `
    <p><strong>Disclaimer</strong></p>
    <p>
      This local recreation mirrors the public UNSW Face Test flow, but it saves your results as a
      CSV file on this computer instead of posting them to the original website.
    </p>
    <p>
      The original site warns that some recruitment agencies have asked people to complete the test
      and share their scores. The UNSW notice states that those agencies are not affiliated with
      UNSW or with an authorised research team.
    </p>
  `,
];

const studyInstructionPages = [
  `
    <p><strong>Memory Learning Phase Instructions</strong></p>
    <p>There are three parts to this face test. You will now begin Part 1, the Memory Learning Phase.</p>
  `,
  `
    <p>You will be shown 20 faces, one after another.</p>
    <p>Try to memorise these faces because you will be tested on them in the next part.</p>
    <p>Faces appear automatically, so you do not need to press any keys during Part 1.</p>
  `,
  `
    <p class="mobile-warning">
      This task works best on a desktop or laptop computer. The original UNSW test is not designed
      for mobile use, and this recreation keeps the same assumption.
    </p>
  `,
];

const memoryInstructionPages = [
  `
    <p><strong>Memory Test Instructions</strong></p>
    <p>For each face, decide whether that person appeared during the learning phase.</p>
  `,
  `
    <p>
      This recognition test is intentionally difficult because the appearance of faces may change
      due to age, lighting, pose, expression, or head angle.
    </p>
  `,
  `
    <p>If you studied the face earlier, respond <strong>Y</strong> for Yes.</p>
    <p>If you did not study the face earlier, respond <strong>N</strong> for No.</p>
  `,
  `
    <p>
      When a studied identity reappears, it uses a different photo of the same person. Those
      trials should still be answered with <strong>Yes</strong>.
    </p>
  `,
];

const matchingInstructionPages = [
  `
    <p><strong>Sorting Instructions</strong></p>
    <p>In this block you will be tested on your ability to find images that match a target face.</p>
  `,
  `
    <p>
      On each trial you will first see a target face. After the target disappears, classify a set
      of four images according to whether they match that target or not.
    </p>
    <p>Any number of the four images may match the target, including zero or all four.</p>
  `,
  `
    <p>Move matching faces to the <strong>right</strong> side and nonmatching faces to the <strong>left</strong> side.</p>
    <p>You can drag cards between columns or use each card’s quick-classify buttons.</p>
    <img src="./assets/example/exampleScreen.jpg" alt="Example of the matching screen">
  `,
  `
    <p>We will start with two practice trials.</p>
    <p>
      Respond as quickly and accurately as you can. You may take your time, but this task relies on
      face information held in memory, so overthinking is not always helpful.
    </p>
  `,
];

main().catch(renderFatalError);

async function main() {
  await showLanding();
  await showConsent();
  await collectDemographics();
  await showInstructionSet("Important Note", disclaimerPages, "Continue");
  await showInstructionSet("Part 1", studyInstructionPages, "Begin Memory Learning");
  await requestFullscreenSafe();
  await runStudyPhase();
  await showInstructionSet("Part 2", memoryInstructionPages, "Begin Memory Test");
  await runMemoryPhase();
  await showInstructionSet("Part 3", matchingInstructionPages, "Begin Practice");
  await runMatchingBlock(data.practiceTrials, true);
  await showInstructionSet(
    "Practice Complete",
    ["<p><strong>End of practice trials.</strong></p><p>Click below to begin the scored matching trials.</p>"],
    "Begin Real Trials",
  );
  await runMatchingBlock(data.matchingTrials, false);
  await collectContact();
  await showInstructionSet("Final Note", disclaimerPages, "See Results");
  renderResults();
}

function renderBaseScreen({ step, title, subtitle, sideHtml, bodyHtml, actions }) {
  const actionMarkup = actions
    .map(
      (action) =>
        `<button id="${action.id}" class="button ${action.className || "button-primary"}" ${
          action.disabled ? "disabled" : ""
        }>${action.label}</button>`,
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
        <strong>Session IDs</strong>
        <div class="pill-row">
          <span class="pill-neutral">${state.subjectId}</span>
          <span class="pill-neutral">${state.subjectId2}</span>
        </div>
      </div>
      <div class="mini-panel">
        <strong>Task Structure</strong>
        <p class="panel-copy">20 study faces, 40 memory trials, 20 matching trials, and local CSV export.</p>
      </div>
      ${extraHtml}
    </div>
  `;
}

async function showLanding() {
  app.innerHTML = `
    <section class="screen">
      <article class="panel hero">
        <div class="hero-copy">
          <p class="eyebrow">Public-Test Recreation</p>
          <h2>Local Face Test App</h2>
          <p>
            This is a local recreation of the public UNSW Face Test flow. It keeps the original
            three-part structure: study faces, recognise previously seen identities, and classify
            matches after a brief target preview.
          </p>
          <div class="hero-actions">
            <button id="start-app" class="button button-primary">Start Test</button>
            <button id="learn-more" class="button button-secondary">What Changed?</button>
          </div>
        </div>
        <div class="hero-aside">
          <div class="notice-card">
            <strong>Desktop Recommended</strong>
            <p class="panel-copy">
              The original test is not mobile compatible. This recreation works best on a larger
              screen with a mouse or trackpad.
            </p>
          </div>
          <div class="notice-card">
            <strong>Local Output</strong>
            <p class="panel-copy">
              The original site posts results to a server. This version keeps the flow local and
              lets you download a CSV at the end.
            </p>
          </div>
          <div class="notice-card">
            <strong>Scoring</strong>
            <p class="panel-copy">
              Memory trials contribute 40 points, matching trials contribute 80 points, and the
              final percentage is based on 120 total points.
            </p>
          </div>
        </div>
      </article>
    </section>
  `;

  const startButton = document.getElementById("start-app");
  const learnMoreButton = document.getElementById("learn-more");

  await new Promise((resolve) => {
    startButton.addEventListener("click", resolve, { once: true });
    learnMoreButton.addEventListener(
      "click",
      () => {
        window.alert(
          "This local recreation replaces the original server-side save with an on-device CSV export and keeps the public trial flow self-contained in this folder.",
        );
      },
      { once: false },
    );
  });
}

async function showConsent() {
  renderBaseScreen({
    step: "Consent",
    title: "Participation And Local Data Handling",
    subtitle: "The original public test uses a consent screen before starting. This recreation keeps the same checkpoint.",
    sideHtml: sessionInfoHtml(`
      <div class="mini-panel">
        <strong>What You Are Agreeing To</strong>
        <p class="panel-copy">Continue voluntarily, complete the task locally, and optionally download your own results file.</p>
      </div>
    `),
    bodyHtml: `
      <div class="consent-box">
        <p><strong>Summary</strong></p>
        <p>This task measures face memory and face matching ability using unfamiliar faces.</p>
        <p>Your participation here is voluntary. You can stop at any point by closing the page.</p>
        <p>No data are uploaded by this local recreation. Results stay in the browser session until you choose to download them as a CSV file.</p>
        <p>If you would like the workflow to mimic the public site as closely as possible, please complete the task in one sitting on a desktop or laptop.</p>
      </div>
      <label class="check-row">
        <input id="consent-checkbox" type="checkbox">
        <span>I have read the local-use summary above and I want to continue.</span>
      </label>
    `,
    actions: [{ id: "continue-consent", label: "Continue To Demographics", className: "button-primary", disabled: true }],
  });

  const checkbox = document.getElementById("consent-checkbox");
  const button = document.getElementById("continue-consent");
  checkbox.addEventListener("change", () => {
    button.disabled = !checkbox.checked;
  });

  await waitForClick(button);

  record({
    section: "consent",
    response: "agreed",
  });
}

async function collectDemographics() {
  renderBaseScreen({
    step: "Demographics",
    title: "Participant Questions",
    subtitle: "These mirror the prompts used before the public test begins.",
    sideHtml: sessionInfoHtml(`
      <div class="mini-panel">
        <strong>Required Fields</strong>
        <p class="panel-copy">Age bracket, gender, and ethnic background are required to continue. Numeric age remains optional.</p>
      </div>
    `),
    bodyHtml: `
      <form id="demographic-form" class="fields">
        <div class="field">
          <label for="age">Age In Years</label>
          <input id="age" name="age" type="number" min="0" max="120" placeholder="Optional">
          <p class="field-help">This mirrors the numeric age prompt shown before the task.</p>
        </div>
        <div class="field">
          <label for="age-bracket">Age Bracket</label>
          <select id="age-bracket" name="ageBracket" required>
            <option value="">Select an option</option>
            ${ageChoices.map((choice) => `<option value="${choice}">${choice}</option>`).join("")}
          </select>
        </div>
        <div class="field">
          <label for="gender">Gender</label>
          <select id="gender" name="gender" required>
            <option value="">Select an option</option>
            ${genderChoices.map((choice) => `<option value="${choice}">${choice}</option>`).join("")}
          </select>
        </div>
        <div class="field">
          <label for="ethnicity">Ethnic Background</label>
          <select id="ethnicity" name="ethnicity" required>
            <option value="">Select an option</option>
            ${ethnicityChoices.map((choice) => `<option value="${choice}">${choice}</option>`).join("")}
          </select>
        </div>
      </form>
    `,
    actions: [{ id: "save-demographics", label: "Continue", className: "button-primary" }],
  });

  const form = document.getElementById("demographic-form");
  const button = document.getElementById("save-demographics");

  await new Promise((resolve) => {
    button.addEventListener("click", () => {
      if (!form.reportValidity()) {
        return;
      }
      state.demographics = {
        age: document.getElementById("age").value.trim(),
        ageBracket: document.getElementById("age-bracket").value,
        gender: document.getElementById("gender").value,
        ethnicity: document.getElementById("ethnicity").value,
      };
      record({
        section: "demographics",
        ...state.demographics,
      });
      resolve();
    });
  });
}

async function showInstructionSet(stepLabel, pages, finalLabel) {
  for (let index = 0; index < pages.length; index += 1) {
    renderBaseScreen({
      step: stepLabel,
      title: "Instructions",
      subtitle: `Page ${index + 1} of ${pages.length}`,
      sideHtml: sessionInfoHtml(`
        <div class="mini-panel">
          <strong>Reminder</strong>
          <p class="panel-copy">The local recreation keeps the original three-part sequence and timing.</p>
        </div>
      `),
      bodyHtml: `<div class="copy-box">${pages[index]}</div>`,
      actions: [
        {
          id: "next-page",
          label: index === pages.length - 1 ? finalLabel : "Next",
          className: index === pages.length - 1 ? "button-primary" : "button-secondary",
        },
      ],
    });

    await waitForClick(document.getElementById("next-page"));
  }
}

async function runStudyPhase() {
  for (let index = 0; index < state.studyOrder.length; index += 1) {
    const stimulus = state.studyOrder[index];
    app.innerHTML = `
      <section class="screen">
        <article class="panel trial-shell">
          <div class="trial-header">
            <div>
              <p class="step-label">Part 1 Of 3</p>
              <h2 class="panel-title">Remember This Person</h2>
            </div>
            <div class="pill-row">
              <span class="pill-neutral">Study Face ${index + 1} of ${state.studyOrder.length}</span>
              <span class="pill-neutral">5 seconds</span>
            </div>
          </div>
          <div class="progress-bar"><span id="study-progress"></span></div>
          <div class="stimulus-frame">
            <img src="${assetPath(stimulus)}" alt="Study face ${index + 1}">
          </div>
          <p class="trial-note">Faces advance automatically during the learning phase.</p>
        </article>
      </section>
    `;

    record({
      section: "study",
      trialIndex: index + 1,
      stimulus,
      viewedMs: data.settings.viewingTimeMs,
    });

    await animateProgress(document.getElementById("study-progress"), data.settings.viewingTimeMs);
  }
}

async function runMemoryPhase() {
  for (let index = 0; index < state.memoryOrder.length; index += 1) {
    const trial = state.memoryOrder[index];
    const result = await showMemoryTrial(trial, index + 1, state.memoryOrder.length);
    state.memoryResults.push(result);
    record({
      section: "memory",
      trialIndex: index + 1,
      stimulus: trial.stimulus,
      trialType: trial.trialType,
      response: result.response,
      rtMs: result.rtMs,
      correct: result.correct,
      points: result.points,
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
            <img src="${assetPath(trial.stimulus)}" alt="Memory trial face ${trialNumber}">
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

    const start = performance.now();
    const yesButton = document.getElementById("memory-yes");
    const noButton = document.getElementById("memory-no");

    const finish = (response) => {
      window.removeEventListener("keydown", handleKeydown);
      const rtMs = Math.round(performance.now() - start);
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
      if (key === "y") {
        finish("Y");
      } else if (key === "n") {
        finish("N");
      }
    };

    yesButton.addEventListener("click", () => finish("Y"), { once: true });
    noButton.addEventListener("click", () => finish("N"), { once: true });
    window.addEventListener("keydown", handleKeydown);
  });
}

async function runMatchingBlock(trials, isPractice) {
  for (let index = 0; index < trials.length; index += 1) {
    const trial = trials[index];
    await showMatchingPreview(trial, index + 1, trials.length, isPractice);
    const result = await showMatchingSorter(trial, index + 1, trials.length, isPractice);
    state.matchingResults.push(result);
    record({
      section: isPractice ? "matching_practice" : "matching",
      trialIndex: index + 1,
      trialId: trial.id,
      target: trial.target,
      stimuli: trial.stimuli.join(" | "),
      assignments: result.details.map((detail) => `${detail.path}:${detail.assigned}`).join(" | "),
      answerKey: result.details.map((detail) => `${detail.path}:${detail.expected}`).join(" | "),
      points: result.points,
      practice: isPractice,
    });
  }
}

async function showMatchingPreview(trial, trialNumber, totalTrials, isPractice) {
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
            <span class="pill-neutral">Target visible for 5 seconds</span>
          </div>
        </div>
        <div class="progress-bar"><span id="match-preview-progress"></span></div>
        <div class="stimulus-frame">
          <img src="${assetPath(trial.target)}" alt="Target face for trial ${trialNumber}">
        </div>
        <p class="trial-note">Memorise the target. The target will disappear before classification begins.</p>
      </article>
    </section>
  `;

  record({
    section: isPractice ? "matching_practice_preview" : "matching_preview",
    trialIndex: trialNumber,
    trialId: trial.id,
    target: trial.target,
  });

  await animateProgress(document.getElementById("match-preview-progress"), data.settings.viewingTimeMs);
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
              <span class="pill-neutral">Target hidden</span>
            </div>
          </div>
          <p class="trial-note">Drag cards or use the quick buttons. All four cards must be classified before submission.</p>
          <div class="sort-layout">
            <section class="zone" data-zone="left">
              <div class="zone-header">
                <h3>Nonmatch Left</h3>
                <span class="zone-count" id="count-left">0</span>
              </div>
              <div class="cards" id="zone-left"></div>
            </section>
            <section class="zone" data-zone="center">
              <div class="zone-header">
                <h3>Waiting Area</h3>
                <span class="zone-count" id="count-center">4</span>
              </div>
              <div class="cards" id="zone-center"></div>
            </section>
            <section class="zone" data-zone="right">
              <div class="zone-header">
                <h3>Matching Right</h3>
                <span class="zone-count" id="count-right">0</span>
              </div>
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

    const submitButton = document.getElementById("submit-sort");
    const resetButton = document.getElementById("reset-sort");
    const assignments = Object.fromEntries(trial.stimuli.map((path) => [path, "center"]));
    const cards = {};

    const updateCounts = () => {
      const counts = { left: 0, center: 0, right: 0 };
      Object.values(assignments).forEach((zone) => {
        counts[zone] += 1;
      });
      countNodes.left.textContent = counts.left;
      countNodes.center.textContent = counts.center;
      countNodes.right.textContent = counts.right;
      submitButton.disabled = counts.center > 0;
    };

    const moveCard = (path, zone) => {
      assignments[path] = zone;
      containers[zone].appendChild(cards[path]);
      updateCounts();
    };

    const createCard = (path) => {
      const card = document.createElement("article");
      card.className = "card";
      card.draggable = true;
      card.dataset.path = path;
      card.innerHTML = `
        <img src="${assetPath(path)}" alt="Candidate face">
        <div class="card-actions">
          <button type="button" data-move="left">Nonmatch</button>
          <button type="button" data-move="right">Match</button>
        </div>
      `;

      card.addEventListener("dragstart", (event) => {
        event.dataTransfer.setData("text/plain", path);
        card.classList.add("dragging");
      });

      card.addEventListener("dragend", () => {
        card.classList.remove("dragging");
      });

      card.querySelectorAll("button").forEach((button) => {
        button.addEventListener("click", () => {
          moveCard(path, button.dataset.move);
        });
      });

      return card;
    };

    trial.stimuli.forEach((path) => {
      cards[path] = createCard(path);
      moveCard(path, "center");
    });

    document.querySelectorAll(".zone").forEach((zoneElement) => {
      zoneElement.addEventListener("dragover", (event) => {
        event.preventDefault();
      });
      zoneElement.addEventListener("drop", (event) => {
        event.preventDefault();
        const path = event.dataTransfer.getData("text/plain");
        const zone = zoneElement.dataset.zone;
        if (path && zone) {
          moveCard(path, zone);
        }
      });
    });

    resetButton.addEventListener("click", () => {
      trial.stimuli.forEach((path) => {
        moveCard(path, "center");
      });
    });

    submitButton.addEventListener("click", () => {
      const details = trial.stimuli.map((path, index) => {
        const expected = trial.answers[index];
        const assigned = assignments[path];
        return {
          path,
          expected,
          assigned,
          correct: expected === assigned,
        };
      });
      const points = details.filter((detail) => detail.correct).length;
      resolve({
        trialId: trial.id,
        practice: isPractice,
        points,
        details,
      });
    });

    updateCounts();
  });
}

async function collectContact() {
  renderBaseScreen({
    step: "Contact",
    title: "Optional Contact Details",
    subtitle: "The public task offers an optional email field before showing results. This recreation keeps it local.",
    sideHtml: sessionInfoHtml(`
      <div class="mini-panel">
        <strong>Optional</strong>
        <p class="panel-copy">Leave this blank if you only want the scores and the downloadable CSV file.</p>
      </div>
    `),
    bodyHtml: `
      <div class="field field-full">
        <label for="contact-email">Email Address</label>
        <input id="contact-email" type="email" placeholder="Optional">
        <p class="field-help">No email is sent anywhere by this app. The value is only included in the downloaded CSV.</p>
      </div>
    `,
    actions: [{ id: "save-contact", label: "Continue To Results", className: "button-primary" }],
  });

  await waitForClick(document.getElementById("save-contact"));
  state.contactEmail = document.getElementById("contact-email").value.trim();
  record({
    section: "contact",
    email: state.contactEmail,
  });
}

function renderResults() {
  const scores = computeScores();
  const benchmarks = data.percentileBenchmarks;

  app.innerHTML = `
    <section class="screen">
      <article class="panel hero">
        <div class="hero-copy">
          <p class="eyebrow">Results</p>
          <h2>Face Test Complete</h2>
          <p class="results-copy">
            Thank you for completing the local recreation. Your scores below follow the same public
            scoring split used by the original UNSW task.
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
            <button id="download-csv" class="button button-primary">Download CSV</button>
            <button id="restart-test" class="button button-secondary">Restart</button>
          </div>
        </div>
        <div class="hero-aside">
          <div class="notice-card">
            <strong>Percentile Benchmarks</strong>
            <p class="panel-copy">Top 5%: ${benchmarks.top5}% and above</p>
            <p class="panel-copy">Top 10%: ${benchmarks.top10}% and above</p>
            <p class="panel-copy">Top 25%: ${benchmarks.top25}% and above</p>
            <p class="panel-copy">Top 50%: ${benchmarks.top50}% and above</p>
          </div>
          <div class="notice-card">
            <strong>Local Export</strong>
            <p class="panel-copy">The CSV includes demographics, response-level logs, optional contact email, and session IDs.</p>
          </div>
          <div class="notice-card">
            <strong>Original Finish Flow</strong>
            <p class="panel-copy">The public site redirects to a separate finish page. This local recreation keeps the finish state here and offers immediate export.</p>
          </div>
        </div>
      </article>
    </section>
  `;

  document.getElementById("download-csv").addEventListener("click", () => {
    const filename = `face-test-local-${state.subjectId}-${state.subjectId2}.csv`;
    downloadCsv(filename, buildCsv(scores));
  });

  document.getElementById("restart-test").addEventListener("click", () => {
    window.location.reload();
  });
}

function computeScores() {
  const memoryPoints = state.memoryResults.reduce((total, trial) => total + trial.points, 0);
  const matchPoints = state.matchingResults
    .filter((trial) => !trial.practice)
    .reduce((total, trial) => total + trial.points, 0);
  return {
    memoryPoints,
    matchPoints,
    overallPercent: Math.round(((memoryPoints + matchPoints) / 120) * 100),
  };
}

function buildCsv(scores) {
  const rows = [
    {
      rowType: "summary",
      subject: state.subjectId,
      subject2: state.subjectId2,
      sessionStartedAt: state.sessionStartedAt,
      age: state.demographics.age,
      ageBracket: state.demographics.ageBracket,
      gender: state.demographics.gender,
      ethnicity: state.demographics.ethnicity,
      contactEmail: state.contactEmail,
      memoryPoints: scores.memoryPoints,
      matchPoints: scores.matchPoints,
      overallPercent: scores.overallPercent,
    },
    ...state.records,
  ];

  const headers = [...new Set(rows.flatMap((row) => Object.keys(row)))];
  const lines = [
    headers.join(","),
    ...rows.map((row) => headers.map((header) => csvCell(row[header] ?? "")).join(",")),
  ];
  return lines.join("\n");
}

function record(entry) {
  state.records.push({
    rowType: "event",
    subject: state.subjectId,
    subject2: state.subjectId2,
    timestamp: new Date().toISOString(),
    ...entry,
  });
}

function csvCell(value) {
  const text = String(value).replace(/"/g, '""');
  return `"${text}"`;
}

function waitForClick(element) {
  return new Promise((resolve) => {
    element.addEventListener("click", resolve, { once: true });
  });
}

function assetPath(relativePath) {
  return `./assets/${relativePath}`;
}

function shuffle(items) {
  const copy = [...items];
  for (let index = copy.length - 1; index > 0; index -= 1) {
    const swapIndex = Math.floor(Math.random() * (index + 1));
    [copy[index], copy[swapIndex]] = [copy[swapIndex], copy[index]];
  }
  return copy;
}

function animateProgress(fillElement, durationMs) {
  return new Promise((resolve) => {
    const start = performance.now();
    const tick = (now) => {
      const progress = Math.min((now - start) / durationMs, 1);
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
  } catch (error) {
    record({
      section: "fullscreen",
      response: "denied_or_unavailable",
    });
  }
}

function downloadCsv(filename, content) {
  const blob = new Blob([content], { type: "text/csv;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = filename;
  document.body.appendChild(link);
  link.click();
  link.remove();
  URL.revokeObjectURL(url);
}

function renderFatalError(error) {
  console.error(error);
  app.innerHTML = `
    <section class="screen">
      <article class="panel content-panel">
        <p class="step-label">Error</p>
        <h2 class="screen-title">The app hit an unexpected problem.</h2>
        <p class="screen-subtitle">Open the browser console for more detail, then reload the page.</p>
        <pre class="copy-box">${escapeHtml(String(error))}</pre>
      </article>
    </section>
  `;
}

function escapeHtml(text) {
  return text
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;");
}
