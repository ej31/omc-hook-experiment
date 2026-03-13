#!/usr/bin/env python3
"""transcript에서 메트릭을 추출하여 metrics.json으로 저장"""

import json
import sys
import re
from datetime import datetime
from collections import defaultdict
from pathlib import Path

THRESHOLD_MS = 500  # 병렬 판정 기준

# Sonnet 4.6 가격 (per 1M tokens)
SONNET_INPUT_PRICE = 3.0
SONNET_CACHE_WRITE_PRICE = 3.75
SONNET_CACHE_READ_PRICE = 0.30
SONNET_OUTPUT_PRICE = 15.0


def parse_usage(usage):
    """usage 딕셔너리에서 모든 토큰 종류를 추출"""
    input_t = usage.get("input_tokens", 0)
    cache_create = usage.get("cache_creation_input_tokens", 0)
    cache_read = usage.get("cache_read_input_tokens", 0)
    output_t = usage.get("output_tokens", 0)
    # 총 input = 직접 input + cache write + cache read
    total_input = input_t + cache_create + cache_read
    total = total_input + output_t
    return {
        "input_tokens": input_t,
        "cache_creation_input_tokens": cache_create,
        "cache_read_input_tokens": cache_read,
        "output_tokens": output_t,
        "total_input_tokens": total_input,
        "total_tokens": total,
    }


def calc_cost(usage_parsed):
    """파싱된 usage에서 비용 계산"""
    cost_input = (usage_parsed["input_tokens"] / 1_000_000) * SONNET_INPUT_PRICE
    cost_cache_write = (usage_parsed["cache_creation_input_tokens"] / 1_000_000) * SONNET_CACHE_WRITE_PRICE
    cost_cache_read = (usage_parsed["cache_read_input_tokens"] / 1_000_000) * SONNET_CACHE_READ_PRICE
    cost_output = (usage_parsed["output_tokens"] / 1_000_000) * SONNET_OUTPUT_PRICE
    return {
        "cost_input": round(cost_input, 6),
        "cost_cache_write": round(cost_cache_write, 6),
        "cost_cache_read": round(cost_cache_read, 6),
        "cost_output": round(cost_output, 6),
        "cost_total": round(cost_input + cost_cache_write + cost_cache_read + cost_output, 4),
    }


def extract_per_prompt_metrics(workdir_path):
    """out1/out2/out3.json 에서 프롬프트별 토큰 추출 (캐시 토큰 포함)"""
    per_prompt = {}
    for i in range(1, 4):
        out_file = workdir_path / f"out{i}.json"
        if not out_file.exists():
            per_prompt[f"p{i}"] = parse_usage({})
            per_prompt[f"p{i}"]["cost"] = calc_cost(per_prompt[f"p{i}"])
            continue

        agg = defaultdict(int)
        try:
            text = out_file.read_text().strip()
            for line in text.split("\n"):
                line = line.strip()
                if not line:
                    continue
                try:
                    obj = json.loads(line)
                    usage = obj.get("usage", {})
                    for key in ["input_tokens", "cache_creation_input_tokens",
                                "cache_read_input_tokens", "output_tokens"]:
                        agg[key] += usage.get(key, 0)
                except json.JSONDecodeError:
                    pass
        except Exception:
            pass

        parsed = parse_usage(dict(agg))
        parsed["cost"] = calc_cost(parsed)
        per_prompt[f"p{i}"] = parsed
    return per_prompt


def extract_per_prompt_duration(workdir_path):
    """프롬프트별 소요 시간 추출"""
    durations = {}
    for i in range(1, 4):
        start_f = workdir_path / f".p{i}_start_ts"
        end_f = workdir_path / f".p{i}_end_ts"
        if start_f.exists() and end_f.exists():
            try:
                s = int(start_f.read_text().strip())
                e = int(end_f.read_text().strip())
                durations[f"p{i}_duration_sec"] = e - s
            except ValueError:
                durations[f"p{i}_duration_sec"] = 0
        else:
            durations[f"p{i}_duration_sec"] = 0
    return durations


