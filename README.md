# 清译 · Clearling

Chromium Manifest V3 extension for automatic Simplified Chinese translation.
Version 0.4 defaults to translation-only reading, with bilingual and original
modes available in the popup and settings. The default model is MiMo V2.6 Flash
with thinking disabled. Model selection now includes 19 presets with search and family grouping. The
comparison workspace and result export have been removed. Popup and settings
use the same black surfaces, controls and typography in every OS theme.

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

Version 0.4.0 is supplied as a ZIP package. To update an existing unpacked
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

Version 0.4.0 passes 33 Node tests, 11 reading checks and nine UI checks in
each browser. The 0.3 reading engine previously passed 16 presentation checks
in each browser (`scripts/verify-reading.mjs`,
`scripts/verify-presentation.mjs`, corresponding JSON reports in `artifacts/`).
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
Unsafe mixed containers retain their original controls and content. Image text,
video, scanned PDF, closed Shadow DOM and browser-restricted pages are not
covered by this DOM translator.

Viewport priority, bounded directional prefetch, shared paragraph requests
and incremental cache replies reduce avoidable waiting. Already-dispatched
valid work can finish and warm the cache after scrolling; queued distant work
is cancelled. Presentation changes do not invalidate translation requests.

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
