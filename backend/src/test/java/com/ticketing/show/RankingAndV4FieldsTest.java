package com.ticketing.show;

import static org.assertj.core.api.Assertions.assertThat;

import java.time.Duration;
import java.time.Instant;
import java.util.List;
import java.util.UUID;

import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;

import com.ticketing.reservation.PaymentMethod;
import com.ticketing.reservation.ReservationView;
import com.ticketing.show.ShowViews.RankingItem;
import com.ticketing.show.ShowViews.Rankings;
import com.ticketing.support.TestApp;

/** v4: 기간별 랭킹(판매 좌석 수·점유율), 지역 필터, venueInfo, 결제 수단 기본값. */
class RankingAndV4FieldsTest {

    private static final Instant NOW = Instant.parse("2026-11-24T03:00:00Z");

    private TestApp app;
    private long a; // CONCERT
    private long b; // MUSICAL
    private long c; // CONCERT
    private long pa;
    private long pb;
    private long pc;
    private int users;

    @BeforeEach
    void setUp() {
        app = new TestApp(NOW.minus(Duration.ofDays(10)), 100); // 10일 전부터 시작해 시계를 앞으로 돌린다
        Instant opens = NOW.minus(Duration.ofDays(30));
        a = app.store.addShow("콘서트 A", Genre.CONCERT, opens, "서울");
        b = app.store.addShow("뮤지컬 B", Genre.MUSICAL, opens, "부산");
        c = app.store.addShow("콘서트 C", Genre.CONCERT, opens, "부산");
        pa = app.store.addPerformance(a, NOW.plus(Duration.ofDays(30)));
        pb = app.store.addPerformance(b, NOW.plus(Duration.ofDays(30)));
        pc = app.store.addPerformance(c, NOW.plus(Duration.ofDays(30)));
    }

    /** 새 계정으로 대기열 → 선점 → 확정. 좌석은 그 회차 앞에서부터 아직 안 팔린 것. */
    private ReservationView book(long perf, int seats) {
        long user = app.user("u" + (users++) + "@x.com");
        String token = app.queue.enter(user, perf).queueToken();
        List<Long> free = app.store.seats.values().stream()
                .filter(s -> s.performanceId == perf && s.status == com.ticketing.seat.SeatRepository.Status.AVAILABLE)
                .map(s -> s.id).limit(seats).toList();
        String hold = app.seatService.hold(user, token, perf, free).holdId();
        return app.reservationService.confirm(user, token, UUID.randomUUID().toString(), hold);
    }

    private void bookAll() {
        book(pa, 4);                                      // 10일 전: A 4석
        app.store.clock.advance(Duration.ofDays(7));      // 3일 전
        book(pb, 2);                                      // B 2석
        app.store.clock.advance(Duration.ofDays(3).minusHours(1)); // 1시간 전
        book(pc, 1);                                      // C 1석
        book(pa, 1);                                      // A 1석
        app.store.clock.advance(Duration.ofHours(1));     // 지금
    }

    private static List<Object[]> view(Rankings r) {
        return r.items().stream().map(i -> new Object[] {i.rank(), i.show().title(), i.share()}).toList();
    }

    @Test
    void 기간마다_판매_좌석_수로_순위가_달라지고_점유율은_소수_첫째_자리() {
        bookAll();
        Rankings all = app.showService.rankings(null, RankingPeriod.ALL);
        assertThat(view(all)).containsExactly(new Object[] {1, "콘서트 A", 62.5}, new Object[] {2, "뮤지컬 B", 25.0},
                new Object[] {3, "콘서트 C", 12.5});
        assertThat(all.rankedAt()).isEqualTo(NOW);
        assertThat(all.period()).isEqualTo(RankingPeriod.ALL);

        Rankings weekly = app.showService.rankings(null, null); // 기본 WEEKLY: A의 10일 전 4석은 빠진다
        assertThat(weekly.period()).isEqualTo(RankingPeriod.WEEKLY);
        assertThat(view(weekly)).containsExactly(new Object[] {1, "뮤지컬 B", 50.0}, new Object[] {2, "콘서트 A", 25.0},
                new Object[] {3, "콘서트 C", 25.0}); // A·C 동률 → 공연 id 오름차순

        Rankings daily = app.showService.rankings(null, RankingPeriod.DAILY);
        assertThat(view(daily)).containsExactly(new Object[] {1, "콘서트 A", 50.0}, new Object[] {2, "콘서트 C", 50.0});
    }

