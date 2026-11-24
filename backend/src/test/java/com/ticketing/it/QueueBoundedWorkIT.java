package com.ticketing.it;

import static org.assertj.core.api.Assertions.assertThat;

import java.time.Duration;
import java.time.Instant;
import java.util.HexFormat;
import java.util.List;
import java.util.Set;
import java.util.concurrent.ThreadLocalRandom;

import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.data.redis.core.RedisCallback;
import org.springframework.data.redis.core.StringRedisTemplate;
import org.springframework.jdbc.core.simple.JdbcClient;

import com.ticketing.auth.AuthService;
import com.ticketing.queue.QueueService;
import com.ticketing.queue.QueueState;
import com.ticketing.queue.QueueStore;
import com.ticketing.queue.RedisKeys;

/**
 * 대기열 상태 전진 한 번의 일에 상한이 있다(next, 부하 테스트에서 발견: 끊긴 대기자 30만 명을 한 번에 지우면 Redis가 1.4초 멈춤).
 * - 끊긴 대기자는 한 번에 최대 약 1,000명(정리 500 + 승격 후보에서 걸러 낸 500)만 지우고 나머지는 다음 요청이 잇는다.
 * - 끊긴 대기자는 승격하지 않는다(입장 자리를 떠난 사람에게 주지 않음).
 * - 빈자리가 있어도 앞에 대기자가 남아 있으면 새로 온 사람은 바로 입장하지 않고 줄 뒤에 선다(새치기 없음).
 */
@SpringBootTest(webEnvironment = SpringBootTest.WebEnvironment.NONE,
        properties = {"spring.flyway.enabled=true", "app.queue.max-active=2", "app.queue.wait-ttl-seconds=30"})
class QueueBoundedWorkIT {

    @Autowired
    QueueService queue;
    @Autowired
    AuthService auth;
    @Autowired
    JdbcClient jdbc;
    @Autowired
    StringRedisTemplate redis;

    private long perf;

    @BeforeEach
    void setUp() {
        ItData.flushRedis(redis);
        Instant now = Instant.now();
        perf = ItData.performance(jdbc, now.minus(Duration.ofHours(1)), now.plus(Duration.ofDays(1)));
    }

    /** 실제 키 구조로 "1분 전에 폴링이 끊긴" 대기자 n명을 줄 앞에 넣는다. */
    private void staleWaiters(int n) {
        long old = System.currentTimeMillis() - 60_000;
        redis.executePipelined((RedisCallback<Object>) c -> {
            for (int i = 1; i <= n; i++) {
                byte[] b = new byte[32];
                ThreadLocalRandom.current().nextBytes(b);
                String tid = HexFormat.of().formatHex(b);
                c.zSetCommands().zAdd(RedisKeys.waiting(perf).getBytes(), i, tid.getBytes());
                c.zSetCommands().zAdd(RedisKeys.seen(perf).getBytes(), old, tid.getBytes());
                c.hashCommands().hSet(RedisKeys.token(tid).getBytes(), "perf".getBytes(), String.valueOf(perf).getBytes());
                c.hashCommands().hSet(RedisKeys.token(tid).getBytes(), "uid".getBytes(), String.valueOf(900_000_000L + i).getBytes());
            }
            c.stringCommands().set(RedisKeys.seq(perf).getBytes(), String.valueOf(n).getBytes());
            c.stringCommands().set(RedisKeys.queueTick(perf).getBytes(), String.valueOf(System.currentTimeMillis()).getBytes());
            return null;
        });
    }

    @Test
    void 끊긴_대기자가_많아도_한_번에_일부만_지우고_승격하지_않으며_새로_온_사람은_새치기하지_않는다() {
        staleWaiters(1200);
        long user = ItData.user(auth);

        // 진입 한 번: 상태 전진이 끊긴 대기자를 최대 약 1,000명만 지운다 → 아직 200명이 남아 있어 빈자리(2)가 있어도 대기
        QueueState entered = queue.enter(user, perf);
        Long left = redis.opsForZSet().zCard(RedisKeys.waiting(perf));
        System.out.println("[측정] 진입 한 번 뒤 남은 대기자(끊긴 사람 포함) = " + left);
        assertThat(entered.status()).isEqualTo(QueueStore.State.WAITING);
        assertThat(left).isBetween(150L, 701L);
        assertThat(redis.opsForZSet().zCard(RedisKeys.active(perf))).isZero(); // 끊긴 대기자는 승격되지 않았다

        // 내 폴링이 나머지를 지우고 나를 승격한다
        QueueState polled = queue.status(user, entered.queueToken());
        assertThat(polled.status()).isEqualTo(QueueStore.State.ADMITTED);
        Set<String> active = redis.opsForZSet().range(RedisKeys.active(perf), 0, -1);
        assertThat(active).hasSize(1);
        assertThat(redis.opsForZSet().zCard(RedisKeys.waiting(perf))).isZero();
        assertThat(List.copyOf(active).get(0)).isEqualTo(com.ticketing.queue.QueueTokens.tokenId(entered.queueToken()));
    }
}
