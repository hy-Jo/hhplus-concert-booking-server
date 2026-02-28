#!/usr/bin/env python3
"""
k6 결과 JSON 파일 분석 스크립트

Usage:
    python scripts/analyze-k6-results.py load-tests/results/01-queue-spike-medium.json
"""

import json
import sys
from pathlib import Path


def analyze_k6_result(json_file_path):
    """k6 결과 JSON 파일을 분석하여 핵심 메트릭을 출력합니다."""

    with open(json_file_path, 'r', encoding='utf-8') as f:
        data = json.load(f)

    metrics = data.get('metrics', {})

    print("=" * 60)
    print(f"k6 Load Test Result Analysis")
    print(f"File: {json_file_path}")
    print("=" * 60)
    print()

    # HTTP Metrics
    print("📊 HTTP Metrics")
    print("-" * 60)

    http_reqs = metrics.get('http_reqs', {}).get('values', {})
    http_req_duration = metrics.get('http_req_duration', {}).get('values', {})
    http_req_failed = metrics.get('http_req_failed', {}).get('values', {})

    if http_reqs:
        print(f"  Total Requests: {http_reqs.get('count', 0):,}")
        print(f"  Request Rate: {http_reqs.get('rate', 0):.2f} req/s")

    if http_req_duration:
        print(f"\n  Response Time:")
        print(f"    Average: {http_req_duration.get('avg', 0):.2f} ms")
        print(f"    Min: {http_req_duration.get('min', 0):.2f} ms")
        print(f"    Median: {http_req_duration.get('med', 0):.2f} ms")
        print(f"    Max: {http_req_duration.get('max', 0):.2f} ms")
        print(f"    P90: {http_req_duration.get('p(90)', 0):.2f} ms")
        print(f"    P95: {http_req_duration.get('p(95)', 0):.2f} ms ⭐")
        print(f"    P99: {http_req_duration.get('p(99)', 0):.2f} ms")

    if http_req_failed:
        error_rate = http_req_failed.get('rate', 0) * 100
        print(f"\n  Error Rate: {error_rate:.2f}%")

        if error_rate < 1:
            print(f"    ✅ PASS (< 1%)")
        elif error_rate < 5:
            print(f"    ⚠️  WARNING (< 5%)")
        else:
            print(f"    ❌ FAIL (>= 5%)")

    print()

    # Custom Metrics
    custom_metrics = {
        'token_issue_success': 'Token Issue Success',
        'token_issue_failed': 'Token Issue Failed',
        'reservation_success': 'Reservation Success',
        'reservation_conflict': 'Reservation Conflict',
        'reservation_failed': 'Reservation Failed',
        'payment_success': 'Payment Success',
        'payment_failed': 'Payment Failed',
        'cache_hit_count': 'Cache Hits',
        'cache_miss': 'Cache Misses',
    }

    custom_found = False
    for metric_key, metric_name in custom_metrics.items():
        if metric_key in metrics:
            if not custom_found:
                print("📈 Custom Metrics")
                print("-" * 60)
                custom_found = True

            values = metrics[metric_key].get('values', {})
            count = values.get('count', 0)
            print(f"  {metric_name}: {count:,}")

    if custom_found:
        print()

    # Thresholds
    print("🎯 Thresholds")
    print("-" * 60)

    threshold_results = []
    for metric_name, metric_data in metrics.items():
        thresholds = metric_data.get('thresholds', {})
        for threshold_name, threshold_result in thresholds.items():
            passed = threshold_result.get('ok', False)
            symbol = "✅" if passed else "❌"
            threshold_results.append({
                'passed': passed,
                'metric': metric_name,
                'threshold': threshold_name,
                'symbol': symbol
            })

    if threshold_results:
        # Sort: failed first, then by metric name
        threshold_results.sort(key=lambda x: (x['passed'], x['metric']))

        for result in threshold_results:
            print(f"  {result['symbol']} {result['metric']} {result['threshold']}")
    else:
        print("  (No thresholds defined)")

    print()

    # Summary
    print("📝 Summary")
    print("-" * 60)

    total_reqs = http_reqs.get('count', 0)
    error_rate = http_req_failed.get('rate', 0) * 100
    p95_duration = http_req_duration.get('p(95)', 0)

    passed_thresholds = sum(1 for t in threshold_results if t['passed'])
    total_thresholds = len(threshold_results)

    print(f"  Total Requests: {total_reqs:,}")
    print(f"  Error Rate: {error_rate:.2f}%")
    print(f"  P95 Response Time: {p95_duration:.2f} ms")
    print(f"  Thresholds Passed: {passed_thresholds}/{total_thresholds}")

    if error_rate < 1 and p95_duration < 500 and passed_thresholds == total_thresholds:
        print(f"\n  🎉 Overall: EXCELLENT")
    elif error_rate < 5 and p95_duration < 1000:
        print(f"\n  ✅ Overall: PASS")
    else:
        print(f"\n  ❌ Overall: FAIL")

    print()
    print("=" * 60)


if __name__ == '__main__':
    if len(sys.argv) < 2:
        print("Usage: python analyze-k6-results.py <json_file>")
        print("Example: python analyze-k6-results.py load-tests/results/01-queue-spike-medium.json")
        sys.exit(1)

    json_file = Path(sys.argv[1])

    if not json_file.exists():
        print(f"Error: File not found: {json_file}")
        sys.exit(1)

    if not json_file.suffix == '.json':
        print(f"Error: Not a JSON file: {json_file}")
        sys.exit(1)

    analyze_k6_result(json_file)
