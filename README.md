# 清译 · Clearling

Chromium Manifest V3 extension for automatic Simplified Chinese translation.
Version 0.5 starts new installations in Microsoft fast translation mode, without
requiring a gateway or API key. AI precision mode keeps the 19 model presets,
connection settings and model preferences. Older installations retain their AI
selection until the reading engine is explicitly changed. Waiting and failed
translations keep the original readable; translation-only replacement happens
only when a valid translation is ready. Fast and AI results use separate cache
identities, while existing AI cache identities remain valid.

The current source refines that interface with neutral black-and-white surfaces,
clear connection setup, visible unsaved changes and progress during validation.
Connection tests require saving the form first; model controls stay locked while
their selection is being validated. Site controls follow changes from other
extension windows.

## Build

Node 24 or later. Run `npm install`, `npm test`, and `npm run build`. The
loadable extension is `dist/`. Source modules live in `extension/`.

## Daily Browser Installation

As verified on 2026-10-01, version 0.3.0 is enabled in the everyday Chrome
Praise profile and Ego Lite Profile 3, loaded normally from this project's
`dist/` directory. Refresh existing webpages after an extension update so they
receive the new content script. Existing connection settings are preserved.
The settings page detects an updated unpacked build and uses the normal
`chrome.runtime.reload()` API before running new UI code. Developer mode must
remain enabled. `scripts/update-local-chrome.mjs` opens the installed settings
page and verifies a nonce-bound loopback receipt containing version and safe
configuration metadata only; it does not read or change browser profiles.

## Optional Isolated Test Entrances

The local applications `~/Applications/清译 Chrome.app` and
`~/Applications/清译 Ego.app` open dedicated Clearling browser profiles. Each
launch uses Chromium's supported CDP unpacked-extension loading. This is a
session installation: current Chrome/Ego remove CDP-installed extensions on
restart, so the launcher restores the extension every time. It does not change
your everyday profiles. The launcher uses private pipes, not a TCP debugger.

Source entrypoints are `scripts/Open-Clearling-Chrome.command` and
`scripts/Open-Clearling-Ego.command`. For persistent installation in a normal
profile, use the browser's developer-mode Load Unpacked flow with `dist/`;
desktop automation and protected preferences are not modified by this project.

## Connection

In the extension's connection settings, supply the paired inference gateway
endpoint and API key. Select Cindy's normalized ChatAPI or a native compatible
API. The key is stored only in the extension's trusted local context, never in
sync, source, build output or exports. Browser local storage is not a system
keychain. This project does not read Cindy's credentials, databases or UI.

Model availability and thinking behavior must be verified with the actual
gateway. GLM 5.3 Flash cannot disable native thinking. Qwen's native protocol
uses enable_thinking, while Cindy's documented adapter uses thinking.type.

Version 0.5.2 is supplied as a ZIP package. To update an existing unpacked
installation while retaining its settings, replace files in the existing loaded
directory and reload the extension; refresh existing webpages afterward. Avoid
running two Clearling copies on the same page.

Fresh installations start unconfigured. Supply credentials through the
password field, not source code, a report or a public conversation. The user's
configured gateway has completed public-sample requests for 18 of the 19
presets; GPT-5.6 Luna returned HTTP 429 twice. The complete pricing criteria and
request contracts are in `docs/model-contracts.md`. Credentials were not extracted. These single
samples establish connectivity, not a model quality or speed ranking.

## Validation

`npm run serve` hosts a public fixture and a synthetic provider. These results
verify extension behavior only; they are not AI translations or quality scores.
Real installation requires Chrome/Ego to load the MV3 manifest, run its worker
and automatically inject its isolated content script. Merely injecting a
JavaScript file is not installation evidence.

The source has 56 Node tests. Browser checks run through
`scripts/verify-reading.mjs`, `scripts/verify-ui.mjs`,
`scripts/verify-presentation.mjs` and `scripts/verify-layout.mjs`, with JSON
reports and UI screenshots in the ignored `artifacts/` directory.
Browser regressions use a synthetic provider and isolated profiles. They cover
X replies, short replies, layout geometry, inline code, editors, dynamic and
recycled nodes, caching, narrow screens, and transport-disconnection recovery.
The new checks cover three display modes, article cards and details, links,
table columns, late open Shadow DOM, frames, failure recovery, disconnected
Ports, and a thousand-entry feed with end-to-start navigation. Separately, the
configured daily Ego installation translated the public X Article title and
body, its profile cards, and a multilingual ordinary webpage.

X rules distinguish tweet bodies, Article card title/summary, Article title
and rich-text blocks. Original nodes stay in place and can be restored; links
and inline code are rebuilt from local typed mappings, never model HTML.

