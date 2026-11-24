package com.ticketing.it;

import static org.assertj.core.api.Assertions.assertThat;
import static org.junit.jupiter.api.Assumptions.assumeTrue;

import java.io.IOException;
import java.net.InetSocketAddress;
import java.net.ServerSocket;
import java.net.Socket;
import java.time.Duration;
import java.time.Instant;
import java.util.List;
import java.util.Map;
import java.util.UUID;
import java.util.concurrent.TimeUnit;

import org.junit.jupiter.api.AfterAll;
import org.junit.jupiter.api.BeforeAll;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.boot.test.web.server.LocalServerPort;
import org.springframework.jdbc.core.simple.JdbcClient;
import org.springframework.test.annotation.DirtiesContext;
import org.springframework.test.context.DynamicPropertyRegistry;
import org.springframework.test.context.DynamicPropertySource;

import com.ticketing.it.AuthSessionIT.Browser;
import com.ticketing.it.AuthSessionIT.Resp;

/**
 * next 검증 6: Redis가 죽어 있는 동안
 * - 둘러보기(공연 목록·상세), 로그인·가입·내 정보, 내 예매 조회·취소, /readyz는 정상(200)
 * - 예매 진행(대기열 진입·상태·이탈, 좌석 조회, 선점, 확정)은 503 SERVICE_UNAVAILABLE + Retry-After, 오래 매달리지 않음
 * - Redis가 다시 뜨면 서버 재시작 없이 회복한다.
 * 시스템 Redis를 멈추지 않도록 이 테스트 전용 redis-server를 빈 포트에 띄웠다 끈다(redis-server가 없으면 건너뜀).
 */
@SpringBootTest(webEnvironment = SpringBootTest.WebEnvironment.RANDOM_PORT, properties = {
        "spring.flyway.enabled=true", "app.queue.max-active=100", "app.auth.session-cookie-secure=false",
        "app.rate-limit.general-per-minute=10000", "app.rate-limit.strict-per-minute=10000",
        "app.rate-limit.poll-per-minute=10000"})
@DirtiesContext
class RedisDownIT {

    private static int redisPort;
    private static Process redis;

    @LocalServerPort
    int port;
    @Autowired
    JdbcClient jdbc;

    @BeforeAll
    static void startRedis() throws Exception {
        assumeTrue(onPath("redis-server"), "redis-server가 없어 건너뜀");
        try (ServerSocket s = new ServerSocket(0)) {
            redisPort = s.getLocalPort();
        }
        startRedisProcess();
    }

    @AfterAll
    static void stopRedis() throws Exception {
        stopRedisProcess();
    }

    @DynamicPropertySource
    static void redisProps(DynamicPropertyRegistry r) {
        r.add("app.redis.host", () -> "127.0.0.1");
        r.add("app.redis.port", () -> redisPort);
        r.add("app.redis.password", () -> "");
        r.add("app.redis.database", () -> 0);
    }

