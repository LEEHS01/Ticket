package com.ticketing.it;

import static org.assertj.core.api.Assertions.assertThat;

import java.net.URI;
import java.net.http.HttpClient;
import java.net.http.HttpRequest;
import java.net.http.HttpResponse;
import java.nio.charset.StandardCharsets;
import java.time.Duration;
import java.time.Instant;
import java.util.Base64;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.UUID;

import com.fasterxml.jackson.core.type.TypeReference;
import com.fasterxml.jackson.databind.ObjectMapper;

import org.junit.jupiter.api.AfterAll;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.builder.SpringApplicationBuilder;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.boot.test.web.server.LocalServerPort;
import org.springframework.context.ConfigurableApplicationContext;
import org.springframework.data.redis.core.StringRedisTemplate;
import org.springframework.jdbc.core.simple.JdbcClient;

import com.ticketing.TicketingApplication;

/**
 * 로그인·세션 통합 테스트(실제 MySQL·Redis, 실제 HTTP).
 * 핵심: 애플리케이션 인스턴스를 **두 개** 띄우고(같은 DB), 한쪽에서 받은 세션 쿠키를 다른 쪽에 보내도 로그인이 유지된다
 * = 세션이 서버 메모리가 아니라 MySQL(SPRING_SESSION)에 있다는 증거. next: 세션은 Redis에 없다(Redis를 비워도 유지 → RedisLossIT). 쿠키는 브라우저처럼 직접 들고 다닌다(Browser).
 */
@SpringBootTest(webEnvironment = SpringBootTest.WebEnvironment.RANDOM_PORT, properties = {
        "spring.flyway.enabled=true", "app.queue.max-active=1", "app.auth.session-cookie-secure=false",
        "app.rate-limit.general-per-minute=10000", "app.rate-limit.strict-per-minute=10000",
        "app.rate-limit.poll-per-minute=10000"})
class AuthSessionIT {

    private static final ObjectMapper JSON = new ObjectMapper();
    private static ConfigurableApplicationContext second;

    @LocalServerPort
    int port;
    @Autowired
    JdbcClient jdbc;
    @Autowired
    StringRedisTemplate redis;

    private String a;  // 인스턴스 1
    private String b;  // 인스턴스 2
    private long perf;
    private List<Long> seatIds;

    @BeforeEach
    void setUp() {
        if (second == null) {
            // 명령행 인자로 넘긴다(builder.properties()는 기본값이라 application.yml에 덮어써진다)
            second = new SpringApplicationBuilder(TicketingApplication.class).run(
                    "--server.port=0", "--spring.flyway.enabled=false", "--app.queue.max-active=1",
                    "--app.auth.session-cookie-secure=false", "--app.rate-limit.general-per-minute=10000",
                    "--app.rate-limit.strict-per-minute=10000", "--app.rate-limit.poll-per-minute=10000");
        }
        ItData.flushRedis(redis);
        a = "http://127.0.0.1:" + port;
        b = "http://127.0.0.1:" + second.getEnvironment().getProperty("local.server.port");
        Instant now = Instant.now();
        perf = ItData.performance(jdbc, now.minus(Duration.ofHours(1)), now.plus(Duration.ofDays(2)));
        seatIds = ItData.seatIds(jdbc, perf);
    }

    @AfterAll
    static void stopSecond() {
        if (second != null) {
            second.close();
        }
    }

    int sessionRows(String sessionId) {
        return jdbc.sql("SELECT COUNT(*) FROM SPRING_SESSION WHERE SESSION_ID = :s").param("s", sessionId)
                .query(Integer.class).single();
    }

    int attributeRows(String sessionId) {
        return jdbc.sql("""
                        SELECT COUNT(*) FROM SPRING_SESSION_ATTRIBUTES a JOIN SPRING_SESSION s ON s.PRIMARY_ID = a.SESSION_PRIMARY_ID
                         WHERE s.SESSION_ID = :s""").param("s", sessionId).query(Integer.class).single();
    }

    // ------------------------------------------------------------------ 브라우저 흉내

    record Resp(int status, Map<String, Object> body, HttpResponse<String> raw) {
        @SuppressWarnings("unchecked")
        Map<String, Object> error() {
            return (Map<String, Object>) body.get("error");
        }
    }

