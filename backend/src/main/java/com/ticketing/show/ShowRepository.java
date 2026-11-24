package com.ticketing.show;

import java.util.Collection;
import java.time.Instant;
import java.util.List;
import java.util.Map;
import java.util.Optional;

public interface ShowRepository {

    /**
     * 공연 목록. genre·titleOrVenueLike가 null이면 그 조건을 쓰지 않는다.
     * region도 null이면 조건 없음(정확히 일치, v4).
     * likePattern은 호출자가 %·_·\ 를 이스케이프한 값(예: "%재즈%").
     */
    List<ShowRow> findAll(Genre genre, String likePattern, String region);

    Optional<ShowRow> findById(long id);

    List<GradeRow> findGrades(Collection<Long> showIds);

    /** 회차 × 등급별 좌석·판매 수. showIds가 null이면 모든 공연. */
    List<PerformanceGradeStat> findPerformanceStats(Collection<Long> showIds);

    Optional<PerformanceInfo> findPerformance(long performanceId);

    /** v4 랭킹: showId → 판매 좌석 수(확정만, 취소 제외, 판매 0인 공연은 없음). since == null이면 전체 기간. */
    Map<Long, Integer> findSoldSeats(Instant since, Genre genre);
}
