#!/usr/bin/env python3
"""
채운 대기자의 키가 실제 진입 API가 만든 키와 같은 형태인지 대조한다.
  python3 -I compare_shape.py --port 16391 --perf P --real-token T --real-uid U --probes probes.json
비교: 토큰 해시(타입·필드·TTL 유무), 사용자 키(타입·값 = tokenId·TTL 유무), waiting·seen ZSET의 멤버 형식(64자 16진수)과 점수 형식.
"""
import argparse
import json
import os
import re
import sys

sys.path.insert(0, os.path.dirname(__file__))
from resp import Redis  # noqa: E402
import keys as K  # noqa: E402


def shape(r, p, tid, uid):
    tk, uk = K.token(tid), K.user_token(p, uid)
    h = r.cmd("HGETALL", tk) or []
    fields = dict(zip(h[0::2], h[1::2]))
    w = r.cmd("ZSCORE", K.waiting(p), tid)
    s = r.cmd("ZSCORE", K.seen(p), tid)
    return {
        "token.type": r.cmd("TYPE", tk),
        "token.fields": sorted(fields),
        "token.perf==perf": fields.get("perf") == str(p),
        "token.uid==uid": fields.get("uid") == str(uid),
        "token.ttl>0": r.cmd("PTTL", tk) > 0,
        "token.encoding": r.cmd("OBJECT", "ENCODING", tk),
        "user.type": r.cmd("TYPE", uk),
        "user.value==tokenId": r.cmd("GET", uk) == tid,
        "user.ttl>0": r.cmd("PTTL", uk) > 0,
        "tokenId.format": bool(re.fullmatch(r"[0-9a-f]{64}", tid)),
        "waiting.score.integer": w is not None and float(w).is_integer(),
        "seen.score.ms": s is not None and float(s) > 1.6e12,
    }


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--port", type=int, required=True)
    ap.add_argument("--perf", type=int, required=True)
    ap.add_argument("--real-token", required=True)
    ap.add_argument("--real-uid", type=int, required=True)
    ap.add_argument("--probes", required=True)
    a = ap.parse_args()
    r = Redis("127.0.0.1", a.port)
    real = shape(r, a.perf, K.token_id(a.real_token), a.real_uid)
    filled_probe = json.load(open(a.probes))[0]
    filled = shape(r, a.perf, K.token_id(filled_probe["token"]), filled_probe["uid"])
    print("| 항목 | 실제 진입 API | 채운 데이터 | 같음 |")
    print("|---|---|---|---|")
    same = True
    for k in real:
        ok = real[k] == filled[k]
        same &= ok
        print(f"| {k} | {real[k]} | {filled[k]} | {'O' if ok else 'X'} |")
    print("형태 일치" if same else "형태가 다름!")
    sys.exit(0 if same else 1)


if __name__ == "__main__":
    main()
