# Read the coverage ledger

The [feature inventory](../../FEATURE-INVENTORY.md) tracks the full product requirement list. The eight evidence and completeness requirements include an explicit coverage row for every inventoried surface. Each applicable row names its implementation, documentation, localization, persistence, focused check, runtime interaction and capture references where available. A null field records an unresolved obligation. Each excluded surface carries an explanation in its row.

The website validates the exact published requirement identities and the category coverage structure when it reads the ledger. Structural validity permits documentation to describe unfinished work. To enforce proof coverage at a candidate acceptance boundary, run the audit for the exact product surface, source revision and artifact digest.

```sh
node scripts/audit-feature-evidence.mjs --surface kiosk --source <40-character-source-revision> --artifact-sha256 <64-character-artifact-digest>
```

Check the JSON report for missing evidence. An exit code of 1 means the proof links are incomplete. An exit code of 2 means the input or an underlying file could not be validated. A matching proof link identifies a reviewed record for that candidate. Runtime acceptance still requires exercising the actual product and checking the stated workflow, privacy and visual conditions.
