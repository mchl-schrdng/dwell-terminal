# Changelog

## 0.10.1

- Restore the last-used terminal window when clicking the Dock icon, including minimized or hidden windows while Eclipse is visible. Keep existing tabs, unfinished input and running sessions intact.

## 0.10.0

- Paste clipboard images into a local interactive Claude session with ⌘V or Edit → Paste, using Claude's native attachment handling.
- Select preview text and choose **Ask Claude** to prepare file context in the current tab without submitting it. Include source line ranges and honest Markdown or diff labels.
- Check the active tab and running foreground program before inserting Claude context. Cancel stale preview actions and prevent delayed text paste from reaching a different tab.
- Keep diff content beginning with `++` or `--` styled as source changes rather than file headers.

## 0.9.0

- Open a selected folder in a new tab in the same window from the folder button or ⌘O. Name the tab after its folder and preserve running sessions and each tab's preview.
- Keep + and ⌘T in the active tab's project. Make separate windows an explicit **File → Open Folder in New Window…** action.
- Cover cancellation, selected folder aliases, repeated folders, independent shell directories and preview restoration in the macOS application tests.

## 0.8.3

- Seal the complete macOS app with an ad-hoc signature, including its native helpers and runtime resources. Fail packaging if signing or signature verification fails.
- Verify the release checksum and extracted ZIP signature in CI, and reject a modified runtime resource in a regression test.
- Clarify first-launch approval: the release is still not Apple-notarized, and macOS may require a manual exception.

## 0.8.2

- Keep validated Claude conversation ownership when input arrives during startup checks, without restoring an invalidated directory. Resume returns to that running conversation instead of starting a duplicate.
- Ship the native notifications, Line tabs and worktree correction below. Versions 0.8.0 and 0.8.1 were not released after release checks exposed startup timing issues.

## 0.8.1 (unreleased)

- Keep the worktree dialog usable when shell directory metadata refreshes within the same checkout. Reject creation if its source terminal closes, becomes unavailable or moves to another checkout.

## 0.8.0 (unreleased)

- Receive native program status from Claude Code 2.1.295+ without installing hooks or changing Claude settings. Route all Dwell tabs and windows to Eclipse and the existing background chime.
- Keep native status separate from filesystem permissions, group repeated alerts, and restore ordinary terminal bells after a program returns to its shell.
- Show the alerting tab's current project and distinguish working motion from decorative idle motion.
- Refine tab colors with Line: restrained two-color accents above plain graphite tabs, with a clear active border and matching palette swatches.
- Preserve all six saved color choices and keep Claude's status indicators separate from tab accents.

## 0.7.0

- Give each terminal its own file selection, Files/Changes view and scroll position, including tabs in the same checkout.
- Follow local shell directory changes without modifying shell configuration. Keep the project root while navigating subfolders; switch projects or worktrees and clear unrelated previews when leaving.
- Restore each saved tab in its latest validated folder without starting commands, and keep Claude worktree/resume actions scoped to that tab.
- Read directory changes from macOS rather than terminal escape sequences; keep Claude metadata restricted to its trusted repository.
- Keep Dwell's Dock icon and application menu available when Eclipse is enabled, including access to Check for Updates.

## 0.6.0

- Check for updates from the Dwell menu and download a newer stable release in your browser. Installation stays manual; checking or downloading never interrupts terminal sessions.
- Bound release checks, validate the official Apple Silicon archive and handle offline checks without changing preferences.

## 0.5.0

- Choose one of six gradient tab colors with a right-click, or return to Graphite. Colors stay with each saved tab; inactive tabs remain subdued and Claude status indicators stay distinct.

## 0.4.3

- Restore native window dragging from the empty space beside terminal tabs. Only tabs and controls exclude dragging; tab switching, closing and renaming remain interactive.
- Add a regression check for the empty titlebar area in the macOS application suite.

## 0.4.2