    /** 쿠키(TKT_SESSION)와 CSRF 토큰을 들고 다니는 아주 작은 브라우저. 어느 인스턴스로 보낼지 매번 고를 수 있다. */
    static final class Browser {
        final HttpClient http = HttpClient.newHttpClient();
        String cookie;
        String csrf;

        Resp call(String base, String method, String path, String json, Map<String, String> headers) throws Exception {
            HttpRequest.Builder r = HttpRequest.newBuilder(URI.create(base + path))
                    .method(method, json == null ? HttpRequest.BodyPublishers.noBody()
                            : HttpRequest.BodyPublishers.ofString(json, StandardCharsets.UTF_8));
            if (json != null) {
                r.header("Content-Type", "application/json");
            }
            if (cookie != null) {
                r.header("Cookie", "TKT_SESSION=" + cookie);
            }
            if (csrf != null && !method.equals("GET")) {
                r.header("X-CSRF-Token", csrf);
            }
            headers.forEach(r::header);
            HttpResponse<String> res = http.send(r.build(), HttpResponse.BodyHandlers.ofString(StandardCharsets.UTF_8));
            for (String c : res.headers().allValues("Set-Cookie")) {
                if (c.startsWith("TKT_SESSION=")) {
                    String v = c.substring("TKT_SESSION=".length(), c.indexOf(';'));
                    cookie = v.isEmpty() || c.contains("Max-Age=0") ? null : v;
                }
            }
            Map<String, Object> body = res.body().isBlank() ? Map.of()
                    : JSON.readValue(res.body(), new TypeReference<LinkedHashMap<String, Object>>() { });
            if (body.get("csrfToken") instanceof String t) {
                csrf = t;
            }
            return new Resp(res.statusCode(), body, res);
        }

        Resp get(String base, String path, Map<String, String> h) throws Exception {
            return call(base, "GET", path, null, h);
        }

        Resp post(String base, String path, String json, Map<String, String> h) throws Exception {
            return call(base, "POST", path, json, h);
        }

        /** GET /auth/me 로 익명 세션 + CSRF 토큰 받기 → 가입(가입과 동시에 로그인). */
        long signup(String base, String email) throws Exception {
            get(base, "/api/auth/me", Map.of());
            Resp r = post(base, "/api/auth/signup",
                    "{\"email\":\"" + email + "\",\"password\":\"password-123\",\"name\":\"테스트\"}", Map.of());
            assertThat(r.status()).isEqualTo(201);
            return ((Number) ((Map<?, ?>) r.body().get("user")).get("id")).longValue();
        }

        String sessionId() {
            return new String(Base64.getDecoder().decode(cookie), StandardCharsets.UTF_8);
        }
    }

    private static String email() {
        return "it-" + UUID.randomUUID() + "@example.com";
    }

    private static Map<String, String> token(String t) {
        return Map.of("X-Queue-Token", t);
    }

    private static Map<String, String> confirmHeaders(String t) {
        return Map.of("X-Queue-Token", t, "Idempotency-Key", UUID.randomUUID().toString());
    }

    /** base 인스턴스로 진입 → 선점까지. 반환: {token, holdId} */
    private String[] enterAndHold(Browser br, String base, List<Long> ids) throws Exception {
        Resp enter = br.post(base, "/api/queue/enter", "{\"performanceId\":" + perf + "}", Map.of());
        assertThat(enter.status()).isEqualTo(200);
        assertThat(enter.body().get("status")).isEqualTo("ADMITTED");
        String t = (String) enter.body().get("queueToken");
        Resp hold = br.post(base, "/api/performances/" + perf + "/holds",
                "{\"seatIds\":" + ids + "}", token(t));
        assertThat(hold.status()).isEqualTo(201);
        return new String[] {t, (String) hold.body().get("holdId")};
    }

    // ------------------------------------------------------------------ 테스트

