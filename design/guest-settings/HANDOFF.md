# Guest and kiosk Settings

The guest portal exposes Settings through Tools. The production destination is /settings. These two boards use the guest shell colours and control shapes and adapt the action-sounds row from design/management-sounds/Settings-Sounds.dc.html at source revision 7cf2ec7954dc7482c2e0aa163b5ea5f405c0a35f. There are no management settings or account administration actions on this page.

The desktop board places display controls in two columns. At 360 px they form one vertical column in the same reading order. Keyboard order starts with the search input and its adjacent regex controls, then Language, Theme, Motion, Density, Text size, High contrast, Always show the focus ring, Corner roundness and Action sounds. Preserve the shell's skip link. Use the localized label and help text for each control. Closing the regex builder returns focus to the control that opened it. Filtering retains existing selections.

Use the existing display preference handlers and POST /prefs language flow. School mode omits the language control and its search terms while retaining the previous preference. Keep the action-sound preference in td.actionSounds, retain the saved switch position under School mode and explain why playback is suppressed. Reuse the existing local playback and mute checks. Register this page's search independently from management Settings and index both group headings and localized control labels.

The boards use an isolated browser storage prefix and the existing regex builder. The language selector records an example selection. Production uses the English, Cantonese and bilingual catalogs. Open either board with ?school=1 to preview the hidden language control and suppressed feedback. Verify production navigation, preference flow, localization, sound outcomes, keyboard interaction and rendering separately.

## Narrow-screen touch targets

The published 1.0.123 build at revision 6985c92531079abb28fab1424528261cea417289 measured a 40 px search input, two 32 × 32 px regex buttons, 16 px sliders, and 44 px contrast and focus labels at 360 CSS px. The narrow board keeps the one-column order and adds an associated, wrapping label above the search row.

Give the search input and both range inputs at least 48 CSS px of height. Give each regex button its own 48 × 48 CSS px area, and use the full checkbox label as a touch target. The field, toggle, and builder keep their keyboard order. The field label remains visible when a query is present. Localize the accessible names of both buttons using that field label. Verify the actual native input rectangles, pointer targets, focus return, and horizontal containment in the built surface.
