package com.ticketing.seat;

import java.time.Instant;
import java.util.List;

import com.ticketing.show.ShowViews.Grade;

/** 계약 4.1의 좌석 관련 응답 자료형. */
public final class SeatViews {

    private SeatViews() {
    }

    public enum SeatStatus { AVAILABLE, HELD, SOLD, MINE }

    public record Seat(long id, String row, int number, String grade, SeatStatus status) {
    }

    public record PerformanceRef(long id, long showId, String showTitle, String venue, Instant startsAt) {
    }

    public record HoldView(String holdId, List<Long> seatIds, int totalPrice, Instant expiresAt) {

        public static HoldView of(HoldStore.Hold h) {
            return new HoldView(h.holdId(), h.seatIds(), h.totalPrice(), h.expiresAt());
        }
    }

    /** v4 좌석 배치 미리보기. 좌석 상태가 없다(대기열을 거치지 않고 볼 수 있으므로). */
    public record SeatLayout(
            PerformanceRef performance,
            List<Grade> grades,
            List<String> rows,
            int seatsPerRow,
            List<Integer> aisleAfter,
            List<LayoutSeat> seats) {
    }

    public record LayoutSeat(String row, int number, String grade) {
    }

    public record SeatMap(
            PerformanceRef performance,
            List<Grade> grades,
            List<String> rows,
            int seatsPerRow,
            List<Integer> aisleAfter,
            List<Seat> seats,
            HoldView myHold) {
    }
}
