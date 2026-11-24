package com.ticketing.show;

import java.time.Duration;

/** v4 랭킹 기간. DAILY = 최근 24시간, WEEKLY = 최근 7일, ALL = 전체. */
public enum RankingPeriod {
    DAILY(Duration.ofHours(24)), WEEKLY(Duration.ofDays(7)), ALL(null);

    private final Duration window;

    RankingPeriod(Duration window) {
        this.window = window;
    }

    /** null이면 기간 제한 없음. */
    public Duration window() {
        return window;
    }
}