    @Test
    void 로그인한_세션_쿠키를_다른_인스턴스에_보내도_인증이_유지되고_로그아웃은_DB에서_세션을_지운다() throws Exception {
        Browser br = new Browser();
        String email = email();
        long id = br.signup(a, email);
        String sid = br.sessionId();
        assertThat(sessionRows(sid)).isEqualTo(1);                  // 세션은 MySQL에 있다
        assertThat(attributeRows(sid)).isEqualTo(2);                // uid, csrf
        String pk = jdbc.sql("SELECT PRIMARY_ID FROM SPRING_SESSION WHERE SESSION_ID = :s").param("s", sid)
                .query(String.class).single();
        assertThat(redis.keys("*session*")).isEmpty();              // Redis에는 없다
        Map<String, Object> row = jdbc.sql("SELECT MAX_INACTIVE_INTERVAL AS m, EXPIRY_TIME - LAST_ACCESS_TIME AS d "
                + "FROM SPRING_SESSION WHERE SESSION_ID = :s").param("s", sid).query().singleRow();
        assertThat(((Number) row.get("m")).intValue()).isEqualTo(1800);   // 유휴 만료 30분
        assertThat(((Number) row.get("d")).longValue()).isEqualTo(1_800_000L);

        Resp onB = br.get(b, "/api/auth/me", Map.of());            // 다른 인스턴스
        assertThat(((Map<?, ?>) onB.body().get("user")).get("id")).isEqualTo((int) id);
        assertThat(((Map<?, ?>) onB.body().get("user")).get("email")).isEqualTo(email);

        // 쿠키 속성
        String setCookie = onB.raw().headers().allValues("Set-Cookie").stream().findFirst().orElse("");
        assertThat(setCookie).isEmpty(); // 이미 세션이 있으면 다시 내려주지 않는다

        assertThat(br.post(b, "/api/auth/logout", null, Map.of()).status()).isEqualTo(204);
        assertThat(sessionRows(sid)).isZero();                       // 다른 인스턴스에서 로그아웃해도 DB에서 지워진다
        assertThat(jdbc.sql("SELECT COUNT(*) FROM SPRING_SESSION_ATTRIBUTES WHERE SESSION_PRIMARY_ID = :p")
                .param("p", pk).query(Integer.class).single()).isZero(); // 속성도 함께(ON DELETE CASCADE)
        assertThat(br.cookie).isNull();
    }

    @Test
    void 세션_테이블은_1분_안의_연속_요청에는_쓰지_않고_그보다_오래되면_마지막_접근_시각만_갱신한다() throws Exception {
        Browser br = new Browser();
        br.signup(a, email());
        String sid = br.sessionId();
        long first = lastAccess(sid);
        Thread.sleep(30);
        br.get(b, "/api/auth/me", Map.of());
        br.get(a, "/api/me/reservations", Map.of());
        assertThat(lastAccess(sid)).isEqualTo(first);                // 60초 안 → UPDATE 없음

        // 2분 전에 마지막으로 접근한 것처럼 되돌리면 다음 요청이 갱신한다
        jdbc.sql("UPDATE SPRING_SESSION SET LAST_ACCESS_TIME = LAST_ACCESS_TIME - 120000, EXPIRY_TIME = EXPIRY_TIME - 120000 "
                + "WHERE SESSION_ID = :s").param("s", sid).update();
        br.get(b, "/api/auth/me", Map.of());
        assertThat(lastAccess(sid)).isGreaterThanOrEqualTo(first);   // 지금 시각으로 다시 써짐
        assertThat(jdbc.sql("SELECT EXPIRY_TIME - LAST_ACCESS_TIME FROM SPRING_SESSION WHERE SESSION_ID = :s")
                .param("s", sid).query(Long.class).single()).isEqualTo(1_800_000L);
    }

    @Test
    void 로그인한_요청의_세션_확인은_DB_왕복_1번이다() throws Exception {
        Browser br = new Browser();
        br.signup(a, email());
        String[] th = enterAndHold(br, a, List.of(seatIds.get(0)));
        br.get(a, "/api/queue/status", token(th[0]));                 // 커넥션 데우기
        // 대기 상태 조회는 대기열이 Redis라 DB는 세션 조회만 쓴다 → 서버가 받은 문장 수 = 1
        long before = questions();
        Resp r = br.get(a, "/api/queue/status", token(th[0]));
        long after = questions();
        assertThat(r.status()).isEqualTo(200);
        long statements = after - before - 1; // SHOW STATUS 자신 1번 제외
        System.out.println("[측정] GET /api/queue/status 한 번의 DB 문장 수 = " + statements);
        assertThat(statements).isEqualTo(1);
    }

