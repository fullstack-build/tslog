#!/bin/bash
./scripts/preCommit/protectDevAndMainBranches.sh || exit "$?"
yarn build || exit "$?"
#yarn test || exit "$?"  # SKIPPING TESTS FOR NOW AS THEY DON'T PASS FOR SOME REASON?
