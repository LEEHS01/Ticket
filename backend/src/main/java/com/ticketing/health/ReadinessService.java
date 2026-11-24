package com.ticketing.health;

import java.util.concurrent.atomic.AtomicReference;

import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.boot.availability.ApplicationAvailability;
import org.springframework.boot.availability.ReadinessState;
import org.springframework.data.redis.core.RedisCallback;
import org.springframework.data.redis.core.StringRedisTemplate;
import org.springframework.jdbc.core.simple.JdbcClient;
import org.springframework.stereotype.Service;

/**
 * /readyz 판단: 종료 중이 아니고 MySQL이 응답하면 준비 완료.
 * next: Redis는 판단에 넣지 않는다. Redis가 죽었다고 파드가 트래픽에서 빠지면 Redis 없이 되는
 * 둘러보기·로그인·내 예매까지 함께 죽기 때문이다. Redis 상태는 응답 본문의 "redis" 항목과 로그(바뀔 때만)로 알린다.
 * Actuator를 넣지 않고 Spring Boot 기본 ApplicationAvailability(종료 시작 시 REFUSING_TRAFFIC)를 쓴다.
 */
@Service
public class ReadinessService {

    private static final Logger log = LoggerFactory.getLogger(ReadinessService.class);

    public record Readiness(boolean ready, boolean redisUp) {
    }

    private final JdbcClient jdbc;
    private final StringRedisTemplate redis;
    private final ApplicationAvailability availability;
    private final AtomicReference<Boolean> lastRedis = new AtomicReference<>();

    public ReadinessService(JdbcClient jdbc, StringRedisTemplate redis, ApplicationAvailability availability) {
        this.jdbc = jdbc;
        this.redis = redis;
        this.availability = availability;
    }

    public Readiness check() {
        boolean accepting = availability.getReadinessState() == ReadinessState.ACCEPTING_TRAFFIC;
        return new Readiness(accepting && mysqlUp(), redisUp());
    }

    private boolean mysqlUp() {
        try {
            Integer one = jdbc.sql("SELECT 1").query(Integer.class).single();
            return one != null && one == 1;
        } catch (RuntimeException e) {
            log.warn("MySQL 연결 확인 실패: {}", e.getClass().getSimpleName());
            return false;
        }
    }

    private boolean redisUp() {
        boolean up;
        try {
            String pong = redis.execute((RedisCallback<String>) connection -> connection.ping());
            up = "PONG".equalsIgnoreCase(pong);
        } catch (RuntimeException e) {
            up = false;
        }
        Boolean previous = lastRedis.getAndSet(up);
        if (previous == null ? !up : previous != up) {
            if (up) {
                log.info("Redis 연결 확인: 정상");
            } else {
                log.warn("Redis 연결 확인 실패: 예매 진행(대기열·좌석·선점·확정)은 503, 둘러보기·로그인·내 예매는 정상 동작");
            }
        }
        return up;
    }
}
