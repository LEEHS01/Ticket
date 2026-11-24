"""아주 작은 Redis 클라이언트(RESP2). 외부 패키지 없이 파이프라인과 EVALSHA만 쓰기 위해 직접 만들었다."""
import socket


class RedisError(Exception):
    pass


class Redis:
    def __init__(self, host="127.0.0.1", port=6379, db=0):
        self.sock = socket.create_connection((host, port))
        self.sock.setsockopt(socket.IPPROTO_TCP, socket.TCP_NODELAY, 1)
        self.f = self.sock.makefile("rb")
        if db:
            self.cmd("SELECT", db)

    @staticmethod
    def _encode(args):
        out = [b"*%d\r\n" % len(args)]
        for a in args:
            b = a if isinstance(a, bytes) else str(a).encode()
            out.append(b"$%d\r\n%s\r\n" % (len(b), b))
        return b"".join(out)

    def _read(self):
        line = self.f.readline()
        if not line:
            raise RedisError("연결이 끊겼습니다")
        kind, rest = line[:1], line[1:-2]
        if kind == b"+":
            return rest.decode()
        if kind == b"-":
            return RedisError(rest.decode())
        if kind == b":":
            return int(rest)
        if kind == b"$":
            n = int(rest)
            if n < 0:
                return None
            data = self.f.read(n + 2)[:-2]
            return data.decode(errors="replace")
        if kind == b"*":
            n = int(rest)
            return None if n < 0 else [self._read() for _ in range(n)]
        raise RedisError("알 수 없는 응답: %r" % line)

    def cmd(self, *args):
        self.sock.sendall(self._encode(args))
        r = self._read()
        if isinstance(r, RedisError):
            raise r
        return r

    def pipeline(self, commands, chunk=5000):
        """명령 목록을 묶어서 보낸다. 오류가 하나라도 있으면 예외."""
        results = []
        for i in range(0, len(commands), chunk):
            part = commands[i:i + chunk]
            self.sock.sendall(b"".join(self._encode(c) for c in part))
            for _ in part:
                r = self._read()
                if isinstance(r, RedisError):
                    raise r
                results.append(r)
        return results

    def now_ms(self):
        s, us = self.cmd("TIME")
        return int(s) * 1000 + int(us) // 1000
