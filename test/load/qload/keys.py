"""백엔드 RedisKeys.java·RedisQueueStore.java와 같은 키 이름·인자 순서. 바뀌면 여기도 고친다."""
import hashlib
import secrets


def waiting(p): return f"queue:{p}:waiting"
def seen(p): return f"queue:{p}:seen"
def active(p): return f"queue:{p}:active"
def seq(p): return f"queue:{p}:seq"
def tick(p): return f"queue:{p}:tick"
def grace(p): return f"queue:{p}:grace"
def user_token(p, uid): return f"queue:{p}:user:{uid}"
def token(tid): return f"queue:token:{tid}"


def new_token():
    """QueueTokens.newToken(): SecureRandom 32바이트 → base64url 43자."""
    return secrets.token_urlsafe(32)


def token_id(tok):
    """QueueTokens.tokenId(): SHA-256(토큰 ASCII) 소문자 16진수 64자."""
    return hashlib.sha256(tok.encode("ascii")).hexdigest()


def token_ttl_ms(admit_ms, wait_ttl_ms):
    """RedisQueueStore.tokenTtlMs(): 입장 + 대기 TTL + 60초."""
    return admit_ms + wait_ttl_ms + 60_000


class Settings:
    def __init__(self, max_active=100, admit_ms=600_000, wait_ttl_ms=30_000):
        self.max_active = max_active
        self.admit_ms = admit_ms
        self.wait_ttl_ms = wait_ttl_ms

    @property
    def token_ttl_ms(self):
        return token_ttl_ms(self.admit_ms, self.wait_ttl_ms)


def poll_call(p, tid, uid, s):
    """RedisQueueStore.poll(): KEYS 7개, ARGV 5개."""
    keys = [waiting(p), seen(p), active(p), token(tid), user_token(p, uid), tick(p), grace(p)]
    argv = [s.max_active, s.admit_ms, s.wait_ttl_ms, tid, s.token_ttl_ms]
    return keys, argv


def peek_call(p, tid):
    return [waiting(p), active(p)], [tid]


def enter_call(p, tid, uid, s):
    keys = [waiting(p), seen(p), active(p), seq(p), token(tid), user_token(p, uid), tick(p), grace(p)]
    argv = [s.max_active, s.admit_ms, s.wait_ttl_ms, tid, p, s.token_ttl_ms, uid]
    return keys, argv


def leave_call(p, tid, uid, s):
    keys = [waiting(p), seen(p), active(p), token(tid), user_token(p, uid), tick(p), grace(p)]
    argv = [s.max_active, s.admit_ms, s.wait_ttl_ms, tid]
    return keys, argv
