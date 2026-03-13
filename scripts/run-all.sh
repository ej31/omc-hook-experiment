#!/bin/bash
# 6개 실행을 모두 병렬로 실행
# 사용법: ./run-all.sh

BASE=~/omc-verification

echo "======================================"
echo "  OMC A/B 테스트 - 6개 병렬 실행 시작"
echo "  모델: haiku | 프롬프트: 3단계"
echo "======================================"
echo ""

PIDS=()
LABELS=()

for CONDITION in disable enable; do
  for RUN in 1 2 3; do
    LABEL="${CONDITION}-omc/run${RUN}"
    LOG="$BASE/${CONDITION}-omc/run${RUN}/progress.log"

    echo "시작: $LABEL"
    bash "$BASE/run-single.sh" "$CONDITION" "$RUN" > "$LOG" 2>&1 &
    PIDS+=($!)
    LABELS+=("$LABEL")
  done
done

echo ""
echo "6개 프로세스 실행 중... PID: ${PIDS[*]}"
echo "진행 확인: tail -f ~/omc-verification/*/run*/progress.log"
echo ""

# 완료 대기
FAILED=0
for i in "${!PIDS[@]}"; do
  wait "${PIDS[$i]}"
  EXIT_CODE=$?
  if [[ $EXIT_CODE -eq 0 ]]; then
    echo "완료: ${LABELS[$i]}"
  else
    echo "실패: ${LABELS[$i]} (exit: $EXIT_CODE)"
    FAILED=$((FAILED + 1))
  fi
done

echo ""
if [[ $FAILED -eq 0 ]]; then
  echo "전체 완료! 메트릭 추출 중..."
else
  echo "경고: ${FAILED}개 실패. 성공한 것만 메트릭 추출."
fi

# 메트릭 추출
echo ""
for CONDITION in disable enable; do
  for RUN in 1 2 3; do
    WORKDIR="$BASE/${CONDITION}-omc/run${RUN}"
    if [[ -f "$WORKDIR/.end_ts" ]]; then
      echo "캡처: ${CONDITION}-omc/run${RUN}"
      bash "$BASE/capture.sh" "$CONDITION" "$RUN" 2>&1 | tail -1
    fi
  done
done

# 분석
echo ""
echo "======================================"
echo "  최종 분석"
echo "======================================"
python3 "$BASE/analyze.py"
