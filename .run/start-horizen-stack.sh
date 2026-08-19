#!/usr/bin/env bash
# Launch the three long-running services for the Horizen demo run, detached.
#
# These used to be started as children of an agent shell, which meant they were
# killed whenever that session ended -- twice, mid-run, taking the oracle keeper
# with them so prices aged past MAX_STALENESS_WINDOW (3600s) and every borrow
# would have reverted PriceStale. Start-Process breaks the parent link so they
# outlive whatever started them.
#
# Postgres is NOT here: it lives in docker compose (infra/data-stack) and
# already survives on its own. Bring it up first:
#   cd code/infra/data-stack && docker compose up -d postgres
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
LOGS="$ROOT/.run/logs"
mkdir -p "$LOGS"

# PowerShell cannot read git-bash's POSIX paths (/c/Users/...), so every path
# handed to Start-Process goes through cygpath. The -lc script itself stays
# POSIX -- bash is what interprets that.
BASH_EXE='C:\Program Files\Git\bin\bash.exe'

# Two quoting traps live in this function, both of which failed silently:
#
# 1. Logging is Start-Process's job, not the shell's. An in-command
#    `> file 2>&1` does not survive -ArgumentList parsing once the path has a
#    space in it ("team idea"), and produced no log files at all. Start-Process
#    also refuses to point stdout and stderr at one file, hence the .err split.
#
# 2. $cmd is wrapped in literal double quotes. -ArgumentList does not quote
#    elements containing spaces, so '-lc','npm run horizen:keep' reached bash as
#    `-c npm` plus three loose words, and each service printed `npm help` and
#    exited instead of starting.
launch() {
  local name="$1" dir="$2" cmd="$3"
  local windir winout winerr
  windir="$(cygpath -w "$dir")"
  winout="$(cygpath -w "$LOGS/$name.log")"
  winerr="$(cygpath -w "$LOGS/$name.err.log")"
  powershell -NoProfile -Command \
    "Start-Process -FilePath '$BASH_EXE' -ArgumentList '-lc','\"$cmd\"' -WorkingDirectory '$windir' -RedirectStandardOutput '$winout' -RedirectStandardError '$winerr' -WindowStyle Hidden" \
    >/dev/null
  echo "[start] $name -> .run/logs/$name.log"
}

launch price-keeper "$ROOT/code/backend/price-keeper" "npm run horizen:keep"

# LOG_LEVEL=info overrides the warn in .env.horizen so intent transitions are
# visible while we watch a run.
launch data-api "$ROOT/code/backend/data-api" \
  "set -a; source .env.horizen; set +a; export LOG_LEVEL=info; npm start"

launch dapp "$ROOT/code/dapp" "npm run dev"

echo
echo "Wait ~3 min for the dapp's first webpack compile, then open http://localhost:3000"
