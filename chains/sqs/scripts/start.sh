#!/bin/bash
# sqs version v25.8.1


SCRIPT_DIR=$(dirname $(realpath $0))

# Start sqs server 
cd ${SCRIPT_DIR}/../sqs && make docker-build && make run-docker