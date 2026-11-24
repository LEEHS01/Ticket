package com.ticketing.migrate;

import static org.assertj.core.api.Assertions.assertThat;

import java.time.Duration;
import java.time.Instant;
import java.util.Random;

import org.junit.jupiter.api.Test;

/** v4: 시드 예매 시각을 판매 시작 ~ 지금(최대 14일)에 흩고, 공연마다 최근에 몰리는 정도를 다르게 한다. */
class SeedSpreadTest {

    private static final Instant NOW = Instant.parse("2026-11-24T03:00:00Z");

    private static double recentShare(int showIndex, Instant opens) {
        Random r = new Random(42);
        int recent = 0;
        for (int i = 0; i < 2000; i++) {
            Instant t = Seeder.spreadCreatedAt(showIndex, opens, NOW, r);
            assertThat(t).isAfterOrEqualTo(opens.isAfter(NOW.minus(Duration.ofDays(14))) ? opens
                    : NOW.minus(Duration.ofDays(14))).isBeforeOrEqualTo(NOW.minusSeconds(60));
            if (t.isAfter(NOW.minus(Duration.ofDays(1)))) {
                recent++;
            }
        }
        return recent / 2000.0;
    }

    @Test
    void 판매_시작_이후_지금_1분_전_사이이고_최대_14일_전까지() {
        recentShare(0, NOW.minus(Duration.ofDays(3)));
        recentShare(5, NOW.minus(Duration.ofDays(40)));
    }

    @Test
    void 공연마다_최근_24시간에_몰리는_비율이_달라_기간별_순위가_바뀐다() {
        Instant opens = NOW.minus(Duration.ofDays(30));
        double oldHeavy = recentShare(0, opens);   // k = 0.35
        double recentHeavy = recentShare(4, opens); // k = 0.35 + 8×0.3 = 2.75
        assertThat(recentHeavy).isGreaterThan(oldHeavy * 3);
    }
}
