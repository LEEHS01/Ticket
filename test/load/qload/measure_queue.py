#!/usr/bin/env python3
"""
대기열 Lua 스크립트 한 번의 실행 시간을 잰다(fill_queue.py로 채운 뒤). 백엔드의 실제 Lua 파일을 그대로 쓴다.

  python3 -I measure_queue.py --port 16390 --perf 900001 --scripts <backend>/src/main/resources/redis \
      [--repeat 21] [--wait-ttl-ms 3600000] [--stale 1000,10000] [--out result.json]

- 서버 시간: Redis SLOWLOG(임계값 0)에 기록된 명령 실행 시간(µs). 네트워크·클라이언트를 뺀 "Redis가 그 스크립트 하나에 묶인 시간"이다.
  Redis는 단일 스레드라 이 시간 동안 다른 모든 요청(다른 회차·요청 제한·선점 포함)이 기다린다.
- 클라이언트 왕복: 이 스크립트에서 보낸 뒤 응답까지(ms). 같은 PC 안의 루프백이다.
- 측정 항목(순서대로, 뒤로 갈수록 데이터를 바꾼다):
  peek(앞·가운데·맨 뒤) / poll(앞·가운데·맨 뒤) / enter(새 진입) / leave(가운데 대기자 이탈) /
  promote(입장자 1명 이탈 → 맨 앞 1명 승격) / promote_all(입장자 전원 만료 → max_active명 승격) /
  stale_S(폴링이 끊긴 대기자 S명을 정리하는 상태 전진 한 번) — S는 --stale(마지막에 "all"이면 남은 전원)
- 대기 TTL(--wait-ttl-ms)은 측정 도중 채운 대기자가 저절로 끊긴 것으로 처리되지 않도록 길게 둔다(기본 1시간).
"""
import argparse
import json
import os
import statistics
import sys
import time

sys.path.insert(0, os.path.dirname(__file__))
from resp import Redis  # noqa: E402
import keys as K  # noqa: E402


def load_scripts(r, d):
    common = open(os.path.join(d, "queue-common.lua"), encoding="utf-8").read()
    shas = {}
    for name in ("peek", "poll", "enter", "leave"):
        body = open(os.path.join(d, f"queue-{name}.lua"), encoding="utf-8").read()
        # LuaScripts.queue(): 공통 부분 + "\n" + 스크립트
        shas[name] = r.cmd("SCRIPT", "LOAD", common + "\n" + body)
    return shas


class Meter:
    def __init__(self, r):
        self.r = r
        r.cmd("CONFIG", "SET", "slowlog-log-slower-than", 0)
        r.cmd("CONFIG", "SET", "slowlog-max-len", 100000)

    def run(self, calls):
        """calls: [(sha, keys, argv)] → (서버 µs 목록, 클라이언트 ms 목록, 결과 목록)"""
        self.r.cmd("SLOWLOG", "RESET")
        client, results = [], []
        for sha, keys, argv in calls:
            t = time.perf_counter()
            results.append(self.r.cmd("EVALSHA", sha, len(keys), *keys, *argv))
            client.append((time.perf_counter() - t) * 1000)
        entries = self.r.cmd("SLOWLOG", "GET", len(calls) + 50)
        server = [int(e[2]) for e in reversed(entries) if e[3] and e[3][0].upper() == "EVALSHA"]
        return server, client, results


