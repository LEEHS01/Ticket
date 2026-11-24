package com.ticketing.show;

import java.time.Instant;
import java.util.List;

/** 계약 4.1의 공연 관련 응답 자료형. */
public final class ShowViews {

    private ShowViews() {
    }

    public record Grade(String code, String name, int price) {
    }

    /** 포스터는 이미지가 아니라 프론트가 그릴 때 쓰는 값. */
    public record Poster(int seed, int hue) {
    }

    public record ShowSummary(
            long id,
            String title,
            String tagline,
            Genre genre,
            String venue,
            String region,
            Instant firstStartsAt,
            Instant lastStartsAt,
            Instant saleOpensAt,
            int minPrice,
            int maxPrice,
            SaleStatus status,
            int remainingSeats,
            int totalSeats,
            Integer rank,
            Poster poster,
            Instant createdAt) {
    }

    public record GradeRemaining(String grade, int remaining, int total) {
    }

    public record PerformanceSummary(long id, Instant startsAt, SaleStatus status, List<GradeRemaining> remainingByGrade) {
    }

    /** ShowSummary의 모든 필드 + 상세 필드(계약: ShowSummary & {...}). */
    public record ShowDetail(
            long id,
            String title,
            String tagline,
            Genre genre,
            String venue,
            String region,
            Instant firstStartsAt,
            Instant lastStartsAt,
            Instant saleOpensAt,
            int minPrice,
            int maxPrice,
            SaleStatus status,
            int remainingSeats,
            int totalSeats,
            Integer rank,
            Poster poster,
            Instant createdAt,
            String ageRating,
            int runningMinutes,
            List<String> cast,
            String description,
            List<String> notices,
            int maxSeatsPerBooking,
            List<Grade> grades,
            List<PerformanceSummary> performances,
            VenueInfo venueInfo) {
    }

    /** v4: seatCount = 회차 하나의 좌석 수. */
    public record VenueInfo(String name, String region, int seatCount) {
    }

    /** v4 랭킹. share = 같은 조건(장르·기간) 전체 판매 좌석 수에 대한 비율(%), 소수 첫째 자리. */
    public record RankingItem(int rank, ShowSummary show, double share) {
    }

    public record Rankings(Instant rankedAt, RankingPeriod period, List<RankingItem> items) {
    }

    public record ShowListResponse(List<ShowSummary> shows) {
    }
}
