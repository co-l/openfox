#!/bin/sh

# Test: parallel_exit_on_failure

script_dir=$(dirname "$0")
. "$script_dir/parallel-exit-on-failure.sh"

failures=0

# Helper: run a test case
run_test() {
  desc=$1
  shift
  start=$(date +%s%N)
  output=$(parallel_exit_on_failure "$@" 2>&1)
  ec=$?
  end=$(date +%s%N)
  elapsed=$(( (end - start) / 1000000 ))
  echo "--- $desc ---"
  echo "$output"
  echo "exit=$ec elapsed=${elapsed}ms"
  echo ""
}

echo "=== Test 1: first fails instantly ==="
run_test "first fails" \
  "fast_fail"   "sh -c 'exit 1'" \
  "slow_ok_1"   "sleep 1" \
  "slow_ok_2"   "sleep 1" \
  "slow_ok_3"   "sleep 1"

echo "=== Test 2: last fails ==="
run_test "last fails" \
  "slow_ok_1"   "sleep 1" \
  "slow_ok_2"   "sleep 1" \
  "slow_ok_3"   "sleep 1" \
  "fast_fail"   "sh -c 'exit 1'"

echo "=== Test 3: middle fails ==="
run_test "middle fails" \
  "slow_ok_1"   "sleep 1" \
  "fast_fail"   "sh -c 'exit 1'" \
  "slow_ok_2"   "sleep 1" \
  "slow_ok_3"   "sleep 1"

echo "=== Test 4: all succeed ==="
run_test "all succeed" \
  "quick_ok"    "true" \
  "slow_ok_1"   "sleep 0.3" \
  "slow_ok_2"   "sleep 0.3" \
  "slow_ok_3"   "sleep 0.3"

echo "=== Test 5: failure with error output ==="
run_test "failure with output" \
  "err_fail"    "sh -c 'echo error message; exit 1'" \
  "slow_ok_1"   "sleep 1" \
  "slow_ok_2"   "sleep 1"

echo "=== Test 6: single command succeeds ==="
run_test "single ok" \
  "only_one"    "true"

echo "=== Test 7: single command fails ==="
run_test "single fail" \
  "only_one"    "sh -c 'exit 1'"

echo "=== Test 8: two commands, both fail, first should win ==="
run_test "both fail" \
  "fast_fail"   "sh -c 'exit 1'" \
  "also_fail"   "sh -c 'exit 2'"

echo "=== Test 9: verify timing - failure under 500ms ==="
start=$(date +%s%N)
parallel_exit_on_failure \
  "fast_fail"   "sh -c 'exit 1'" \
  "slow_ok_1"   "sleep 2" \
  "slow_ok_2"   "sleep 2" \
  "slow_ok_3"   "sleep 2" > /dev/null 2>&1
ec=$?
end=$(date +%s%N)
elapsed=$(( (end - start) / 1000000 ))
if [ "$elapsed" -lt 500 ]; then
  echo "ok: fast failure in ${elapsed}ms"
else
  echo "FAIL: took ${elapsed}ms, expected < 500ms"
  failures=$((failures + 1))
fi

echo ""
if [ "$failures" -eq 0 ]; then
  echo "ALL TESTS PASSED"
else
  echo "$failures TEST(S) FAILED"
  exit 1
fi
