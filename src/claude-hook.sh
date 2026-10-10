#!/bin/sh

# macOS supplies plutil; starting an Electron process for every tool adds latency.
[ "$TERM_PROGRAM" = Dwell ] || exit 0
export LC_ALL=C
input=$(/usr/bin/head -c 1048577)
[ "${#input}" -le 1048576 ] || exit 0

field() {
  printf '%s' "$input" | /usr/bin/plutil -extract "$1" raw -o - - 2>/dev/null
}

# Subagent tool activity must not overwrite the main conversation's state.
if field agent_id >/dev/null; then exit 0; fi
case "$(field hook_event_name)" in
  SessionStart|SessionEnd) status=0 ;;
  UserPromptSubmit|PostToolUse|ElicitationResult) status=3 ;;
  PreToolUse)
    case "$(field tool_name)" in
      AskUserQuestion|ExitPlanMode) status=4 ;;
      *) status=3 ;;
    esac ;;
  PostToolUseFailure)
    if [ "$(field is_interrupt)" = true ]; then status=0; else status=3; fi ;;
  PermissionRequest|Elicitation|Stop) status=4 ;;
  StopFailure) status=2 ;;
  Notification)
    case "$(field notification_type)" in
      permission_prompt|idle_prompt|elicitation_dialog|elicitation_url_dialog|agent_needs_input|agent_completed|quota_auto_resume_stale|quota_auto_resume_disabled)
        status=4 ;;
      elicitation_complete|elicitation_response|quota_auto_resume_fired) status=3 ;;
      *) exit 0 ;;
    esac ;;
  *) exit 0 ;;
esac

printf '{"terminalSequence":"\\u001b]9;4;%s\\u0007"}\n' "$status"
