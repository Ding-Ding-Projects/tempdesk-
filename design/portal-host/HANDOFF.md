# Portal Host wizard handoff

The portable desktop wizard starts the guest and management portals from one accepted TempDesk publication. Open **Desktop.dc.html** or **Narrow.dc.html** for the interactive local design. Serve the folder or open the HTML directly. Both use the same stylesheet, fixture controller and palette. Canvas dimensions and adjacent notes are in **canvas.json**. The controls above the board select design fixtures, language, accent and motion; production language and appearance belong in the application's normal settings.

## Layout and interaction

The 1120 × 820 reference uses a persistent step rail and one active task panel. At 360 × 800 the rail becomes a current-step label, fields stack, controls wrap and content scrolls vertically. Long digests and endpoint paths wrap in place. Use the TempDesk Deployer palette from **design/README.md**, the existing Segoe UI Variable type stack, 14–24 px surfaces, pill actions and minimum 48 px controls. Reduced motion overrides all animation. The forward action gets the mint emphasis. Coral is reserved for an actionable problem.

| Step | Production operation and forward gate | Recovery and evidence |
| --- | --- | --- |
| Check Docker | Detect Desktop, a responsive Linux engine, and Compose v2; report actual versions. | Show the failing check and let the operator recheck after starting Docker or switching engines. No installation or engine switch without explicit action. |
| Publication receipt | Native file picker selects a receipt. Accept only the supported receipt schema and a published/already-published status, expected repository identity, immutable image digest, release tag and full source revision. Display those values before continuation. | Show a specific invalid/missing-field message. Keep the previous selection available until a replacement is valid. |
| Configuration | Require an existing protected configuration directory. Optionally select a separate reviewed Compose overlay. Resolve the required guest and management configuration and mounts locally. Only show selected names and validation outcomes. | Preserve operator files and their paths. Never copy values into logs, controls, examples or receipts. |
| LAN and project | Select an actual LAN interface/address and named Compose project. Generate a project-specific override binding both distinct host ports to the selected LAN address; set COMPOSE_PROJECT_NAME to the selected project. Preserve every supplied file. | Reject duplicate or occupied ports, loopback-only addresses, conflicting project ownership and unavailable interfaces before launch. Preserve previous input on Back. |
| Review | Present the precise release, image/revision, config selection, independent project and endpoint candidates. State whether existing containers or volumes will be reused using actual inspection. | Back changes one decision without losing unrelated values. Cancel before Start leaves the system untouched. |
| Start and verify | Invoke the supported immutable pull, project-scoped Compose start, then separate bounded guest and management health/revision checks. Progress advances only from real engine events, with elapsed time, output and exit status. | A partial start is visible. Stop observing must preserve running services and volumes. Reconcile existing state before retry. Only show actionable guest and management URL links after each endpoint earns the corresponding check. Label host-local reachability and independent LAN-client proof separately. |

Real guest navigation uses the configured port with **/**. Management uses its configured port with **/login**. The fixtures use reserved documentation addresses and synthetic data; local board buttons never contact a registry or start containers. The progress fixture advances one example event at a time. For management recovery use the explicit health-only recheck. It must call an engine operation that only rechecks the already-running endpoints; never substitute the log-view entrypoint, which may first pull or start services. Show a verified guest URL while management is still pending and restore focus after native chooser dismissal. Production progress has no manual “advance” button.

## Accessibility and acceptance

Expose step state to assistive technology, move focus to the new task heading on Back/Next, return focus to the original chooser after picker cancellation, and focus a failing field or its diagnostic after validation. Keep stable live regions for meaningful phase changes; do not announce every log line. Use native keyboard controls, visible focus, localized English and Hong Kong Cantonese copy, and bilingual wrapping. At 100%, 125%, 150% and 200%, preserve every action, both URLs and the complete copyable revision/digest. Verify normal, error, partial start, safe cancellation, retry and successful result against the real portable executable.

The checked-in boards are design references. The two locally rendered prototype frames and review notes are in REHEARSAL.md and frames/. Hosted canvas sync, real wizard operation and production visual parity remain unverified.

## Reopen a saved project

Select **Reopen saved project** on either board. Step one shows only the saved project and release. Check Docker and Compose to enable **Recheck endpoint health**. This opens the results step for new health observations without starting containers or requiring a new publication receipt. The board uses example events. The running wizard accepts endpoint evidence only from the native operation.
