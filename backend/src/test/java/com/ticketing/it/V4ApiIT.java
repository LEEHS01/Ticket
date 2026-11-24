package com.ticketing.it;

import static org.assertj.core.api.Assertions.assertThat;

import java.sql.Timestamp;
import java.time.Clock;
import java.time.Duration;
import java.time.Instant;
import java.time.ZoneOffset;
import java.util.ArrayList;
import java.util.HashSet;
import java.util.List;
import java.util.Map;
import java.util.Set;
import java.util.UUID;

import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.boot.test.context.TestConfiguration;
import org.springframework.boot.test.web.server.LocalServerPort;
import org.springframework.context.annotation.Bean;
import org.springframework.context.annotation.Primary;
import org.springframework.data.redis.core.StringRedisTemplate;
import org.springframework.jdbc.core.simple.JdbcClient;

import com.ticketing.it.AuthSessionIT.Browser;
import com.ticketing.it.AuthSessionIT.Resp;

/**
 * API v4(실제 MySQL·HTTP): 랭킹 집계와 점유율, 공지 페이지 나눔·고정 순서, 배너 노출 기간, 배치 정보에 상태 없음,
 * paymentMethod 기본값·거부.
 * 앱의 "지금"을 2099년으로 고정한다 → 기간 조건(랭킹 24시간·7일, 배너 노출, 공지 게시)이 이 테스트가 넣은 행만 보게 된다
 * (같은 테스트 DB에 시드·다른 테스트 데이터가 섞여 있어도). 전체 기간(ALL)·전체 공지는 순서·합계 같은 성질로 확인한다.
 */
@SpringBootTest(webEnvironment = SpringBootTest.WebEnvironment.RANDOM_PORT, properties = {
        "spring.flyway.enabled=true", "app.queue.max-active=100", "app.auth.session-cookie-secure=false",
        "app.rate-limit.general-per-minute=10000", "app.rate-limit.strict-per-minute=10000",
        "app.rate-limit.poll-per-minute=10000"})
class V4ApiIT {

    static final Instant NOW = Instant.parse("2099-01-15T03:00:00Z");

    @TestConfiguration
    static class FixedClock {
        @Bean
        @Primary
        Clock futureClock() {
            return Clock.fixed(NOW, ZoneOffset.UTC);
        }
    }

    @LocalServerPort
    int port;
    @Autowired
    JdbcClient jdbc;
    @Autowired
    StringRedisTemplate redis;

    private String a;
    private long seedUser;

    @BeforeEach
    void setUp() {
        ItData.flushRedis(redis);
        a = "http://127.0.0.1:" + port;
        jdbc.sql("DELETE FROM banners WHERE slug LIKE 'it-%'").update();
        jdbc.sql("DELETE FROM notices WHERE slug LIKE 'it-%'").update();
        // 이 테스트의 예전 실행이 남긴 2099년 예매는 취소로 돌려 랭킹 기간 조건에서 뺀다
        jdbc.sql("UPDATE reservations SET status = 'CANCELLED', cancelled_at = created_at WHERE created_at > '2098-01-01' AND status = 'CONFIRMED'")
                .update();
        seedUser = jdbc.sql("SELECT id FROM users WHERE email = 'seed-system@ticketing.invalid'").query(Long.class).single();
    }

    // ------------------------------------------------------------------ 데이터 만들기

    /** genre 공연 1개 + 회차 1개(2행 × 4석). 반환 {showId, perfId} */
    private long[] show(String genre) {
        String slug = "it-" + UUID.randomUUID();
        jdbc.sql("""
                        INSERT INTO shows (slug, title, tagline, genre, venue, region, sale_opens_at, age_rating, running_minutes,
                                           cast_members, description, notices, poster_seed, poster_hue,
                                           seat_rows, seats_per_row, aisle_after)
                        VALUES (:slug, :title, '통합 테스트 한 줄', :genre, '테스트홀', '테스트', :opens, '전체 관람가', 90,
                                '["출연"]', '설명', '["유의"]', 1, 10, 2, 4, '[2]')
                        """)
                .param("slug", slug).param("title", "v4 " + genre + " " + slug.substring(3, 11)).param("genre", genre)
                .param("opens", Timestamp.from(NOW.minus(Duration.ofDays(30)))).update();
        long showId = jdbc.sql("SELECT id FROM shows WHERE slug = :s").param("s", slug).query(Long.class).single();
        jdbc.sql("INSERT INTO grades VALUES (:id, 'R', 'R석', 100000, 0), (:id, 'S', 'S석', 50000, 1)")
                .param("id", showId).update();
        jdbc.sql("INSERT INTO performances (show_id, seq, starts_at) VALUES (:id, 1, :at)")
                .param("id", showId).param("at", Timestamp.from(NOW.plus(Duration.ofDays(3)))).update();
        long perf = jdbc.sql("SELECT id FROM performances WHERE show_id = :id").param("id", showId)
                .query(Long.class).single();
        for (String row : List.of("A", "B")) {
            for (int n = 1; n <= 4; n++) {
                jdbc.sql("INSERT INTO seats (performance_id, row_label, seat_number, grade_code) VALUES (:p, :r, :n, :g)")
                        .param("p", perf).param("r", row).param("n", n).param("g", row.equals("A") ? "R" : "S").update();
            }
        }
        return new long[] {showId, perf};
    }

