#!/bin/bash
# Debug script to check test file syntax and imports

LOG_FILE="/Users/juliustranquilli/webisoft/cardano-ibc-official/.cursor/debug.log"

echo "{\"location\":\"debug_check_test_files.sh:5\",\"message\":\"Checking STT test files\",\"timestamp\":$(date +%s)000,\"sessionId\":\"debug-session\",\"runId\":\"run1\",\"hypothesisId\":\"A\"}" >> "$LOG_FILE"

# Check if test files exist
for file in "validators/minting_client_stt.test.ak" "validators/minting_connection_stt.test.ak" "validators/minting_channel_stt.test.ak"; do
    if [ -f "$file" ]; then
        echo "{\"location\":\"debug_check_test_files.sh:11\",\"message\":\"Test file exists\",\"data\":{\"file\":\"$file\"},\"timestamp\":$(date +%s)000,\"sessionId\":\"debug-session\",\"runId\":\"run1\",\"hypothesisId\":\"A\"}" >> "$LOG_FILE"
        # Check what the test file imports
        IMPORT=$(grep "use validators" "$file")
        echo "{\"location\":\"debug_check_test_files.sh:15\",\"message\":\"Test file import\",\"data\":{\"file\":\"$file\",\"import\":\"$IMPORT\"},\"timestamp\":$(date +%s)000,\"sessionId\":\"debug-session\",\"runId\":\"run1\",\"hypothesisId\":\"A\"}" >> "$LOG_FILE"
    else
        echo "{\"location\":\"debug_check_test_files.sh:18\",\"message\":\"Test file missing\",\"data\":{\"file\":\"$file\"},\"timestamp\":$(date +%s)000,\"sessionId\":\"debug-session\",\"runId\":\"run1\",\"hypothesisId\":\"A\"}" >> "$LOG_FILE"
    fi
done

# Check if main validator files exist
for file in "validators/minting_client_stt.ak" "validators/minting_connection_stt.ak" "validators/minting_channel_stt.ak"; do
    if [ -f "$file" ]; then
        echo "{\"location\":\"debug_check_test_files.sh:26\",\"message\":\"Validator file exists\",\"data\":{\"file\":\"$file\"},\"timestamp\":$(date +%s)000,\"sessionId\":\"debug-session\",\"runId\":\"run1\",\"hypothesisId\":\"B\"}" >> "$LOG_FILE"
        # Check for validator function definition
        VALIDATOR_DEF=$(grep "^validator" "$file" | head -1)
        echo "{\"location\":\"debug_check_test_files.sh:30\",\"message\":\"Validator definition\",\"data\":{\"file\":\"$file\",\"definition\":\"$VALIDATOR_DEF\"},\"timestamp\":$(date +%s)000,\"sessionId\":\"debug-session\",\"runId\":\"run1\",\"hypothesisId\":\"C\"}" >> "$LOG_FILE"
        # Check for problematic imports
        HOST_STATE_IMPORT=$(grep "use validators/host_state_stt" "$file")
        echo "{\"location\":\"debug_check_test_files.sh:34\",\"message\":\"HostState import check\",\"data\":{\"file\":\"$file\",\"import\":\"$HOST_STATE_IMPORT\"},\"timestamp\":$(date +%s)000,\"sessionId\":\"debug-session\",\"runId\":\"run1\",\"hypothesisId\":\"D\"}" >> "$LOG_FILE"
    else
        echo "{\"location\":\"debug_check_test_files.sh:37\",\"message\":\"Validator file missing\",\"data\":{\"file\":\"$file\"},\"timestamp\":$(date +%s)000,\"sessionId\":\"debug-session\",\"runId\":\"run1\",\"hypothesisId\":\"B\"}" >> "$LOG_FILE"
    fi
done

echo "Test file check complete. Check $LOG_FILE for details."