def extract_test_results(workdir_path):
    """out3.json (또는 out2.json) 에서 테스트 pass/fail 카운트 파싱"""
    test_info = {"test_pass_count": 0, "test_fail_count": 0, "test_total": 0, "test_passed": False}

    for fname in ["out3.json", "out2.json"]:
        out_file = workdir_path / fname
        if not out_file.exists():
            continue

        try:
            text = out_file.read_text()
            pass_patterns = [
                r"(\d+)\s*(?:tests?\s+)?pass(?:ed)?",
                r"PASS(?:ED)?[:\s]+(\d+)",
                r"(\d+)/\d+\s+(?:tests?\s+)?pass",
                r"✓\s*(\d+)",
            ]
            fail_patterns = [
                r"(\d+)\s*(?:tests?\s+)?fail(?:ed|ure)?",
                r"FAIL(?:ED)?[:\s]+(\d+)",
                r"✗\s*(\d+)",
                r"(\d+)\s+error",
            ]

            pass_count = 0
            fail_count = 0

            for pattern in pass_patterns:
                matches = re.findall(pattern, text, re.IGNORECASE)
                if matches:
                    pass_count = max(pass_count, max(int(m) for m in matches))

            for pattern in fail_patterns:
                matches = re.findall(pattern, text, re.IGNORECASE)
                if matches:
                    fail_count = max(fail_count, max(int(m) for m in matches))

            if pass_count > 0 or fail_count > 0:
                test_info["test_pass_count"] = pass_count
                test_info["test_fail_count"] = fail_count
                test_info["test_total"] = pass_count + fail_count
                test_info["test_passed"] = fail_count == 0 and pass_count > 0
                break
        except Exception:
            pass

    return test_info


def count_code_lines(workdir_path):
    """생성된 코드 파일의 라인 수"""
    line_counts = {}
    total = 0
    for ext in ["*.html", "*.css", "*.js"]:
        for f in sorted(workdir_path.glob(ext)):
            if f.name.startswith("out") or f.name.endswith(".test.js"):
                continue
            try:
                lines = len(f.read_text().splitlines())
                line_counts[f.name] = lines
                total += lines
            except Exception:
                pass
    for f in sorted(workdir_path.glob("*.test.js")):
        try:
            lines = len(f.read_text().splitlines())
            line_counts[f.name] = lines
            total += lines
        except Exception:
            pass
    return line_counts, total


def extract_tokens_from_jsonl(filepath):
    """JSONL transcript 파일에서 토큰 사용량 합산 (캐시 포함)"""
    agg = defaultdict(int)
    try:
        with open(filepath) as f:
            for line in f:
                try:
                    obj = json.loads(line)
                    if obj.get("type") == "assistant":
                        usage = obj.get("message", {}).get("usage", {})
                        for key in ["input_tokens", "cache_creation_input_tokens",
                                    "cache_read_input_tokens", "output_tokens"]:
                            agg[key] += usage.get(key, 0)
                except (json.JSONDecodeError, AttributeError):
                    pass
    except Exception:
        pass
    return parse_usage(dict(agg))


