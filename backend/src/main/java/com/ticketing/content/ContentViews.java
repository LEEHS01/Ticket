package com.ticketing.content;

import java.time.Instant;
import java.util.List;

/** v4 배너·공지 응답 자료형(docs/next/API-v4.md 1장). */
public final class ContentViews {

    private ContentViews() {
    }

    public enum NoticeCategory { TICKET_OPEN, SERVICE }

    public record Banner(long id, long showId, String eyebrow, String title, String subtitle, String imageUrl,
                         String mobileImageUrl) {
    }

    public record BannerList(List<Banner> banners) {
    }

    public record NoticeSummary(long id, NoticeCategory category, String title, boolean pinned, Instant publishedAt,
                                Instant ticketOpenAt, Long showId) {
    }

    /** NoticeSummary의 모든 필드 + body(일반 텍스트). */
    public record Notice(long id, NoticeCategory category, String title, boolean pinned, Instant publishedAt,
                         Instant ticketOpenAt, Long showId, String body) {
    }

    /** page는 1부터. 결과가 없으면 notices = [], totalCount = 0, totalPages = 0. 마지막 쪽을 넘긴 page는 빈 목록. */
    public record NoticePage(List<NoticeSummary> notices, int page, int totalPages, long totalCount) {
    }
}
