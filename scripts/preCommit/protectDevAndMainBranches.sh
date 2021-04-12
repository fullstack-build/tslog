#!/bin/bash
# Protect Dev and Main Branches
branch="$(git rev-parse --abbrev-ref HEAD)"

if [ "$branch" = "main" ] || [ "$branch" = "dev" ]
then
  echo "You can't commit directly to the $branch branch! Please open a PR on a separate feature branch and get it approved before merging into $branch."
  exit 1
fi
