package com.ticketing.it;

import static org.assertj.core.api.Assertions.assertThat;

import java.time.Duration;
import java.time.Instant;
import java.util.HashMap;
import java.util.List;
import java.util.Map;
import java.util.Set;
import java.util.UUID;
import java.util.concurrent.TimeUnit;

import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.boot.test.web.server.LocalServerPort;
import org.springframework.data.redis.core.StringRedisTemplate;
import org.springframework.jdbc.core.simple.JdbcClient;

import com.ticketing.it.AuthSessionIT.Browser;
import com.ticketing.it.AuthSessionIT.Resp;

/**
 * next: Redis가 통째로 비었을 때(장애 전환으로 다른 클라우드의 빈 Redis로 넘어감, Redis 재시작)의 동작.
 * Redis는 "잃어도 되는 상태"만 담으므로, 비워도
 * (a) 중복 판매가 없고 (b) 로그인은 유지되며 (c) 대기자는 401로 다시 줄을 서고
 * (d) 선점 중이던 사용자는 409 HOLD_EXPIRED로 다시 좌석을 고르며 (e) 서버 재시작 없이 바로 정상이어야 한다.
 * "비우기"는 테스트용 Redis DB(REDIS_DATABASE)에 FLUSHDB를 보낸다. 앱은 그 DB 하나만 쓰므로 앱 입장에서는 FLUSHALL과 같다
 * (같은 Redis 서버의 다른 DB를 쓰는 개발 데이터는 지우지 않기 위해).
 */
@SpringBootTest(webEnvironment = SpringBootTest.WebEnvironment.RANDOM_PORT, properties = {
        "spring.flyway.enabled=true", "app.queue.max-active=1", "app.auth.session-cookie-secure=false",
        "app.rate-limit.general-per-minute=10000", "app.rate-limit.strict-per-minute=10000",
        "app.rate-limit.poll-per-minute=10000"})
class RedisLossIT {

    @LocalServerPort
    int port;
    @Autowired
    JdbcClient jdbc;
    @Autowired
    StringRedisTemplate redis;

    private String a;
    private long perf;
    private List<Long> seatIds;

    @BeforeEach
    void setUp() {
        ItData.flushRedis(redis);
        a = "http://127.0.0.1:" + port;
        Instant now = Instant.now();
        perf = ItData.performance(jdbc, now.minus(Duration.ofHours(1)), now.plus(Duration.ofDays(2)));
        seatIds = ItData.seatIds(jdbc, perf);
    }

    private static String email() {
        return "loss-" + UUID.randomUUID() + "@example.com";
    }

    private static Map<String, String> token(String t) {
        return Map.of("X-Queue-Token", t);
    }

    private static Map<String, String> confirmHeaders(String t) {
        return Map.of("X-Queue-Token", t, "Idempotency-Key", UUID.randomUUID().toString());
    }

    private Resp enter(Browser br) throws Exception {
        return br.post(a, "/api/queue/enter", "{\"performanceId\":" + perf + "}", Map.of());
    }

    /** 진입(입장) → 선점. 반환 {token, holdId} */
    private String[] enterAndHold(Browser br, Long... ids) throws Exception {
        Resp e = enter(br);
        assertThat(e.body().get("status")).isEqualTo("ADMITTED");
        String t = (String) e.body().get("queueToken");
        Resp h = br.post(a, "/api/performances/" + perf + "/holds", "{\"seatIds\":" + List.of(ids) + "}", token(t));
        assertThat(h.status()).isEqualTo(201);
        return new String[] {t, (String) h.body().get("holdId")};
    }

    private Resp confirm(Browser br, String[] th) throws Exception {
        return br.post(a, "/api/reservations", "{\"holdId\":\"" + th[1] + "\"}", confirmHeaders(th[0]));
    }

    private Browser user() throws Exception {
        Browser br = new Browser();
        br.signup(a, email());
        return br;
    }

    // ------------------------------------------------------------------

