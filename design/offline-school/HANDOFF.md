# Offline reader mode card

Use one compact card inside the existing searchable Settings sheet. The full-width reference is 1120 × 820. At 560 × 820 (half width), give the form the full reader area instead of compressing it beside an article. The 360 × 800 reference keeps normal vertical scrolling. In production the article remains intact behind Settings and receives focus again on close. Both boards provide Accent colour and Motion adjustments and an adjacent state note.

| State | Content and action | Focus and state transition |
| --- | --- | --- |
| Off | Localized name, Off, concise effect summary, Enable. | Enable opens an inline form and focuses Display name. |
| Enable | Display name, new PIN and confirmation, Enable and Cancel. | Require a nonempty bounded name and matching 4–12 decimal digits. Focus the first invalid field and associate its diagnostic. Wait for the native save before showing On. |
| On | Chosen name, English-only status, sound pause, Unlock and Rename. | Keep mode controls discoverable under the chosen name and generic mode in Settings search. Do not expose either hidden preference in search, suggestions, the palette or the accessibility tree. |
| Unlock | Current PIN, Unlock and Cancel. | Focus current PIN. On verified unlock restore prior language, wording and sound preference, announce once, then return focus to Enable. |
| Incorrect PIN | Same form and an inline error linked to the input. | Preserve the mode, clear the entry, focus it and permit another attempt. No shake or sound is necessary. |
| Rename | New display name and current PIN. | On verified save keep the mode active, announce the new name and return focus to Rename. Cancel makes no change. |
| Shared state unavailable | Neutral English state, short explanation and Retry. | Do not infer Off or show protected controls. Retain the stored choices. Retry reads the shared state and focuses a surviving action. |

Use the ordinary reader Settings search and adjacent independent regex builder. The draft draws only the controls available in the selected state. Register commands and search labels from the same visibility rules, including bilingual copy when Off. On activation switch the whole reader to English, suppress personal wording, uploads, drop import, associated discovery and cues. Pausing sound does not overwrite its stored switch or volume. Restore those values after a verified unlock. Reevaluate state across windows and at startup. Show unavailable whenever shared state cannot be read. Validate everything again in the native bridge. Keep credentials out of URLs, search, logs, analytics, announcements, screenshots and exports. Clear transient fields on submission, cancel and mode changes.

The local board selector chooses examples. Credential fields are empty and read-only and all credential-dependent submits are disabled. Use the selector to inspect the incorrect-PIN state; do not enter actual credentials. No simulated action grants an unlock or changes native data. The production implementation owns live language changes, validation, shared persistence, focus recovery and short polite announcements after real results.

## Neutral preferences and discovery

On and Unavailable keep Theme, Motion and Text size searchable and adjustable in English. Only the protected Language, Personal wording and paused Action sounds settings are removed. The shared-state Retry example recovers to On and focuses Unlock; recovery to Off must focus Enable. Closing Settings restores focus to its actual opener. Preserve pre-lock choices without creating a second credential or settings store.

**Unbuilt production suppression inventory.** The following reader paths and discovery sources require production enforcement and separate verification. The design controls only its own example Settings DOM.

- Remove protected feature tiles from index.html#features, direct articles at features/personal-wording.html and features/language-modes.html, links into them and their indexed headings. Gate restored navigation and direct links before rendering.
- Filter protected wording, language-switch and paused-sound references within generated docs/offline-guide.html and docs/virtual-commons.html, their index entries and excerpts reachable through docs/index.html. Retain ordinary unrelated documentation on those routes.
- Filter article URLs, titles, summaries, sections and full text exposed through search-index.json and the packaged edition's articles array, including searches started in the documentation reader.
- In site/assets/site.js, filter the palette's set-language and set-wording destinations, paused audio controls from settings-row discovery, and contributions registered with addPaletteSource. Remove Settings DOM, shortcut, drop/picker and feedback routes that reveal protected controls. Preserve set-theme, set-motion, set-size and the mode management actions. Restore the same routes on verified unlock.
