# Code Guide

This guide is for the next agent taking over work on the local face-test recreation.

## Purpose

This app recreates the public UNSW Face Test flow as a self-contained local web app.

It keeps these major behaviors:

- Consent and demographics intake
- Study phase with 20 timed faces
- Memory recognition phase with 40 trials
- Matching phase with 2 practice trials and 20 scored trials
- Final score summary
- Local CSV download instead of the original server-side save

It does not depend on the original UNSW backend once the files are present locally.

## Main Folders

- [index.html](C:/Users/00298204/Dropbox/teaching/psychology_2/Psy2015f/r4psy2026/facetest-clone/index.html:1)
  Entry point for the app.
- [app.css](C:/Users/00298204/Dropbox/teaching/psychology_2/Psy2015f/r4psy2026/facetest-clone/app.css:1)
  All app styling.
- [app.js](C:/Users/00298204/Dropbox/teaching/psychology_2/Psy2015f/r4psy2026/facetest-clone/app.js:1)
  Main runtime, state, screen rendering, timing, scoring, and CSV export.
- [data/face-test-data.js](C:/Users/00298204/Dropbox/teaching/psychology_2/Psy2015f/r4psy2026/facetest-clone/data/face-test-data.js:1)
  Generated dataset injected as `window.FACE_TEST_DATA`.
- `assets/`
  Downloaded images used by the study, memory, practice, and matching phases.

## Source Of Truth

The current app is driven by `window.FACE_TEST_DATA`.

That object includes:

- `settings`
- `studyFaces`
- `memoryTrials`
- `practiceTrials`
- `matchingTrials`
- `percentileBenchmarks`

The runtime assumes this structure exists before `app.js` runs.

## How The Data Was Built

The local data bundle and assets were generated from the saved public UNSW page source using:

- [scripts/facetest_clone_builder.py](C:/Users/00298204/Dropbox/teaching/psychology_2/Psy2015f/r4psy2026/scripts/facetest_clone_builder.py:1)

That builder:

- Parses `.tmp-facetest/UNSWfacetestlink.html`
- Extracts the matching trial order and answer keys
- Generates `data/face-test-data.js`
- Downloads required assets into `facetest-clone/assets`

If trials or assets need regeneration, rerun:

```powershell
py scripts/facetest_clone_builder.py
```

After updating the source copy under the repo, copy the folder to:

- `C:\Users\00298204\Downloads\facetest-clone`

## Runtime Structure

The app is a lightweight single-page flow with manual rendering.

Important `app.js` areas:

- `state`
  Holds session IDs, demographics, contact email, randomized trial orders, and event records.
- `main()`
  Defines the whole test flow in sequence.
- `renderBaseScreen()`
  Shared layout renderer for consent, demographics, instructions, and contact screens.
- `runStudyPhase()`
  Timed exposure of study faces.
- `runMemoryPhase()` and `showMemoryTrial()`
  Recognition test and scoring.
- `runMatchingBlock()`, `showMatchingPreview()`, and `showMatchingSorter()`
  Matching preview, drag/drop sorting UI, and point assignment.
- `computeScores()`
  Final summary scoring.
- `buildCsv()` and `downloadCsv()`
  Local export path that replaces the original `save_data.php` behavior.

## Scoring Rules

The recreated scoring follows the public page logic:

- Memory section: 40 total points
- Matching section: 80 total points
- Overall score: `round((memory + matching) / 120 * 100)`

Practice matching trials are recorded but excluded from the final matching score.

## Key Differences From The Public Site

- No `jsPsych`
  The original page uses older `jsPsych` plugins. This recreation is plain HTML/CSS/JS.
- No backend post
  The original sends CSV to `save_data.php`. This version stores data in memory and offers CSV download.
- No redirect to the public finish page
  Results are shown locally inside the app.
- UI is modernized
  The flow is still faithful, but the presentation is newer and easier to maintain.

## Things To Be Careful About

- `requestFullscreenSafe()` is best-effort only. It may fail silently depending on browser policy.
- The matching UI supports both drag/drop and button-based classification. If you change card markup, make sure both paths still work.
- `showMatchingSorter()` assumes exactly 4 stimuli per matching trial.
- `buildCsv()` uses event-style rows plus one summary row. If another system consumes this CSV, preserve the current headers or coordinate the schema change.
- `assetPath()` assumes the app is served from the `facetest-clone` root.

## Known Gaps

- I did not run a full automated browser smoke test in this environment.
- I did not reproduce the exact old consent page HTML; the current consent screen is a local-use summary that keeps the same checkpoint in the flow.
- The public site’s social/share/finish pages were not rebuilt because the task focus was the test app itself.
- The app works best opened from a desktop browser; mobile remains a weak target just like the original.

## Best Next Tasks For A New Agent

- Do a live browser pass through all phases and confirm the timing/flow feels right.
- Check that drag/drop works in the target browser and that the button fallback is still usable.
- Validate the CSV contents after one full run.
- If parity matters, compare wording and percentile text against the current public site.
- If deployment is needed, add a tiny local server recommendation or package it for static hosting.

## File Placement

There are currently two copies of this app:

- Source copy in the repo:
  `C:\Users\00298204\Dropbox\teaching\psychology_2\Psy2015f\r4psy2026\facetest-clone`
- Delivered copy in Downloads:
  `C:\Users\00298204\Downloads\facetest-clone`

If you change the repo copy, remember to copy the updated folder into `Downloads` again if that delivered copy is the one being used.