    @Test
    void 검증2_Redis를_통째로_비워도_로그인이_유지되고_CSRF도_그대로_통과한다() throws Exception {
        Browser br = new Browser();
        String email = email();
        br.signup(a, email);
        String csrf = br.csrf;

        ItData.flushRedis(redis);

        Resp me = br.get(a, "/api/auth/me", Map.of());
        assertThat(((Map<?, ?>) me.body().get("user")).get("email")).isEqualTo(email);
        assertThat(br.csrf).isEqualTo(csrf);
        assertThat(br.get(a, "/api/me/reservations", Map.of()).status()).isEqualTo(200);
        assertThat(enter(br).status()).isEqualTo(200); // CSRF 확인(세션) 통과 + 빈 Redis로 바로 정상 동작
    }

    @Test
    void 검증3_선점_중_Redis를_비우면_확정은_HOLD_EXPIRED_다른_사용자가_그_좌석을_사고_판매는_1건() throws Exception {
        Browser alice = user();
        String[] ah = enterAndHold(alice, seatIds.get(0));

        ItData.flushRedis(redis);

        Resp expired = confirm(alice, ah);
        assertThat(expired.status()).isEqualTo(409);
        assertThat(expired.error().get("code")).isEqualTo("HOLD_EXPIRED");
        // 좌석 화면으로 돌아가면 토큰도 사라졌으므로 다시 줄을 서게 된다
        Resp seats = alice.get(a, "/api/performances/" + perf + "/seats", token(ah[0]));
        assertThat(seats.status()).isEqualTo(401);
        assertThat(seats.error().get("code")).isEqualTo("QUEUE_TOKEN_INVALID");

        Browser bob = user();
        String[] bh = enterAndHold(bob, seatIds.get(0)); // 같은 좌석을 다른 사람이 잡는다
        Resp bought = confirm(bob, bh);
        assertThat(bought.status()).isEqualTo(201);
        assertThat(ItData.soldCount(jdbc, perf)).isEqualTo(1);

        // 앨리스가 다시 줄을 서서 같은 좌석을 고르면 이미 팔렸다
        String[] retry = new String[] {(String) enter(alice).body().get("queueToken"), null};
        Resp taken = alice.post(a, "/api/performances/" + perf + "/holds", "{\"seatIds\":[" + seatIds.get(0) + "]}",
                token(retry[0]));
        assertThat(taken.status()).isEqualTo(409);
        assertThat(taken.error().get("code")).isEqualTo("SEAT_TAKEN");
        assertThat(ItData.soldCount(jdbc, perf)).isEqualTo(1);
    }

    @Test
    void 검증4_팔린_좌석은_Redis를_비운_뒤에도_선점되지_않고_되살아난_옛_선점으로도_확정되지_않는다() throws Exception {
        Browser alice = user();
        assertThat(confirm(alice, enterAndHold(alice, seatIds.get(1))).status()).isEqualTo(201);

        ItData.flushRedis(redis);

        Browser bob = user();
        Resp e = enter(bob);
        Resp hold = bob.post(a, "/api/performances/" + perf + "/holds", "{\"seatIds\":[" + seatIds.get(1) + "]}",
                token((String) e.body().get("queueToken")));
        assertThat(hold.status()).isEqualTo(409);
        assertThat(hold.error().get("code")).isEqualTo("SEAT_TAKEN");
        bob.call(a, "DELETE", "/api/queue", null, token((String) e.body().get("queueToken")));

        // Redis가 "틀린" 경우: 캐럴의 선점이 사라진 사이 데이브가 같은 좌석을 샀는데, 캐럴의 옛 선점이 되살아남
        // (예: 복제가 늦은 Redis로 넘어갔다가 되돌아옴). 그래도 DB의 WHERE status='AVAILABLE'이 두 번째 판매를 막는다.
        Browser carol = user();
        String[] ch = enterAndHold(carol, seatIds.get(2));
        Map<String, byte[]> dump = dumpAll();
        ItData.flushRedis(redis);
        Browser dave = user();
        assertThat(confirm(dave, enterAndHold(dave, seatIds.get(2))).status()).isEqualTo(201);
        restoreAll(dump);

        Resp stale = confirm(carol, ch);
        assertThat(stale.status()).isEqualTo(409);
        assertThat(stale.error().get("code")).isEqualTo("SEAT_TAKEN");
        assertThat(ItData.soldCount(jdbc, perf)).isEqualTo(2); // 좌석 1(앨리스), 2(데이브)
        assertThat(jdbc.sql("SELECT COUNT(*) FROM reservation_seats WHERE seat_id = :s").param("s", seatIds.get(2))
                .query(Integer.class).single()).isEqualTo(1);
    }

