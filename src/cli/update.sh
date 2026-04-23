#!/bin/bash
set -e

OLD_VERSION=$(openfox --version)
openfox service stop
npm cache clean --force
npm update -g openfox
NEW_VERSION=$(openfox --version)
openfox service start
echo "Updated: $OLD_VERSION -> $NEW_VERSION"