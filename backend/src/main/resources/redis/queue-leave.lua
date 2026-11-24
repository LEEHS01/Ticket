-- 대기열 이탈 또는 예매 완료(입장 권한 반납). 토큰을 지우고 바로 상태를 전진시켜 다음 대기자를 승격한다.
-- KEYS: 1 waiting 2 seen 3 active 4 token 5 user(이 사용자의 tokenId, 내 토큰일 때만 지움) 6 tick 7 grace(장애 유예)
-- ARGV: 1 maxActive 2 admitMs 3 waitTtlMs 4 tokenId
local now = now_ms()
redis.call('ZREM', KEYS[1], ARGV[4])
redis.call('ZREM', KEYS[2], ARGV[4])
redis.call('ZREM', KEYS[3], ARGV[4])
redis.call('DEL', KEYS[4])
if redis.call('GET', KEYS[5]) == ARGV[4] then
  redis.call('DEL', KEYS[5])
end
local wait_ttl_ms = tonumber(ARGV[3])
advance(KEYS[1], KEYS[2], KEYS[3], now, tonumber(ARGV[1]), tonumber(ARGV[2]), wait_ttl_ms, in_grace(KEYS[6], KEYS[7], now, wait_ttl_ms))
return 1