def find_subagent_transcripts(transcript_path, start_ts):
    """sub-agent transcript 파일을 찾아 토큰 합산"""
    main_path = Path(transcript_path)
    transcript_dir = main_path.parent
    sub_agg = defaultdict(int)
    subagent_files = []

    # 같은 디렉토리의 다른 JSONL 파일
    for jsonl in transcript_dir.glob("*.jsonl"):
        if jsonl == main_path:
            continue
        try:
            mtime = jsonl.stat().st_mtime
            if mtime >= start_ts:
                parsed = extract_tokens_from_jsonl(str(jsonl))
                if parsed["total_tokens"] > 0:
                    for k, v in parsed.items():
                        sub_agg[k] += v
                    subagent_files.append(jsonl.name)
        except Exception:
            pass

    # 상위 projects 디렉토리에서 관련 sub-agent 프로젝트 탐색
    projects_dir = transcript_dir.parent
    if projects_dir.name == "projects":
        for proj in projects_dir.iterdir():
            if proj == transcript_dir or not proj.is_dir():
                continue
            for jsonl in proj.glob("*.jsonl"):
                try:
                    mtime = jsonl.stat().st_mtime
                    if mtime >= start_ts:
                        parsed = extract_tokens_from_jsonl(str(jsonl))
                        if parsed["total_tokens"] > 0:
                            for k, v in parsed.items():
                                sub_agg[k] += v
                            subagent_files.append(f"{proj.name}/{jsonl.name}")
                except Exception:
                    pass

    return dict(sub_agg), subagent_files


