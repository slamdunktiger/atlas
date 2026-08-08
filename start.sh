#!/usr/bin/env bash
# Start Atlas on localhost:8731 (background). Logs to ~/.atlas/atlas.log
cd "$(dirname "$0")"
ATLAS_DB="${ATLAS_DB:-$HOME/.atlas/atlas.db}" \
ATLAS_PORT="${ATLAS_PORT:-8731}" \
nohup python3 atlas_server.py > ~/.atlas/atlas.log 2>&1 &
echo "Atlas PID $! — http://localhost:8731"
