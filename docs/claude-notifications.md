# Claude Code integration

Enable **Help → Claude Code Integration** and start a new Claude session. Dwell merges its hooks into `~/.claude/settings.json`, or the directory selected by `CLAUDE_CONFIG_DIR`. Existing settings, notification channels and hooks are preserved. Disabling the menu item removes only Dwell's handlers. Malformed settings and `disableAllHooks` are not overridden.

The hooks run only when `TERM_PROGRAM=Dwell` and the bundled helper path is present. They use `/bin/sh` and macOS `plutil`, with no dependency, network service or transcript reader. The helper accepts at most 1 MiB of JSON and returns a bounded `terminalSequence`. Claude writes it through its own terminal; xterm and the main process validate it before changing context or attention.

The 0.4.0 workspace bridge uses `OSC 777;dwell;1`, a per-PTY nonce, an allowlisted event/state/reason, the conversation UUID and a Base64-encoded directory. Messages are limited to 6,000 characters. No prompts, transcript paths, tool inputs or environment dumps cross the bridge. Git verifies checkout membership before filesystem scope changes. Missing identity or an older Dwell host retains the numeric `OSC 9;4` fallback; the helper never emits both for one event.

Workspace launch checks require Claude Code **2.1.296+**, a conservative tested baseline rather than a claim about the earliest compatible release. After that check, Dwell enables `CwdChanged` alongside its existing hooks. Ordinary integration setup retains the older event set. Unrelated handlers and settings remain intact.

Use a recent Claude Code release. `terminalSequence` requires version 2.1.141 or later and only works in an interactive CLI while Claude's interface is on screen. Headless `-p`, the Agent SDK and arbitrary remote sessions are not covered. Remote Claude sessions need their own hooks and helper; ordinary BEL still works over SSH.

## States

<img src="images/eclipse.png" width="160" alt="Eclipse in its amber attention state">

| Claude event                                                          | Dwell state                                      |
| --------------------------------------------------------------------- | ------------------------------------------------ |
| `SessionStart`, `SessionEnd`                                          | Reset                                            |
| `UserPromptSubmit`, normal `PreToolUse`, `PostToolUse`                | Working; quiet, cool orb                         |
| `PermissionRequest`, `AskUserQuestion`, `ExitPlanMode`, `Elicitation` | Attention; amber at twice the normal speed       |
| `Stop`                                                                | Response ended; attention, not a success claim   |
| `StopFailure`                                                         | API failure; slow red pulse                      |
| `PostToolUseFailure`                                                  | Working when recoverable; reset when interrupted |
| `ElicitationResult`                                                   | Working                                          |

Subagent events with `agent_id` are ignored. A top-level custom agent with only `agent_type` still works. Authentication success and unknown notification types stay quiet. Notification events for permissions, idle responses, MCP input, background agents and stalled quota resumption request attention; quota resumption and completed MCP input return to working. `agent_completed` can mean completion or failure, so it is not a success signal. An idle notification cannot downgrade an existing API error.

Source: [Claude's official hook reference](https://code.claude.com/docs/en/hooks), checked 2026-10-10.

## Attention and sound

Structured events change the orb even when the terminal is visible. Only background alerts create unread markers or play a sound. Focus, an orb click or submitting input acknowledges an alert without declaring the work complete. Working resumes when Claude reports it. Red alerts take priority over amber; unread alerts win within the same priority. The orb opens the session displayed on its card.

Repeated events in the same state stay silent, including after acknowledgement. Sounds are separated by at least 1.5 seconds. The bundled 1.05-second stereo chime is generated from original oscillators and a quiet echo; its reproducible source is `scripts/generate-orb-sound.cjs`. **View → Notification Sound** mutes it.

Dwell 0.4.0 adds semantic reasons to Eclipse’s transient card. Specific reasons can replace one another without another sound, including after acknowledgement of the previous reason. A delayed generic idle event cannot replace a specific reason or an error. Recovery, interruption and closure clear the current reason.

BEL remains a fallback for ordinary terminal programs. During structured Claude activity, generic bells are ignored so Claude's delayed idle notification does not duplicate an immediate hook alert. A session reset restores ordinary bells. No change to `preferredNotifChannel` is required for the integration.

## Limits

- A finished response is not proof of success. Background tasks or other hooks may continue work.
- Failed tools are often recoverable. API failures stop the current response and are the useful red-alert case.
- Claude does not emit `Stop` for a user interruption. Dwell clears its last reported state on Escape or Ctrl-C; this does not prove that a process exited.
- A killed or crashed Claude process may never run a hook. `SessionEnd` also depends on Claude still being able to emit a terminal sequence. Dwell does not infer a crash from silence. Escape/Ctrl-C, the next session event or closing the terminal clears a stale indicator.
- Dedicated Claude PTYs invalidate their directory on exit. Ordinary shell input invalidates a previously reported Claude directory until a fresh hook confirms it; a missing exit hook must not make shell output inherit a stale relative-path base.
- Events from parallel tools may briefly interleave. The orb displays the latest relevant reported state, not a complete scheduler or task ledger.
- Managed Claude policies and project settings can disable or restrict user hooks. Dwell does not bypass them.

Sources: [terminal sequences](https://code.claude.com/docs/en/hooks#emit-terminal-notifications), [notifications](https://code.claude.com/docs/en/hooks#notification), [API failures](https://code.claude.com/docs/en/hooks#stopfailure), [terminal bell setup](https://code.claude.com/docs/en/terminal-config#get-a-terminal-bell-or-notification).
