package com.ticketing.content;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;

import java.time.Clock;
import java.time.Instant;
import java.time.ZoneOffset;
import java.util.ArrayList;
import java.util.Comparator;
import java.util.List;
import java.util.Optional;

import org.junit.jupiter.api.Test;

import com.ticketing.common.ErrorCode;
import com.ticketing.content.ContentViews.NoticeCategory;
import com.ticketing.content.ContentViews.NoticeSummary;

/** v4 공지 페이지 나눔 규칙(1부터, 빈 결과, 마지막 쪽 넘김)과 배너 개수 제한. SQL 정렬·기간은 통합 테스트가 확인한다. */
class ContentServiceTest {

    private static final Instant NOW = Instant.parse("2026-11-24T03:00:00Z");

    /** 고정 → 최신순 정렬과 게시 시각 필터를 흉내 낸 가짜 저장소. */
    static final class FakeContent implements ContentRepository {
        final List<ContentViews.Notice> notices = new ArrayList<>();
        final List<ContentViews.Banner> banners = new ArrayList<>();
        int lastLimit;

        void notice(long id, NoticeCategory c, boolean pinned, Instant at) {
            notices.add(new ContentViews.Notice(id, c, "공지 " + id, pinned, at, null, null, "본문"));
        }

        private List<ContentViews.Notice> visible(NoticeCategory c, Instant now) {
            return notices.stream().filter(n -> (c == null || n.category() == c) && !n.publishedAt().isAfter(now))
                    .sorted(Comparator.comparing(ContentViews.Notice::pinned).reversed()
                            .thenComparing(ContentViews.Notice::publishedAt, Comparator.reverseOrder())
                            .thenComparing(ContentViews.Notice::id, Comparator.reverseOrder()))
                    .toList();
        }

        @Override
        public List<ContentViews.Banner> findActiveBanners(Instant now, int limit) {
            lastLimit = limit;
            return banners.stream().limit(limit).toList();
        }

        @Override
        public long countNotices(NoticeCategory category, Instant now) {
            return visible(category, now).size();
        }

        @Override
        public List<NoticeSummary> findNotices(NoticeCategory category, Instant now, int offset, int limit) {
            return visible(category, now).stream().skip(offset).limit(limit)
                    .map(n -> new NoticeSummary(n.id(), n.category(), n.title(), n.pinned(), n.publishedAt(),
                            n.ticketOpenAt(), n.showId()))
                    .toList();
        }

        @Override
        public Optional<ContentViews.Notice> findNotice(long id, Instant now) {
            return visible(null, now).stream().filter(n -> n.id() == id).findFirst();
        }
    }

    private final FakeContent repo = new FakeContent();
    private final ContentService service = new ContentService(repo, Clock.fixed(NOW, ZoneOffset.UTC));

    @Test
    void 공지가_없으면_빈_목록_totalCount_0_totalPages_0() {
        ContentViews.NoticePage p = service.notices(null, 1, 20);
        assertThat(p.notices()).isEmpty();
        assertThat(p.totalCount()).isZero();
        assertThat(p.totalPages()).isZero();
        assertThat(p.page()).isEqualTo(1);
    }

    @Test
    void 쪽은_1부터이고_고정_공지가_먼저_마지막_쪽을_넘기면_빈_목록과_실제_totalPages() {
        for (int i = 1; i <= 5; i++) {
            repo.notice(i, NoticeCategory.SERVICE, false, NOW.minusSeconds(100 - i));
        }
        repo.notice(6, NoticeCategory.SERVICE, true, NOW.minusSeconds(1000)); // 오래됐어도 고정이라 맨 앞
        repo.notice(7, NoticeCategory.TICKET_OPEN, false, NOW.minusSeconds(10));
        repo.notice(8, NoticeCategory.SERVICE, false, NOW.plusSeconds(60));  // 게시 전 → 안 보임

        ContentViews.NoticePage first = service.notices(null, 1, 3);
        assertThat(first.notices()).extracting(NoticeSummary::id).containsExactly(6L, 7L, 5L);
        assertThat(first.totalCount()).isEqualTo(7);
        assertThat(first.totalPages()).isEqualTo(3);
        assertThat(service.notices(null, 3, 3).notices()).extracting(NoticeSummary::id).containsExactly(1L);
        ContentViews.NoticePage beyond = service.notices(null, 4, 3);
        assertThat(beyond.notices()).isEmpty();
        assertThat(beyond.totalPages()).isEqualTo(3);
        assertThat(service.notices(NoticeCategory.TICKET_OPEN, 1, 20).notices()).extracting(NoticeSummary::id)
                .containsExactly(7L);
    }

    @Test
    void 게시_전이거나_없는_공지는_NOTICE_NOT_FOUND() {
        repo.notice(1, NoticeCategory.SERVICE, false, NOW.plusSeconds(60));
        assertThatThrownBy(() -> service.notice(1)).extracting("code").isEqualTo(ErrorCode.NOTICE_NOT_FOUND);
        assertThatThrownBy(() -> service.notice(99)).extracting("code").isEqualTo(ErrorCode.NOTICE_NOT_FOUND);
    }

    @Test
    void 배너는_최대_6개만_요청한다() {
        service.banners();
        assertThat(repo.lastLimit).isEqualTo(6);
    }
}
