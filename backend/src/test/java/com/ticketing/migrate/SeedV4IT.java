package com.ticketing.migrate;

import static org.assertj.core.api.Assertions.assertThat;

import java.time.Instant;
import java.util.List;
import java.util.Map;
import java.util.Set;

import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.jdbc.core.simple.JdbcClient;
import org.springframework.test.context.ActiveProfiles;

import com.ticketing.TicketingApplication;

/** v4 시드(실제 MySQL): 배너 6개 순서·그림 경로, 공지(오픈 예정마다 1건 + 서비스 3건, 고정 1건), 한 줄 소개·지역, 재실행해도 중복 없음. */
@SpringBootTest(webEnvironment = SpringBootTest.WebEnvironment.NONE)
@ActiveProfiles(TicketingApplication.MIGRATE_PROFILE)
class SeedV4IT {

    @Autowired
    Seeder seeder;
    @Autowired
    JdbcClient jdbc;

    private long id(String slug) {
        return jdbc.sql("SELECT id FROM shows WHERE slug = :s").param("s", slug).query(Long.class).single();
    }

    private List<Map<String, Object>> seedBanners() {
        return jdbc.sql("SELECT show_id, image_url, eyebrow, title, subtitle, mobile_image_url, ends_at FROM banners "
                + "WHERE slug LIKE 'seed-%' ORDER BY sort_order, id").query().listOfRows();
    }

