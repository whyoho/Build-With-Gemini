#!/bin/bash

# Read the PostToolUse JSON payload from stdin
payload=$(cat)

# Check if the tool use involved modifying index.ts
if echo "$payload" | grep -q '"index.ts"'; then
    # Kill any existing Bun processes
    pkill bun || true
    
    # Start the server again in hot-reload mode
    # We use nohup to detach it so the hook doesn't block
    nohup bun --hot index.ts > server.log 2>&1 &
    
    # Return a JSON response telling the agent it succeeded
    echo '{"hookSpecificOutput": {"hookEventName": "PostToolUse", "systemMessage": "Bun server restarted successfully."}}'
else
    # Output minimal required JSON for the hook to continue without blocking
    echo '{"hookSpecificOutput": {"hookEventName": "PostToolUse"}}'
fi
