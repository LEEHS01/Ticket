package com.ticketing.content;

import java.time.Clock;
import java.time.Instant;
import java.util.List;

import org.springframework.stereotype.Service;

import com.ticketing.common.ApiException;
import com.ticketing.common.ErrorCode;

/** v4 홈 배너·공지. MySQL만 쓰므로 Redis가 죽어도 동작한다. 공지 본문은 일반 텍스트 그대로(HTML로 해석하지 않음). */
@Service
public class ContentService {

    public static final int MAX_BANNERS = 6;
    public static final int DEFAULT_PAGE_SIZE = 20;
    public static final int MAX_PAGE_SIZE = 50;

    private final ContentRepository content;
    private final Clock clock;

    public ContentService(ContentRepository content, Clock clock) {
        this.content = content;
        this.clock = clock;
    }

    public List<ContentViews.Banner> banners() {
        return content.findActiveBanners(clock.instant(), MAX_BANNERS);
    }

    /** page는 1부터(검증은 컨트롤러). 마지막 쪽을 넘긴 page는 빈 목록과 실제 totalPages를 돌려준다. */
    public ContentViews.NoticePage notices(ContentViews.NoticeCategory category, int page, int size) {
        Instant now = clock.instant();
        long total = content.countNotices(category, now);
        int totalPages = (int) ((total + size - 1) / size);
        List<ContentViews.NoticeSummary> items = total == 0 || page > totalPages ? List.of()
                : content.findNotices(category, now, (page - 1) * size, size);
        return new ContentViews.NoticePage(items, page, totalPages, total);
    }

    public ContentViews.Notice notice(long id) {
        return content.findNotice(id, clock.instant()).orElseThrow(() -> new ApiException(ErrorCode.NOTICE_NOT_FOUND));
    }
}