    /** perf의 아직 안 팔린 좌석 n개를 지정 시각의 확정(또는 취소) 예매로 판다. */
    private void sell(long perf, int n, Instant createdAt, String status) {
        String code = ("IT" + UUID.randomUUID().toString().replace("-", "").toUpperCase()).substring(0, 12);
        jdbc.sql("""
                        INSERT INTO reservations (code, performance_id, user_id, total_price, name, email_hash, email_masked,
                                                  status, created_at, cancelled_at)
                        VALUES (:code, :p, :u, 0, '테스트', REPEAT('0', 64), 't***@x.com', :status, :at,
                                IF(:status = 'CANCELLED', :at, NULL))
                        """)
                .param("code", code).param("p", perf).param("u", seedUser).param("status", status)
                .param("at", Timestamp.from(createdAt)).update();
        long rid = jdbc.sql("SELECT id FROM reservations WHERE code = :c").param("c", code).query(Long.class).single();
        List<Long> seats = jdbc.sql("SELECT id FROM seats WHERE performance_id = :p AND status = 'AVAILABLE' ORDER BY id LIMIT "
                + n).param("p", perf).query(Long.class).list();
        for (Long s : seats) {
            jdbc.sql("INSERT INTO reservation_seats VALUES (:r, :s, 1000)").param("r", rid).param("s", s).update();
            if (status.equals("CONFIRMED")) {
                jdbc.sql("UPDATE seats SET status = 'SOLD', reservation_id = :r WHERE id = :s").param("r", rid)
                        .param("s", s).update();
            }
        }
    }

    @SuppressWarnings("unchecked")
    private static List<Map<String, Object>> items(Resp r) {
        return (List<Map<String, Object>>) r.body().get("items");
    }

    private static long showIdOf(Map<String, Object> item) {
        return ((Number) ((Map<?, ?>) item.get("show")).get("id")).longValue();
    }

    // ------------------------------------------------------------------ 랭킹

