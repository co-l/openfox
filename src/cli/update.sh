#!/bin/bash
set -e

CURRENT_VERSION=$(openfox --version)
LATEST_VERSION=$(npm view openfox version)

if [ "$CURRENT_VERSION" = "$LATEST_VERSION" ]; then
  echo "OpenFox is already at the latest version: $CURRENT_VERSION"
  exit 0
fi

echo "Updating OpenFox: $CURRENT_VERSION -> $LATEST_VERSION"
npm cache clean --force
npm update -g openfox
NEW_VERSION=$(openfox --version)

if [ "$1" = "--service" ]; then
  echo "Restarting service..."
  systemd-run --user --scope systemctl --user restart openfox
else
  echo "Updated: $NEW_VERSION"
  echo "Please restart OpenFox to use the new version."
fi
