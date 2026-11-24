package com.ticketing.content;

import java.sql.ResultSet;
import java.sql.SQLException;
import java.sql.Timestamp;
import java.time.Instant;
import java.util.List;
import java.util.Optional;

import org.springframework.jdbc.core.simple.JdbcClient;
import org.springframework.stereotype.Repository;

/** 배너·공지(MySQL만). 고정 SQL + 이름 있는 매개변수 바인딩만 쓴다. */
@Repository
public class JdbcContentRepository implements ContentRepository {

    private final JdbcClient jdbc;

    public JdbcContentRepository(JdbcClient jdbc) {
        this.jdbc = jdbc;
    }

    @Override
    public List<ContentViews.Banner> findActiveBanners(Instant now, int limit) {
        return jdbc.sql("""
                        SELECT id, show_id, eyebrow, title, subtitle, image_url, mobile_image_url
                          FROM banners
                         WHERE (starts_at IS NULL OR starts_at <= :now)
                           AND (ends_at IS NULL OR ends_at > :now)
                         ORDER BY sort_order, id
                         LIMIT :limit
                        """)
                .param("now", Timestamp.from(now)).param("limit", limit)
                .query((rs, n) -> new ContentViews.Banner(rs.getLong("id"), rs.getLong("show_id"), rs.getString("eyebrow"),
                        rs.getString("title"), rs.getString("subtitle"), rs.getString("image_url"),
                        rs.getString("mobile_image_url")))
                .list();
    }

    @Override
    public long countNotices(ContentViews.NoticeCategory category, Instant now) {
        return jdbc.sql("""
                        SELECT COUNT(*) FROM notices
                         WHERE (:category IS NULL OR category = :category) AND published_at <= :now
                        """)
                .param("category", category == null ? null : category.name()).param("now", Timestamp.from(now))
                .query(Long.class).single();
    }

    @Override
    public List<ContentViews.NoticeSummary> findNotices(ContentViews.NoticeCategory category, Instant now, int offset,
            int limit) {
        return jdbc.sql("""
                        SELECT id, category, title, pinned, published_at, ticket_open_at, show_id
                          FROM notices
                         WHERE (:category IS NULL OR category = :category) AND published_at <= :now
                         ORDER BY pinned DESC, published_at DESC, id DESC
                         LIMIT :limit OFFSET :offset
                        """)
                .param("category", category == null ? null : category.name()).param("now", Timestamp.from(now))
                .param("limit", limit).param("offset", offset)
                .query((rs, n) -> new ContentViews.NoticeSummary(rs.getLong("id"),
                        ContentViews.NoticeCategory.valueOf(rs.getString("category")), rs.getString("title"),
                        rs.getBoolean("pinned"), instant(rs, "published_at"), instant(rs, "ticket_open_at"),
                        nullableLong(rs, "show_id")))
                .list();
    }

    @Override
    public Optional<ContentViews.Notice> findNotice(long id, Instant now) {
        return jdbc.sql("""
                        SELECT id, category, title, pinned, published_at, ticket_open_at, show_id, body
                          FROM notices WHERE id = :id AND published_at <= :now
                        """)
                .param("id", id).param("now", Timestamp.from(now))
                .query((rs, n) -> new ContentViews.Notice(rs.getLong("id"),
                        ContentViews.NoticeCategory.valueOf(rs.getString("category")), rs.getString("title"),
                        rs.getBoolean("pinned"), instant(rs, "published_at"), instant(rs, "ticket_open_at"),
                        nullableLong(rs, "show_id"), rs.getString("body")))
                .optional();
    }

    private static Instant instant(ResultSet rs, String column) throws SQLException {
        Timestamp t = rs.getTimestamp(column);
        return t == null ? null : t.toInstant();
    }

    private static Long nullableLong(ResultSet rs, String column) throws SQLException {
        long v = rs.getLong(column);
        return rs.wasNull() ? null : v;
    }
}