    long lastAccess(String sid) {
        return jdbc.sql("SELECT LAST_ACCESS_TIME FROM SPRING_SESSION WHERE SESSION_ID = :s").param("s", sid)
                .query(Long.class).single();
    }

    long questions() {
        return jdbc.sql("SHOW GLOBAL STATUS LIKE 'Questions'").query((rs, n) -> rs.getLong(2)).single();
    }

    @Test
    void 세션_쿠키는_HttpOnly_SameSite_Lax_Path이고_로그인_전후로_세션_ID가_바뀐다() throws Exception {
        Browser br = new Browser();
        Resp me = br.get(a, "/api/auth/me", Map.of());
        String cookieHeader = me.raw().headers().allValues("Set-Cookie").get(0);
        assertThat(cookieHeader).contains("HttpOnly").contains("SameSite=Lax").contains("Path=/")
                .doesNotContain("Secure"); // 테스트는 SESSION_COOKIE_SECURE=false
        String anonymousId = br.sessionId();
        String anonymousCsrf = br.csrf;

        br.post(a, "/api/auth/signup", "{\"email\":\"" + email() + "\",\"password\":\"password-123\",\"name\":\"a\"}",
                Map.of());
        String afterSignup = br.sessionId();
        assertThat(afterSignup).isNotEqualTo(anonymousId);
        assertThat(br.csrf).isNotEqualTo(anonymousCsrf);
        assertThat(sessionRows(anonymousId)).isZero();               // 옛 ID로는 더 찾을 수 없다
        assertThat(sessionRows(afterSignup)).isEqualTo(1);

        // 로그아웃 → 로그인 때도 다시 바뀐다
        String email = email();
        Browser other = new Browser();
        other.signup(a, email);
        other.post(a, "/api/auth/logout", null, Map.of());
        other.get(a, "/api/auth/me", Map.of());
        String beforeLogin = other.sessionId();
        Resp login = other.post(b, "/api/auth/login",
                "{\"email\":\"" + email.toUpperCase() + "\",\"password\":\"password-123\"}", Map.of());
        assertThat(login.status()).isEqualTo(200);
        assertThat(other.sessionId()).isNotEqualTo(beforeLogin);
    }

    @Test
    void CSRF_토큰_없이_상태_변경_요청을_보내면_403() throws Exception {
        Browser br = new Browser();
        br.signup(a, email());
        String saved = br.csrf;
        br.csrf = null;

        Resp enter = br.post(a, "/api/queue/enter", "{\"performanceId\":" + perf + "}", Map.of());
        assertThat(enter.status()).isEqualTo(403);
        assertThat(enter.error().get("code")).isEqualTo("CSRF_INVALID");
        br.csrf = "wrong-" + saved;
        assertThat(br.post(a, "/api/auth/logout", null, Map.of()).status()).isEqualTo(403);
        // 세션 없이 가입·로그인도 막힌다(먼저 GET /api/auth/me 필요)
        Browser fresh = new Browser();
        assertThat(fresh.post(a, "/api/auth/login", "{\"email\":\"x@example.com\",\"password\":\"password-123\"}",
                Map.of()).status()).isEqualTo(403);
        // 올바른 토큰이면 통과
        br.csrf = saved;
        assertThat(br.post(a, "/api/queue/enter", "{\"performanceId\":" + perf + "}", Map.of()).status()).isEqualTo(200);
    }