    @Test
    void 랭킹은_기간_안의_확정_좌석_수로_순위를_매기고_점유율은_조건별_전체에_대한_비율이며_판매_0은_뺀다() throws Exception {
        long[] x = show("CLASSIC");
        long[] y = show("CLASSIC");
        long[] z = show("CLASSIC");
        long[] none = show("CLASSIC");
        sell(x[1], 4, NOW.minus(Duration.ofDays(10)), "CONFIRMED");  // 전체에만
        sell(y[1], 3, NOW.minus(Duration.ofDays(3)), "CONFIRMED");   // 7일 안
        sell(z[1], 1, NOW.minus(Duration.ofHours(2)), "CONFIRMED");  // 24시간 안
        sell(x[1], 1, NOW.minus(Duration.ofHours(1)), "CONFIRMED");  // 24시간 안
        sell(z[1], 2, NOW.minus(Duration.ofHours(1)), "CANCELLED");  // 취소는 세지 않는다
        Browser br = new Browser();

        Resp daily = br.get(a, "/api/rankings?period=DAILY&genre=CLASSIC", Map.of());
        assertThat(daily.status()).isEqualTo(200);
        assertThat(daily.body().get("period")).isEqualTo("DAILY");
        assertThat(daily.body().get("rankedAt")).isEqualTo("2099-01-15T03:00:00Z");
        assertThat(items(daily)).extracting(V4ApiIT::showIdOf).containsExactly(x[0], z[0]); // 1석씩 동률 → id 순
        assertThat(items(daily)).extracting(i -> i.get("share")).containsExactly(50.0, 50.0);
        assertThat(items(daily)).extracting(i -> i.get("rank")).containsExactly(1, 2);

        Resp weekly = br.get(a, "/api/rankings?genre=CLASSIC", Map.of()); // 기본 WEEKLY
        assertThat(weekly.body().get("period")).isEqualTo("WEEKLY");
        assertThat(items(weekly)).extracting(V4ApiIT::showIdOf).containsExactly(y[0], x[0], z[0]);
        assertThat(items(weekly)).extracting(i -> i.get("share")).containsExactly(60.0, 20.0, 20.0);
        assertThat(items(weekly)).extracting(V4ApiIT::showIdOf).doesNotContain(none[0]);

        // 전체 기간·전체 장르: 시드·다른 테스트 데이터가 섞이므로 성질로 확인
        Resp all = br.get(a, "/api/rankings?period=ALL", Map.of());
        List<Map<String, Object>> list = items(all);
        assertThat(list).hasSizeLessThanOrEqualTo(20);
        double sum = 0;
        double previous = Double.MAX_VALUE;
        for (int i = 0; i < list.size(); i++) {
            assertThat(list.get(i).get("rank")).isEqualTo(i + 1);
            double share = ((Number) list.get(i).get("share")).doubleValue();
            assertThat(share).isPositive().isLessThanOrEqualTo(previous);
            assertThat(share * 10).isEqualTo(Math.rint(share * 10)); // 소수 첫째 자리
            previous = share;
            sum += share;
            Map<?, ?> s = (Map<?, ?>) list.get(i).get("show");
            assertThat(s.keySet().stream().map(Object::toString).toList()).contains("tagline", "region", "createdAt", "rank", "poster");
        }
        assertThat(sum).isLessThanOrEqualTo(100.0 + 0.05 * list.size());
        // 전체 판매 좌석 합으로 다시 계산한 1위 점유율과 같다
        long totalSold = jdbc.sql("""
                        SELECT COUNT(*) FROM reservations r JOIN reservation_seats rs ON rs.reservation_id = r.id
                         WHERE r.status = 'CONFIRMED'""").query(Long.class).single();
        long firstSold = jdbc.sql("""
                        SELECT COUNT(*) FROM reservations r JOIN reservation_seats rs ON rs.reservation_id = r.id
                          JOIN performances p ON p.id = r.performance_id
                         WHERE r.status = 'CONFIRMED' AND p.show_id = :s""").param("s", showIdOf(list.get(0)))
                .query(Long.class).single();
        assertThat(((Number) list.get(0).get("share")).doubleValue())
                .isEqualTo(Math.round(firstSold * 1000.0 / totalSold) / 10.0);
    }

    // ------------------------------------------------------------------ 공지

    private long notice(String category, boolean pinned, Instant publishedAt) {
        String slug = "it-" + UUID.randomUUID();
        jdbc.sql("""
                        INSERT INTO notices (slug, category, title, body, pinned, published_at)
                        VALUES (:slug, :c, :t, '첫 줄\n<b>둘째 줄</b>', :p, :at)""")
                .param("slug", slug).param("c", category).param("t", "공지 " + slug.substring(3, 9)).param("p", pinned)
                .param("at", Timestamp.from(publishedAt)).update();
        return jdbc.sql("SELECT id FROM notices WHERE slug = :s").param("s", slug).query(Long.class).single();
    }

    @SuppressWarnings("unchecked")
    private static List<Long> ids(Resp r) {
        return ((List<Map<String, Object>>) r.body().get("notices")).stream()
                .map(n -> ((Number) n.get("id")).longValue()).toList();
    }

