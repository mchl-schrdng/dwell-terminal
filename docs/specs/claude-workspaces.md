# Dwell: isolated Claude workspaces

Status: implemented locally on `codex/claude-workspaces`; automated source and packaged-app checks pass. Manual coverage and remaining limits are recorded below.

Prepared on 2026-10-10 against Dwell 0.3.0, commit `d40bda6`. Recheck the repository and official CLI documentation before implementation. This document defines the next feature set, not a promise about an unreleased version.

## 1. Product goal

Make several Claude Code sessions in one repository safe and easy to follow, while keeping Dwell a small terminal with files and read-only previews.

Deliver four features, in this order:

1. Claude sessions in separate worktrees, with the correct files and Git changes for each tab.
2. Explicitly resume each saved Claude conversation in its original worktree.
3. Open a file at a cited line directly from terminal output.
4. Let Eclipse explain why a session needs attention.

A worktree is a separate working directory and branch within the same repository. It prevents ordinary edits from competing for the same files. It does not isolate ports, databases or external services, and merging branches can still require conflict resolution. See [Git worktrees](https://git-scm.com/docs/git-worktree).

## 2. Scope and product decisions

- Keep Electron, plain JavaScript, xterm, the graphite theme and the current Eclipse animation and sound.
- Use Claude's native worktree and resume capabilities. Dwell supplies launch actions, verified context and presentation; it does not implement a Git manager or another agent runtime.
- Keep ordinary shell tabs. Starting a server or running tests must remain straightforward.
- No automatic merge, commit, stash, reset, branch deletion or worktree deletion by Dwell.
- No transcript parsing, conversation database, daemon, tmux requirement, embedded model, agent dashboard or telemetry.
- All application text, repository documentation and code comments remain in English.
- Features operate with a local, interactive Claude CLI. Do not imply support for remote SSH sessions, headless Claude or arbitrary agent SDK clients.

## 3. Worktrees: the primary feature

### User flow

Add **New Claude Worktree…** to the Terminal menu and the existing new-tab control's secondary menu. Keep the ordinary plus action and ⌘T as **New Terminal**.

1. The user supplies a short task name, for example `Auth`.
2. Dwell opens a new tab and starts the configured Claude launcher with native worktree isolation.
3. Until the checkout is confirmed, show a compact `Starting worktree…` state; do not label the main checkout as isolated.
4. Once validated, identify the checkout/branch beside the existing project path. Keep the editable tab name short.
5. Switching between Auth and Billing switches Files, Changes, the preview and file-drop references to the matching checkout. PTYs continue running throughout.

Create from the initiating checkout's **current committed HEAD**, explicitly described in the creation UI. Uncommitted changes are not copied. A normal terminal opened from an active worktree starts in that worktree, so its server and tests use the same files.

Claude documents native creation and the per-launch `worktree.baseRef` setting. Use its supported per-launch settings mechanism for `head`, rather than modifying the user's global settings. Confirm support in the chosen CLI version. [Claude worktree creation](https://code.claude.com/docs/en/worktrees#start-claude-in-a-worktree), [base selection](https://code.claude.com/docs/en/worktrees#choose-the-base-branch).

### Creation and lifecycle rules

- Generate a unique worktree name from the task label plus a short random suffix. Reject path separators/control characters and never reuse an existing path as part of **New**. Reserve names during concurrent launches.
- Preflight Git availability, a committed HEAD and a usable launcher. For the MVP, require the opened project to be a checkout root; explain how to open the repository root when a subfolder was selected. Normal terminals remain usable in other folders.
- Preserve Claude's native authentication, workspace-trust and permission prompts. Do not auto-answer them.
- If launch or integration fails, leave a readable error and an honest context indicator. Do not silently start Claude in the shared checkout as a fallback.
- Never run startup commands by typing into an existing shell or using a delay to guess that a prompt is ready. Start a dedicated new PTY through a tested launch path.
- Do not copy `.env`, ignored files, dependencies or dirty files, and do not run setup scripts automatically. Existing user-configured Claude setup remains Claude's responsibility.
- Closing a Dwell tab stops its process using the existing confirmation behavior. Dwell does not remove the checkout. Native Claude cleanup prompts, if present, remain in the terminal; Dwell must not answer them or promise that Claude will retain every worktree.
- Completing work does not merge it. Explain in the guide that review/commit/merge happen through the user's normal Git or Claude workflow.
- Manually launched Claude sessions keep working. Dwell follows their reported, verified checkout; it never moves a running session into a worktree automatically.
- If two live Claude sessions share one checkout, identify it as shared rather than claiming per-session isolation. Helper shell tabs in the same checkout are expected.

### One reliable context per tab

The main process owns each terminal's context. Distinguish:

| Concept           | Meaning                                                                       |
| ----------------- | ----------------------------------------------------------------------------- |
| Project           | The repository opened by the user; stable grouping for the window.            |
| Checkout root     | The validated worktree used for file and Git operations.                      |
| Current directory | Claude's last reported directory inside that checkout, with known provenance. |
| Conversation ID   | Claude's identifier, distinct from Dwell's terminal ID.                       |
| Context revision  | A generation counter for rejecting stale async results.                       |

Inspect Git metadata to verify worktree membership and common repository identity. Use a bounded, NUL-safe worktree listing and canonical paths; a directory named `.claude/worktrees/foo` is not sufficient proof. Preserve existing Git timeouts and suppression of repository-defined commands in read-only operations. [Git worktree listing](https://git-scm.com/docs/git-worktree#_porcelain_format).

All file, Git, watcher and drop-reference IPC must resolve through the requesting terminal's validated context. The renderer passes an owned terminal ID and a relative path, never an authoritative filesystem root. Keep symlink/path escape checks relative to the active checkout. Ignore attempts to switch to unrelated repositories through terminal metadata. An external checkout can still be opened explicitly through Open Folder.

On context or active-tab changes, update the visible panes together, invalidate older reads and detach obsolete watchers. Retain a small navigation state per checkout (selected file, Files/Changes mode and scroll), so returning to a worktree restores its view. Never restart or resize an unrelated PTY as a side effect of changing roots.

A subdirectory change updates the relative-path base; it does not shrink the Files tree to that subdirectory. Exiting Claude invalidates its reported current directory as evidence of the parent shell's directory. A deleted worktree produces an unavailable state, not a fallback to another checkout with a similar path.

## 4. Resume the exact conversation

On relaunch, restore tab labels and context without executing commands. A tab with a saved Claude association offers **Resume Claude** and **Open Terminal**.

**Resume Claude** opens the saved conversation by exact ID with the correct launcher and repository/worktree context. Never use “most recent conversation” as a substitute for an exact association. Reuse a live matching tab when known, rather than launching a duplicate.

Persist only the metadata needed for this behavior: terminal identity/label, repository and checkout paths, conversation ID and a reference to the configured launcher. Do not store transcripts, prompts, permissions, tokens, environment dumps or arbitrary commands learned from terminal output. Save atomically and migrate the existing `terminalNames` preferences without losing tab names or layout.

Check the checkout before resuming. If it disappeared, offer opening a plain terminal with an explicit explanation; do not resume silently in the main checkout. A missing conversation or unavailable launcher yields a retryable error without discarding the saved association. Do not route **Resume** through **New Claude Worktree** or recreate an existing worktree by name.

Conversation restoration is provided by Claude. Shell processes, servers and interrupted commands are outside this feature. The precise resume behavior and launch flags must be tested with the supported CLI version. [Claude session resume](https://code.claude.com/docs/en/sessions#resume-a-session).

### Launcher compatibility

The existing user workflow has used a custom Claude launcher. Do not assume that executing the stock `claude` binary preserves its account or environment.

Use one explicit launcher definition: executable/command name plus fixed argument array, defaulting to `claude`. Reuse it for worktree creation and resume. Validate flag forwarding and login-shell environment handling; preserve intentional user configuration without persisting secrets. Do not infer executable commands from untrusted terminal output. If the user's launcher is a shell function or alias, establish and test a compatible invocation before calling the feature ready. This is a prerequisite, not a second profiles system.

## 5. Terminal references open the existing preview

Recognize a conservative first set of references: absolute or reliably based relative `path:line` and `path:line:column`. ⌘click opens the source preview, scrolls to the one-based line and briefly highlights it. Provide an accessible keyboard/context-menu equivalent. Preserve normal selection, paste and HTTP(S) links.

- Reuse xterm's [link provider API](https://xtermjs.org/docs/api/terminal/classes/terminal/#registerlinkprovider) and the existing source-line renderer.
- Validate the file in the main process against the emitting terminal's checkout before opening it. Never execute a file link or treat it as a shell command.
- A relative path needs a trustworthy base for the output that contained it. Do not apply today's directory blindly to old scrollback, search the repository for a matching basename, or choose the first existing candidate. Capture context epochs/markers when reliable metadata changes; otherwise leave the reference unlinked.
- Switching tabs while validation is pending must not open the file in the wrong checkout.
- Open source content even if the current pane was displaying a Git diff. Deleted or missing files get a concise unavailable message.
- Keep the existing preview limits. For a line outside the loaded preview, explain the limit and offer the existing external-open action; do not claim to have navigated to that line.
- Verify references in both ordinary terminal output and Claude's fullscreen mode. Mouse reporting, wrapped lines and terminal hyperlinks need a real-app check before advertising fullscreen compatibility.

This is navigation into the existing preview, not a new editor or terminal-output parser framework.

## 6. Eclipse explains the signal

Keep the current colors, motion, priority and sound. Add a small transient card on hover or keyboard focus, with project, checkout/tab and the reason for the currently selected session. Clicking it returns to that same session; the existing direct orb click keeps working. Moving the orb must remain reliable.

Use a closed set of reasons:

| Event meaning                  | Copy                 | State |
| ------------------------------ | -------------------- | ----- |
| Permission needed              | Approval requested   | Amber |
| User question / external input | Question             | Amber |
| Plan approval                  | Plan to review       | Amber |
| Response ended                 | Response ready       | Amber |
| API response failure           | Response interrupted | Red   |
| Unclassified supported alert   | Needs attention      | Amber |

This MVP shows the current priority item, not a notification inbox. No conversation excerpts, tool inputs, commands or permission buttons appear on the desktop. Provide the card's information through accessibility APIs; avoid stealing focus on hover. Clamp it to the current display and close it when hidden or dismissed.

A reason change must update the card even if the color stays amber. It must not produce extra chimes merely because the reason became more precise. Preserve cooldowns, background-only sound, error priority and acknowledgement semantics. Clear stale reasons on recovery, interruption, session replacement or closure. Delayed generic notifications must not replace a more specific active reason or downgrade an error.

## 7. Shared Claude integration

Extend the existing hook bridge once for the data shared by all four features. Keep the event-to-reason mapping centralized. Existing [notification coverage](../claude-notifications.md) remains the baseline.

Use top-level session lifecycle, known state events and their reported directory; add `CwdChanged` only for a verified supported CLI. Ignore subagent events as today. Preserve unrelated hooks and settings, symlinks and the user's existing notification configuration when upgrading or removing Dwell's integration.

Use a small versioned, namespaced OSC payload through Claude's allowlisted `terminalSequence` channel. Prototype the exact sequence before settling the encoding; an allowed OSC family alone does not prove that every payload will pass. Bound strings and message sizes, encode control characters, validate on both sides and bind events to their owning window/terminal/conversation. Ignore malformed, unsupported and obsolete messages. Keep generic terminal bells and the current progress fallback without duplicate sound.

Only accept identity, directory, state and closed reason codes. Treat metadata as untrusted observations, not authorization for filesystem access or command execution. Do not add HTTP services, sockets, transcript watchers or an Electron process per hook.

The current app advertises Claude Code 2.1.141+. Determine and document the actual minimum version required for the new features; do not assume every current hook or setting exists at that baseline. Older clients retain ordinary terminals and existing compatible notifications, with unavailable features explained honestly. No automatic Claude update or silent downgrade from isolated to shared execution.

Official references: [common hook fields](https://code.claude.com/docs/en/hooks#common-input-fields), [directory changes](https://code.claude.com/docs/en/hooks#cwdchanged), [terminal output channel](https://code.claude.com/docs/en/hooks#emit-terminal-notifications), [CLI flags](https://code.claude.com/docs/en/cli-reference).

## 8. Implementation map and sequence

Read `AGENTS.md` and trace every caller before changing IPC signatures.

| Area                                   | Expected changes                                                                  |
| -------------------------------------- | --------------------------------------------------------------------------------- |
| `src/main.cjs`                         | Per-terminal context, validated launch/resume, scoped IPC, preferences migration. |
| `src/claude.cjs`, `src/claude-hook.sh` | Compatible metadata transport and lifecycle/reason mapping.                       |
| `src/preload.cjs`                      | Narrow, explicit terminal-scoped bridge methods.                                  |
| `src/renderer.js`                      | Creation action, restored tabs, context switching, link navigation.               |
| `src/files.cjs`, `src/git.cjs`         | Reuse bounded readers and path checks with the selected checkout.                 |
| `src/preview.js`                       | Scroll/highlight a validated source line.                                         |
| `src/attention.cjs`, `src/orb.*`       | Current reason and accessible transient card.                                     |
| `test/`, `scripts/test-app.cjs`        | Regressions and deterministic interactive fixtures.                               |
| Guides, README, release docs           | Accurate setup, version requirements, limits and refreshed UI descriptions.       |

Implement in reviewable stages:

1. **Compatibility proof:** verify native worktree base selection, metadata emission, custom launcher and exact resume using disposable data. Record the supported CLI version.
2. **Worktree foundation:** terminal context, launch action, scoped panes/IPC/watchers and migration. Complete two simultaneous sessions before moving on.
3. **Resume:** persist validated associations and test restart/failure recovery.
4. **Links:** reuse the context foundation for safe line navigation.
5. **Eclipse:** add semantic reasons and the transient card; keep animation/audio unchanged.
6. **Release validation:** update documentation, test the packaged app and follow the release process.

Do not split the first two stages between agents editing the same context/IPC code. Once the context contract is stable, independent link and Eclipse work can run in parallel. Avoid a general workspace abstraction or plugin system; introduce a small focused module only when it reduces duplicated logic.

## 9. Acceptance criteria

Use disposable repositories and isolated preferences. Automated tests must not require a Claude account or alter the user's sessions.

| Case                                              | Required outcome                                                                                                                                                                                                               |
| ------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Two Claude worktrees from one project             | Distinct branches/directories; edits to the same path remain separate; the original checkout's tracked files, index and pre-existing user files stay unchanged. New worktree directories and shared Git metadata are expected. |
| Dirty original checkout                           | New work starts from the selected committed HEAD; unstaged/staged/untracked user work remains untouched.                                                                                                                       |
| Rapid tab switching                               | Files, diff, preview, drop references and branch label always agree; delayed reads cannot paint the wrong checkout; both PTYs survive.                                                                                         |
| Helper terminal                                   | A new ordinary terminal from Auth starts in Auth's checkout; it does not launch a second Claude automatically.                                                                                                                 |
| Launch failure / unsupported CLI / missing hooks  | Clear error or unknown state; no false isolated indicator and no shared-checkout fallback.                                                                                                                                     |
| Same name / concurrent launch                     | New creates separate unique worktrees or fails cleanly; it never reuses/resets another task's checkout.                                                                                                                        |
| Unrelated path / symlink escape / forged metadata | No filesystem scope expansion, execution or context switch to an unrelated repository.                                                                                                                                         |
| Restart with two saved conversations              | User action resumes each exact ID with its matching launcher and checkout, not the last conversation in the project.                                                                                                           |
| Deleted worktree / missing session                | No recreation, deletion of metadata or silent launch in the main checkout; normal terminal recovery remains available.                                                                                                         |
| Preference migration / integration update         | Existing names/layout/hooks/settings survive; no copied secrets or transcript data.                                                                                                                                            |
| File references                                   | Correct source line for supported absolute and reliably based relative paths, including spaces and Unicode; unsupported/ambiguous paths remain safe.                                                                           |
| Old output after directory changes                | Never resolve an old relative reference using an unrelated newer directory.                                                                                                                                                    |
| Missing file / preview limit / fullscreen         | Honest errors and limits; mouse selection and Claude input keep working.                                                                                                                                                       |
| Eclipse transitions                               | Correct reason for permission, question, plan, response end and API failure; late duplicates stay quiet; error priority remains intact.                                                                                        |
| Desktop interaction                               | Hover/focus card, dragging, click-to-return, multiple displays and reduced motion work without focus theft.                                                                                                                    |
| Existing terminal behavior                        | Resize, input flow control, copy/paste, tab close confirmations, read-only previews and ordinary bells still pass.                                                                                                             |

Run `npm run format`, `npm run check`, `npm run test:app`, then package and run the desktop checks against the packaged executable as CI does. Add focused tests for the new behavior; do not substitute mocks for the real PTY, xterm and window integration checks.

A final real-Claude smoke test is required for metadata, custom launcher, worktree entry, exact resume and fullscreen links, in a disposable project and a dedicated test conversation using the configured account. Do not reuse the user's active conversations or require account-backed tests in CI. State clearly if that final check could not be performed. Never close the user's app or replace a running bundle for testing.

## 10. Handoff and publication

Keep this document in the implementation branch so assumptions and acceptance criteria travel with the work.

Use a `codex/` branch for repository work. The only publishing identity is `mchl-schrdng`. Follow [the existing release process](../releases.md); the intended next minor version is 0.4.0 if it is still available. Update both manifests and the changelog together at release time, never rewrite old tags and never publish a binary before its checks pass.

This specification does not require immediate installation or publication. Deliver the implementation, test results and any remaining limitations for review first.

## 11. Implementation notes

Initial workspace validation on 2026-10-10 (Apple Silicon): `npm run format`, `npm run check` (37 unit tests), `npm run test:app`, `npm run package`, and the full `test:app` suite with `DWELL_EXECUTABLE` pointing to the packaged macOS executable all passed. The packaged Eclipse card and restored-tab screen were visually inspected. Generated builds, profiles and screenshots remain outside version control.

- The new launch actions require Claude Code **2.1.296+**, the version verified with the user's existing `maison` executable. Ordinary terminals and the compatible notification fallback retain their existing support.
- `src/workspaces.cjs` validates Git membership and migrates saved tab metadata. Main-process context revisions scope file/Git requests, watchers and file references; the renderer retains navigation per checkout.
- Native worktree launches use a small shell adapter to merge `worktree.baseRef: "head"` into launcher-supplied settings. This preserves `maison`'s account helper and status line. Resume calls the configured launcher directly with the saved ID. No dependency or background service was added.
- Automated desktop tests use disposable repositories, isolated shell configuration and an account-free CLI fixture with real PTYs, Git worktrees, hooks, xterm and Electron windows. They cover stale reads, separate edits, fullscreen mouse reporting, exact resume, launcher changes, missing checkouts and Eclipse's reason card.
- A dedicated real-Claude conversation verified native worktree entry, accepted OSC metadata and exact resume through `maison`. In Dwell, the restored conversation retained its history and checkout; the keyboard file-reference action opened the expected source line while Claude's fullscreen UI was active. No existing user conversation was reused or closed.

Known limits: relative references are deliberately disabled in fullscreen output or after cursor edits/reflow make their original directory uncertain. Use an absolute reference or **Open File Reference…**. Modified-click behavior in fullscreen is covered by the deterministic desktop fixture; a physical ⌘click on real Claude output and multiple physical displays have not been manually checked. Shell aliases/functions are not supported launchers; an executable wrapper that forwards arguments and invokes `claude` on PATH is supported.

The implementation is included in the 0.4.0 source preview, alongside Focus and the subsequent repository cleanup. The initial checks above predate those changes. Installation and tagged release publication remain separate actions.
