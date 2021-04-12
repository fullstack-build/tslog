#!/bin/bash
./scripts/enforcePreCommitSetup.sh
echo 'Building...'
rm -r dist
tsc
echo 'Building...done'