- Keep Eclipse on the active Dwell window’s screen and reanchor it when displays or their work areas change.
- Save manual placement relative to screen edges; reset legacy absolute coordinates to the bottom-right corner instead of stranding the orb on a larger display.
- Cover external displays, resolution changes, unplugging, saved placement and hover/drag cleanup with regression tests.

## 0.4.1

- Show Eclipse by default on first launch. Hiding it remains available, and a saved choice to disable it is preserved.
- Verify first-launch visibility and the saved opt-out on macOS; synchronize drag tests with the main process.

## 0.4.0

- Give the terminal a compact shared title and tab bar, with panels closed for new projects and a temporary Focus Mode that preserves saved layouts.
- Find sessions by name or checkout, show Claude’s current reason in the selected session, and jump to unread alerts with errors first.
- Add saved terminal text zoom, consistent reading margins, and Escape from the preview back to the terminal.
- Start native Claude worktrees from the selected checkout’s committed HEAD, with terminal-scoped Files, Changes, previews and drop references.
- Restore tabs without starting commands, and explicitly resume each saved Claude conversation in its original checkout using the same configured launcher.
- Open validated file:line[:column] references in the source preview with ⌘click or the keyboard reference dialog.
- Show Eclipse’s current project, checkout and reason on hover or focus, preserving its animation and sound.
- Require Claude Code 2.1.296+ for workspaces; preserve launcher account settings and block unavailable checkouts and changed launchers from silent resume.
- Cancel closed tabs before spawning Claude, keep one window per project, and resume conversations after a manual Claude session exits.
- Keep session choices stable during background updates and prevent delayed file references from marking a different preview.
- Route Eclipse to unread requests at equal priority, ignore expired targets and refresh its current session name.
- Recheck preview file identity before reading; package only runtime sources and refuse to overwrite a running bundle.
- Preserve Claude progress notifications without identity when macOS reports a missing JSON field on standard output.

## 0.3.0

- Add built-in Claude Code integration using official lifecycle hooks, with one-click setup and removal that preserve existing settings.
- Distinguish work, requests for attention and blocking API errors; ignore subagent activity and recoverable tool failures.
- Replace dust with Eclipse, a fluid ring that moves twice as fast in amber and pulses slowly in red, with an original quiet stereo chime.
- Keep activity separate from unread alerts, route the orb to the most urgent terminal, suppress duplicate bells, and reset on interruptions and terminal exits.
- Validate the native hook, real terminal escape sequences, settings preservation, multiple tabs, accessibility and packaged resources.

## 0.2.0 (local preview)

- Replace the rotating orb with a continuously drifting dust cloud and two clear states: idle and attention.
- Add a soft, optional notification sound; coalesce repeated alerts and limit sound bursts.
- Keep background notifications visible when hiding Dwell also hides its orb.
- Prevent Git previews from executing repository-defined clean and process filters. Filtered files are compared without transformation.
- Verify real terminal alerts while the app is hidden, animation pause/resume and saved sound preferences.

## 0.1.1

- Keep typed input and the last terminal row visible above the status bar after scrolling and resizing.
- Scope CI badges to main-branch pushes and clarify Claude Code bell notification setup.

## 0.1.0

A fresh public release of Dwell for macOS on Apple Silicon.

- Independent terminal tabs with real shell sessions, editable names and saved tab order.
- A project file tree and live, read-only code, Markdown and image previews.
- A Changes view with staged, unstaged, new and deleted file previews.
- Safely quoted file paths inserted by dropping files from the explorer or Finder.
- Attention indicators on terminal tabs and an optional, movable desktop dust orb with gentle motion and color transitions.
- Silent macOS notifications for background alerts when the orb is disabled.
- Plain translucent graphite, resizable panes and saved project layout.
- Isolated desktop tests, dependency checks, CodeQL and tested macOS release archives.

This release is not Apple-notarized. Running shell sessions end when Dwell quits.
