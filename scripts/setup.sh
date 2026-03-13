#!/bin/bash
# OMC A/B 검증 환경 셋업

BASE=~/omc-verification

# 6개 작업 디렉토리 생성 (3라운드 × 2조건)
for i in 1 2 3; do
  mkdir -p "$BASE/disable-omc/run$i"
  mkdir -p "$BASE/enable-omc/run$i"
done

echo "디렉토리 생성 완료:"
find "$BASE" -type d | sort
