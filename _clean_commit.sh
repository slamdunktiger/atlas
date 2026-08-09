#!/bin/bash
set -e
cd REDACTEDREDACTED/atlas
rm -f ~/.atlas/covey-backups/* 2>/dev/null || true
echo "backups cleaned: $(ls ~/.atlas/covey-backups/ 2>/dev/null | wc -l) remaining"
echo "test markers in board: $(grep -cE 'BACKUP-TEST|DEDUP1|PREEDITCHECK|VRF-|VERIFY' ~/Documents/M1\ Hermes/COVEY-BOARD.md 2>/dev/null || echo 0)"
python3 -c "import ast; ast.parse(open('atlas_server.py').read()); print('SYNTAX OK')"
git add -A
git commit -q -m "Covey auto-backup: timestamped pre-edit snapshots (local-only, dedupe, keep last 50)

Before every covey write (add/edit/delete) the current COVEY-BOARD.md is snapshotted
to ~/.atlas/covey-backups/COVEY-BOARD-<ts>.md. Pre-edit state (true undo point),
dedupes identical content, trims to last 50. Private/local only -- never in the public
atlas repo (board stays out of git by design)."
git push 2>&1 | tail -2
echo "DONE"
