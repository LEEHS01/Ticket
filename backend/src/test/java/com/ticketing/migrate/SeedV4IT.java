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
        // 새 DB에서는 SHOWS 순서대로 id가 1부터라 계약의 15, 4, 1, 6, 8, 12와 같다(기존 DB는 id가 다를 수 있음)
        assertThat(ContentSeed.BANNERS).extracting(b -> Seeder.SHOWS.indexOf(
                Seeder.SHOWS.stream().filter(s -> s.slug().equals(b.showSlug())).findFirst().orElseThrow()) + 1)
                .containsExactly(15, 4, 1, 6, 8, 12);

        // 공지: 오픈 예정 공연마다 TICKET_OPEN 1건(공연 연결, 오픈 일시 = 판매 시작), SERVICE 3건(고정 1건)
        List<Seeder.SeedShow> upcoming = Seeder.SHOWS.stream().filter(s -> s.saleOpensDay() > 0).toList();
        assertThat(upcoming).hasSize(3);
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
                .isEqualTo(3);
        assertThat(jdbc.sql("SELECT COUNT(*) FROM notices WHERE slug LIKE 'service-%' AND category = 'SERVICE'")
                .query(Integer.class).single()).isEqualTo(3);
        assertThat(jdbc.sql("SELECT COUNT(*) FROM notices WHERE slug LIKE 'service-%' AND pinned").query(Integer.class)
                .single()).isEqualTo(1);
        assertThat(jdbc.sql("SELECT COUNT(*) FROM notices WHERE (slug LIKE 'service-%' OR slug LIKE 'ticket-open-%') "
                + "AND published_at > NOW(3)").query(Integer.class).single()).isZero(); // 모두 이미 게시됨
        assertThat(seedBanners()).hasSize(6);

        // 공연 18개 모두 한 줄 소개(30자 이내)와 지역(서울·경기·대구·부산 중, 3개 이상 섞임)
        List<Map<String, Object>> shows = jdbc.sql("SELECT slug, tagline, region FROM shows WHERE slug IN (:s)")
                .param("s", Seeder.SHOWS.stream().map(Seeder.SeedShow::slug).toList()).query().listOfRows();
        assertThat(shows).hasSize(18).allSatisfy(s -> {
            assertThat((String) s.get("tagline")).isNotBlank().hasSizeLessThanOrEqualTo(30);
            assertThat((String) s.get("region")).isIn("서울", "경기", "대구", "부산");
        });
        Set<Object> regions = shows.stream().map(s -> s.get("region")).collect(java.util.stream.Collectors.toSet());
        assertThat(regions).hasSizeGreaterThanOrEqualTo(3);
    }
}
