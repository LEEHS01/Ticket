package com.ticketing.show;

import java.time.Clock;
import java.time.Instant;
import java.util.ArrayList;
import java.util.Comparator;
import java.util.HashMap;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.stream.Collectors;

import org.springframework.stereotype.Service;

import com.ticketing.common.ApiException;
import com.ticketing.common.ErrorCode;
import com.ticketing.show.ShowViews.Grade;
import com.ticketing.show.ShowViews.GradeRemaining;
import com.ticketing.show.ShowViews.PerformanceSummary;
import com.ticketing.show.ShowViews.RankingItem;
import com.ticketing.show.ShowViews.Rankings;
import com.ticketing.show.ShowViews.VenueInfo;
import com.ticketing.show.ShowViews.Poster;
import com.ticketing.show.ShowViews.ShowDetail;
import com.ticketing.show.ShowViews.ShowSummary;

/**
 * 공연 목록·상세. 잔여석은 판매(DB) 기준이며 선점은 반영하지 않는다(계약 4.1).
 * 랭킹은 필터와 무관하게 전체 공연의 판매 좌석 수로 매긴다(판매 0이면 null).
 */
@Service
public class ShowService {

    public static final int MAX_SEATS_PER_BOOKING = 4;

    public enum Sort { DATE, RANKING, OPENING }

    /** region(v4): 공연장 지역, 정확히 일치. null이면 조건 없음. */
    public record Query(Genre genre, String q, SaleStatus status, Sort sort, String region) {

        public Query(Genre genre, String q, SaleStatus status, Sort sort) {
            this(genre, q, status, sort, null);
        }
    }

    /** v4 랭킹: 최대 20개. */
    public static final int RANKING_SIZE = 20;

    private final ShowRepository shows;
    private final Clock clock;

    public ShowService(ShowRepository shows, Clock clock) {
        this.shows = shows;
        this.clock = clock;
    }

    public List<ShowSummary> list(Query query) {
        List<ShowRow> rows = shows.findAll(query.genre(), likePattern(query.q()),
                query.region() == null || query.region().isBlank() ? null : query.region().trim());
        List<PerformanceGradeStat> allStats = shows.findPerformanceStats(null);
        Map<Long, Integer> ranks = ranks(allStats);
        Map<Long, List<GradeRow>> grades = shows.findGrades(rows.stream().map(ShowRow::id).toList()).stream()
                .collect(Collectors.groupingBy(GradeRow::showId));
        Map<Long, List<PerformanceGradeStat>> statsByShow = allStats.stream()
                .collect(Collectors.groupingBy(PerformanceGradeStat::showId));
        Instant now = clock.instant();

        Comparator<ShowSummary> order = switch (query.sort() == null ? Sort.DATE : query.sort()) {
            case DATE -> Comparator.comparing(ShowSummary::firstStartsAt, Comparator.nullsLast(Comparator.naturalOrder()));
            case OPENING -> Comparator.comparing(ShowSummary::saleOpensAt);
            case RANKING -> Comparator.comparing(ShowSummary::rank, Comparator.nullsLast(Comparator.naturalOrder()))
                    .thenComparing(ShowSummary::firstStartsAt, Comparator.nullsLast(Comparator.naturalOrder()));
        };
        return rows.stream()
                .map(row -> summarize(row, grades.getOrDefault(row.id(), List.of()),
                        statsByShow.getOrDefault(row.id(), List.of()), ranks.get(row.id()), now).summary())
                .filter(s -> query.status() == null || s.status() == query.status())
                .sorted(order.thenComparing(ShowSummary::id))
                .toList();
    }

    public ShowDetail get(long id) {
        ShowRow row = shows.findById(id).orElseThrow(() -> new ApiException(ErrorCode.SHOW_NOT_FOUND));
        List<PerformanceGradeStat> allStats = shows.findPerformanceStats(null);
        List<GradeRow> grades = shows.findGrades(List.of(id));
        List<PerformanceGradeStat> mine = allStats.stream().filter(s -> s.showId() == id).toList();
        Computed c = summarize(row, grades, mine, ranks(allStats).get(id), clock.instant());
        ShowSummary s = c.summary();
        // 회차 하나의 좌석 수: 회차마다 같은 공연장 배치라 첫 회차 기준(회차가 없으면 0)
        int seatCount = mine.stream().filter(st -> st.performanceId() == mine.get(0).performanceId())
                .mapToInt(PerformanceGradeStat::total).sum();
        return new ShowDetail(s.id(), s.title(), s.tagline(), s.genre(), s.venue(), s.region(), s.firstStartsAt(),
                s.lastStartsAt(), s.saleOpensAt(), s.minPrice(), s.maxPrice(), s.status(), s.remainingSeats(),
                s.totalSeats(), s.rank(), s.poster(), s.createdAt(), row.ageRating(), row.runningMinutes(), row.cast(), row.description(), row.notices(),
                MAX_SEATS_PER_BOOKING,
                grades.stream().map(g -> new Grade(g.code(), g.name(), g.price())).toList(),
                c.performances(), new VenueInfo(row.venue(), row.region(), mine.isEmpty() ? 0 : seatCount));
    }

    private record Computed(ShowSummary summary, List<PerformanceSummary> performances) {
    }