    @Test
    void 가입_로그인_한_인스턴스에서_대기열_선점_다른_인스턴스에서_확정_내예매_취소_로그아웃_후_401() throws Exception {
        Browser br = new Browser();
        br.signup(a, email());
        String[] th = enterAndHold(br, a, List.of(seatIds.get(0), seatIds.get(4)));

        // 확정은 인스턴스 2에서(세션은 MySQL, 대기열 토큰·선점은 Redis → 어느 인스턴스든 같다)
        String key = UUID.randomUUID().toString();
        Map<String, String> h = Map.of("X-Queue-Token", th[0], "Idempotency-Key", key);
        Resp created = br.post(b, "/api/reservations", "{\"holdId\":\"" + th[1] + "\"}", h);
        assertThat(created.status()).isEqualTo(201);
        assertThat(created.body().get("name")).isEqualTo("테스트");
        assertThat((List<?>) created.body().get("seats")).hasSize(2);
        String code = (String) created.body().get("code");
        // 같은 키 재전송(인스턴스 1) → 같은 응답
        Resp replay = br.post(a, "/api/reservations", "{\"holdId\":\"" + th[1] + "\"}", h);
        assertThat(replay.status()).isEqualTo(201);
        assertThat(replay.body()).isEqualTo(created.body());

        Resp mine = br.get(a, "/api/me/reservations", Map.of());
        assertThat((List<?>) mine.body().get("reservations")).hasSize(1);

        Resp cancel = br.post(b, "/api/me/reservations/" + code + "/cancel", null, Map.of());
        assertThat(cancel.status()).isEqualTo(200);
        assertThat(cancel.body().get("status")).isEqualTo("CANCELLED");
        assertThat(ItData.soldCount(jdbc, perf)).isZero();

        assertThat(br.post(a, "/api/auth/logout", null, Map.of()).status()).isEqualTo(204);
        br.get(a, "/api/auth/me", Map.of()); // 새 익명 세션 + CSRF
        Resp after = br.get(b, "/api/me/reservations", Map.of());
        assertThat(after.status()).isEqualTo(401);
        assertThat(after.error().get("code")).isEqualTo("UNAUTHENTICATED");
        assertThat(br.post(a, "/api/queue/enter", "{\"performanceId\":" + perf + "}", Map.of()).status())
                .isEqualTo(401);
    }

    @Test
    void A_계정의_예매를_B_계정이_조회_취소하면_404이고_A의_좌석은_그대로() throws Exception {
        Browser alice = new Browser();
        alice.signup(a, email());
        String[] th = enterAndHold(alice, a, List.of(seatIds.get(0)));
        String code = (String) alice.post(a, "/api/reservations", "{\"holdId\":\"" + th[1] + "\"}",
                confirmHeaders(th[0])).body().get("code");

        Browser bob = new Browser();
        bob.signup(b, email());
        assertThat((List<?>) bob.get(b, "/api/me/reservations", Map.of()).body().get("reservations")).isEmpty();
        Resp steal = bob.post(b, "/api/me/reservations/" + code + "/cancel", null, Map.of());
        assertThat(steal.status()).isEqualTo(404);
        assertThat(steal.error().get("code")).isEqualTo("RESERVATION_NOT_FOUND");
        assertThat(ItData.soldCount(jdbc, perf)).isEqualTo(1);
    }

    @Test
    void 같은_계정이_두_번에_나눠_5석을_확정하려_하면_두_번째가_BOOKING_LIMIT_EXCEEDED() throws Exception {
        Browser br = new Browser();
        br.signup(a, email());
        String[] first = enterAndHold(br, a, List.of(seatIds.get(0), seatIds.get(1), seatIds.get(2)));
        assertThat(br.post(a, "/api/reservations", "{\"holdId\":\"" + first[1] + "\"}", confirmHeaders(first[0]))
                .status()).isEqualTo(201);

        String[] second = enterAndHold(br, b, List.of(seatIds.get(3), seatIds.get(4)));
        Resp over = br.post(b, "/api/reservations", "{\"holdId\":\"" + second[1] + "\"}", confirmHeaders(second[0]));
        assertThat(over.status()).isEqualTo(409);
        assertThat(over.error().get("code")).isEqualTo("BOOKING_LIMIT_EXCEEDED");
        assertThat(ItData.soldCount(jdbc, perf)).isEqualTo(3);
    }

