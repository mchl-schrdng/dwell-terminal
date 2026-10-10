# Getting started

Dwell is a small terminal workspace for macOS on Apple Silicon. It uses your existing shell and command-line tools.

## Install

[Download the latest release](https://github.com/mchl-schrdng/dwell-terminal/releases/latest), unzip it, and move **Dwell.app** to Applications. Open Dwell and choose **Open Folder**.

The release is not Apple-notarized. If macOS blocks the app, use **System Settings → Privacy & Security → Open Anyway** after trying to open it. Only do this for the release you downloaded from this repository.

## Terminals and previews

Each terminal tab has its own shell session. Double-click a tab to rename it, or press F2 while the tab is focused. Enter saves the name; Escape cancels.

Tab names, their order and your project layout are restored on relaunch. Running shell sessions are not restored. Switching tabs or resizing the workspace keeps sessions alive.

Code, Markdown and image previews update as files change on disk. Previews are read-only; large files are bounded.

| Shortcut  | Action                   |
| --------- | ------------------------ |
| ⌘T / ⌘W   | Open / close a terminal  |
| ⌘O        | Open a folder            |
| ⌘B / ⌘⇧P  | Toggle files / preview   |
| ⌘J        | Focus the terminal       |
| ⌘⇧[ / ⌘⇧] | Previous / next terminal |

## Review changes

Choose **Changes** above the file tree to review staged and unstaged edits separately. Click a changed file to see its diff in the preview.

New and deleted files are included; renames appear as a deletion and an addition. Changes refresh while the view is visible, with a refresh button for an immediate check. Dwell never stages, commits or discards changes. Submodule contents are excluded.

## Drop a path into the terminal

Drag a file from **Files**, **Changes**, or Finder into a running terminal to insert its quoted absolute path. This works after changing directories and handles spaces and apostrophes. Dropping a file does not press Enter.

Up to 32 files can be dropped from Finder at once. Paths containing control characters are rejected.

## Connect Claude Code

Install Claude Code separately, then enable **Help → Claude Code Integration** in Dwell. Start a new interactive Claude Code session, version 2.1.141 or later.

Dwell installs a small set of official Claude hooks while preserving your other settings and hooks. They only run inside Dwell. Use the same menu to remove them. No extra package, daemon or conversation reader is needed.

## Eclipse and sound

Enable **View → Desktop Orb** to show Eclipse, the optional desktop companion.

- **Cool:** gentle motion while Claude works. The movement at rest is decorative.
- **Amber:** Claude needs input or has finished a response. The motion is twice as fast.
- **Red:** an API error interrupted the response. A failed tool that Claude can recover from does not trigger a red alert.

Click Eclipse to return to the most urgent terminal, drag it to move, or right-click to hide. It remembers its position, respects reduced motion and has a static fallback without WebGL.

Reading an alert clears its unread marker; further work or a new prompt updates its state. Background alerts play an original spatial chime. Toggle **View → Notification Sound** to mute or enable it. Foreground alerts remain silent.

Duplicate alerts are grouped. macOS notifications take over when the orb is off or Dwell is hidden, subject to your system settings. Ordinary terminal bells remain supported outside a structured Claude session.

A finished response is not proof that all work succeeded. Abrupt process crashes may emit no event. See [Claude event coverage and limits](claude-notifications.md).

## Privacy

Dwell adds no telemetry, accounts or cloud sync. Tools you run inside the terminal, including Claude Code, use their own accounts and network connections.

[Back to Dwell](../README.md)
