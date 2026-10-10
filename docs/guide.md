# Getting started

Dwell is a small terminal workspace for macOS on Apple Silicon. It uses your existing shell and command-line tools.

## Install

[Download the latest release](https://github.com/mchl-schrdng/dwell-terminal/releases/latest), unzip it, and move **Dwell.app** to Applications. Open Dwell and choose **Open Folder**.

The release is not Apple-notarized. If macOS blocks the app, use **System Settings → Privacy & Security → Open Anyway** after trying to open it. Only do this for the release you downloaded from this repository.

## Terminals and previews

Each terminal tab has its own shell session. Double-click a tab to rename it, or press F2 while the tab is focused. Enter saves the name; Escape cancels.

Tab names, their order and your project layout are restored on relaunch. Running shell sessions are not restored. Switching tabs or resizing the workspace keeps sessions alive.

In the source preview, restored tabs wait for **Open Terminal** or **Resume Claude**; reopening Dwell does not run commands.

Code, Markdown and image previews update as files change on disk. Previews are read-only; large files are bounded.

| Shortcut  | Action                   |
| --------- | ------------------------ |
| ⌘T / ⌘W   | Open / close a terminal  |
| ⌘O        | Open a folder            |
| ⌘B / ⌘⇧P  | Toggle files / preview   |
| ⌘J        | Focus the terminal       |
| ⌘⇧[ / ⌘⇧] | Previous / next terminal |
| ⌘⇧L       | Open a file reference    |

## Claude workspaces (source preview)

These features are unreleased. Workspaces require **Claude Code 2.1.296 or later**, the version verified with this implementation. Older clients retain ordinary terminals and compatible progress notifications; Dwell never updates Claude automatically.

Enable **Help → Claude Code Integration**. If you normally launch Claude through an executable such as `maison`, select it in **Terminal → Claude Launcher…**, with its usual fixed arguments as a JSON array. Dwell uses a fresh login shell that loads your shell configuration, then executes that launcher directly. The default is `claude`. Aliases and functions need an executable wrapper. Do not put credentials in launcher arguments.

Choose **Terminal → New Claude Worktree…** or the menu beside **+**, and name the task. Open the repository root first; Git needs a committed HEAD. Claude may require you to accept its workspace-trust prompt in an ordinary session before native worktree creation. Authentication and permission prompts remain Claude’s own.

The new branch starts from the initiating checkout’s **committed HEAD**. Dwell generates a unique name and waits for Claude to report a Git-verified checkout. Until then, Files and Changes are unavailable. Failed startup never falls back to the shared checkout.

Files, diffs, previews and drop references follow the selected terminal. Returning to a checkout restores its selection, view mode and scroll. **+** and **⌘T** still open an ordinary shell, in the selected checkout; use it for servers and tests. Two Claude sessions in the same checkout are labelled **Shared Claude checkout**.

Dwell does not copy dirty files, `.env` or dependencies. User-configured Claude worktree setup remains Claude’s responsibility. Worktrees separate files and branches, not ports, databases or external services. Review, commit and merge through your usual Git workflow. Closing a tab stops its process; Dwell never removes a worktree, resets it, or answers Claude’s cleanup prompts.

### Resume a conversation

**Resume Claude** passes the exact saved conversation ID, from its validated checkout, to the configured launcher. It never uses `--continue` or recreates a worktree. A known live conversation is focused instead of duplicated. Changing the launcher blocks resume until the original configuration is restored, protecting its account association.

A deleted checkout remains unavailable. **Open Terminal in Project** explicitly recovers a plain shell in the original project and clears that tab’s Claude association. Resume errors retain the association for retry. Servers, shell commands and processes are not restored.

Only tab metadata is saved: IDs, labels, checkout paths and a fingerprint of the launcher configuration. Dwell does not save conversations or infer commands from terminal output. Manually launched Claude sessions use the explicitly configured launcher for later resume; configure it to match your usual command.

### Open a cited line

⌘click `path:line` or `path:line:column` to open source, including from the Changes view. Quote paths containing spaces, for example `"/project/src/my component.tsx":12:3`. The file must belong to that terminal’s checkout. **Terminal → Open File Reference…** (⌘⇧L) is the keyboard alternative and accepts an absolute path.

Absolute references work across terminal modes. Relative references require a verified directory for that output. Dwell records context boundaries in ordinary scrollback and conservatively leaves ambiguous output unlinked after cursor edits, resizing or fullscreen redraws. Use absolute references in Claude’s fullscreen mode. It does not guess from a basename or apply a newer directory to old output.

Previews remain limited to 1 MiB and 2,000 lines. A reference beyond the loaded text offers **Open in Default App**, subject to Dwell’s existing executable-file restrictions.

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

In the source preview, hover or focus Eclipse to see the current project, checkout/tab and reason: **Approval requested**, **Question**, **Plan to review**, **Response ready**, **Response interrupted**, or **Needs attention**. The card opens that same session. It contains no conversation text or tool inputs; refining a reason does not play another chime.

Reading an alert clears its unread marker; further work or a new prompt updates its state. Background alerts play an original spatial chime. Toggle **View → Notification Sound** to mute or enable it. Foreground alerts remain silent.

Duplicate alerts are grouped. macOS notifications take over when the orb is off or Dwell is hidden, subject to your system settings. Ordinary terminal bells remain supported outside a structured Claude session.

A finished response is not proof that all work succeeded. Abrupt process crashes may emit no event. See [Claude event coverage and limits](claude-notifications.md).

## Privacy

Dwell adds no telemetry, accounts or cloud sync. Tools you run inside the terminal, including Claude Code, use their own accounts and network connections.

[Back to Dwell](../README.md)
