#!/bin/bash
# 단일 실행: 3개 프롬프트 순차 수행
# 사용법: ./run-single.sh <disable|enable> <1|2|3>

set -e

CONDITION="$1"
RUN="$2"
BASE=~/omc-verification
WORKDIR="$BASE/${CONDITION}-omc/run${RUN}"

PROMPT1=$(cat "$BASE/prompt1.txt")
PROMPT2=$(cat "$BASE/prompt2.txt")
PROMPT3=$(cat "$BASE/prompt3.txt")

# 이전 실행 결과 정리
# progress.log는 run-all.sh에서 리다이렉트로 사용하므로 삭제하지 않음
rm -f "$WORKDIR"/*.html "$WORKDIR"/*.css "$WORKDIR"/*.js "$WORKDIR"/out*.json "$WORKDIR"/err*.log "$WORKDIR"/.start_ts "$WORKDIR"/.end_ts "$WORKDIR"/.p*_ts "$WORKDIR"/metrics.json

cd "$WORKDIR"

START_TS=$(date +%s)
echo "$START_TS" > .start_ts

CLAUDE_FLAGS="-p --model sonnet --dangerously-skip-permissions --output-format json"

echo "[${CONDITION}-omc/run${RUN}] 시작: $(date '+%H:%M:%S')"

# 프롬프트 1: 파일 생성
echo "[${CONDITION}/run${RUN}] 프롬프트 1/3..."
P1_START=$(date +%s)
if [[ "$CONDITION" == "disable" ]]; then
  DISABLE_OMC=1 claude $CLAUDE_FLAGS "$PROMPT1" > out1.json 2>err1.log
else
  claude $CLAUDE_FLAGS "$PROMPT1" > out1.json 2>err1.log
fi
P1_END=$(date +%s)
echo "$P1_START" > .p1_start_ts
echo "$P1_END" > .p1_end_ts

# 프롬프트 2: 테스트 작성 + 실행 (--continue로 같은 세션)
echo "[${CONDITION}/run${RUN}] 프롬프트 2/3..."
P2_START=$(date +%s)
if [[ "$CONDITION" == "disable" ]]; then
  DISABLE_OMC=1 claude $CLAUDE_FLAGS --continue "$PROMPT2" > out2.json 2>err2.log
else
  claude $CLAUDE_FLAGS --continue "$PROMPT2" > out2.json 2>err2.log
fi
P2_END=$(date +%s)
echo "$P2_START" > .p2_start_ts
echo "$P2_END" > .p2_end_ts

# 프롬프트 3: 리뷰 + 수정 + 재테스트 (--continue로 같은 세션)
echo "[${CONDITION}/run${RUN}] 프롬프트 3/3..."
P3_START=$(date +%s)
if [[ "$CONDITION" == "disable" ]]; then
  DISABLE_OMC=1 claude $CLAUDE_FLAGS --continue "$PROMPT3" > out3.json 2>err3.log
else
  claude $CLAUDE_FLAGS --continue "$PROMPT3" > out3.json 2>err3.log
fi
P3_END=$(date +%s)
echo "$P3_START" > .p3_start_ts
echo "$P3_END" > .p3_end_ts

END_TS=$(date +%s)
echo "$END_TS" > .end_ts
DURATION=$((END_TS - START_TS))

echo "[${CONDITION}-omc/run${RUN}] 완료! ${DURATION}초"
