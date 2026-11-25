package com.ticketing.migrate;

import static org.assertj.core.api.Assertions.assertThat;

import java.util.HashMap;
import java.util.HashSet;
import java.util.List;
import java.util.Map;
import java.util.Set;
import java.util.stream.Collectors;

import org.junit.jupiter.api.Test;

import com.ticketing.show.Genre;

/**
 * 시드 공연 목록 검증(DB 없이). 시드 문구·배치 실수(한 줄 소개 30자 초과, 지역 누락, 공연장마다 다른 배치, 등급 행 초과,
 * 번호·순서 어긋남)를 migrate 전에 잡는다. 추가 공연 기준: docs/next/SHOWS-ADD.md.
 */
class SeedCatalogTest {

    private static final List<String> FIRST_18 = List.of(
            "dawnlight-blue-frequency", "citypop-summer-night", "mulgyeol-indie-fest-2026", "girl-who-folds-time",
            "lighthouse-keeper-song", "cloud-station", "last-letter-thursday", "rooftop-observatory", "second-move",
            "autumn-chamber-night", "mirinae-youth-orchestra", "piano-memory-of-water", "sunset-jazz-eleven-pm",
            "first-snow-folk-concert", "moonlight-laundry", "bus-leaves-at-eight", "long-winter-cello", "cat-postman");

    private final List<Seeder.SeedShow> shows = Seeder.SHOWS;

    @Test
    void 공연은_68개이고_1_18번은_예전_그대로_19_68번은_표의_번호_순서() {
        assertThat(shows).hasSize(68);
        assertThat(shows.subList(0, 18)).extracting(Seeder.SeedShow::slug).isEqualTo(FIRST_18);
        assertThat(AddedShows.NUMBERS).hasSize(50);
        for (int no = 19; no <= 68; no++) {
            assertThat(shows.get(no - 1).slug()).as("%d번", no).isEqualTo(AddedShows.NUMBERS.get(no));
        }
        assertThat(shows).extracting(Seeder.SeedShow::slug).doesNotHaveDuplicates();
        assertThat(shows).extracting(Seeder.SeedShow::title).doesNotHaveDuplicates();
    }

    @Test
    void 추가_50개의_합계는_표와_같다_장르_회차_오픈_예정() {
        List<Seeder.SeedShow> added = shows.subList(18, 68);
        Map<Genre, Long> byGenre = added.stream().collect(Collectors.groupingBy(Seeder.SeedShow::genre, Collectors.counting()));
        assertThat(byGenre).containsEntry(Genre.CONCERT, 14L).containsEntry(Genre.MUSICAL, 13L)
                .containsEntry(Genre.PLAY, 12L).containsEntry(Genre.CLASSIC, 11L);
        assertThat(added.stream().mapToInt(s -> s.performances().size()).sum()).isEqualTo(222);
        assertThat(added.stream().filter(s -> s.saleOpensDay() > 0).count()).isEqualTo(14);
        // 가장 먼 회차는 기준일 +126일(3/31), 가장 가까운 회차는 12/3(+8일)
        assertThat(added.stream().flatMap(s -> s.performances().stream()).mapToInt(Seeder.SeedPerf::day).max().orElseThrow())
                .isEqualTo(126);
        assertThat(AddedShows.day("03-31")).isEqualTo(126);
        assertThat(AddedShows.day("12-03")).isEqualTo(8);
    }

    @Test
    void 한_줄_소개는_모두_있고_30자_이내_지역은_모든_공연장에_있다() {
        for (Seeder.SeedShow s : shows) {
            String tagline = ContentSeed.TAGLINES.get(s.slug());
            assertThat(tagline).as(s.slug()).isNotBlank();
            assertThat(tagline.length()).as(s.slug() + " 한 줄 소개 길이").isLessThanOrEqualTo(30);
            assertThat(ContentSeed.VENUE_REGIONS).as(s.venue() + "의 지역").containsKey(s.venue());
        }
        assertThat(shows.stream().map(s -> ContentSeed.region(s.venue())).collect(Collectors.toSet()))
                .containsExactlyInAnyOrder("서울", "경기", "대구", "부산", "인천", "대전", "광주");
    }

    @Test
    void 같은_공연장은_같은_좌석_배치이고_등급_행이_배치를_넘지_않는다() {
        Map<String, VenueLayout> seen = new HashMap<>();
        for (Seeder.SeedShow s : shows) {
            VenueLayout before = seen.putIfAbsent(s.venue(), s.layout());
            assertThat(before == null ? s.layout() : before).as(s.venue()).isEqualTo(s.layout());
            assertThat(AddedShows.VENUE_LAYOUTS.get(s.venue())).as(s.venue()).isEqualTo(s.layout());
            List<Seeder.SeedGrade> grades = s.grades();
            assertThat(grades.get(grades.size() - 1).rows()).as(s.slug() + " 마지막 등급은 나머지 행").isZero();
            int fixed = grades.stream().mapToInt(Seeder.SeedGrade::rows).sum();
            assertThat(fixed).as(s.slug() + " 등급 행 합").isLessThan(s.layout().rows());
            assertThat(grades).extracting(Seeder.SeedGrade::code).doesNotHaveDuplicates();
        }
    }

    @Test
    void 회차는_날짜순이고_예매_시작_뒤이며_오픈_예정은_미리_판매가_없고_2월_이후는_20퍼센트_이하() {
        Set<Integer> soldOutShows = new HashSet<>();
        for (int i = 0; i < shows.size(); i++) {
            Seeder.SeedShow s = shows.get(i);
            List<Seeder.SeedPerf> perfs = s.performances();
            assertThat(perfs).as(s.slug()).isNotEmpty().hasSizeLessThan(100); // 시드 예매번호 형식(회차 두 자리) 안
            for (int p = 0; p < perfs.size(); p++) {
                Seeder.SeedPerf perf = perfs.get(p);
                assertThat(perf.day()).as(s.slug()).isGreaterThan(s.saleOpensDay());
                assertThat(perf.soldRatio()).isBetween(0.0, 1.0);
                if (p > 0) {
                    Seeder.SeedPerf prev = perfs.get(p - 1);
                    assertThat(perf.day() * 2400 + perf.time().getHour() * 100 + perf.time().getMinute())
                            .as(s.slug() + " 회차 순서").isGreaterThan(prev.day() * 2400 + prev.time().getHour() * 100
                                    + prev.time().getMinute());
                }
                if (s.saleOpensDay() > 0) {
                    assertThat(perf.soldRatio()).as(s.slug() + " 오픈 예정").isZero();
                }
                if (i >= 18 && perf.day() >= AddedShows.day("02-01")) {
                    assertThat(perf.soldRatio()).as(s.slug() + " 2월 이후").isLessThanOrEqualTo(0.2);
                }
                if (perf.soldRatio() == 1.0 && i >= 18) {
                    soldOutShows.add(i + 1);
                }
            }
            assertThat(s.hue()).isBetween(0, 359);
            assertThat(s.cast()).as(s.slug()).isNotEmpty();
            assertThat(s.description()).as(s.slug()).isNotBlank();
        }
        assertThat(shows.get(21).performances().get(0).soldRatio()).isEqualTo(0.95); // 22번 거의 매진
        assertThat(soldOutShows).hasSizeBetween(2, 3);
        // 판매 중인 추가 공연은 예매 시작이 1~20일 전
        assertThat(shows.subList(18, 68)).filteredOn(s -> s.saleOpensDay() <= 0)
                .allSatisfy(s -> assertThat(-s.saleOpensDay()).isBetween(1, 20));
    }
}
