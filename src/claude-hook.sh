#!/bin/sh

# macOS supplies plutil; starting an Electron process for every tool adds latency.
[ "$TERM_PROGRAM" = Dwell ] || exit 0
export LC_ALL=C
input=$(/usr/bin/head -c 1048577)
[ "${#input}" -le 1048576 ] || exit 0

field() {
  extracted=$(printf '%s' "$input" | /usr/bin/plutil -extract "$1" raw -o - - 2>/dev/null) || return 1
  printf '%s' "$extracted"
}

# Subagent tool activity must not overwrite the main conversation's state.
if field agent_id >/dev/null; then exit 0; fi
event=$(field hook_event_name)
reason=none
case "$event" in
  SessionStart|SessionEnd) status=0 ;;
  CwdChanged) status=keep ;;
  UserPromptSubmit|PostToolUse|ElicitationResult) status=3 ;;
  PreToolUse)
    case "$(field tool_name)" in
      AskUserQuestion) status=4; reason=question ;;
      ExitPlanMode) status=4; reason=plan ;;
      *) status=3 ;;
    esac ;;
  PostToolUseFailure)
    if [ "$(field is_interrupt)" = true ]; then status=0; else status=3; fi ;;
  PermissionRequest) status=4; reason=approval ;;
  Elicitation) status=4; reason=question ;;
  Stop) status=4; reason=response ;;
  StopFailure) status=2; reason=error ;;
  Notification)
    case "$(field notification_type)" in
      permission_prompt) status=4; reason=approval ;;
      elicitation_dialog|elicitation_url_dialog|agent_needs_input) status=4; reason=question ;;
      agent_completed) status=4; reason=response ;;
      idle_prompt|quota_auto_resume_stale|quota_auto_resume_disabled) status=4; reason=attention ;;
      elicitation_complete|elicitation_response|quota_auto_resume_fired) status=3 ;;
      *) exit 0 ;;
    esac ;;
  *) exit 0 ;;
esac

id=$(field session_id)
cwd=$(field cwd)
[ "$event" != CwdChanged ] || cwd=$(field new_cwd)
# Old Dwell versions and payloads without identity keep their progress notifications.
if [ -z "$DWELL_CLAUDE_NONCE" ] || [ -z "$id" ] || [ -z "$cwd" ]; then
  [ "$status" = keep ] || printf '{"terminalSequence":"\\u001b]9;4;%s\\u0007"}\n' "$status"
  exit 0
fi
case "$id:$DWELL_CLAUDE_NONCE" in *[!a-fA-F0-9:-]*) exit 0 ;; esac
[ "${#id}" -eq 36 ] && [ "${#DWELL_CLAUDE_NONCE}" -eq 36 ] && [ "${#cwd}" -le 4096 ] || exit 0
cwd=$(printf '%s' "$cwd" | /usr/bin/base64 | /usr/bin/tr -d '\r\n')
printf '{"terminalSequence":"\\u001b]777;dwell;1;%s;%s;%s;%s;%s;%s\\u0007"}\n' "$DWELL_CLAUDE_NONCE" "$event" "$status" "$reason" "$id" "$cwd"
