#!/usr/bin/env python3
"""
대기열 채우기: 한 회차의 대기열에 대기자 N명과 입장자 M명을 실제 코드와 같은 키 구조로 직접 넣는다
(진입 API를 거치지 않음). 형태 대조는 compare_shape.py.

  python3 -I fill_queue.py --port 16390 --perf 900001 --waiting 100000 --active 100 \
      [--wait-ttl-ms 3600000] [--probe 0:UID --probe 50000:UID ...] [--probe-out probes.json]

- 대기자: queue:{p}:waiting(점수 = 진입 순번 1..N), queue:{p}:seen(점수 = 지금), queue:token:{sha256}(perf, uid, TTL),
  queue:{p}:user:{uid}(tokenId, TTL), queue:{p}:seq = N
- 입장자: queue:{p}:active(점수 = 지금 + 입장 시간) + 토큰·사용자 키
- --probe 위치:uid → 그 순번(0부터)의 대기자를 실제 사용자 id로 만들고 토큰 원문을 --probe-out에 적는다(API 측정용)
- 가짜 사용자 id는 --uid-base(기본 900,000,000)부터. DB에는 없는 사용자다(Redis만 본다)
"""
import argparse
import json
import sys
import time

sys.path.insert(0, __import__("os").path.dirname(__file__))
from resp import Redis  # noqa: E402
import keys as K  # noqa: E402


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--host", default="127.0.0.1")
    ap.add_argument("--port", type=int, required=True)
    ap.add_argument("--db", type=int, default=0)
    ap.add_argument("--perf", type=int, required=True)
    ap.add_argument("--waiting", type=int, required=True)
    ap.add_argument("--active", type=int, default=100)
    ap.add_argument("--admit-ms", type=int, default=600_000)
    ap.add_argument("--wait-ttl-ms", type=int, default=30_000)
    ap.add_argument("--uid-base", type=int, default=900_000_000)
    ap.add_argument("--probe", action="append", default=[], help="위치:uid (위치는 0부터)")
    ap.add_argument("--probe-out")
    a = ap.parse_args()

    s = K.Settings(max_active=a.active, admit_ms=a.admit_ms, wait_ttl_ms=a.wait_ttl_ms)
    r = Redis(a.host, a.port, a.db)
    p = a.perf
    probes = {}
    for spec in a.probe:
        pos, uid = spec.split(":")
        probes[int(pos)] = int(uid)

    started = time.time()
    now = r.now_ms()
    ttl = s.token_ttl_ms
    cmds = []
    waiting_pairs, seen_pairs = [], []
    probe_out = []

    def flush_z():
        if waiting_pairs:
            cmds.append(["ZADD", K.waiting(p)] + waiting_pairs[:])
            cmds.append(["ZADD", K.seen(p)] + seen_pairs[:])
            waiting_pairs.clear()
            seen_pairs.clear()

    for i in range(a.waiting):
        tok = K.new_token()
        tid = K.token_id(tok)
        uid = probes.get(i, a.uid_base + i)
        cmds.append(["HSET", K.token(tid), "perf", p, "uid", uid])
        cmds.append(["PEXPIRE", K.token(tid), ttl])
        cmds.append(["SET", K.user_token(p, uid), tid, "PX", ttl])
        waiting_pairs += [i + 1, tid]
        seen_pairs += [now, tid]
        if i in probes:
            probe_out.append({"position": i, "uid": uid, "token": tok})
        if len(waiting_pairs) >= 2000:
            flush_z()
        if len(cmds) >= 20000:
            r.pipeline(cmds)
            cmds.clear()
    flush_z()
    for j in range(a.active):
        tok = K.new_token()
        tid = K.token_id(tok)
        uid = a.uid_base + a.waiting + j
        cmds.append(["HSET", K.token(tid), "perf", p, "uid", uid])
        cmds.append(["PEXPIRE", K.token(tid), ttl])
        cmds.append(["SET", K.user_token(p, uid), tid, "PX", ttl])
        cmds.append(["ZADD", K.active(p), now + s.admit_ms, tid])
    cmds.append(["SET", K.seq(p), a.waiting])
    cmds.append(["SET", K.tick(p), now])
    r.pipeline(cmds)

    if a.probe_out:
        with open(a.probe_out, "w") as f:
            json.dump(probe_out, f)
    print(json.dumps({"perf": p, "waiting": r.cmd("ZCARD", K.waiting(p)), "active": r.cmd("ZCARD", K.active(p)),
                      "seconds": round(time.time() - started, 1)}, ensure_ascii=False))


if __name__ == "__main__":
    main()
