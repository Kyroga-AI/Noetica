#!/usr/bin/env bash
PID_FILE=/tmp/noetica-pids
if [ ! -f "$PID_FILE" ]; then
  echo "No PID file found at $PID_FILE — nothing to stop."
  exit 0
fi
while IFS=' ' read -r pid name; do
  if kill -0 "$pid" 2>/dev/null; then
    kill "$pid" && echo "Stopped $name (PID $pid)"
  fi
done < "$PID_FILE"
rm -f "$PID_FILE"
echo "Done."
