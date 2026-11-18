# Contributing to TempDesk

Select the component that owns the behavior and read its contract in [AGENTS.md](AGENTS.md). For HTTP changes, update the [API contract](docs/API.md) with the Windows and Samba implementations. For guest changes, verify standard-user permissions, time limits and password handling before suggesting rollout.

Use synthetic accounts and an isolated directory in development. Keep deployment addresses, credentials and local paths out of changes and screenshots. For Windows development, start with the root build entrypoints. See the [development commands](README.md#development) for each component.

Describe the actual behavior changed, the checks run, and any remaining rollout requirements. Update the relevant operator article, [roadmap](ROADMAP.md) and [handoff](HANDOFF.md). Use the security policy for vulnerabilities.