def summary(server, client):
    def pct(v, q):
        v = sorted(v)
        return v[min(len(v) - 1, int(round(q * (len(v) - 1))))]
    return {
        "n": len(server),
        "server_us_median": int(statistics.median(server)) if server else None,
        "server_us_p95": pct(server, 0.95) if server else None,
        "server_us_max": max(server) if server else None,
        "client_ms_median": round(statistics.median(client), 3) if client else None,
    }


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--host", default="127.0.0.1")
    ap.add_argument("--port", type=int, required=True)
    ap.add_argument("--db", type=int, default=0)
    ap.add_argument("--perf", type=int, required=True)
    ap.add_argument("--scripts", required=True)
    ap.add_argument("--repeat", type=int, default=21)
    ap.add_argument("--max-active", type=int, default=100)
    ap.add_argument("--admit-ms", type=int, default=600_000)
    ap.add_argument("--wait-ttl-ms", type=int, default=3_600_000)
    ap.add_argument("--stale", default="1000,10000")
    ap.add_argument("--out")
    a = ap.parse_args()

    r = Redis(a.host, a.port, a.db)
    s = K.Settings(a.max_active, a.admit_ms, a.wait_ttl_ms)
    p = a.perf
    sha = load_scripts(r, a.scripts)
    m = Meter(r)
    n0 = r.cmd("ZCARD", K.waiting(p))
    out = {"waiting": n0, "active": r.cmd("ZCARD", K.active(p)), "ops": {}}

    def uid_of(tid):
        return int(r.cmd("HGET", K.token(tid), "uid"))

    def member(rank):
        return r.cmd("ZRANGE", K.waiting(p), rank, rank)[0]

    picks = {"front": 0, "middle": n0 // 2, "back": n0 - 1}
    tids = {k: member(v) for k, v in picks.items()}
    uids = {k: uid_of(t) for k, t in tids.items()}

    def record(name, server, client, extra=None):
        out["ops"][name] = summary(server, client)
        if extra:
            out["ops"][name].update(extra)
        o = out["ops"][name]
        print(f"  {name:<14} 서버 µs 중앙 {o['server_us_median']:>8} / 95% {o['server_us_p95']:>8} / 최대 {o['server_us_max']:>8}"
              f"   왕복 ms 중앙 {o['client_ms_median']}" + (f"   {extra}" if extra else ""), flush=True)

    # 1) 순번 확인(상태를 바꾸지 않는 peek, 폴링 poll)
    for k in ("front", "middle", "back"):
        server, client, res = m.run([(sha["peek"], *K.peek_call(p, tids[k]))] * a.repeat)
        record(f"peek_{k}", server, client, {"position": res[0][1]})
    for k in ("front", "middle", "back"):
        server, client, res = m.run([(sha["poll"], *K.poll_call(p, tids[k], uids[k], s))] * a.repeat)
        record(f"poll_{k}", server, client, {"position": res[0][1]})

    # 2) 새 진입(맨 뒤에 붙는다)
    calls = []
    for i in range(a.repeat):
        tid = K.token_id(K.new_token())
        calls.append((sha["enter"], *K.enter_call(p, tid, 800_000_000 + i, s)))
    server, client, res = m.run(calls)
    record("enter", server, client, {"position_last": res[-1][1]})

    # 3) 이탈(가운데 대기자)
    calls = []
    for i in range(a.repeat):
        tid = member(n0 // 2 + i * 3)
        calls.append((sha["leave"], *K.leave_call(p, tid, uid_of(tid), s)))
    server, client, _ = m.run(calls)
    record("leave_middle", server, client)

    # 4) 승격: 입장자 1명 이탈 → 맨 앞 대기자 1명 승격(상태 전진)
    calls = []
    actives = r.cmd("ZRANGE", K.active(p), 0, a.repeat - 1)
    for tid in actives:
        calls.append((sha["leave"], *K.leave_call(p, tid, uid_of(tid), s)))
    server, client, _ = m.run(calls)
    record("promote_one", server, client)

    # 5) 입장자 전원 만료 → 한 번의 상태 전진이 max_active명을 승격
    srv, cli = [], []
    for i in range(min(5, a.repeat)):
        now = r.now_ms()
        act = r.cmd("ZRANGE", K.active(p), 0, -1)
        r.pipeline([["ZADD", K.active(p), now - 1000, t] for t in act])
        front = member(0)
        server, client, _ = m.run([(sha["poll"], *K.poll_call(p, front, uid_of(front), s))])
        srv += server
        cli += client
    record("promote_all", srv, cli, {"promoted_each": a.max_active})

    # 6) 폴링 끊긴 대기자 S명 정리(그 S명의 마지막 폴링 시각을 대기 TTL보다 옛날로 바꾼 뒤 상태 전진 한 번)
    for spec in a.stale.split(","):
        spec = spec.strip()
        n = r.cmd("ZCARD", K.waiting(p))
        size = n - 1 if spec == "all" else min(int(spec), n - 1)
        old = r.now_ms() - a.wait_ttl_ms - 60_000
        members = r.cmd("ZRANGE", K.waiting(p), 1, size)  # 맨 앞 1명은 남겨 폴링하는 사람으로 쓴다
        r.pipeline([["ZADD", K.seen(p)] + sum(([old, t] for t in members[i:i + 1000]), [])
                    for i in range(0, len(members), 1000)])
        front = member(0)
        before = r.cmd("ZCARD", K.waiting(p))
        server, client, _ = m.run([(sha["poll"], *K.poll_call(p, front, uid_of(front), s))])
        after = r.cmd("ZCARD", K.waiting(p))
        record(f"stale_{spec}", server, client, {"marked": size, "removed": before - after,
                                                  "waiting_after": after})

    mem = r.cmd("INFO", "memory")
    out["used_memory"] = int([l for l in mem.splitlines() if l.startswith("used_memory:")][0].split(":")[1])
    if a.out:
        with open(a.out, "w") as f:
            json.dump(out, f, ensure_ascii=False, indent=1)


if __name__ == "__main__":
    main()
