# Changelog

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