    private static Computed summarize(ShowRow row, List<GradeRow> grades, List<PerformanceGradeStat> stats,
            Integer rank, Instant now) {
        List<GradeRow> sortedGrades = grades.stream().sorted(Comparator.comparingInt(GradeRow::sortOrder)).toList();
        Map<String, Integer> gradeOrder = new HashMap<>();
        for (int i = 0; i < sortedGrades.size(); i++) {
            gradeOrder.put(sortedGrades.get(i).code(), i);
        }

        Map<Long, List<PerformanceGradeStat>> byPerformance = new LinkedHashMap<>();
        stats.stream()
                .sorted(Comparator.comparing(PerformanceGradeStat::startsAt).thenComparing(PerformanceGradeStat::performanceId))
                .forEach(s -> byPerformance.computeIfAbsent(s.performanceId(), k -> new ArrayList<>()).add(s));

        List<PerformanceSummary> performances = new ArrayList<>();
        int remainingOpen = 0;
        int total = 0;
        for (List<PerformanceGradeStat> perf : byPerformance.values()) {
            int perfTotal = perf.stream().mapToInt(PerformanceGradeStat::total).sum();
            int perfRemaining = perf.stream().mapToInt(s -> s.total() - s.sold()).sum();
            SaleStatus status = SaleStatus.ofPerformance(row.saleOpensAt(), perf.get(0).startsAt(), perfRemaining, now);
            List<GradeRemaining> byGrade = perf.stream()
                    .sorted(Comparator.comparingInt(s -> gradeOrder.getOrDefault(s.grade(), Integer.MAX_VALUE)))
                    .map(s -> new GradeRemaining(s.grade(), s.total() - s.sold(), s.total()))
                    .toList();
            performances.add(new PerformanceSummary(perf.get(0).performanceId(), perf.get(0).startsAt(), status, byGrade));
            total += perfTotal;
            if (status != SaleStatus.CLOSED) {
                remainingOpen += perfRemaining;
            }
        }

        SaleStatus showStatus = SaleStatus.ofShow(performances.stream().map(PerformanceSummary::status).toList());
        Instant first = performances.isEmpty() ? null : performances.get(0).startsAt();
        Instant last = performances.isEmpty() ? null : performances.get(performances.size() - 1).startsAt();
        int minPrice = sortedGrades.stream().mapToInt(GradeRow::price).min().orElse(0);
        int maxPrice = sortedGrades.stream().mapToInt(GradeRow::price).max().orElse(0);

        ShowSummary summary = new ShowSummary(row.id(), row.title(), row.tagline(), row.genre(), row.venue(),
                row.region(), first, last, row.saleOpensAt(), minPrice, maxPrice, showStatus, remainingOpen, total, rank,
                new Poster(row.posterSeed(), row.posterHue()), row.createdAt());
        return new Computed(summary, performances);
    }

    /**
     * v4 랭킹: 기간(DAILY 24시간·WEEKLY 7일·ALL) 안에 확정된 예매의 좌석 수(취소 제외)로 순위를 매긴다.
     * 판매 0인 공연은 빼고, 같으면 공연 id 오름차순. share = 그 공연 판매 / 같은 조건 전체 판매 × 100, 소수 첫째 자리(반올림).
     * 반올림과 상위 20개 자르기 때문에 share 합이 정확히 100이 아닐 수 있다.
     */
    public Rankings rankings(Genre genre, RankingPeriod period) {
        RankingPeriod p = period == null ? RankingPeriod.WEEKLY : period;
        Instant now = clock.instant();
        Instant since = p.window() == null ? null : now.minus(p.window());
        Map<Long, Integer> sold = shows.findSoldSeats(since, genre);
        long totalSold = sold.values().stream().mapToLong(Integer::longValue).sum();
        List<Map.Entry<Long, Integer>> ordered = sold.entrySet().stream()
                .filter(e -> e.getValue() > 0)
                .sorted(Map.Entry.<Long, Integer>comparingByValue().reversed().thenComparing(Map.Entry.comparingByKey()))
                .limit(RANKING_SIZE)
                .toList();
        if (ordered.isEmpty()) {
            return new Rankings(now, p, List.of());
        }
        Map<Long, ShowSummary> summaries = list(new Query(null, null, null, null)).stream()
                .collect(Collectors.toMap(ShowSummary::id, s -> s));
        List<RankingItem> items = new ArrayList<>();
        for (Map.Entry<Long, Integer> e : ordered) {
            ShowSummary s = summaries.get(e.getKey());
            if (s == null) {
                continue;
            }
            double share = java.math.BigDecimal.valueOf(e.getValue() * 100.0 / totalSold)
                    .setScale(1, java.math.RoundingMode.HALF_UP).doubleValue();
            items.add(new RankingItem(items.size() + 1, s, share));
        }
        return new Rankings(now, p, items);
    }

    /** 판매 좌석 수 내림차순 순위(1부터). 같으면 id 오름차순. 판매 0인 공연은 순위 없음. */
    static Map<Long, Integer> ranks(List<PerformanceGradeStat> stats) {
        Map<Long, Integer> sold = new HashMap<>();
        stats.forEach(s -> sold.merge(s.showId(), s.sold(), Integer::sum));
        List<Map.Entry<Long, Integer>> ordered = sold.entrySet().stream()
                .filter(e -> e.getValue() > 0)
                .sorted(Map.Entry.<Long, Integer>comparingByValue().reversed().thenComparing(Map.Entry.comparingByKey()))
                .toList();
        Map<Long, Integer> ranks = new HashMap<>();
        for (int i = 0; i < ordered.size(); i++) {
            ranks.put(ordered.get(i).getKey(), i + 1);
        }
        return ranks;
    }

    /** 검색어를 LIKE 패턴으로. %·_·\ 는 이스케이프해 글자 그대로 찾는다. 빈 검색어는 조건 없음. */
    static String likePattern(String q) {
        if (q == null || q.isBlank()) {
            return null;
        }
        String escaped = q.trim().replace("\\", "\\\\").replace("%", "\\%").replace("_", "\\_");
        return "%" + escaped + "%";
    }
}
