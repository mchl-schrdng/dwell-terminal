# Changelog

## 0.4.0 (unreleased)

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