    @Test
    void Redis가_죽어도_둘러보기_로그인_내예매는_되고_예매_진행만_503_다시_뜨면_재시작_없이_회복한다() throws Exception {
        String a = "http://127.0.0.1:" + port;
        Instant now = Instant.now();
        long perf = ItData.performance(jdbc, now.minus(Duration.ofHours(1)), now.plus(Duration.ofDays(2)));
        long show = jdbc.sql("SELECT show_id FROM performances WHERE id = :p").param("p", perf).query(Long.class).single();
        List<Long> seatIds = ItData.seatIds(jdbc, perf);

        // Redis가 살아 있을 때 예매 1건(나중에 취소해 본다)
        Browser alice = new Browser();
        String email = "down-" + UUID.randomUUID() + "@example.com";
        alice.signup(a, email);
        Resp enter = alice.post(a, "/api/queue/enter", "{\"performanceId\":" + perf + "}", Map.of());
        String t = (String) enter.body().get("queueToken");
        Resp hold = alice.post(a, "/api/performances/" + perf + "/holds", "{\"seatIds\":[" + seatIds.get(0) + "]}",
                Map.of("X-Queue-Token", t));
        String code = (String) alice.post(a, "/api/reservations", "{\"holdId\":\"" + hold.body().get("holdId") + "\"}",
                Map.of("X-Queue-Token", t, "Idempotency-Key", UUID.randomUUID().toString())).body().get("code");
        assertThat(code).isNotNull();

        stopRedisProcess();

        // ---- Redis 없이 되는 것
        assertThat(alice.get(a, "/api/shows", Map.of()).status()).isEqualTo(200);
        assertThat(alice.get(a, "/api/shows/" + show, Map.of()).status()).isEqualTo(200);
        assertThat(((Map<?, ?>) alice.get(a, "/api/auth/me", Map.of()).body().get("user")).get("email")).isEqualTo(email);
        assertThat(alice.get(a, "/api/me/reservations", Map.of()).status()).isEqualTo(200);
        Browser bob = new Browser();
        bob.get(a, "/api/auth/me", Map.of());
        assertThat(bob.post(a, "/api/auth/login", "{\"email\":\"" + email + "\",\"password\":\"password-123\"}", Map.of())
                .status()).isEqualTo(200);                                        // 로그인(세션 = MySQL)
        Browser stranger = new Browser();
        stranger.get(a, "/api/auth/me", Map.of());
        Resp unknown = stranger.post(a, "/api/auth/login",
                "{\"email\":\"nobody-" + UUID.randomUUID() + "@example.com\",\"password\":\"password-123\"}", Map.of());
        assertThat(unknown.status()).isEqualTo(401);                              // 없는 이메일도 503이 아니라 401
        Browser newcomer = new Browser();
        newcomer.signup(a, "down-new-" + UUID.randomUUID() + "@example.com");       // 가입(201)
        assertThat(bob.post(a, "/api/me/reservations/" + code + "/cancel", null, Map.of()).status()).isEqualTo(200);
        Resp ready = alice.get(a, "/readyz", Map.of());
        assertThat(ready.status()).isEqualTo(200);                                // 파드를 트래픽에서 빼지 않는다
        assertThat(ready.body()).containsEntry("status", "ready").containsEntry("redis", "down");

        // ---- 예매 진행은 503 + Retry-After, 빨리 실패
        Map<String, String> tok = Map.of("X-Queue-Token", "A".repeat(43));
        List<Resp> booking = List.of(
                bob.post(a, "/api/queue/enter", "{\"performanceId\":" + perf + "}", Map.of()),
                bob.get(a, "/api/queue/status", tok),
                bob.get(a, "/api/performances/" + perf + "/seats", tok),
                bob.post(a, "/api/performances/" + perf + "/holds", "{\"seatIds\":[" + seatIds.get(1) + "]}", tok),
                bob.post(a, "/api/reservations", "{\"holdId\":\"" + "h".repeat(22) + "\"}",
                        Map.of("X-Queue-Token", "A".repeat(43), "Idempotency-Key", UUID.randomUUID().toString())),
                bob.call(a, "DELETE", "/api/queue", null, tok));
        for (Resp r : booking) {
            assertThat(r.status()).as(r.raw().request().uri().getPath()).isEqualTo(503);
            assertThat(r.error().get("code")).isEqualTo("SERVICE_UNAVAILABLE");
            assertThat((String) r.error().get("message")).contains("잠시 후 다시 시도");
            assertThat(r.raw().headers().firstValue("Retry-After")).hasValue("5");
            assertThat(r.raw().body()).doesNotContain("Exception").doesNotContain("6379").doesNotContain("redis");
        }
        long started = System.nanoTime();
        bob.post(a, "/api/queue/enter", "{\"performanceId\":" + perf + "}", Map.of());
        long ms = (System.nanoTime() - started) / 1_000_000;
        System.out.println("[측정] Redis 중지 중 대기열 진입 응답 시간 = " + ms + "ms");
        assertThat(ms).isLessThan(2000);

        // ---- Redis가 다시 뜨면(빈 상태) 서버 재시작 없이 회복
        startRedisProcess();
        long deadline = System.nanoTime() + TimeUnit.SECONDS.toNanos(20);
        Resp back;
        do {
            back = bob.post(a, "/api/queue/enter", "{\"performanceId\":" + perf + "}", Map.of());
            if (back.status() == 200) {
                break;
            }
            Thread.sleep(250);
        } while (System.nanoTime() < deadline);
        assertThat(back.status()).isEqualTo(200);
        assertThat(back.body().get("status")).isEqualTo("ADMITTED");
        assertThat(alice.get(a, "/readyz", Map.of()).body()).containsEntry("redis", "up");
    }

    // ------------------------------------------------------------------ 전용 redis-server

    private static boolean onPath(String exe) {
        try {
            return new ProcessBuilder(exe, "--version").redirectErrorStream(true).start().waitFor(5, TimeUnit.SECONDS);
        } catch (IOException | InterruptedException e) {
            return false;
        }
    }

    private static void startRedisProcess() throws Exception {
        redis = new ProcessBuilder("redis-server", "--port", String.valueOf(redisPort), "--bind", "127.0.0.1",
                "--save", "", "--appendonly", "no", "--daemonize", "no")
                .redirectErrorStream(true).redirectOutput(ProcessBuilder.Redirect.DISCARD).start();
        long deadline = System.nanoTime() + TimeUnit.SECONDS.toNanos(10);
        while (System.nanoTime() < deadline) {
            try (Socket s = new Socket()) {
                s.connect(new InetSocketAddress("127.0.0.1", redisPort), 200);
                return;
            } catch (IOException e) {
                Thread.sleep(100);
            }
        }
        throw new IllegalStateException("테스트용 redis-server가 뜨지 않았습니다.");
    }

    private static void stopRedisProcess() throws Exception {
        if (redis != null && redis.isAlive()) {
            redis.destroy();
            redis.waitFor(10, TimeUnit.SECONDS);
        }
    }
}
