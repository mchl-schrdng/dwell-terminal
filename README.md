<p align="center"><img src="assets/dwell-icon.svg" width="104" alt="Dwell"></p>
<h1 align="center">Dwell</h1>
<p align="center">A little room to focus.</p>

<p align="center">
  <a href="https://github.com/mchl-schrdng/dwell-terminal/actions/workflows/ci.yml"><img src="https://github.com/mchl-schrdng/dwell-terminal/actions/workflows/ci.yml/badge.svg?branch=main&amp;event=push" alt="CI"></a>
  <a href="https://github.com/mchl-schrdng/dwell-terminal/actions/workflows/codeql.yml"><img src="https://github.com/mchl-schrdng/dwell-terminal/actions/workflows/codeql.yml/badge.svg?branch=main&amp;event=push" alt="CodeQL"></a>
  <a href="https://github.com/mchl-schrdng/dwell-terminal/releases/latest"><img src="https://img.shields.io/github/v/release/mchl-schrdng/dwell-terminal?color=555&label=release" alt="Latest release"></a>
  <a href="LICENSE"><img src="https://img.shields.io/badge/license-MIT-555" alt="MIT license"></a>
</p>

A quiet terminal for macOS. Your files on the left, independent terminal tabs in the center, and a live preview on the right.

![Dwell on macOS, with Git changes, two terminal tabs and a read-only diff](docs/images/dwell.png)

- Run a server, execute tests and work in separate terminal tabs.
- Preview code, Markdown and images as files change on disk.
- Review Git changes and drop file paths straight into your prompt.
- Get quiet attention alerts, with an optional desktop orb.
- A single visual identity: plain, translucent graphite.

## Get Dwell

[Download for Apple Silicon](https://github.com/mchl-schrdng/dwell-terminal/releases/latest). Unzip, move **Dwell.app** to Applications, then choose **Open Folder**.

Dwell uses your existing shell and command-line tools. This release is not Apple-notarized.

| Shortcut  | Action                   |
| --------- | ------------------------ |
| ⌘T / ⌘W   | Open / close a terminal  |
| ⌘O        | Open a folder            |
| ⌘B / ⌘⇧P  | Toggle files / preview   |
| ⌘J        | Focus the terminal       |
| ⌘⇧[ / ⌘⇧] | Previous / next terminal |

Double-click a terminal tab to rename it (or press F2 while the tab is focused). Press Enter to save or Escape to cancel. Tab names and their order are restored for each project with fresh shell sessions.

Previews are read-only. Project layout is restored on relaunch; running shell sessions are not. Dwell adds no telemetry, accounts or cloud sync.

## Working with Claude Code

Choose **Changes** above the file tree to review staged and unstaged edits separately. Click a changed file to see its diff in the preview. New and deleted files are included; renames appear as a deletion and an addition. Changes refresh while the view is visible, with a refresh button for an immediate check. Dwell never stages, commits or discards changes. Submodule contents are excluded, and large previews are bounded.

Drag a file from **Files**, **Changes**, or Finder into a running terminal to insert its quoted absolute path. This works after changing directories and handles spaces and apostrophes. Dropping a file does not press Enter. Up to 32 files can be dropped from Finder at once; paths containing control characters are rejected.

Enable **Help → Claude Code Integration**, then start a new interactive Claude Code session (2.1.141 or later). Dwell installs a small set of official Claude hooks, preserving your other settings and hooks. They only run inside Dwell. Use the same menu to remove them. No extra package, daemon or conversation reader is needed.

**View → Desktop Orb** adds Eclipse: a small, fluid ring of light. It stays cool while Claude works, turns amber and moves twice as fast when Claude needs input or finishes a response, and turns red when an API error interrupts the response. A failed tool that Claude can recover from does not trigger a red alert. The movement at rest is decorative.

Click the orb to return to the most urgent terminal, drag to move, or right-click to hide. Reading an alert clears its unread marker; further work or a new prompt updates its state. The orb remembers its position, respects reduced motion and has a static fallback without WebGL.

Background alerts play a quiet, original spatial chime. **View → Notification Sound** mutes it. Duplicate alerts are grouped, and macOS notifications take over when the orb is off or Dwell is hidden, subject to your system settings. Ordinary terminal bells remain supported outside a structured Claude session.

A finished response is not proof that all work succeeded. Abrupt process crashes may emit no event. See [Claude event coverage and limits](docs/claude-notifications.md).

## Development

Requires an Apple Silicon Mac and Node.js 24.

```sh
npm ci
npm start
```

```sh
npm run check     # Lint, formatting, unit tests and build
npm run test:app  # Real terminal and desktop integration tests
npm run package  # macOS app, ZIP and SHA-256 checksum
```

CI runs on every pull request. Version tags run the release checks. Releases are published by [mchl-schrdng](https://github.com/mchl-schrdng) after those checks pass.

[Contributing](CONTRIBUTING.md) · [Agent instructions](AGENTS.md) · [Security](SECURITY.md) · [MIT license](LICENSE)
