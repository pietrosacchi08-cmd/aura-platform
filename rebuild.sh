#!/bin/bash
set -e
cd /home/team/shared/site
sudo rm -rf dist .vinxi
bun run publish 2>&1
echo "DONE: $?"
