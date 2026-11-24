-- 대기열 스크립트 공통 부분(각 스크립트 앞에 붙여서 로드한다).
-- 시각은 앱 서버가 아니라 Redis의 TIME을 쓴다 → 복제본마다 시계가 조금 달라도 결과가 같다.
local function now_ms()
  local t = redis.call('TIME')
  return tonumber(t[1]) * 1000 + math.floor(tonumber(t[2]) / 1000)
end

-- 장애 유예(next): Redis가 멈췄다가 같은 데이터로 돌아오면(주 서버 → 대기 서버 전환 등) 그동안은 아무도 폴링할 수 없었다.
-- 이 회차의 대기열 스크립트가 마지막으로 돈 시각(tick)에서 대기 TTL의 절반보다 오래 지났으면 "멈춰 있었다"고 보고,
-- 지금부터 대기 TTL 동안(grace 키의 TTL)은 "폴링 끊김"으로 대기자를 빼지 않는다. 유예가 끝난 뒤에도 폴링하지 않은 사람만 빠진다.
-- 왜 절반인가: 정상 폴링 간격은 대기 TTL의 1/3 이하이므로, 공백이 TTL/2 이하인 장애로는 TTL을 넘겨 빠지는 사람이 생기지 않는다.
-- 대기자가 있으면 몇 초마다 폴링이 오므로 정상일 때 이 조건이 걸리지 않는다(대기자가 없으면 걸려도 영향이 없다).
-- 시각·키가 모두 Redis 안에 있어 서버가 여러 대여도 결과가 같다.
local function in_grace(tick, grace, now, wait_ttl_ms)
  local last = tonumber(redis.call('GET', tick) or '0')
  redis.call('SET', tick, now)
  if last > 0 and now - last > wait_ttl_ms / 2 then
    redis.call('SET', grace, '1', 'PX', wait_ttl_ms)
    return true
  end
  return redis.call('EXISTS', grace) == 1
end

-- 상태 전진: ① 만료된 입장자 정리 → ② 폴링이 끊긴 대기자 제거(유예 중이면 건너뜀) → ③ 빈자리만큼 대기자를 들어온 순서대로 승격.
-- 스케줄러 없이, 요청이 들어올 때마다 이 함수가 원자적으로 실행된다.
-- 입장 만료(①)는 장애 중에도 시간이 그대로 흐른다(입장 권한은 길고, 유예하면 다음 대기자가 그만큼 늦어진다).
local function advance(waiting, seen, active, now, max_active, admit_ms, wait_ttl_ms, grace)
  redis.call('ZREMRANGEBYSCORE', active, '-inf', now)
  if not grace then
    local stale = redis.call('ZRANGEBYSCORE', seen, '-inf', now - wait_ttl_ms)
    for _, m in ipairs(stale) do
      redis.call('ZREM', waiting, m)
      redis.call('ZREM', seen, m)
    end
  end
  local free = max_active - redis.call('ZCARD', active)
  if free > 0 then
    local nexts = redis.call('ZRANGE', waiting, 0, free - 1)
    for _, m in ipairs(nexts) do
      redis.call('ZADD', active, now + admit_ms, m)
      redis.call('ZREM', waiting, m)
      redis.call('ZREM', seen, m)
    end
  end
end
