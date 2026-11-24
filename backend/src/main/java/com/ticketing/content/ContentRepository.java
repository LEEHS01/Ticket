package com.ticketing.content;

import java.time.Instant;
import java.util.List;
import java.util.Optional;

public interface ContentRepository {

    /** 노출 기간(starts_at ≤ now < ends_at, NULL은 제한 없음) 안의 배너를 sort_order·id 순으로 최대 limit개. */
    List<ContentViews.Banner> findActiveBanners(Instant now, int limit);

    /** 게시된(published_at ≤ now) 공지 수. category가 null이면 전체. */
    long countNotices(ContentViews.NoticeCategory category, Instant now);

    /** 고정 공지 먼저, 그다음 게시 시각 최신순(같으면 id 큰 순). */
    List<ContentViews.NoticeSummary> findNotices(ContentViews.NoticeCategory category, Instant now, int offset, int limit);

    /** 게시된 공지 하나. 게시 전이면 비어 있다. */
    Optional<ContentViews.Notice> findNotice(long id, Instant now);
}
