-- 대기열 스크립트 공통 부분(각 스크립트 앞에 붙여서 로드한다).
-- 시각은 앱 서버가 아니라 Redis의 TIME을 쓴다 → 복제본마다 시계가 조금 달라도 결과가 같다.
local function now_ms()
  local t = redis.call('TIME')
  return tonumber(t[1]) * 1000 + math.floor(tonumber(t[2]) / 1000)
end

-- 한 번의 상태 전진이 하는 일의 상한(next, 부하 테스트로 정함).
-- Redis는 스크립트를 통째로 실행하는 동안 다른 요청을 받지 못하므로, 한 번에 지우거나 승격하는 인원을 묶어 둔다.
-- 예전에는 폴링이 끊긴 대기자를 한 번에 전부 지웠다 → 대기자 30만 명이 한꺼번에 끊기면 한 번에 1.4초 동안 Redis가 멈췄다.
-- 남은 인원은 다음 요청(폴링·진입·이탈)이 이어서 처리한다. 대기자가 많을수록 폴링도 많으므로 금방 따라잡는다.
local STALE_BATCH = 500
local PROMOTE_BATCH = 500

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

-- 상태 전진: ① 만료된 입장자 정리 → ② 폴링이 끊긴 대기자 제거(오래 끊긴 순으로 최대 STALE_BATCH명, 유예 중이면 건너뜀)
--          → ③ 빈자리만큼 대기자를 들어온 순서대로 승격(최대 PROMOTE_BATCH명). 승격 후보 중 아직 지우지 못한 "끊긴 대기자"는
--            승격하지 않고 지운다(입장 자리를 떠난 사람에게 주지 않게).
-- 스케줄러 없이, 요청이 들어올 때마다 이 함수가 원자적으로 실행된다.
-- 입장 만료(①)는 장애 중에도 시간이 그대로 흐른다(입장 권한은 길고, 유예하면 다음 대기자가 그만큼 늦어진다).
-- 상한 때문에 ③ 뒤에도 빈자리와 대기자가 함께 남을 수 있다 → 진입(queue-enter.lua)은 대기자가 없을 때만 바로 입장시킨다.
local function advance(waiting, seen, active, now, max_active, admit_ms, wait_ttl_ms, grace)
  redis.call('ZREMRANGEBYSCORE', active, '-inf', now)
  local cutoff = now - wait_ttl_ms
  if not grace then
    local stale = redis.call('ZRANGEBYSCORE', seen, '-inf', cutoff, 'LIMIT', 0, STALE_BATCH)
    for _, m in ipairs(stale) do
      redis.call('ZREM', waiting, m)
      redis.call('ZREM', seen, m)
    end
  end
  local free = math.min(max_active - redis.call('ZCARD', active), PROMOTE_BATCH)
  local skipped = 0
  while free > 0 and skipped < STALE_BATCH do
    local nexts = redis.call('ZRANGE', waiting, 0, free - 1)
    if #nexts == 0 then
      break
    end
    for _, m in ipairs(nexts) do
      local last_seen = tonumber(redis.call('ZSCORE', seen, m) or now)
      redis.call('ZREM', waiting, m)
      redis.call('ZREM', seen, m)
      if grace or last_seen >= cutoff then
        redis.call('ZADD', active, now + admit_ms, m)
        free = free - 1
      else
        skipped = skipped + 1
      end
    end
  end
end