    @Test
    void 공지는_고정_먼저_최신순이고_페이지를_겹치지_않게_나누며_게시_전_공지는_보이지_않는다() throws Exception {
        long oldPinned = notice("SERVICE", true, NOW.minus(Duration.ofDays(400)));
        long n1 = notice("SERVICE", false, NOW.minus(Duration.ofMinutes(3)));
        long n2 = notice("TICKET_OPEN", false, NOW.minus(Duration.ofMinutes(2)));
        long n3 = notice("SERVICE", false, NOW.minus(Duration.ofMinutes(1)));
        long future = notice("SERVICE", false, NOW.plus(Duration.ofHours(1)));
        Browser br = new Browser();

        Resp full = br.get(a, "/api/notices?size=50", Map.of());
        long total = jdbc.sql("SELECT COUNT(*) FROM notices WHERE published_at <= :n").param("n", Timestamp.from(NOW))
                .query(Long.class).single();
        assertThat(((Number) full.body().get("totalCount")).longValue()).isEqualTo(total);
        List<Long> order = ids(full);
        assertThat(order).doesNotContain(future);
        assertThat(order.indexOf(oldPinned)).isLessThan(order.indexOf(n3)); // 고정이 먼저(400일 전이어도)
        assertThat(order.indexOf(n3)).isLessThan(order.indexOf(n2));
        assertThat(order.indexOf(n2)).isLessThan(order.indexOf(n1));
        // 고정 공지가 모두 앞에 모여 있다
        List<Boolean> pinnedFlags = jdbc.sql("SELECT pinned FROM notices WHERE published_at <= :n ORDER BY pinned DESC, published_at DESC, id DESC LIMIT 50")
                .param("n", Timestamp.from(NOW)).query(Boolean.class).list();
        assertThat(pinnedFlags).isSortedAccordingTo((p, q) -> Boolean.compare(q, p));

        // size=2로 끝까지 넘기면 같은 순서를 겹침·빠짐 없이 나눈다
        int pages = ((Number) br.get(a, "/api/notices?size=2", Map.of()).body().get("totalPages")).intValue();
        assertThat(pages).isEqualTo((int) ((total + 1) / 2));
        List<Long> paged = new ArrayList<>();
        for (int p = 1; p <= pages; p++) {
            Resp r = br.get(a, "/api/notices?size=2&page=" + p, Map.of());
            assertThat(r.body().get("page")).isEqualTo(p);
            paged.addAll(ids(r));
        }
        assertThat(paged).hasSize((int) total);
        assertThat(paged.subList(0, order.size())).isEqualTo(order);
        assertThat(new HashSet<>(paged)).hasSize(paged.size());
        Resp beyond = br.get(a, "/api/notices?size=2&page=" + (pages + 1), Map.of());
        assertThat(ids(beyond)).isEmpty();
        assertThat(beyond.body().get("totalPages")).isEqualTo(pages);

        // 분류 필터, 상세(본문은 일반 텍스트 그대로), 게시 전·없는 공지는 404
        assertThat(ids(br.get(a, "/api/notices?category=TICKET_OPEN&size=50", Map.of()))).contains(n2).doesNotContain(n1, n3);
        Resp detail = br.get(a, "/api/notices/" + n1, Map.of());
        assertThat(detail.status()).isEqualTo(200);
        assertThat(detail.body().get("body")).isEqualTo("첫 줄\n<b>둘째 줄</b>");
        assertThat(detail.body()).containsKeys("ticketOpenAt", "showId", "pinned", "publishedAt", "category");
        assertThat(br.get(a, "/api/notices/" + future, Map.of()).status()).isEqualTo(404);
        assertThat(br.get(a, "/api/notices/999999999", Map.of()).error().get("code")).isEqualTo("NOTICE_NOT_FOUND");
    }

    // ------------------------------------------------------------------ 배너

    private void banner(String key, long showId, int order, Instant startsAt, Instant endsAt) {
        jdbc.sql("""
                        INSERT INTO banners (slug, show_id, eyebrow, title, subtitle, image_url, sort_order, starts_at, ends_at)
                        VALUES (:slug, :show, '테스트', :title, '부제', '/banners/banner-test.webp', :ord, :s, :e)""")
                .param("slug", "it-" + key + "-" + UUID.randomUUID()).param("show", showId).param("title", "배너 " + key)
                .param("ord", order).param("s", startsAt == null ? null : Timestamp.from(startsAt))
                .param("e", endsAt == null ? null : Timestamp.from(endsAt)).update();
    }

    @Test
    void 배너는_노출_기간_안의_것만_정한_순서로_최대_6개() throws Exception {
        long showId = show("CONCERT")[0];
        banner("always", showId, -20, null, null);
        banner("ended", showId, -19, null, NOW.minusSeconds(1));
        banner("notyet", showId, -18, NOW.plus(Duration.ofHours(1)), null);
        banner("window", showId, -21, NOW.minus(Duration.ofHours(1)), NOW.plus(Duration.ofHours(1)));
        for (int i = 0; i < 6; i++) {
            banner("filler" + i, showId, 100 + i, null, null);
        }
        @SuppressWarnings("unchecked")
        List<Map<String, Object>> banners = (List<Map<String, Object>>) new Browser().get(a, "/api/banners", Map.of())
                .body().get("banners");
        assertThat(banners).hasSize(6);
        assertThat(banners.subList(0, 2)).extracting(b -> b.get("title")).containsExactly("배너 window", "배너 always");
        assertThat(banners).extracting(b -> (String) b.get("title")).doesNotContain("배너 ended", "배너 notyet");
        assertThat(banners.get(0)).containsEntry("mobileImageUrl", null).containsEntry("showId", (int) showId);
    }

    // ------------------------------------------------------------------ 좌석 배치

