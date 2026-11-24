package com.ticketing.it;

import static org.assertj.core.api.Assertions.assertThat;
import static org.junit.jupiter.api.Assumptions.assumeTrue;

import java.io.IOException;
import java.net.InetSocketAddress;
import java.net.ServerSocket;
import java.net.Socket;
import java.time.Duration;
import java.time.Instant;
import java.util.Map;
import java.util.UUID;
import java.util.concurrent.TimeUnit;

import org.junit.jupiter.api.AfterAll;
import org.junit.jupiter.api.BeforeAll;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.boot.test.web.server.LocalServerPort;
import org.springframework.data.redis.core.StringRedisTemplate;
import org.springframework.jdbc.core.simple.JdbcClient;
import org.springframework.test.annotation.DirtiesContext;
import org.springframework.test.context.DynamicPropertyRegistry;
import org.springframework.test.context.DynamicPropertySource;

import com.ticketing.it.AuthSessionIT.Browser;
import com.ticketing.it.AuthSessionIT.Resp;
import com.ticketing.queue.RedisKeys;

/**
 * Redis가 잠시 멈췄다가 <b>같은 데이터로</b> 돌아오는 경우(주 서버 → 대기 서버 자동 전환, 수십 초).
 * 운영 기본값 QUEUE_WAIT_TTL_SECONDS=30에서 Redis를 45초 동안 멈춘다(SIGSTOP → SIGCONT, 데이터 유지).
 * 그동안은 아무도 폴링할 수 없었으므로, 돌아온 뒤 대기자가 "폴링 끊김"으로 줄에서 빠지면 안 된다.
 * 대신 돌아온 뒤에도 폴링하지 않는 사람(정말 떠난 사람)은 유예가 끝나면 빠져야 한다.
 * 입장 권한·선점의 만료 시각은 장애 중에도 그대로 흐른다(여기서는 입장 600초라 아직 유효).
 * 시스템 Redis를 건드리지 않도록 전용 redis-server를 띄운다(없으면 건너뜀). 약 90초 걸린다.
 */
@SpringBootTest(webEnvironment = SpringBootTest.WebEnvironment.RANDOM_PORT, properties = {
        "spring.flyway.enabled=true", "app.queue.max-active=1", "app.queue.wait-ttl-seconds=30",
        "app.auth.session-cookie-secure=false", "app.rate-limit.general-per-minute=10000",
        "app.rate-limit.strict-per-minute=10000", "app.rate-limit.poll-per-minute=10000"})
@DirtiesContext
class RedisPauseIT {

    private static final Duration PAUSE = Duration.ofSeconds(45);
    private static int redisPort;
    private static Process redis;

    @LocalServerPort
    int port;
    @Autowired
    JdbcClient jdbc;
    @Autowired
    StringRedisTemplate template;

    @BeforeAll
    static void startRedis() throws Exception {
        assumeTrue(RedisDownITSupport.onPath("redis-server"), "redis-server가 없어 건너뜀");
        assumeTrue(RedisDownITSupport.onPath("kill"), "kill이 없어 건너뜀");
        try (ServerSocket s = new ServerSocket(0)) {
            redisPort = s.getLocalPort();
        }
        redis = RedisDownITSupport.start(redisPort);
    }

    @AfterAll
    static void stopRedis() throws Exception {
        if (redis != null) {
            signal("CONT");
            redis.destroy();
            redis.waitFor(10, TimeUnit.SECONDS);
        }
    }

    @DynamicPropertySource
    static void redisProps(DynamicPropertyRegistry r) {
        r.add("app.redis.host", () -> "127.0.0.1");
        r.add("app.redis.port", () -> redisPort);
        r.add("app.redis.password", () -> "");
        r.add("app.redis.database", () -> 0);
    }

    private static void signal(String sig) throws Exception {
        new ProcessBuilder("kill", "-" + sig, String.valueOf(redis.pid())).start().waitFor(5, TimeUnit.SECONDS);
    }

