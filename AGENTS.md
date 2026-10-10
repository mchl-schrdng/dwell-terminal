# Working on Dwell

Dwell is a small Electron terminal for macOS on Apple Silicon. Keep it focused: file tree, independent terminals and read-only previews. All application copy and repository documentation are in English.

## Boundaries

- `src/main.cjs`: native windows, PTYs, filesystem IPC and preferences.
- `src/preload.cjs`: the explicit, sandboxed renderer bridge.
- `src/files.cjs`: bounded file reads and project path checks.
- `src/git.cjs`: bounded, read-only Git status and diffs.
- `src/attention.cjs` and `src/orb.*`: terminal bell alerts and the optional desktop dust orb.
- `src/renderer.js`: workspace state, file tree and terminal tabs.
- `src/preview.js`: code highlighting and sanitized Markdown.
- `src/ui.js`: shared DOM and icon helpers.
- `src/style.css`: the single, plain translucent graphite theme.

Use the existing plain JavaScript structure. Add a dependency or abstraction only when it solves an actual problem. Remove unused code. Keep functions readable and changes scoped.

## Invariants

- Preserve active sessions when switching tabs or resizing. Never close a user's running app to test a build.
- Keep context isolation and renderer sandboxing enabled. Validate every privileged IPC sender.
- Resolve project paths and reject links outside the project. Bound preview reads; reject non-regular files. Never execute preview content.
- Sanitize Markdown and block remote preview resources. Open only HTTP(S) web links externally.
- Keep text opaque over plain translucent graphite. Respect reduced transparency. Do not add decorative gradients, workspace background animations or a theme picker. The optional desktop dust orb uses a small canvas animation; respect reduced motion and stop drawing when hidden.
- Tests use disposable projects, preferences and shell configuration. Never require credentials, third-party accounts or the developer's shell setup in CI.
- Do not commit generated builds, caches, logs, preferences, secrets or personal paths.

## Verification

Run `npm run check` for a change. For PTY, IPC, window or renderer changes, also run `npm run test:app` on macOS. Add a focused regression test when fixing behavior; avoid tests that only repeat the implementation.

Inspect visible design changes in the actual app. Use generic shell commands and the deterministic interactive fixture for terminal tests.

Use `npm run format` before committing. Explain the behavior change and the verification in the PR. Keep GitHub Actions pinned to full commit hashes and credentials out of PR workflows.

## Releases

Follow [the release process](docs/releases.md). Package only on Apple Silicon. Never replace a bundle that is currently running. Do not claim Apple signing or notarization unless the release actually has it.
