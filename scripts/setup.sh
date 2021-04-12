#!/bin/bash

# Create pre-hook for commit
preCommitFile=".git/hooks/pre-commit"
echo "Setting up pre-commit hooks for git..."
cp "scripts/preCommit.sh" "$preCommitFile"
echo "Setting up pre-commit hooks for git...done"

# Install NodeJs
read -p 'Install Nodejs? [y/N]: ' installNode
if [ "${installNode,,}" = "y" ]
then
  sudo apt-get install nodejs
fi
