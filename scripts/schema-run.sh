#!/usr/bin/env bash
# Runs the schema sync for the "Schema apply" and "Schema plan" workflows and records what really happened (AUTO-02).
#   scripts/schema-run.sh run apply|plan   run the command(s), keep the log, record each exit status; always exits 0
#   scripts/schema-run.sh verdict          read the record and fail (exit 1) unless it really succeeded
# The workflow runs "run", then publishes the log with `if: always()`, then runs "verdict" last (also `if: always()`),
# so the log is kept even when the command failed, and the job still ends red.
#
# Environment:
#   TURSO_DATABASE_URL        the target; empty = no target
#   SCHEMA_SYNC_CMD           the command (default "node scripts/turso-sync.mjs"); tests put a stub here
#   NO_TARGET=skip|fail       what "no target" means: skip = reported as SKIPPED (not as success), fail = a failure
#   SCHEMA_LOG, SCHEMA_RESULT where to write (default plan.log, schema-result.env)
# Three outcomes only: ok (every command exited 0), failed (any command failed, or nothing was recorded), skipped (no target).
set -u
LOG="${SCHEMA_LOG:-plan.log}"
RESULT="${SCHEMA_RESULT:-schema-result.env}"
CMD="${SCHEMA_SYNC_CMD:-node scripts/turso-sync.mjs}"
esc() { sed -e 's/%/%25/g' | tr '\n' '\r' | sed -e 's/\r/%0A/g'; }

record() { # mode apply_status plan_status outcome reason
  printf 'MODE=%s\nAPPLY_STATUS=%s\nPLAN_STATUS=%s\nOUTCOME=%s\nREASON=%s\n' "$1" "$2" "$3" "$4" "$5" > "$RESULT"
}

run() {
  mode="${1:-}"
  case "$mode" in apply|plan) ;; *) echo "usage: $0 run apply|plan" >&2; exit 2;; esac
  rm -f "$RESULT"
  if [ -z "${TURSO_DATABASE_URL:-}" ]; then
    echo "No database target is set (TURSO_DATABASE_URL is empty): nothing was run." > "$LOG"
    if [ "${NO_TARGET:-skip}" = fail ]; then record "$mode" none none failed "no database target is set"; else record "$mode" none none skipped "no database target is set"; fi
    return 0
  fi
  : > "$LOG"
  apply=none
  if [ "$mode" = apply ]; then
    $CMD >> "$LOG" 2>&1; apply=$?
    echo "exit: $apply" >> "$LOG"
  fi
  $CMD --plan >> "$LOG" 2>&1; plan=$?
  echo "plan exit: $plan" >> "$LOG"
  if [ "$apply" != none ] && [ "$apply" != 0 ]; then outcome=failed; reason="apply exited $apply"; fi
  if [ "$plan" != 0 ]; then outcome=failed; reason="${reason:+$reason; }plan exited $plan"; fi
  record "$mode" "$apply" "$plan" "${outcome:-ok}" "${reason:-}"
  return 0
}

verdict() {
  if [ ! -f "$RESULT" ]; then
    echo "::error title=Schema result::nothing was recorded, so the schema is NOT known to be fine (an earlier step stopped)."
    return 1
  fi
  # shellcheck disable=SC1090
  MODE= APPLY_STATUS= PLAN_STATUS= OUTCOME= REASON=
  while IFS='=' read -r k v; do case "$k" in MODE|APPLY_STATUS|PLAN_STATUS|OUTCOME|REASON) printf -v "$k" '%s' "$v";; esac; done < "$RESULT"
  tail_log=""; [ -f "$LOG" ] && tail_log=$(tail -40 "$LOG" | esc)
  summary() { [ -n "${GITHUB_STEP_SUMMARY:-}" ] && printf '## Schema %s: %s\n\n%s\n' "$MODE" "$1" "$2" >> "$GITHUB_STEP_SUMMARY"; return 0; }
  case "$OUTCOME" in
    ok)
      echo "::notice title=Schema $MODE::OK: apply=$APPLY_STATUS plan=$PLAN_STATUS (every command exited 0)."
      summary OK "apply status: $APPLY_STATUS, plan status: $PLAN_STATUS"
      return 0;;
    skipped)
      echo "::warning title=Schema $MODE SKIPPED::$REASON. Nothing was applied or checked; this is NOT a successful $MODE."
      summary "SKIPPED (not a success)" "$REASON. Nothing was applied or checked."
      return 0;;
    *)
      echo "::error title=Schema $MODE FAILED::${REASON:-unknown problem} (apply=$APPLY_STATUS, plan=$PLAN_STATUS). Do not treat the schema as ready.%0A$tail_log"
      summary FAILED "${REASON:-unknown problem}"
      return 1;;
  esac
}

case "${1:-}" in
  run) shift; run "$@";;
  verdict) verdict; exit $?;;
  *) echo "usage: $0 run apply|plan | verdict" >&2; exit 2;;
esac