    @Test
    void 좌석_배치는_로그인_대기열_없이_볼_수_있고_판매_선점_여부와_좌석_id가_없다() throws Exception {
        long[] s = show("PLAY");
        Browser anonymous = new Browser();
        Resp before = anonymous.get(a, "/api/performances/" + s[1] + "/layout", Map.of());
        assertThat(before.status()).isEqualTo(200);

        sell(s[1], 2, NOW.minus(Duration.ofHours(1)), "CONFIRMED");          // 2석 판매
        Browser buyer = new Browser();
        buyer.signup(a, "layout-" + UUID.randomUUID() + "@example.com");
        String t = (String) buyer.post(a, "/api/queue/enter", "{\"performanceId\":" + s[1] + "}", Map.of()).body()
                .get("queueToken");
        long free = jdbc.sql("SELECT id FROM seats WHERE performance_id = :p AND status = 'AVAILABLE' ORDER BY id LIMIT 1")
                .param("p", s[1]).query(Long.class).single();
        assertThat(buyer.post(a, "/api/performances/" + s[1] + "/holds", "{\"seatIds\":[" + free + "]}",
                Map.of("X-Queue-Token", t)).status()).isEqualTo(201);                   // 1석 선점

        Resp after = anonymous.get(a, "/api/performances/" + s[1] + "/layout", Map.of());
        assertThat(after.raw().body()).isEqualTo(before.raw().body());               // 판매·선점 전후 응답이 같다
        String body = after.raw().body();
        for (String leak : List.of("status", "SOLD", "HELD", "AVAILABLE", "MINE", "holdId", "reservation")) {
            assertThat(body).doesNotContain(leak);
        }
        @SuppressWarnings("unchecked")
        List<Map<String, Object>> seats = (List<Map<String, Object>>) after.body().get("seats");
        assertThat(seats).hasSize(8).allSatisfy(seat -> assertThat(seat.keySet()).containsExactlyInAnyOrder("row", "number", "grade"));
        assertThat(after.body()).containsKeys("performance", "grades", "rows", "seatsPerRow", "aisleAfter");
        assertThat(anonymous.get(a, "/api/performances/999999999/layout", Map.of()).error().get("code"))
                .isEqualTo("PERFORMANCE_NOT_FOUND");
    }

    // ------------------------------------------------------------------ 결제 수단

    @Test
    void 결제_수단은_없으면_CARD_고르면_그_값이_저장되고_정의되지_않은_값은_400이며_예매가_생기지_않는다() throws Exception {
        long perf = show("MUSICAL")[1];
        List<Long> seatIds = ItData.seatIds(jdbc, perf);
        Browser br = new Browser();
        br.signup(a, "pay-" + UUID.randomUUID() + "@example.com");
        Set<String> methods = new HashSet<>();
        String[] bodies = {"", ",\"paymentMethod\":\"BANK_TRANSFER\""};
        for (int i = 0; i < bodies.length; i++) {
            String t = (String) br.post(a, "/api/queue/enter", "{\"performanceId\":" + perf + "}", Map.of()).body()
                    .get("queueToken");
            String hold = (String) br.post(a, "/api/performances/" + perf + "/holds", "{\"seatIds\":[" + seatIds.get(i) + "]}",
                    Map.of("X-Queue-Token", t)).body().get("holdId");
            Map<String, String> h = Map.of("X-Queue-Token", t, "Idempotency-Key", UUID.randomUUID().toString());
            if (i == 1) {
                Resp bad = br.post(a, "/api/reservations", "{\"holdId\":\"" + hold + "\",\"paymentMethod\":\"PAYPAL\"}", h);
                assertThat(bad.status()).isEqualTo(400);
                assertThat(bad.error().get("code")).isEqualTo("VALIDATION_ERROR");
                assertThat(ItData.soldCount(jdbc, perf)).isEqualTo(1);
            }
            Resp ok = br.post(a, "/api/reservations", "{\"holdId\":\"" + hold + "\"" + bodies[i] + "}", h);
            assertThat(ok.status()).isEqualTo(201);
            methods.add((String) ok.body().get("paymentMethod"));
        }
        assertThat(methods).containsExactlyInAnyOrder("CARD", "BANK_TRANSFER");
        @SuppressWarnings("unchecked")
        List<Map<String, Object>> mine = (List<Map<String, Object>>) br.get(a, "/api/me/reservations", Map.of()).body()
                .get("reservations");
        assertThat(mine).extracting(r -> r.get("paymentMethod")).containsExactly("BANK_TRANSFER", "CARD");
        assertThat(jdbc.sql("""
                        SELECT r.payment_method FROM reservations r WHERE r.performance_id = :p ORDER BY r.id""")
                .param("p", perf).query(String.class).list()).containsExactly("CARD", "BANK_TRANSFER");
    }
}
