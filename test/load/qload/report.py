#!/usr/bin/env python3
"""run_scale.sh 결과 폴더의 scale-*.json을 표(마크다운)로 묶는다.  python3 -I report.py <폴더> [<비교 폴더>]"""
import glob
import json
import os
import sys

OPS = [
    ("peek_front", "순번 확인(peek), 맨 앞"), ("peek_middle", "순번 확인(peek), 가운데"), ("peek_back", "순번 확인(peek), 맨 뒤"),
    ("poll_front", "폴링(poll), 맨 앞"), ("poll_middle", "폴링(poll), 가운데"), ("poll_back", "폴링(poll), 맨 뒤"),
    ("enter", "새 진입"), ("leave_middle", "이탈(가운데)"), ("promote_one", "승격 1명(입장자 이탈)"),
    ("promote_all", "승격 100명(입장자 전원 만료)"),
    ("stale_1000", "끊긴 대기자 1,000명 정리"), ("stale_10000", "끊긴 대기자 10,000명 정리"), ("stale_all", "끊긴 대기자 전원 정리"),
]


def load(folder):
    out = {}
    for f in glob.glob(os.path.join(folder, "scale-*.json")):
        d = json.load(open(f))
        out[d["waiting"]] = d
    return dict(sorted(out.items()))


def main():
    data = load(sys.argv[1])
    scales = list(data)
    print("| 처리 (서버 실행 시간 µs: 중앙값 / 95% / 최대) | " + " | ".join(f"{n:,}명" for n in scales) + " |")
    print("|---|" + "---|" * len(scales))
    for key, label in OPS:
        cells = []
        for n in scales:
            o = data[n]["ops"].get(key)
            if not o:
                cells.append("-")
                continue
            cell = f"{o['server_us_median']:,} / {o['server_us_p95']:,} / {o['server_us_max']:,}"
            if key.startswith("stale"):
                cell += f" ({o['removed']:,}명 제거)"
            cells.append(cell)
        print(f"| {label} | " + " | ".join(cells) + " |")
    print()
    print("| 메모리 | " + " | ".join(f"{n:,}명" for n in scales) + " |")
    print("|---|" + "---|" * len(scales))
    print("| 채운 뒤 증가(MiB) | " + " | ".join(f"{(data[n]['memory_filled'] - data[n]['memory_base']) / 1048576:.1f}" for n in scales) + " |")
    print("| 대기자 1명당(바이트) | " + " | ".join(f"{(data[n]['memory_filled'] - data[n]['memory_base']) // (n + data[n]['active']):,}" for n in scales) + " |")
    print("| 키 수 | " + " | ".join(f"{data[n]['keys']:,}" for n in scales) + " |")


if __name__ == "__main__":
    main()
