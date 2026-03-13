#!/bin/bash
# 사용법: ./capture.sh <disable|enable> <1|2|3>
# 실행 완료 후 transcript를 찾아서 메트릭 추출

set -e

CONDITION="$1"
RUN="$2"

if [[ -z "$CONDITION" || -z "$RUN" ]]; then
  echo "사용법: ./capture.sh <disable|enable> <1|2|3>"
  exit 1
fi

BASE=~/omc-verification
WORKDIR="$BASE/${CONDITION}-omc/run${RUN}"

if [[ ! -f "$WORKDIR/.start_ts" ]]; then
  echo "오류: $WORKDIR 에서 실행 기록이 없습니다."
  exit 1
fi

START_TS=$(cat "$WORKDIR/.start_ts")
END_TS=$(cat "$WORKDIR/.end_ts" 2>/dev/null || date +%s)
DURATION=$((END_TS - START_TS))

# transcript 디렉토리 찾기
ESCAPED_PATH=$(echo "$WORKDIR" | sed "s|$HOME/||" | sed 's|/|-|g')
TRANSCRIPT_DIR="$HOME/.claude/projects/-Users-yimtaejong-${ESCAPED_PATH}"

echo "transcript 디렉토리: $TRANSCRIPT_DIR"

if [[ ! -d "$TRANSCRIPT_DIR" ]]; then
  echo "경고: transcript 디렉토리를 찾을 수 없습니다."
  TRANSCRIPT_DIR=$(ls -td ~/.claude/projects/*omc-verification* 2>/dev/null | head -1)
  if [[ -z "$TRANSCRIPT_DIR" ]]; then
    echo "오류: transcript를 찾을 수 없습니다."
    exit 1
  fi
  echo "fallback 경로: $TRANSCRIPT_DIR"
fi

# 시간 범위 내 모든 JSONL 파일 수집 (start_ts 이후 수정된 것)
TRANSCRIPTS=()
for f in "$TRANSCRIPT_DIR"/*.jsonl; do
  if [[ -f "$f" ]]; then
    # 파일 수정 시간이 start_ts 이후인지 확인
    FILE_MTIME=$(stat -f %m "$f" 2>/dev/null || stat -c %Y "$f" 2>/dev/null)
    if [[ "$FILE_MTIME" -ge "$START_TS" ]]; then
      TRANSCRIPTS+=("$f")
    fi
  fi
done

if [[ ${#TRANSCRIPTS[@]} -eq 0 ]]; then
  echo "오류: 시간 범위 내 transcript 파일이 없습니다."
  exit 1
fi

echo "발견된 transcript 파일 (${#TRANSCRIPTS[@]}개):"
for f in "${TRANSCRIPTS[@]}"; do
  echo "  $(basename "$f") ($(wc -l < "$f" | tr -d ' ')줄)"
done

# 쉼표 구분으로 모든 transcript 경로 전달
TRANSCRIPT_LIST=$(IFS=,; echo "${TRANSCRIPTS[*]}")

# 메트릭 추출
python3 "$BASE/extract_metrics.py" "$TRANSCRIPT_LIST" "$WORKDIR" "$DURATION" "$CONDITION" "$RUN"

echo ""
echo "결과 저장됨: $WORKDIR/metrics.json"
cat "$WORKDIR/metrics.json" | python3 -m json.tool
