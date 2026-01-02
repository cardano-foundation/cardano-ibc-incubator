#!/bin/bash
# Debug script to capture Aiken build output

LOG_FILE="/Users/juliustranquilli/webisoft/cardano-ibc-official/.cursor/debug.log"

echo "{\"location\":\"debug_aiken_build.sh:5\",\"message\":\"Starting Aiken build with verbose output\",\"timestamp\":$(date +%s)000,\"sessionId\":\"debug-session\",\"runId\":\"run1\",\"hypothesisId\":\"B\"}" >> "$LOG_FILE"

# Run aiken build and capture all output
BUILD_OUTPUT=$(aiken build 2>&1)
BUILD_EXIT_CODE=$?

echo "{\"location\":\"debug_aiken_build.sh:12\",\"message\":\"Aiken build completed\",\"data\":{\"exitCode\":$BUILD_EXIT_CODE,\"outputLength\":${#BUILD_OUTPUT}},\"timestamp\":$(date +%s)000,\"sessionId\":\"debug-session\",\"runId\":\"run1\",\"hypothesisId\":\"B\"}" >> "$LOG_FILE"

# Check if there were any errors mentioning our validators
if echo "$BUILD_OUTPUT" | grep -q "minting_client_stt\|minting_connection_stt\|minting_channel_stt"; then
    RELEVANT_OUTPUT=$(echo "$BUILD_OUTPUT" | grep -A 5 -B 5 "minting_client_stt\|minting_connection_stt\|minting_channel_stt")
    echo "{\"location\":\"debug_aiken_build.sh:19\",\"message\":\"STT validators mentioned in build output\",\"data\":{\"output\":\"$RELEVANT_OUTPUT\"},\"timestamp\":$(date +%s)000,\"sessionId\":\"debug-session\",\"runId\":\"run1\",\"hypothesisId\":\"B\"}" >> "$LOG_FILE"
else
    echo "{\"location\":\"debug_aiken_build.sh:22\",\"message\":\"STT validators NOT mentioned in build output\",\"timestamp\":$(date +%s)000,\"sessionId\":\"debug-session\",\"runId\":\"run1\",\"hypothesisId\":\"B\"}" >> "$LOG_FILE"
fi

# Check for any error keywords
if echo "$BUILD_OUTPUT" | grep -qi "error\|fail\|warning"; then
    ERROR_LINES=$(echo "$BUILD_OUTPUT" | grep -i "error\|fail\|warning")
    echo "{\"location\":\"debug_aiken_build.sh:29\",\"message\":\"Build output contains errors/warnings\",\"data\":{\"errors\":\"$ERROR_LINES\"},\"timestamp\":$(date +%s)000,\"sessionId\":\"debug-session\",\"runId\":\"run1\",\"hypothesisId\":\"B\"}" >> "$LOG_FILE"
fi

echo "Aiken build debug complete. Check $LOG_FILE for details."
echo "Exit code: $BUILD_EXIT_CODE"