    @Test
    void 입장하지_않은_토큰은_403_없거나_틀리거나_남의_토큰은_401() throws Exception {
        Browser first = new Browser();
        first.signup(a, email());
        String[] th = enterAndHold(first, a, List.of(seatIds.get(0)));

        Browser second = new Browser();
        second.signup(b, email());
        Resp w = second.post(b, "/api/queue/enter", "{\"performanceId\":" + perf + "}", Map.of());
        assertThat(w.body().get("status")).isEqualTo("WAITING"); // max-active 1
        String waiting = (String) w.body().get("queueToken");

        String seatsPath = "/api/performances/" + perf + "/seats";
        String holdsPath = "/api/performances/" + perf + "/holds";
        String holdBody = "{\"seatIds\":[" + seatIds.get(1) + "]}";
        String confirmBody = "{\"holdId\":\"" + th[1] + "\"}";

        assertThat(second.get(b, seatsPath, token(waiting)).status()).isEqualTo(403);
        assertThat(second.post(b, holdsPath, holdBody, token(waiting)).status()).isEqualTo(403);
        assertThat(second.post(b, "/api/reservations", confirmBody, confirmHeaders(waiting)).status()).isEqualTo(403);

        for (String t : new String[] {"Z".repeat(43), th[0]}) { // 지어낸 토큰, 남(first)의 입장 토큰
            assertThat(second.get(b, seatsPath, token(t)).status()).isEqualTo(401);
            assertThat(second.post(b, holdsPath, holdBody, token(t)).status()).isEqualTo(401);
            assertThat(second.post(b, "/api/reservations", confirmBody, confirmHeaders(t)).status()).isEqualTo(401);
        }
        assertThat(second.get(b, seatsPath, Map.of()).status()).isEqualTo(401);
        // 남의 선점 해제 → 401(남의 토큰) / 내 토큰으로 남의 holdId → 404
        assertThat(second.call(b, "DELETE", "/api/holds/" + th[1], null, token(th[0])).status()).isEqualTo(401);
        // first가 이탈 → second 승격
        assertThat(first.call(a, "DELETE", "/api/queue", null, token(th[0])).status()).isEqualTo(204);
        assertThat(redis.keys("seat:hold:" + perf + ":*")).isEmpty();
        assertThat(second.get(a, "/api/queue/status", token(waiting)).body().get("status")).isEqualTo("ADMITTED");
        assertThat(second.call(a, "DELETE", "/api/holds/" + th[1], null, token(waiting)).status()).isEqualTo(404);
    }

    @Test
    void 로그인_5회_연속_실패하면_429_ACCOUNT_LOCKED와_Retry_After_없는_이메일과_틀린_비밀번호는_같은_401() throws Exception {
        Browser owner = new Browser();
        String email = email();
        owner.signup(a, email);

        Browser attacker = new Browser();
        attacker.get(a, "/api/auth/me", Map.of());
        Resp unknown = attacker.post(a, "/api/auth/login",
                "{\"email\":\"nobody-" + UUID.randomUUID() + "@example.com\",\"password\":\"password-123\"}", Map.of());
        Resp wrong = attacker.post(a, "/api/auth/login", "{\"email\":\"" + email + "\",\"password\":\"bad\"}", Map.of());
        assertThat(unknown.status()).isEqualTo(401);
        assertThat(wrong.status()).isEqualTo(401);
        assertThat(unknown.body()).usingRecursiveComparison().ignoringFields("error.requestId").isEqualTo(wrong.body());

        Resp last = null;
        for (int i = 0; i < 4; i++) {
            last = attacker.post(b, "/api/auth/login", "{\"email\":\"" + email + "\",\"password\":\"bad\"}", Map.of());
        }
        assertThat(last.status()).isEqualTo(429); // 5번째 실패에서 잠김(인스턴스가 달라도 users 열에서 센다)
        assertThat(last.error().get("code")).isEqualTo("ACCOUNT_LOCKED");
        assertThat(last.raw().headers().firstValue("Retry-After")).hasValueSatisfying(v ->
                assertThat(Long.parseLong(v)).isBetween(890L, 900L));
        // 잠긴 동안은 맞는 비밀번호도 거부
        Browser legit = new Browser();
        legit.get(a, "/api/auth/me", Map.of());
        assertThat(legit.post(a, "/api/auth/login", "{\"email\":\"" + email + "\",\"password\":\"password-123\"}",
                Map.of()).status()).isEqualTo(429);
    }
}
