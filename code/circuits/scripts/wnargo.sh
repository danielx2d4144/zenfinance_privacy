#!/bin/bash
# Run a command in WSL Ubuntu with nargo+bb on PATH, working in the
# given directory.
# Usage: ./scripts/wnargo.sh <relpath-from-circuits/> <cmd> [args...]
set -e
REL="$1"
shift
WIN_BASE="/mnt/c/Users/Hi/Desktop/team idea/code/circuits"
MSYS_NO_PATHCONV=1 wsl.exe -d Ubuntu -- bash -lc "cd '$WIN_BASE/$REL' && export PATH=\$HOME/.nargo/bin:\$HOME/.bb:\$PATH && $*"