    @Test
    void 장르_조건이면_그_장르_안에서_점유율을_계산하고_취소와_판매_0인_공연은_뺀다() {
        bookAll();
        Rankings concert = app.showService.rankings(Genre.CONCERT, RankingPeriod.ALL);
        assertThat(view(concert)).containsExactly(new Object[] {1, "콘서트 A", 83.3}, new Object[] {2, "콘서트 C", 16.7});

        String bCode = app.store.reservations.values().stream().filter(r -> r.showId() == b).findFirst().orElseThrow().code();
        long bOwner = app.reservations.owner.entrySet().stream()
                .filter(e -> app.store.reservations.get(e.getKey()).code().equals(bCode)).findFirst().orElseThrow().getValue();
        app.reservationService.cancel(bOwner, bCode);
        assertThat(app.showService.rankings(null, RankingPeriod.ALL).items()).extracting(i -> i.show().id())
                .containsExactly(a, c);
        assertThat(app.showService.rankings(Genre.CLASSIC, RankingPeriod.ALL).items()).isEmpty();
    }

    @Test
    void 판매가_없으면_빈_목록이고_rankedAt은_지금() {
        Rankings r = app.showService.rankings(null, RankingPeriod.WEEKLY);
        assertThat(r.items()).isEmpty();
        assertThat(r.rankedAt()).isEqualTo(NOW.minus(Duration.ofDays(10)));
    }

    @Test
    void 랭킹_항목의_공연_요약에는_v4_필드가_있다() {
        bookAll();
        RankingItem first = app.showService.rankings(null, RankingPeriod.ALL).items().get(0);
        assertThat(first.show().tagline()).isEqualTo("한 줄 소개");
        assertThat(first.show().region()).isEqualTo("서울");
        assertThat(first.show().createdAt()).isNotNull();
    }

    @Test
    void 지역은_정확히_일치로_거르고_상세의_venueInfo는_회차_하나의_좌석_수() {
        assertThat(app.showService.list(new ShowService.Query(null, null, null, null, "부산")))
                .extracting(ShowViews.ShowSummary::id).containsExactlyInAnyOrder(b, c);
        assertThat(app.showService.list(new ShowService.Query(null, null, null, null, "부"))).isEmpty();
        assertThat(app.showService.list(new ShowService.Query(null, null, null, null, " "))).hasSize(3);

        app.store.addPerformance(a, NOW.plus(Duration.ofDays(31))); // 회차가 둘이어도 회차 하나의 좌석 수
        ShowViews.ShowDetail d = app.showService.get(a);
        assertThat(d.venueInfo()).isEqualTo(new ShowViews.VenueInfo("테스트홀", "서울", 8));
        assertThat(d.tagline()).isEqualTo("한 줄 소개");
    }

    @Test
    void 결제_수단은_없으면_CARD이고_고른_값이_기록되며_멱등_재전송은_처음_값() {
        ReservationView card = book(pa, 1);
        assertThat(card.paymentMethod()).isEqualTo(PaymentMethod.CARD);

        long user = app.user("pay@x.com");
        String token = app.queue.enter(user, pb).queueToken();
        long seat = app.store.seatIds(pb).get(0);
        String hold = app.seatService.hold(user, token, pb, List.of(seat)).holdId();
        String key = UUID.randomUUID().toString();
        ReservationView easy = app.reservationService.confirm(user, token, key, hold, PaymentMethod.EASY_PAY);
        assertThat(easy.paymentMethod()).isEqualTo(PaymentMethod.EASY_PAY);
        assertThat(app.reservationService.confirm(user, token, key, hold, PaymentMethod.BANK_TRANSFER).paymentMethod())
                .isEqualTo(PaymentMethod.EASY_PAY);
        assertThat(app.reservationService.myReservations(user)).extracting(ReservationView::paymentMethod)
                .containsExactly(PaymentMethod.EASY_PAY);
    }
}
