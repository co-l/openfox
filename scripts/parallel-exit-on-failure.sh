#!/bin/sh

# Run commands in parallel, exit immediately on first failure.
# Usage: parallel_exit_on_failure <name> <command> [<name> <command>] ...
#
# Each pair is a name (for logging) and a shell command string.
# Prints result for each command as it completes.
# Returns 0 if all commands succeed, 1 if any fails.

parallel_exit_on_failure() {
  # Save errexit state and disable it — we handle errors ourselves
  _peof_old_e=""
  case "$-" in *e*) _peof_old_e="y"; set +e;; esac

  TIMEOUT=120
  TMPDIR=$(mktemp -d) || return 1
  FAILED="$TMPDIR/failed"
  FAILED_BY="$TMPDIR/failed_by"

  _cleanup() {
    rm -rf "$TMPDIR"
  }

  _kill_all() {
    for _pid in $_pids; do
      pkill -P "$_pid" 2>/dev/null
      kill -9 "$_pid" 2>/dev/null
    done
  }

  _pids=""
  _job_count=0
  _names=""

  while [ $# -ge 2 ]; do
    name=$1
    cmd=$2
    (
      logfile="$TMPDIR/$name.log"
      exitfile="$TMPDIR/$name.exit"
      if eval "$cmd" > "$logfile" 2>&1; then
        ec=0
      else
        ec=$?
      fi
      echo "$ec" > "$exitfile"
      if [ "$ec" -ne 0 ]; then
        # Only the first failure touches FAILED (atomic via mkdir)
        mkdir "$TMPDIR/failed_lock" 2>/dev/null && {
          touch "$FAILED"
          echo "$name" > "$FAILED_BY"
          rm -rf "$TMPDIR/failed_lock"
        }
      fi
    ) > /dev/null 2>&1 &
    _pids="$_pids $!"
    _names="$_names $name"
    _job_count=$((_job_count + 1))
    shift 2
  done

  while true; do
    if [ -f "$FAILED" ]; then
      _kill_all
      wait 2>/dev/null
      # Wait briefly for FAILED_BY to be written
      _wait=0
      while [ ! -f "$FAILED_BY" ] && [ "$_wait" -lt 10 ]; do
        sleep 0.01
        _wait=$((_wait + 1))
      done
      # Print only the actual failure
      if [ -f "$FAILED_BY" ]; then
        read -r _failed_name < "$FAILED_BY"
        _exitf="$TMPDIR/$_failed_name.exit"
        if [ -f "$_exitf" ]; then
          read -r _ec < "$_exitf"
          echo "  $_failed_name ✗ (exit code $_ec)"
          if [ -s "$TMPDIR/$_failed_name.log" ]; then
            echo
            cat "$TMPDIR/$_failed_name.log"
            echo
          fi
        fi
      fi
      _cleanup
      [ -n "$_peof_old_e" ] && set -e
      return 1
    fi

    # Check for newly completed jobs and print their results
    for _name in $_names; do
      _exitf="$TMPDIR/$_name.exit"
      _printedf="$TMPDIR/$_name.printed"
      if [ -f "$_exitf" ] && [ ! -f "$_printedf" ]; then
        touch "$_printedf"
        read -r _ec < "$_exitf"
        if [ "$_ec" -eq 0 ]; then
          echo "  $_name ✓"
        fi
        # Non-zero exit is handled by the FAILED path above
      fi
    done

    _completed=0
    for _f in "$TMPDIR"/*.exit; do
      [ -f "$_f" ] && _completed=$((_completed + 1))
    done

    if [ "$_completed" -ge "$_job_count" ]; then
      break
    fi

    sleep 0.1
  done

  # Print any remaining successful results
  for _name in $_names; do
    _exitf="$TMPDIR/$_name.exit"
    _printedf="$TMPDIR/$_name.printed"
    if [ -f "$_exitf" ] && [ ! -f "$_printedf" ]; then
      touch "$_printedf"
      read -r _ec < "$_exitf"
      if [ "$_ec" -eq 0 ]; then
        echo "  $_name ✓"
      fi
    fi
  done

  # Check exit codes
  for _f in "$TMPDIR"/*.exit; do
    [ -f "$_f" ] || continue
    read -r _ec < "$_f"
    if [ "$_ec" -ne 0 ]; then
      _cleanup
      [ -n "$_peof_old_e" ] && set -e
      return 1
    fi
  done

  _cleanup
  [ -n "$_peof_old_e" ] && set -e
  return 0
}