def extract(transcript_paths_str, workdir, duration_sec, condition, run_num):
    """transcript_paths_str: 쉼표 구분된 다중 transcript 경로 또는 단일 경로"""
    transcript_paths = [p.strip() for p in transcript_paths_str.split(",") if p.strip()]

    tool_events = []
    tool_failures = 0
    tool_counts = defaultdict(int)
    total_lines = 0
    system_reminders = 0
    stop_hooks = 0
    main_agg = defaultdict(int)
    agent_delegations = 0

    workdir_path = Path(workdir)
    start_ts_file = workdir_path / ".start_ts"
    start_ts = 0
    if start_ts_file.exists():
        try:
            start_ts = int(start_ts_file.read_text().strip())
        except ValueError:
            pass

    for transcript_path in transcript_paths:
        if not Path(transcript_path).exists():
            continue

        with open(transcript_path) as f:
            for i, line in enumerate(f):
                total_lines += 1
                try:
                    obj = json.loads(line)
                except json.JSONDecodeError:
                    continue
                t = obj.get("type", "")

                if t == "assistant":
                    msg = obj.get("message", {})
                    content = msg.get("content", [])
                    usage = msg.get("usage", {})

                    for key in ["input_tokens", "cache_creation_input_tokens",
                                "cache_read_input_tokens", "output_tokens"]:
                        main_agg[key] += usage.get(key, 0)

                    if isinstance(content, list):
                        for p in content:
                            if isinstance(p, dict) and p.get("type") == "tool_use":
                                ts_str = obj.get("timestamp", "")
                                tool_name = p.get("name", "?")
                                tool_counts[tool_name] += 1

                                if tool_name in ("Agent", "Task", "TaskCreate"):
                                    agent_delegations += 1

                                try:
                                    dt = datetime.fromisoformat(ts_str.replace("Z", "+00:00"))
                                    tool_events.append((dt, tool_name, i))
                                except Exception:
                                    tool_events.append((None, tool_name, i))

                if t == "progress":
                    data = obj.get("data", {})
                    if isinstance(data, dict):
                        hook_name = data.get("hookName", "")
                        if "PostToolUseFailure" in hook_name:
                            tool_failures += 1

                if t == "system" and obj.get("subtype") == "stop_hook_summary":
                    stop_hooks += 1

                if "system-reminder" in line:
                    system_reminders += line.count("system-reminder") // 2

    # 메인 토큰 파싱
    main_usage = parse_usage(dict(main_agg))
    main_cost = calc_cost(main_usage)

    # 병렬 그룹핑
    valid_events = [(dt, name, ln) for dt, name, ln in tool_events if dt is not None]
    valid_events.sort(key=lambda x: x[0])

    groups = []
    if valid_events:
        current = [valid_events[0]]
        for j in range(1, len(valid_events)):
            diff = (valid_events[j][0] - valid_events[j-1][0]).total_seconds() * 1000
            if diff <= THRESHOLD_MS:
                current.append(valid_events[j])
            else:
                groups.append(current)
                current = [valid_events[j]]
        if current:
            groups.append(current)

    parallel_turns = [g for g in groups if len(g) >= 2]
    sequential_turns = [g for g in groups if len(g) == 1]
    total_turns = len(groups)

    created_files = []
    for ext in ["*.html", "*.css", "*.js"]:
        created_files.extend([f.name for f in workdir_path.glob(ext)])

    per_prompt_tokens = extract_per_prompt_metrics(workdir_path)
    per_prompt_duration = extract_per_prompt_duration(workdir_path)
    test_results = extract_test_results(workdir_path)
    code_lines, total_code_lines = count_code_lines(workdir_path)

    # sub-agent (각 transcript 디렉토리에서 탐색, 메인 파일 제외)
    main_paths_set = set(Path(p) for p in transcript_paths)
    sub_agg_all = defaultdict(int)
    sub_files_all = []
    seen_dirs = set()
    for tp in transcript_paths:
        tp_path = Path(tp)
        tdir = tp_path.parent
        if tdir in seen_dirs:
            continue
        seen_dirs.add(tdir)
        for jsonl in tdir.glob("*.jsonl"):
            if jsonl in main_paths_set:
                continue
            try:
                mtime = jsonl.stat().st_mtime
                if mtime >= start_ts:
                    parsed = extract_tokens_from_jsonl(str(jsonl))
                    if parsed["total_tokens"] > 0:
                        for k, v in parsed.items():
                            sub_agg_all[k] += v
                        sub_files_all.append(jsonl.name)
            except Exception:
                pass
    sub_usage = parse_usage(dict(sub_agg_all)) if sub_agg_all else parse_usage({})
    sub_cost = calc_cost(sub_usage)
    sub_files = sub_files_all

    # 전체 합산
    combined = {}
    for key in ["input_tokens", "cache_creation_input_tokens",
                 "cache_read_input_tokens", "output_tokens",
                 "total_input_tokens", "total_tokens"]:
        combined[key] = main_usage.get(key, 0) + sub_usage.get(key, 0)
    combined_cost = calc_cost(combined)

    metrics = {
        "condition": condition,
        "run": int(run_num),
        "duration_sec": int(duration_sec),
        **per_prompt_duration,
        "total_tool_calls": len(tool_events),
        "total_turns": total_turns,
        "parallel_turns": len(parallel_turns),
        "sequential_turns": len(sequential_turns),
        "parallel_rate": round(len(parallel_turns) / max(total_turns, 1) * 100, 1),
        "tool_failures": tool_failures,
        "stop_hook_blocks": stop_hooks,
        "system_reminders": system_reminders,
        "agent_delegations": agent_delegations,
        # 메인 토큰 (캐시 분리)
        "main_tokens": main_usage,
        "main_cost": main_cost,
        # sub-agent 토큰
        "subagent_tokens": sub_usage,
        "subagent_cost": sub_cost,
        "subagent_transcript_files": sub_files,
        # 전체 합산
        "combined_tokens": combined,
        "combined_cost": combined_cost,
        # 프롬프트별 토큰 (캐시 분리)
        "per_prompt_tokens": per_prompt_tokens,
        # 코드 라인 수
        "code_lines": code_lines,
        "total_code_lines": total_code_lines,
        # 테스트 결과
        **test_results,
        "tool_breakdown": dict(tool_counts),
        "created_files": sorted(created_files),
        "transcript_lines": total_lines,
        "transcript_paths": transcript_paths,
        "transcript_count": len(transcript_paths),
        "parallel_details": [
            {"tools": [t[1] for t in g], "timestamp": g[0][0].isoformat()}
            for g in parallel_turns
        ]
    }

    output_path = workdir_path / "metrics.json"
    output_path.write_text(json.dumps(metrics, indent=2, ensure_ascii=False))
    return metrics


if __name__ == "__main__":
    if len(sys.argv) < 6:
        print("사용법: extract_metrics.py <transcript> <workdir> <duration> <condition> <run>")
        sys.exit(1)

    extract(sys.argv[1], sys.argv[2], sys.argv[3], sys.argv[4], sys.argv[5])
