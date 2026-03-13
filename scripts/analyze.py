#!/usr/bin/env python3
"""3라운드 × 2조건 결과를 비교 분석 (캐시 토큰 분리 버전)"""

import json
from pathlib import Path

BASE = Path.home() / "omc-verification"


def load_metrics():
    results = {"enable": [], "disable": []}
    for condition in ["enable", "disable"]:
        for run in [1, 2, 3]:
            path = BASE / f"{condition}-omc" / f"run{run}" / "metrics.json"
            if path.exists():
                results[condition].append(json.loads(path.read_text()))
    return results


def avg(values):
    return round(sum(values) / len(values), 1) if values else 0


def avg4(values):
    return round(sum(values) / len(values), 4) if values else 0


def get_combined(r, key):
    """combined_tokens에서 값 가져오기"""
    return r.get("combined_tokens", {}).get(key, 0)


def get_combined_cost(r):
    return r.get("combined_cost", {}).get("cost_total", 0)


def print_comparison(results):
    print("=" * 90)
    print("  OMC A/B 테스트 결과 비교 (Sonnet + 마크다운 에디터)")
    print("=" * 90)
    print()

    for condition in ["disable", "enable"]:
        label = "OMC OFF" if condition == "disable" else "OMC ON"
        runs = results[condition]
        if not runs:
            print(f"  [{label}] 데이터 없음")
            continue

        print(f"  [{label}] ({len(runs)}회 실행)")
        print(f"  {'Run':<6} {'시간':<8} {'도구':<6} {'병렬%':<7} {'위임':<5} {'캐시쓰기':<10} {'캐시읽기':<12} {'출력':<10} {'비용$':<8} {'코드줄':<7} {'테스트':<10}")
        print(f"  {'-'*6} {'-'*8} {'-'*6} {'-'*7} {'-'*5} {'-'*10} {'-'*12} {'-'*10} {'-'*8} {'-'*7} {'-'*10}")
        for r in runs:
            ct = r.get("combined_tokens", {})
            test_str = f"{r.get('test_pass_count',0)}P/{r.get('test_fail_count',0)}F"
            print(f"  run{r['run']:<3} {r['duration_sec']:<8} {r['total_tool_calls']:<6} {r['parallel_rate']:<7} {r.get('agent_delegations',0):<5} {ct.get('cache_creation_input_tokens',0):<10} {ct.get('cache_read_input_tokens',0):<12} {ct.get('output_tokens',0):<10} {get_combined_cost(r):<8} {r.get('total_code_lines',0):<7} {test_str:<10}")

        # 평균
        print(f"  {'평균':<6} {avg([r['duration_sec'] for r in runs]):<8} {avg([r['total_tool_calls'] for r in runs]):<6} {avg([r['parallel_rate'] for r in runs]):<7} {avg([r.get('agent_delegations',0) for r in runs]):<5} {avg([get_combined(r,'cache_creation_input_tokens') for r in runs]):<10.0f} {avg([get_combined(r,'cache_read_input_tokens') for r in runs]):<12.0f} {avg([get_combined(r,'output_tokens') for r in runs]):<10.0f} {avg4([get_combined_cost(r) for r in runs]):<8} {avg([r.get('total_code_lines',0) for r in runs]):<7}")
        print()

    e = results["enable"]
    d = results["disable"]

    if not (e and d):
        return

    # 프롬프트별 소요 시간
    print("=" * 90)
    print("  프롬프트별 소요 시간 (초)")
    print("=" * 90)
    print(f"\n  {'단계':<15} {'OMC OFF':<12} {'OMC ON':<12} {'차이':<12}")
    print(f"  {'-'*15} {'-'*12} {'-'*12} {'-'*12}")
    for p in ["p1", "p2", "p3"]:
        key = f"{p}_duration_sec"
        off_val = avg([r.get(key, 0) for r in d])
        on_val = avg([r.get(key, 0) for r in e])
        p_label = {"p1": "P1 구현", "p2": "P2 테스트", "p3": "P3 리뷰"}[p]
        print(f"  {p_label:<15} {off_val:<12} {on_val:<12} {on_val - off_val:+.1f}")

    # 프롬프트별 토큰 (캐시 분리)
    print()
    print("=" * 90)
    print("  프롬프트별 토큰 상세 (캐시 분리)")
    print("=" * 90)
    for p in ["p1", "p2", "p3"]:
        p_label = {"p1": "P1 구현", "p2": "P2 테스트", "p3": "P3 리뷰"}[p]
        print(f"\n  [{p_label}]")
        print(f"  {'항목':<20} {'OMC OFF':<15} {'OMC ON':<15} {'차이':<15} {'차이%':<8}")
        print(f"  {'-'*20} {'-'*15} {'-'*15} {'-'*15} {'-'*8}")
        for token_key, token_label in [
            ("cache_creation_input_tokens", "캐시 쓰기"),
            ("cache_read_input_tokens", "캐시 읽기"),
            ("output_tokens", "출력"),
            ("total_tokens", "합계"),
        ]:
            off_val = avg([r.get("per_prompt_tokens", {}).get(p, {}).get(token_key, 0) for r in d])
            on_val = avg([r.get("per_prompt_tokens", {}).get(p, {}).get(token_key, 0) for r in e])
            diff = on_val - off_val
            pct = (diff / off_val * 100) if off_val > 0 else 0
            print(f"  {token_label:<20} {off_val:<15.0f} {on_val:<15.0f} {diff:+.0f}{'':<8} {pct:+.1f}%")
        # 비용
        off_cost = avg4([r.get("per_prompt_tokens", {}).get(p, {}).get("cost", {}).get("cost_total", 0) for r in d])
        on_cost = avg4([r.get("per_prompt_tokens", {}).get(p, {}).get("cost", {}).get("cost_total", 0) for r in e])
        diff_cost = on_cost - off_cost
        pct_cost = (diff_cost / off_cost * 100) if off_cost > 0 else 0
        print(f"  {'비용 ($)':<20} {off_cost:<15.4f} {on_cost:<15.4f} {diff_cost:+.4f}{'':<4} {pct_cost:+.1f}%")

    # 종합 비교
    print()
    print("=" * 90)
    print("  종합 비교 (평균)")
    print("=" * 90)

    metrics_compare = [
        ("소요 시간 (초)", lambda r: r["duration_sec"], "lower"),
        ("도구 호출 수", lambda r: r["total_tool_calls"], "lower"),
        ("병렬율 (%)", lambda r: r["parallel_rate"], "higher"),
        ("에이전트 위임", lambda r: r.get("agent_delegations", 0), "info"),
        ("캐시 쓰기 토큰", lambda r: get_combined(r, "cache_creation_input_tokens"), "lower"),
        ("캐시 읽기 토큰", lambda r: get_combined(r, "cache_read_input_tokens"), "lower"),
        ("출력 토큰", lambda r: get_combined(r, "output_tokens"), "lower"),
        ("전체 토큰", lambda r: get_combined(r, "total_tokens"), "lower"),
        ("코드 라인 수", lambda r: r.get("total_code_lines", 0), "info"),
        ("비용 ($)", lambda r: get_combined_cost(r), "lower"),
        ("system-reminder", lambda r: r.get("system_reminders", 0), "info"),
    ]

    print(f"\n  {'지표':<22} {'OMC OFF':<15} {'OMC ON':<15} {'차이':<15} {'차이%':<10} {'판정':<10}")
    print(f"  {'-'*22} {'-'*15} {'-'*15} {'-'*15} {'-'*10} {'-'*10}")

    for label, fn, better in metrics_compare:
        off_val = avg([fn(r) for r in d]) if "비용" not in label else avg4([fn(r) for r in d])
        on_val = avg([fn(r) for r in e]) if "비용" not in label else avg4([fn(r) for r in e])
        diff = on_val - off_val
        pct = (diff / off_val * 100) if off_val > 0 else 0

        if "비용" in label:
            diff_str = f"{diff:+.4f}"
        else:
            diff_str = f"{diff:+.1f}"

        if better == "info":
            verdict = "-"
        elif better == "lower":
            verdict = "ON 유리" if diff < 0 else ("OFF 유리" if diff > 0 else "동일")
        else:
            verdict = "ON 유리" if diff > 0 else ("OFF 유리" if diff < 0 else "동일")

        print(f"  {label:<22} {off_val:<15} {on_val:<15} {diff_str:<15} {pct:+.1f}%{'':<4} {verdict:<10}")

    # 테스트 결과 비교
    print()
    print("=" * 90)
    print("  테스트 결과 비교")
    print("=" * 90)
    print(f"\n  {'Run':<10} {'OMC OFF':<25} {'OMC ON':<25}")
    print(f"  {'-'*10} {'-'*25} {'-'*25}")
    for run_idx in range(3):
        off_r = d[run_idx] if run_idx < len(d) else {}
        on_r = e[run_idx] if run_idx < len(e) else {}
        off_test = f"{off_r.get('test_pass_count',0)}P/{off_r.get('test_fail_count',0)}F (총{off_r.get('test_total',0)})"
        on_test = f"{on_r.get('test_pass_count',0)}P/{on_r.get('test_fail_count',0)}F (총{on_r.get('test_total',0)})"
        print(f"  run{run_idx+1:<7} {off_test:<25} {on_test:<25}")

    # OMC 오버헤드 요약
    on_cache_read = avg([get_combined(r, "cache_read_input_tokens") for r in e])
    off_cache_read = avg([get_combined(r, "cache_read_input_tokens") for r in d])
    on_total = avg([get_combined(r, "total_tokens") for r in e])
    off_total = avg([get_combined(r, "total_tokens") for r in d])
    on_cost = avg4([get_combined_cost(r) for r in e])
    off_cost = avg4([get_combined_cost(r) for r in d])

    print()
    print("=" * 90)
    print("  OMC 오버헤드 요약")
    print("=" * 90)
    if off_total > 0:
        print(f"  토큰 오버헤드: {((on_total - off_total) / off_total * 100):+.1f}%")
    if off_cost > 0:
        print(f"  비용 오버헤드: {((on_cost - off_cost) / off_cost * 100):+.1f}%")
    if off_cache_read > 0:
        print(f"  캐시 읽기 오버헤드: {((on_cache_read - off_cache_read) / off_cache_read * 100):+.1f}% (CLAUDE.md 주입분)")
    print(f"  동적 주입 횟수: ON={avg([r.get('system_reminders', 0) for r in e]):.0f} / OFF={avg([r.get('system_reminders', 0) for r in d]):.0f}")
    print(f"  에이전트 위임: ON={avg([r.get('agent_delegations', 0) for r in e]):.0f} / OFF={avg([r.get('agent_delegations', 0) for r in d]):.0f}")

    # JSON 저장
    summary = {"enable_omc": results["enable"], "disable_omc": results["disable"]}
    summary_path = BASE / "summary.json"
    summary_path.write_text(json.dumps(summary, indent=2, ensure_ascii=False))
    print(f"\n  상세 결과: {summary_path}")


if __name__ == "__main__":
    results = load_metrics()
    print_comparison(results)
