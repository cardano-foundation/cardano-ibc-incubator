#!/bin/bash
# sqs version v25.8.1


SCRIPT_DIR=$(dirname $(realpath $0))


git submodule update --init --recursive
rm $SCRIPT_DIR/../sqs/config.json && cp $SCRIPT_DIR/../configuration/config.json $SCRIPT_DIR/../sqs/config.json
rm $SCRIPT_DIR/../sqs/Makefile && cp $SCRIPT_DIR/../configuration/Makefile $SCRIPT_DIR/../sqs/Makefile