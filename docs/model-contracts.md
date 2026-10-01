# Model request contracts — 0.4.0

The default remains MiMo V2.6 Flash, thinking disabled. There are 19 unique
presets: the original six plus thirteen new entries from Cindy's current
text-model price directory. Comparison and export have been removed.

## Directory and pricing

Snapshot: 2026-10-02. Source:
https://model-access.cindy.app/api/model-access/models?schemaVersion=5

The directory returned 41 models, including 37 text chat models. All 16 text
models meeting both thresholds are included: effective input <= USD 0.75 and
output <= USD 4.50 per million tokens. Effective price is listed price times
`costDiscount`. This is a public gateway catalog snapshot, not a promise about
a user's tenant invoice. MiMo Flash/Pro and GPT-5.4 Mini retain their existing
presets with unknown gateway price; provider reference prices are not substituted.

The complete source metadata, original and discounted prices, and effort
allowlists are in `model-catalog-2026-10-02.json`. The UI displays discounted
catalog prices; gateway billing and availability can change.

## Parameters and compatibility

The original six retain their existing thinking controls and native ID mappings.
New entries expose only catalogued reasoning efforts, with the lowest listed
level selected for translation. No unsupported thinking-off toggle is invented.
For new effort-only presets, Cindy requests use `reasoning_effort` without a
`thinking` field. Native interfaces may require a custom provider-specific ID;
unknown ID prefixes are not silently stripped.

Existing custom models that now share an ID with a preset retain their original
name and request contract, and are shown only once. Saving a newly entered custom
model with an existing preset ID remains disallowed. Model switching validates
the candidate before replacing the working selection.

## Real gateway checks

Through the existing configured gateway, 18 of 19 presets returned valid Chinese
JSON while preserving `25` and `⟦CLR0_0⟧` in a public sample. GPT-5.6 Luna returned
HTTP 429 on the initial request and one later retry; its availability remains
unverified for that connection. This is a small connectivity/format check, not a
quality or speed ranking. Tests do not change the user's chosen model or extract
its key. The separate 19-model UI switching matrix uses a synthetic provider.