    @Test
    void 배너_공지_한줄소개_지역이_들어가고_다시_돌려도_개수가_그대로다() {
        seeder.seed(Instant.now());
        seeder.seed(Instant.now());

        // 배너: 공연 15, 4, 1, 6, 8, 12 순서(같은 slug의 공연 id). 그림은 /banners/banner-{id}.webp, 모바일 그림 없음
        List<Long> expected = ContentSeed.BANNERS.stream().map(b -> id(b.showSlug())).toList();
        List<Map<String, Object>> banners = seedBanners();
        assertThat(banners).extracting(b -> ((Number) b.get("show_id")).longValue()).isEqualTo(expected);
        assertThat(banners).allSatisfy(b -> {
            assertThat(b.get("image_url")).isEqualTo("/banners/banner-" + b.get("show_id") + ".webp");
            assertThat(b.get("mobile_image_url")).isNull();
            assertThat(((String) b.get("eyebrow")).length()).isLessThanOrEqualTo(12);
            assertThat(((String) b.get("title")).length()).isLessThanOrEqualTo(28);
            assertThat(((String) b.get("subtitle")).length()).isLessThanOrEqualTo(40);
            assertThat(b.get("ends_at")).isNotNull();
        });
        // 새 DB에서는 SHOWS 순서대로 id가 1부터라 공연 번호와 같다(기존 DB는 id가 다를 수 있음). BANNERS-ADD.md: 7~16번째는 33…45
        assertThat(ContentSeed.BANNERS).extracting(b -> Seeder.SHOWS.indexOf(
                Seeder.SHOWS.stream().filter(s -> s.slug().equals(b.showSlug())).findFirst().orElseThrow()) + 1)
                .containsExactly(15, 4, 1, 6, 8, 12, 33, 21, 34, 37, 52, 56, 42, 32, 68, 45);

        // 공지: 오픈 예정 공연마다 TICKET_OPEN 1건(공연 연결, 오픈 일시 = 판매 시작), SERVICE 3건(고정 1건)
        List<Seeder.SeedShow> upcoming = Seeder.SHOWS.stream().filter(s -> s.saleOpensDay() > 0).toList();
        assertThat(upcoming).hasSize(17); // 처음 18개 중 3 + 추가 50개 중 14
        for (Seeder.SeedShow s : upcoming) {
            Map<String, Object> n = jdbc.sql("""
                            SELECT n.category, n.show_id, n.ticket_open_at = sh.sale_opens_at AS same_time, n.pinned
                              FROM notices n JOIN shows sh ON sh.id = n.show_id WHERE n.slug = :slug""")
                    .param("slug", "ticket-open-" + s.slug()).query().singleRow();
            assertThat(n.get("category")).isEqualTo("TICKET_OPEN");
            assertThat(((Number) n.get("show_id")).longValue()).isEqualTo(id(s.slug()));
            assertThat(((Number) n.get("same_time")).intValue()).isEqualTo(1);
        }
        assertThat(jdbc.sql("SELECT COUNT(*) FROM notices WHERE slug LIKE 'ticket-open-%'").query(Integer.class).single())
                .isEqualTo(upcoming.size());
        assertThat(jdbc.sql("SELECT COUNT(*) FROM notices WHERE slug LIKE 'service-%' AND category = 'SERVICE'")
                .query(Integer.class).single()).isEqualTo(3);
        assertThat(jdbc.sql("SELECT COUNT(*) FROM notices WHERE slug LIKE 'service-%' AND pinned").query(Integer.class)
                .single()).isEqualTo(1);
        assertThat(jdbc.sql("SELECT COUNT(*) FROM notices WHERE (slug LIKE 'service-%' OR slug LIKE 'ticket-open-%') "
                + "AND published_at > NOW(3)").query(Integer.class).single()).isZero(); // 모두 이미 게시됨
        assertThat(seedBanners()).hasSize(16);

        // 공연 68개 모두 한 줄 소개(30자 이내)와 지역(7개 지역 중, 3개 이상 섞임)
        List<Map<String, Object>> shows = jdbc.sql("SELECT slug, tagline, region FROM shows WHERE slug IN (:s)")
                .param("s", Seeder.SHOWS.stream().map(Seeder.SeedShow::slug).toList()).query().listOfRows();
        assertThat(shows).hasSize(Seeder.SHOWS.size()).allSatisfy(s -> {
            assertThat((String) s.get("tagline")).isNotBlank().hasSizeLessThanOrEqualTo(30);
            assertThat((String) s.get("region")).isIn("서울", "경기", "대구", "부산", "인천", "대전", "광주");
        });
        Set<Object> regions = shows.stream().map(s -> s.get("region")).collect(java.util.stream.Collectors.toSet());
        assertThat(regions).hasSizeGreaterThanOrEqualTo(3);
    }
    /**
     * 시각을 바꿔 가며 GET /api/banners(ContentService)가 무엇을 몇 개 내주는지(BANNERS-ADD.md의 계산과 대조).
     * 시드를 돌린 날(KST) 정오를 기준으로 +N일. 노출 = 시작 제한 없음 ~ 그 공연의 마지막 회차 시작, 정해 둔 순서, 최대 6개.
     * 결과는 공연 번호(SHOWS 순서 + 1)로 바꿔 비교한다 → 공연 id가 다른 기존 DB에서도 같은 뜻으로 확인된다.
     */
    @Test
    void 배너는_시각이_지나면_끝난_공연이_빠지고_뒤_순서가_올라오며_3월_말까지_이어진다() {
        jdbc.sql("DELETE FROM banners WHERE slug NOT LIKE 'seed-%'").update(); // 다른 통합 테스트가 넣은 배너
        seeder.seed(Instant.now());
        Map<Long, Integer> number = new java.util.HashMap<>();
        for (int i = 0; i < Seeder.SHOWS.size(); i++) {
            number.put(id(Seeder.SHOWS.get(i).slug()), i + 1);
        }
        java.time.ZoneId kst = java.time.ZoneId.of("Asia/Seoul");
        java.time.ZonedDateTime noon = java.time.LocalDate.now(kst).atTime(12, 0).atZone(kst);
        Map<Integer, List<Integer>> expected = new java.util.LinkedHashMap<>();
        expected.put(0, List.of(15, 4, 1, 6, 8, 12));
        expected.put(6, List.of(15, 4, 6, 12, 33, 21));      // 1·8번 끝(11/30)
        expected.put(11, List.of(6, 12, 33, 21, 34, 37));    // 15번(12/5)·4번(12/3) 끝
        expected.put(22, List.of(33, 21, 34, 37, 52, 56));   // 6번(12/16)·12번(12/10) 끝 → 추가 배너만
        expected.put(40, List.of(37, 52, 56, 42, 32, 68));   // 33·21번(12/27)·34번(1/3) 끝
        expected.put(75, List.of(52, 56, 42, 32, 68, 45));   // 37번(2/7) 끝 → 남은 6개
        expected.put(82, List.of(56, 42, 32, 68, 45));       // 52번(2/14) 끝 → 5개
        expected.put(110, List.of(42, 32, 68, 45));          // 56번(3/14) 끝 → 4개
        expected.put(117, List.of(68, 45));                  // 42·32번(3/21) 끝 → 2개
        expected.put(123, List.of(45));                      // 68번(3/27) 끝 → 1개(45번은 3/31까지)
        StringBuilder log = new StringBuilder();
        expected.forEach((days, want) -> {
            java.time.Clock at = java.time.Clock.fixed(noon.plusDays(days).toInstant(), kst);
            List<Integer> got = new com.ticketing.content.ContentService(
                    new com.ticketing.content.JdbcContentRepository(jdbc), at).banners().stream()
                    .map(b -> number.get(b.showId())).toList();
            log.append(String.format("+%d일 %s: %d개 %s%n", days, noon.plusDays(days).toLocalDate(), got.size(), got));
            assertThat(got).as("+%d일", days).isEqualTo(want);
        });
        System.out.print("[측정] 배너 노출\n" + log);
        // 배너 공연의 마지막 회차 날짜(KST)가 표와 같다: 시드를 돌린 날이 기준일(2026-11-25)과 같을 때의 날짜로 비교
        Map<String, String> lastDay = Map.of("snowman-photo-studio", "12-27", "paper-plane-cleared-to-land", "12-27",
                "twelfth-bell", "01-03", "west-attic-inventor", "02-07", "neighborhood-detective", "02-14",
                "broken-clock-shop", "03-14", "thousand-paper-cranes", "03-21", "solbaram-kkotsaem", "03-21",
                "spring-symphony-awakening-fields", "03-27", "rooftop-gardener", "03-31");
        lastDay.forEach((slug, md) -> {
            Seeder.SeedShow s = Seeder.SHOWS.stream().filter(x -> x.slug().equals(slug)).findFirst().orElseThrow();
            int last = s.performances().stream().mapToInt(Seeder.SeedPerf::day).max().orElseThrow();
            assertThat(last).as(slug + " 마지막 회차").isEqualTo(AddedShows.day(md));
        });
    }
}
