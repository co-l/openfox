#!/bin/bash
set -e

CURRENT_VERSION=$(openfox --version)
LATEST_VERSION=$(npm view openfox version)

if [ "$CURRENT_VERSION" = "$LATEST_VERSION" ]; then
  echo "OpenFox is already at the latest version: $CURRENT_VERSION"
  exit 0
fi

echo "Updating OpenFox: $CURRENT_VERSION -> $LATEST_VERSION"
openfox service stop
npm cache clean --force
npm update -g openfox
NEW_VERSION=$(openfox --version)
openfox service start
echo "Updated: $NEW_VERSION"