    @Test
    void Redis가_대기_TTL보다_오래_멈췄다가_같은_데이터로_돌아와도_대기자는_줄에_남고_돌아오지_않은_사람만_유예_뒤_빠진다()
            throws Exception {
        String a = "http://127.0.0.1:" + port;
        Instant now = Instant.now();
        long perf = ItData.performance(jdbc, now.minus(Duration.ofHours(1)), now.plus(Duration.ofDays(2)));
        String enterBody = "{\"performanceId\":" + perf + "}";

        Browser admitted = user(a);
        Resp first = admitted.post(a, "/api/queue/enter", enterBody, Map.of());
        assertThat(first.body().get("status")).isEqualTo("ADMITTED");
        String admittedToken = (String) first.body().get("queueToken");
        Browser stays = user(a);
        String staysToken = (String) stays.post(a, "/api/queue/enter", enterBody, Map.of()).body().get("queueToken");
        Browser gone = user(a);
        String goneToken = (String) gone.post(a, "/api/queue/enter", enterBody, Map.of()).body().get("queueToken");
        assertThat(status(stays, a, staysToken).body()).containsEntry("status", "WAITING").containsEntry("position", 0);
        assertThat(status(gone, a, goneToken).body()).containsEntry("status", "WAITING").containsEntry("position", 1);

        // ---- Redis 45초 정지(데이터 유지). 그동안 화면은 5초마다 다시 묻고 503을 받는다
        signal("STOP");
        long until = System.nanoTime() + PAUSE.toNanos();
        int unavailable = 0;
        while (System.nanoTime() < until) {
            if (status(stays, a, staysToken).status() == 503) {
                unavailable++;
            }
            Thread.sleep(5000);
        }
        signal("CONT");
        System.out.println("[측정] 정지 중 대기 상태 조회 503 횟수 = " + unavailable);
        assertThat(unavailable).isPositive();

        // ---- 돌아온 직후: 둘 다 아직 줄에 있다(마지막 폴링이 45초 전이어도)
        Resp back = waitForRedis(stays, a, staysToken);
        assertThat(back.status()).isEqualTo(200);
        assertThat(back.body()).containsEntry("status", "WAITING").containsEntry("position", 0);
        Long grace = template.getExpire(RedisKeys.queueGrace(perf), TimeUnit.MILLISECONDS);
        System.out.println("[측정] 복구 후 유예 남은 시간(ms) = " + grace);
        assertThat(grace).isBetween(1L, 30_000L);
        // 입장 권한(600초)은 장애 중에도 시간이 흘렀지만 아직 유효
        assertThat(status(admitted, a, admittedToken).body()).containsEntry("status", "ADMITTED");

        // ---- 'stays'는 계속 폴링하고, 'gone'은 돌아오지 않는다 → 유예(30초)가 끝나면 'gone'만 빠진다
        long graceEnd = System.nanoTime() + TimeUnit.SECONDS.toNanos(36);
        Resp last = null;
        while (System.nanoTime() < graceEnd) {
            last = status(stays, a, staysToken);
            assertThat(last.status()).isEqualTo(200);
            Thread.sleep(4000);
        }
        last = status(stays, a, staysToken);
        assertThat(last.body()).containsEntry("status", "WAITING").containsEntry("position", 0);
        Resp goneNow = status(gone, a, goneToken);
        assertThat(goneNow.status()).isEqualTo(401);
        assertThat(goneNow.error().get("code")).isEqualTo("QUEUE_TOKEN_INVALID");
    }

    private static Browser user(String a) throws Exception {
        Browser br = new Browser();
        br.signup(a, "pause-" + UUID.randomUUID() + "@example.com");
        return br;
    }

    private static Resp status(Browser br, String a, String token) throws Exception {
        return br.get(a, "/api/queue/status", Map.of("X-Queue-Token", token));
    }

    /** SIGCONT 뒤 앱의 연결이 다시 쓸 수 있게 될 때까지(보통 즉시) 최대 10초. */
    private static Resp waitForRedis(Browser br, String a, String token) throws Exception {
        long deadline = System.nanoTime() + TimeUnit.SECONDS.toNanos(10);
        Resp r;
        do {
            r = status(br, a, token);
            if (r.status() != 503) {
                return r;
            }
            Thread.sleep(200);
        } while (System.nanoTime() < deadline);
        return r;
    }

    /** RedisDownIT와 같은 전용 redis-server 띄우기. */
    static final class RedisDownITSupport {
        static boolean onPath(String exe) {
            try {
                return new ProcessBuilder("sh", "-c", "command -v " + exe).start().waitFor() == 0;
            } catch (IOException | InterruptedException e) {
                return false;
            }
        }

        static Process start(int port) throws Exception {
            Process p = new ProcessBuilder("redis-server", "--port", String.valueOf(port), "--bind", "127.0.0.1",
                    "--save", "", "--appendonly", "no", "--daemonize", "no")
                    .redirectErrorStream(true).redirectOutput(ProcessBuilder.Redirect.DISCARD).start();
            long deadline = System.nanoTime() + TimeUnit.SECONDS.toNanos(10);
            while (System.nanoTime() < deadline) {
                try (Socket s = new Socket()) {
                    s.connect(new InetSocketAddress("127.0.0.1", port), 200);
                    return p;
                } catch (IOException e) {
                    Thread.sleep(100);
                }
            }
            throw new IllegalStateException("테스트용 redis-server가 뜨지 않았습니다.");
        }
    }
}
