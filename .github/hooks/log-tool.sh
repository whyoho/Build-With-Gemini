#!/bin/bash
# A PreToolUse hook to intercept and log build/test tool executions

# Read the stdin payload containing the tool invocation context
PAYLOAD=$(cat)

# Extract tool name using grep (basic parsing to avoid requiring jq if unavailable)
# Real implementation should use jq to safely parse the JSON payload
TOOL_NAME=$(echo "$PAYLOAD" | grep -o '"name": *"[^"]*"' | head -1 | cut -d '"' -f 4)

# Create a validation log file
LOG_FILE="./.github/hooks/validation-log.txt"
touch "$LOG_FILE"

# Log terminal commands related to building or testing
if [ "$TOOL_NAME" = "run_in_terminal" ] || [ "$TOOL_NAME" = "execute" ]; then
  # Very basic extraction of the command string
  CMD=$(echo "$PAYLOAD" | grep -o '"command": *"[^"]*"' | head -1 | cut -d '"' -f 4)
  
  if [[ "$CMD" == *"build"* ]] || [[ "$CMD" == *"test"* ]] || [[ "$CMD" == *"bun"* ]]; then
    echo "[$(date -u)] Executed: $CMD" >> "$LOG_FILE"
    
    # We could optionally ask the user for permission before running tests or builds:
    # cat <<EOF
    # {
    #   "hookSpecificOutput": {
    #     "permissionDecision": "ask",
    #     "permissionDecisionReason": "About to run a build/test command. Log it for the Validator?"
    #   }
    # }
    # EOF
    # exit 0
  fi
fi

# Allow all tools to proceed by default
cat <<EOF
{
  "hookSpecificOutput": {
    "permissionDecision": "allow"
  }
}
EOF