    @Test
    void 검증5_대기_중_Redis를_비우면_상태_조회가_401_QUEUE_TOKEN_INVALID이고_다시_진입할_수_있다() throws Exception {
        Browser first = user();
        assertThat(enter(first).body().get("status")).isEqualTo("ADMITTED");
        Browser second = user();
        Resp w = enter(second);
        assertThat(w.body().get("status")).isEqualTo("WAITING"); // max-active 1
        String waiting = (String) w.body().get("queueToken");

        ItData.flushRedis(redis);

        Resp status = second.get(a, "/api/queue/status", token(waiting));
        assertThat(status.status()).isEqualTo(401);
        assertThat(status.error().get("code")).isEqualTo("QUEUE_TOKEN_INVALID");
        Resp again = enter(second);
        assertThat(again.status()).isEqualTo(200);
        assertThat(again.body().get("status")).isEqualTo("ADMITTED"); // 빈 대기열이라 바로 입장
    }

    @Test
    void 검증7_로그인_5회_실패로_잠기면_Redis를_비워도_유지되고_잠금_시간이_지나면_풀린다() throws Exception {
        String email = email();
        new Browser().signup(a, email);
        Browser attacker = new Browser();
        attacker.get(a, "/api/auth/me", Map.of());
        Resp last = null;
        for (int i = 0; i < 5; i++) {
            last = attacker.post(a, "/api/auth/login", "{\"email\":\"" + email + "\",\"password\":\"bad\"}", Map.of());
        }
        assertThat(last.status()).isEqualTo(429);
        assertThat(last.error().get("code")).isEqualTo("ACCOUNT_LOCKED");
        Map<String, Object> row = jdbc.sql("""
                        SELECT failed_login_count AS c, TIMESTAMPDIFF(SECOND, NOW(3), failed_login_until) AS s
                          FROM users WHERE email = :e""").param("e", email).query().singleRow();
        assertThat(((Number) row.get("c")).intValue()).isEqualTo(5);
        assertThat(((Number) row.get("s")).longValue()).isBetween(890L, 900L);

        ItData.flushRedis(redis);

        Browser legit = new Browser();
        legit.get(a, "/api/auth/me", Map.of());
        String good = "{\"email\":\"" + email + "\",\"password\":\"password-123\"}";
        Resp stillLocked = legit.post(a, "/api/auth/login", good, Map.of());
        assertThat(stillLocked.status()).isEqualTo(429);
        assertThat(stillLocked.raw().headers().firstValue("Retry-After")).isPresent();

        // 15분이 지난 것처럼(DB 시계 기준 열을 과거로) → 풀린다. 지난 기록은 0으로 보므로 다음 실패는 1부터 센다
        jdbc.sql("UPDATE users SET failed_login_until = NOW(3) - INTERVAL 1 SECOND WHERE email = :e")
                .param("e", email).update();
        assertThat(legit.post(a, "/api/auth/login", good, Map.of()).status()).isEqualTo(200);
        Resp again = attacker.post(a, "/api/auth/login", "{\"email\":\"" + email + "\",\"password\":\"bad\"}", Map.of());
        assertThat(again.status()).isEqualTo(401);
        assertThat(jdbc.sql("SELECT failed_login_count FROM users WHERE email = :e").param("e", email)
                .query(Integer.class).single()).isEqualTo(1);
    }

    // ------------------------------------------------------------------ Redis 내용 저장·복원(옛 선점 되살리기)

    private Map<String, byte[]> dumpAll() {
        Map<String, byte[]> out = new HashMap<>();
        Set<String> keys = redis.keys("*");
        for (String k : keys) {
            out.put(k, redis.dump(k));
        }
        return out;
    }

    private void restoreAll(Map<String, byte[]> dump) {
        dump.forEach((k, v) -> redis.restore(k, v, 10, TimeUnit.MINUTES, true));
    }
}
