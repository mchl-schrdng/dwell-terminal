# Getting started

Dwell is a small terminal workspace for macOS on Apple Silicon. It uses your existing shell and command-line tools.

This guide describes **Dwell 0.9.0**, including opening folders in tabs, native Claude notifications, independent tab contexts, folder following, update checks, Line tab colors, Focus, worktrees, saved conversation resume, file references and the Eclipse reason card.

## Install

[Download the latest release](https://github.com/mchl-schrdng/dwell-terminal/releases/latest), unzip it, and move **Dwell.app** to Applications. Open Dwell and choose **Open Folder**.

The release has a local (ad-hoc) signature but is **not Apple-notarized**. The signature verifies the bundle's files; it does not identify a developer trusted by Apple. macOS may still block a downloaded app, including with a “damaged” warning, on first launch or after an update.

After trying to open Dwell, use **System Settings → Privacy & Security → Open Anyway**, if available. Only approve the release downloaded from this repository. See [Apple's first-launch guidance](https://support.apple.com/en-us/102445).

If that option is unavailable, a manual exception is possible for this app only. First verify the downloaded ZIP against the `.sha256` file attached to the same release. After moving **Dwell.app** to Applications, with Dwell closed, run:

```sh
codesign --verify --deep --strict /Applications/Dwell.app &&
  xattr -dr com.apple.quarantine /Applications/Dwell.app
```

This removes the download quarantine from Dwell only, allowing it to open without Apple notarization. It does not disable Gatekeeper for other apps. If signature verification fails, stop and download the latest release; do not remove its quarantine. Releases before 0.8.3 did not seal the complete bundle and may fail this check.

### Update Dwell

Choose **Dwell → Check for Updates…**. Dwell checks the latest stable GitHub release only when you ask. If a newer version is available, **Download Update** opens its official Apple Silicon ZIP in your browser; **Later** leaves everything as it is.

When you have finished your terminal sessions, quit Dwell, unzip the download and replace **Dwell.app** in Applications. Reopen Dwell. Your settings and saved tabs are kept, but running shell processes stop when you quit. Checking or downloading an update never quits the app or installs anything automatically.

## Terminals and previews

Each terminal tab has its own shell session. Double-click a tab to rename it, or press F2 while the tab is focused. Enter saves the name; Escape cancels.

Right-click a tab to choose Solar, Ultraviolet, Lagoon, Acid, Ember or Iris. A thin gradient line marks the color above a plain graphite surface. The active tab has a brighter line, a lighter graphite fill and a visible border; inactive tabs stay muted. Choose **Graphite** to remove the line. With a tab focused, **Shift+F10** opens the same palette; **Escape** dismisses it. Existing saved colors are kept. Colors do not change Claude's status indicators.

The folder button beside the tabs and **⌘O** open the selected folder in a new tab in the same window. **+** and **⌘T** start another terminal in the active tab's project folder. Each tab keeps its own folder and preview. To use a separate window, choose **File → Open Folder in New Window…**; this returns to the existing window if that project already has one.

Tab names, colors, their order and your project layout are restored on relaunch. Running shell sessions are not restored. Switching tabs or resizing the workspace keeps sessions alive.

Restored tabs wait for **Open Terminal** or **Resume Claude**; reopening Dwell does not run commands.

Code, Markdown and image previews update as files change on disk. Previews are read-only; large files are bounded. Each open tab remembers its own file, Files/Changes view, expanded folders and scroll position. Switching tabs restores that view without restarting either terminal.

The file tree follows the active local shell. Moving into a subfolder keeps the current project root and preview; entering another repository or worktree switches the tree and clears the previous preview. Outside Git, subfolders stay within the current folder until you leave it. A deliberately opened subfolder stays the root until you leave it too. Paths are read from the foreground shell through macOS, without changing shell startup files. Remote SSH directories and arbitrary program output do not change the local file scope; Claude uses its validated hooks.

Saved tabs retain their latest project folder on relaunch. Preview navigation is remembered while tabs remain open; running commands are never resumed automatically.

A new project opens with the terminal filling the workspace. Open Files or Preview when needed; existing saved layouts are kept. **Focus Mode** temporarily hides both panels and restores them when toggled again. Opening a panel or file leaves Focus Mode. **Changes** beside the session context opens the Git view directly.

**Switch Session** searches tab names, branches and checkout paths without starting a process. The context row and tab markers distinguish Claude working, waiting for input, and an interrupted response. **Next Session Needing Attention** takes you to an unread alert, with errors first. Reading it clears the unread marker while its reason remains visible until Claude’s next state.

Terminal text size is saved per project, from 11 to 24 px. Resizing or zooming keeps each session alive. Press Escape while the preview has focus to close it and return to the terminal; Escape in the terminal still belongs to the running program. **Latest output** returns from scrollback without covering the terminal’s text.

| Shortcut     | Action                                         |
| ------------ | ---------------------------------------------- |
| ⌘T / ⌘W      | Open / close a terminal                        |
| ⌘O           | Open a folder in a new tab                     |
| ⌘B / ⌘⇧P     | Toggle files / preview                         |
| ⌘J           | Focus the terminal                             |
| ⌘⇧[ / ⌘⇧]    | Previous / next terminal                       |
| ⌘⇧L          | Open a file reference                          |
| ⌘⇧F          | Toggle Focus Mode                              |
| ⌘K           | Switch Session                                 |
| ⌘⌥A          | Next unread alert                              |
| ⌘+ / ⌘− / ⌘0 | Increase / decrease / reset terminal text size |

## Claude workspaces

Workspaces require **Claude Code 2.1.296 or later**, the version verified with this implementation. Older clients retain ordinary terminals and compatible progress notifications; Dwell never updates Claude automatically.

Enable **Help → Claude Code Integration**. If you normally launch Claude through an executable such as `maison`, select it in **Terminal → Claude Launcher…**, with its usual fixed arguments as a JSON array. Dwell uses a fresh login shell that loads your shell configuration, then executes that launcher directly. The default is `claude`. Aliases and functions need an executable wrapper. Do not put credentials in launcher arguments.

Choose **Terminal → New Claude Worktree…** or the menu beside **+**, and name the task. Open the repository root first; Git needs a committed HEAD. Claude may require you to accept its workspace-trust prompt in an ordinary session before native worktree creation. Authentication and permission prompts remain Claude’s own.

The new branch starts from the initiating checkout’s **committed HEAD**. Dwell generates a unique name and waits for Claude to report a Git-verified checkout. Until then, Files and Changes are unavailable. Failed startup never falls back to the shared checkout.

Files, diffs, previews and drop references follow the selected terminal. Returning to a tab restores its own selection, view mode and scroll, even when several tabs share a checkout. **+** and **⌘T** still open an ordinary shell, in the selected checkout; use it for servers and tests. Two Claude sessions in the same checkout are labelled **Shared Claude checkout**.

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

Install Claude Code separately and start an interactive session, version **2.1.295 or later**, in any Dwell terminal. Native status reaches Eclipse without enabling hooks or changing `preferredNotifChannel`. Dwell keeps your usual launcher. All its windows and tabs share one orb.

For worktrees, saved conversation context or hook notifications on older supported Claude versions, enable **Help → Claude Code Integration**. Dwell installs official Claude hooks while preserving your other settings and hooks. They only run inside Dwell. Use the same menu to remove them. No extra package, daemon or conversation reader is needed. See [compatibility and troubleshooting](claude-notifications.md).

## Eclipse and sound

Eclipse appears by default on first launch. Use **View → Desktop Orb** to show or hide it. Dwell remembers your choice, including an existing choice to keep it disabled.

- **Cool:** more movement while a program works; a slow decorative movement at rest.
- **Amber:** a program needs input or has finished a response. The motion is faster.
- **Red:** a program reports a stopped error. A failed tool that Claude can recover from does not trigger a red alert.

Click Eclipse to return to the most urgent terminal, drag it to move, or right-click to hide. It follows the active Dwell window’s screen, resting in the bottom-right corner by default. Manual placement is saved relative to that screen’s edges, so changing resolution keeps it within reach. It respects reduced motion and has a static fallback without WebGL.

In another app's full-screen Space, macOS may hide Eclipse. Dwell keeps its normal Dock icon and menu bar.

Hover or focus Eclipse to see the current project, checkout/tab and reason: **Approval requested**, **Question**, **Sign-in required**, **Response ready**, **Response interrupted**, or **Needs attention**. Hook-only sessions can also identify a **Plan to review**. The card opens that same session. It contains no conversation text or tool inputs; refining a reason does not play another chime.

Reading an alert clears its unread marker; further work or a new prompt updates its state. Background alerts play an original spatial chime. Toggle **View → Notification Sound** to mute or enable it. Foreground alerts remain silent.

Duplicate alerts are grouped. macOS notifications take over when the orb is off or Dwell is hidden, subject to your system settings. Ordinary terminal bells remain supported outside a structured Claude session.

A finished response is not proof that all work succeeded. Abrupt process crashes may emit no event. See [Claude event coverage and limits](claude-notifications.md).

## Privacy

Dwell adds no telemetry, accounts or cloud sync. A manual update check contacts GitHub for public release metadata; downloading opens the official archive in your browser. Project paths, terminal output and preferences are not sent. Tools you run inside the terminal, including Claude Code, use their own accounts and network connections.

[Back to Dwell](../README.md)
