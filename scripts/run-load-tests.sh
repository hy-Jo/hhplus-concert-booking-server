#!/bin/bash
# 부하 테스트 실행 스크립트
# Usage:
#   ./scripts/run-load-tests.sh small    # Small 스펙 (port 3001)
#   ./scripts/run-load-tests.sh medium   # Medium 스펙 (port 3002) [기본값]
#   ./scripts/run-load-tests.sh large    # Large 스펙 (port 3003)

SPEC=${1:-medium}

case $SPEC in
  small)  PORT=3001 ;;
  medium) PORT=3002 ;;
  large)  PORT=3003 ;;
  *)
    echo "Usage: $0 [small|medium|large]"
    exit 1
    ;;
esac

BASE_URL="http://localhost:${PORT}"

echo ""
echo "================================================"
echo " Load Test: ${SPEC} spec  (${BASE_URL})"
echo "================================================"
echo ""

mkdir -p load-tests/results

run_test() {
  local script=$1
  local name=$2
  echo ">>> [${name}] 시작..."
  k6 run -e BASE_URL="${BASE_URL}" -e SPEC="${SPEC}" "${script}"
  if [ $? -eq 0 ]; then
    echo ">>> [${name}] 완료 ✅"
  else
    echo ">>> [${name}] 완료 (threshold 실패 포함) ⚠️"
  fi
  echo ""
}

run_test "load-tests/01-queue-spike-test.js"        "Scenario 1: Queue Spike"
run_test "load-tests/02-reservation-stress-test.js" "Scenario 2: Reservation Stress"
run_test "load-tests/03-payment-load-test.js"       "Scenario 3: Payment Load"
run_test "load-tests/04-concert-endurance-test.js"  "Scenario 4: Concert Endurance"

echo "================================================"
echo " 결과 파일 생성 위치: load-tests/results/"
ls -la load-tests/results/*${SPEC}*.json 2>/dev/null
echo ""
echo " 분석 명령어:"
for f in load-tests/results/*${SPEC}*.json; do
  [ -f "$f" ] && echo "   python scripts/analyze-k6-results.py $f"
done
echo "================================================"