Version 0.5.1 corrects translation-only reading of X Article lists whose native
numbering uses CSS counters. It hides the verified inner text block after a
successful translation while keeping the original list item, marker and
indentation. Bilingual and original modes restore that same text block;
pending or failed translations keep it readable. Chrome/Ego regressions also
cover replaced source blocks, removed projections and dynamically added controls.
Image text,
video, scanned PDF, closed Shadow DOM and browser-restricted pages are not
covered by this DOM translator.

Version 0.5.2 preserves generic-page elements, native styles and event listeners
by updating existing text nodes in translation-only mode. Only explicitly selected
bilingual mode inserts a translated block. Original mode restores the original
text, while a subsequent website edit wins over an older stored value. Results
are checked against protected text slots before any write; unmappable results
leave the original readable. Waiting and failed requests add no placeholder row.
Short sentence punctuation outside the outermost inline tags may use an owned
text node, which is removed on original-mode restoration; no wrapper element is
introduced. Website edits or removal of that node are respected.
If Microsoft loses markers in densely formatted prose, the same fast provider
retries its readable text slots and reassembles the original formatting locally.
Protected code and controls stay local; this does not switch to the paid AI path.

Layout containers and common author/time metadata are excluded from generic
paragraph detection. Chinese technical labels and unchanged translations do not
produce a second copy. Normal HTML indentation collapses as the browser would;
explicit BR and pre-wrap line breaks remain local and protected. Translated text
can naturally wrap or change intrinsic content widths, but the extension does
not replace host layout boxes or insert hidden source wrappers.

`scripts/verify-compatibility.mjs` checks timeline metadata, decorated headings,
rich inline text, native controls, grids, flex, tables and dynamic content in
isolated Chrome/Ego profiles. `scripts/verify-public-layout.mjs` checks native
structure and mode switching on public documentation/readme pages with the real
Microsoft provider; it records metadata only and requires no user login.

Dynamic controls trigger placement re-evaluation without replacing their event
listeners. Protected link/formatting tokens must remain in order before results
can be cached, and paragraph breaks remain distinct in cache keys and between
translation chunks. The cache namespace changed, so older entries are not reused;
the first revisit can require a new request.

Viewport priority, bounded directional prefetch, shared paragraph requests
and incremental cache replies reduce avoidable waiting. Already-dispatched
valid work can finish and warm the cache after scrolling; queued distant work
is cancelled. Cancelled members of a shared batch can safely subscribe again.
Original-only reading pauses new paragraph requests until translated or bilingual
reading resumes. Presentation changes do not invalidate translation results.

To validate a change without overwriting an everyday installation's `dist/`:

```sh
CLEARLING_BUILD_DIR=artifacts/build-review npm run build
CLEARLING_BUILD_DIR=artifacts/build-review node scripts/verify-browser.mjs chrome
CLEARLING_BUILD_DIR=artifacts/build-review node scripts/verify-presentation.mjs chrome
CLEARLING_BUILD_DIR=artifacts/build-review node scripts/verify-layout.mjs chrome
```

Repeat the browser commands with `ego` for Ego Lite. These commands use isolated
QA profiles and a synthetic provider; they do not establish real model quality or
gateway speed.

`scripts/benchmark-reading.mjs` runs slow/fast/jump traces with cold/revisited
cache states in isolated profiles. Reports explicitly distinguish completed
latency samples from abandoned offscreen work and verify final visible content.
The fixed 35ms synthetic provider measures client scheduling, not real model
speed. Revisiting a route is not necessarily a fully warm cache if the first
pass cancelled unseen work. No controlled benchmark against Immersive Translate
has been completed; this release does not claim proven superiority over it.

## Assets

Tool icons and the raster extension glyph derive from Lucide 0.468.0 (ISC).
Bundled dependencies retain their license notices. No remote scripts are used.

## Fast Translation Validation and Daily Updates

`node scripts/verify-fast.mjs chrome` and the equivalent `ego` command use a
synthetic Microsoft-shaped provider in an isolated MV3 profile. They verify
no-key dispatch, readable pending/failure states, protected links/code, caching,
and AI/fast switching. Add `--live` for three defined public samples against the
real Microsoft service; real results are marked separately. These checks do not
establish a universal translation-quality or speed ranking. The fast endpoint
is a browser translation interface, and availability can change; failures keep
the original visible and do not silently use the paid AI connection.

`node scripts/verify-upgrade.mjs chrome` (or `ego`) checks 0.4.0 → current,
including the saved model, reading mode, automatic switch and authenticated
synthetic gateway connection.

After building the approved release in an existing loaded directory, run
`node scripts/update-installed.mjs chrome --activate-fast` or
`node scripts/update-installed.mjs ego --activate-fast`. The updater verifies
the existing extension ID/version through a one-time loopback handshake,
selects fast reading through the extension's normal API, preserves the AI
connection/model, and opens a defined public translation sample when reading
is enabled. It does not write browser preferences or copy credentials. Existing
webpages need a refresh to receive the updated content script. This updater
requires an already enabled installation; first installation still uses the
browser's supported Load Unpacked flow.
