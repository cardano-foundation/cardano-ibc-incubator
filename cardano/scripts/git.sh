#!/bin/bash

git subtree pull --prefix=gateway/cosmjs-types git@git02.smartosc.com:cardano/ibc-sidechain/cosmjs-types.git dev
git subtree pull --prefix=cardano-node-services git@git02.smartosc.com:cardano/ibc-sidechain/cardano-node-services.git dev

# Check if the current branch is dev
current_branch=$(git rev-parse --abbrev-ref HEAD)
if [ "$current_branch" != "dev" ]; then
    echo "This script must be run from the dev branch. Current branch is $current_branch."
    exit 1
fi

# Define an array of branches
branches=("feature/isc-5" "feature/isc-7" "feature/isc-11" "feature/isc-9" "feature/isc-13" "feature/isc-17" "feature/isc-139")

# Fetch the latest info from remote
echo "Fetching the latest information from remote..."
git fetch
if [ $? -ne 0 ]; then
    echo "Error while fetching from remote. Stopping the script."
    exit 1
fi

# Loop through each branch
for branch in "${branches[@]}"; do
    echo "Starting to process branch: $branch"

    # Try to checkout the branch
    echo "Checking out branch $branch..."
    git checkout "$branch"
    if [ $? -ne 0 ]; then
        echo "Branch $branch does not exist. Creating a new branch based on dev."
        git checkout -b "$branch" origin/dev
        if [ $? -ne 0 ]; then
            echo "Error while creating new branch $branch. Stopping the script."
            exit 1
        fi
    fi

    # Pull the latest changes for the branch
    echo "Pulling the latest changes for $branch..."
    git pull origin "$branch"
    if [ $? -ne 0 ]; then
        echo "Error while pulling the latest changes for $branch. Stopping the script."
        exit 1
    fi

    # Pull from dev
    echo "Merging changes from dev into $branch..."
    git pull origin dev
    if [ $? -ne 0 ]; then
        echo "Error while merging changes from dev into $branch. Stopping the script."
        exit 1
    fi

    # Push to remote
    echo "Pushing $branch to remote..."
    git push --set-upstream origin "$branch"
    if [ $? -ne 0 ]; then
        echo "Error while pushing $branch to remote. Stopping the script."
        exit 1
    fi

    echo "Finished processing branch: $branch"
done

echo "Script completed."

