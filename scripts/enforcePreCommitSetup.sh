#!/bin/bash
preCommitFile=".git/hooks/pre-commit"
if [ ! -f "$preCommitFile" ]; then
  echo "$preCommitFile preCommitFile does not exist, so branch protection does not exist. Running ./scripts/setup.sh to set this up."
  ./scripts/setup.sh
  exit 0
else
  isInFile=$(grep -c "protectDevAndMainBranches.sh" "$preCommitFile")
  if [ "$isInFile" -eq 0 ]; then
    echo "$preCommitFile preCommitFile exists, but branch protection is not present. Running ./scripts/setup.sh to set this up."
    ./scripts/setup.sh
    exit 0
  else
    if [ -x "$preCommitFile" ]; then
      echo "$preCommitFile preCommitFile looks good!"
    else
      echo "$preCommitFile preCommitFile not executable. Marking as executable."
      chmod +x "$preCommitFile"
    fi
  fi
fi
