# Claude Code integration

## Native status, ready on a fresh install

Interactive Claude Code **2.1.295+** reports its state through OSC 7501. Dwell answers the capability query and routes reports from every terminal and window to Eclipse. No hooks, notification-channel setting, launcher replacement or account configuration is needed for this path. Other programs that emit the same protocol work too; ordinary programs can still ring the terminal bell.

Reports belong to their originating terminal. Native state is authoritative while the program runs, so old progress events, hook alerts and bells cannot produce competing states or duplicate chimes. Dwell groups up to 64 program records per terminal and prioritizes errors, requests for input, completed work and running work. Closing a tab removes its state. A shell prompt or OS-confirmed return to the shell clears running and blocked states; completed work and reported errors remain until acknowledged or replaced.

Only status and a fixed reason are shown outside the terminal. Reported messages, titles and application names are discarded. Native status cannot change a folder, identify a saved conversation or grant preview access. The optional hooks below still provide validated workspace context.

Source: [Claude's native terminal status documentation](https://code.claude.com/docs/en/terminal-config#see-session-status-in-your-terminal) and the [OSC 7501 specification](https://www.superlogical.com/rex/docs/build/program-status), checked 2026-10-12.

## Optional workspace hooks

Enable **Help → Claude Code Integration** for worktrees, saved conversation context or hook notifications on older supported clients, then start a new Claude session. Dwell merges its hooks into `~/.claude/settings.json`, or the directory selected by `CLAUDE_CONFIG_DIR` in Dwell's launch environment. A custom launcher can select a different Claude profile; hooks must be installed in that profile too. Native status does not depend on the selected profile. Existing settings, notification channels and hooks are preserved. Disabling the menu item removes only Dwell's handlers. Malformed settings and `disableAllHooks` are not overridden.

The hooks run only when `TERM_PROGRAM=Dwell` and the bundled helper path is present. They use `/bin/sh` and macOS `plutil`, with no dependency, network service or transcript reader. The helper accepts at most 1 MiB of JSON and returns a bounded `terminalSequence`. Claude writes it through its own terminal; xterm and the main process validate it before changing context or attention.

The 0.4.0 workspace bridge uses `OSC 777;dwell;1`, a per-PTY nonce, an allowlisted event/state/reason, the conversation UUID and a Base64-encoded directory. Messages are limited to 6,000 characters. No prompts, transcript paths, tool inputs or environment dumps cross the bridge. Git verifies checkout membership before filesystem scope changes. Missing identity or an older Dwell host retains the numeric `OSC 9;4` fallback; the helper never emits both for one event.

Workspace launch checks require Claude Code **2.1.296+**, a conservative tested baseline rather than a claim about the earliest compatible release. After that check, Dwell enables `CwdChanged` alongside its existing hooks. Ordinary integration setup retains the older event set. Unrelated handlers and settings remain intact.

Hook `terminalSequence` requires version 2.1.141 or later and only works in an interactive CLI while Claude's interface is on screen. Headless `-p` and the Agent SDK are not covered. Remote hook sessions need their own hooks and helper; native status and ordinary BEL can cross SSH when forwarded by the connection.

## States

<img src="images/eclipse.png" width="160" alt="Eclipse in its amber attention state">

| Native state    | Dwell state                                             |
| --------------- | ------------------------------------------------------- |
| `idle`, `clear` | Quiet idle                                              |
| `working`       | Cool motion, more active than idle                      |
| `blocked`       | Amber: approval, question, sign-in or generic attention |
| `done`          | Amber: response ready, not proof of success             |
| `error`         | Red: reported failure                                   |

Without native status, the optional hooks map these events:

| Claude event                                                          | Dwell state                                      |
| --------------------------------------------------------------------- | ------------------------------------------------ |
| `SessionStart`, `SessionEnd`                                          | Reset                                            |
| `UserPromptSubmit`, normal `PreToolUse`, `PostToolUse`                | Working; quiet, cool orb                         |
| `PermissionRequest`, `AskUserQuestion`, `ExitPlanMode`, `Elicitation` | Attention; faster amber motion                   |
| `Stop`                                                                | Response ended; attention, not a success claim   |
| `StopFailure`                                                         | API failure; slow red pulse                      |
| `PostToolUseFailure`                                                  | Working when recoverable; reset when interrupted |
| `ElicitationResult`                                                   | Working                                          |

Subagent events with `agent_id` are ignored. A top-level custom agent with only `agent_type` still works. Authentication success and unknown notification types stay quiet. Notification events for permissions, idle responses, MCP input, background agents and stalled quota resumption request attention; quota resumption and completed MCP input return to working. `agent_completed` can mean completion or failure, so it is not a success signal. An idle notification cannot downgrade an existing API error.

Source: [Claude's official hook reference](https://code.claude.com/docs/en/hooks), checked 2026-10-10.

## Attention and sound

Eclipse and sound are enabled by default when no preference is saved. Use **View → Desktop Orb** to hide it; a saved choice to disable it is preserved. Native status is always available. Installing workspace hooks remains opt-in through **Help → Claude Code Integration**.

Structured events change the orb even when the terminal is visible. Only background alerts create unread markers or play a sound. Focus, an orb click or submitting input acknowledges an alert without declaring the work complete. Working resumes when Claude reports it. Red alerts take priority over amber; unread alerts win within the same priority. The orb opens the session displayed on its card.

Repeated events in the same state stay silent, including after acknowledgement. Sounds are separated by at least 1.5 seconds. The bundled 1.05-second stereo chime is generated from original oscillators and a quiet echo; its reproducible source is `scripts/generate-orb-sound.cjs`. **View → Notification Sound** mutes it.

Dwell 0.4.0 adds semantic reasons to Eclipse’s transient card. Specific reasons can replace one another without another sound, including after acknowledgement of the previous reason. A delayed generic idle event cannot replace a specific reason or an error. Recovery, interruption and closure clear the current reason.

BEL remains a fallback for ordinary terminal programs and changes the orb even in the foreground. During structured activity, generic bells are ignored to avoid duplicate alerts. A session reset or confirmed return to the shell restores ordinary bells. No change to `preferredNotifChannel` is required for native status or hook integration.

## If nothing happens on another Mac

1. Run `claude --version` there. Native status needs **2.1.295+**; older supported clients need the optional hooks on that Mac. Copying Dwell.app does not copy another machine's Claude settings.
2. Start an interactive Claude session directly in a Dwell tab. Claude does not report native status from background sessions or through tmux. `CLAUDE_CODE_DISABLE_TERMINAL_TITLE=1` also disables detection and reports; leave it unset to use native status.
3. A visible active tab changes the orb but stays silent. Switch to another tab or application before waiting for a response to test the chime. Check **View → Notification Sound** and the Mac's output device and volume.
4. To check ordinary terminal alerts without Claude, run `sleep 3; printf '\a'` and switch away before the three seconds expire. A bell cannot tell Dwell whether a task succeeded; it only requests attention.

## Limits

- A finished response is not proof of success. Background tasks or other hooks may continue work.
- Failed tools are often recoverable. API failures stop the current response and are the useful red-alert case.
- Claude does not emit `Stop` for a user interruption. Native programs report `idle` when interrupted. For hook-only sessions, Escape or Ctrl-C clears the last reported state; this does not prove that a process exited.
- A killed or crashed program may emit no final event. Dwell clears live status when it observes the shell again or the attached process exits, but does not invent a failure from silence. Shell checks follow terminal output, selection and bells rather than running continuously while idle.
- Dedicated Claude PTYs invalidate their directory on exit. Ordinary shell input invalidates a previously reported Claude directory until a fresh hook confirms it; a missing exit hook must not make shell output inherit a stale relative-path base.
- Events from parallel tools may briefly interleave. The orb displays the latest relevant reported state, not a complete scheduler or task ledger.
- Managed Claude policies and project settings can disable or restrict user hooks. Dwell does not bypass them.

Sources: [terminal sequences](https://code.claude.com/docs/en/hooks#emit-terminal-notifications), [notifications](https://code.claude.com/docs/en/hooks#notification), [API failures](https://code.claude.com/docs/en/hooks#stopfailure), [terminal bell setup](https://code.claude.com/docs/en/terminal-config#get-a-terminal-bell-or-notification).
