package com.ticketing.show;

import java.time.Instant;
import java.util.List;

/** DB의 공연 한 건(좌석 배치 정보 포함). */
public record ShowRow(
        long id,
        String title,
        String tagline,
        Genre genre,
        String venue,
        String region,
        Instant saleOpensAt,
        String ageRating,
        int runningMinutes,
        List<String> cast,
        String description,
        List<String> notices,
        int posterSeed,
        int posterHue,
        int seatRows,
        int seatsPerRow,
        List<Integer> aisleAfter,
        Instant createdAt) {
}
