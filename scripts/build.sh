#!/bin/bash
echo 'Building...'
rm -r dist > /dev/null 2>&1

if tsc
then
  echo 'Building...done'
else
  exitCode="$?"
  echo "Something went wrong when building (see above). Please inspect the code, fix the issue, and try again."
  exit $exitCode
fi
