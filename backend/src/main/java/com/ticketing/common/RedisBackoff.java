package com.ticketing.common;

import java.time.Duration;
import java.util.concurrent.atomic.AtomicLong;

import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.stereotype.Component;

/**
 * Redis가 없어도 되는 곳(요청 제한, 없는 이메일의 로그인 실패 횟수)에서 쓰는 짧은 차단기.
 * 한 번 실패하면 {@link #PAUSE} 동안은 Redis를 부르지 않고 바로 "없는 것"으로 처리한다.
 * Redis 주소가 응답 없이 막힌 경우(패킷 유실) 요청마다 시간 초과를 기다리지 않게 하려는 것이다.
 * 서버 한 대 안의 상태이고 사용자 상태가 아니다(잃어도 되고, 서버마다 달라도 된다).
 * 상태가 바뀔 때만 로그를 남긴다(장애 동안 로그가 쏟아지지 않게).
 */
@Component
public class RedisBackoff {

    private static final Logger log = LoggerFactory.getLogger(RedisBackoff.class);
    static final Duration PAUSE = Duration.ofSeconds(3);

    /** 다시 시도해도 되는 시각(System.nanoTime 기준). 0 = 정상. */
    private final AtomicLong retryAt = new AtomicLong(0);

    /** 지금 Redis를 불러도 되는가. */
    public boolean tryNow() {
        long at = retryAt.get();
        return at == 0 || System.nanoTime() - at >= 0;
    }

    public void succeeded() {
        if (retryAt.getAndSet(0) != 0) {
            log.info("Redis 응답이 돌아왔습니다.");
        }
    }

    public void failed(RuntimeException e) {
        long previous = retryAt.getAndSet(System.nanoTime() + PAUSE.toNanos());
        if (previous == 0) {
            log.warn("Redis에 연결할 수 없습니다. 요청 제한과 없는 이메일의 로그인 실패 횟수는 잠시 건너뜁니다: {}",
                    e.getClass().getSimpleName());
        }
    }
}
