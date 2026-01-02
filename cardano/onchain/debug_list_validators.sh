#!/bin/bash
# Debug script to list all validators in plutus.json

LOG_FILE="/Users/juliustranquilli/webisoft/cardano-ibc-official/.cursor/debug.log"

echo "{\"location\":\"debug_list_validators.sh:5\",\"message\":\"Listing all validators in plutus.json\",\"timestamp\":$(date +%s)000,\"sessionId\":\"debug-session\",\"runId\":\"run1\",\"hypothesisId\":\"E\"}" >> "$LOG_FILE"

if [ ! -f "plutus.json" ]; then
    echo "{\"location\":\"debug_list_validators.sh:9\",\"message\":\"plutus.json not found\",\"timestamp\":$(date +%s)000,\"sessionId\":\"debug-session\",\"runId\":\"run1\",\"hypothesisId\":\"E\"}" >> "$LOG_FILE"
    exit 1
fi

# Count total validators
TOTAL=$(jq '.validators | length' plutus.json)
echo "{\"location\":\"debug_list_validators.sh:16\",\"message\":\"Total validators in blueprint\",\"data\":{\"count\":$TOTAL},\"timestamp\":$(date +%s)000,\"sessionId\":\"debug-session\",\"runId\":\"run1\",\"hypothesisId\":\"E\"}" >> "$LOG_FILE"

# List all validator titles
jq -r '.validators | .[].title' plutus.json | while read title; do
    echo "{\"location\":\"debug_list_validators.sh:21\",\"message\":\"Found validator\",\"data\":{\"title\":\"$title\"},\"timestamp\":$(date +%s)000,\"sessionId\":\"debug-session\",\"runId\":\"run1\",\"hypothesisId\":\"E\"}" >> "$LOG_FILE"
done

# Search specifically for STT validators
STT_COUNT=$(jq -r '.validators | .[].title' plutus.json | grep -c "stt" || echo "0")
echo "{\"location\":\"debug_list_validators.sh:27\",\"message\":\"STT validators found\",\"data\":{\"count\":$STT_COUNT},\"timestamp\":$(date +%s)000,\"sessionId\":\"debug-session\",\"runId\":\"run1\",\"hypothesisId\":\"E\"}" >> "$LOG_FILE"

echo "Blueprint analysis complete. Check $LOG_FILE for details."

