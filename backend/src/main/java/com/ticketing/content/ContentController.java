package com.ticketing.content;

import java.util.List;
import java.util.Locale;
import java.util.Set;

import jakarta.servlet.http.HttpServletRequest;

import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PathVariable;
import org.springframework.web.bind.annotation.RequestParam;
import org.springframework.web.bind.annotation.RestController;

import com.ticketing.common.ApiError;
import com.ticketing.common.ApiException;
import com.ticketing.common.ErrorCode;

/** v4 배너·공지(로그인 불필요). 정의되지 않은 쿼리 파라미터는 /api/shows처럼 400으로 거부한다. */
@RestController
public class ContentController {

    private static final Set<String> NOTICE_QUERY = Set.of("category", "page", "size");
    private static final int MAX_PAGE = 10_000;

    private final ContentService service;

    public ContentController(ContentService service) {
        this.service = service;
    }

    @GetMapping("/api/banners")
    public ContentViews.BannerList banners(HttpServletRequest request) {
        if (!request.getParameterMap().isEmpty()) {
            throw invalid("query", "배너 목록에는 조건을 줄 수 없습니다.");
        }
        return new ContentViews.BannerList(service.banners());
    }

    @GetMapping("/api/notices")
    public ContentViews.NoticePage notices(HttpServletRequest request,
            @RequestParam(required = false) String category,
            @RequestParam(required = false) String page,
            @RequestParam(required = false) String size) {
        for (String name : request.getParameterMap().keySet()) {
            if (!NOTICE_QUERY.contains(name)) {
                throw invalid("query", "지원하지 않는 조건입니다: " + (name.matches("^[A-Za-z0-9_]{1,30}$") ? name : "?"));
            }
        }
        ContentViews.NoticeCategory c = null;
        if (category != null && !category.isBlank()) {
            try {
                c = ContentViews.NoticeCategory.valueOf(category.trim().toUpperCase(Locale.ROOT));
            } catch (IllegalArgumentException e) {
                throw invalid("category", "공지 분류는 TICKET_OPEN, SERVICE 중 하나여야 합니다.");
            }
        }
        int p = number(page, 1, 1, MAX_PAGE, "page", "page는 1 이상의 정수여야 합니다.");
        int s = number(size, ContentService.DEFAULT_PAGE_SIZE, 1, ContentService.MAX_PAGE_SIZE, "size",
                "size는 1~50 사이의 정수여야 합니다.");
        return service.notices(c, p, s);
    }

    @GetMapping("/api/notices/{id}")
    public ContentViews.Notice notice(@PathVariable long id) {
        if (id <= 0) {
            throw new ApiException(ErrorCode.NOTICE_NOT_FOUND);
        }
        return service.notice(id);
    }

    /** 빈 값은 기본값. 숫자가 아니거나 범위를 벗어나면 400. */
    static int number(String raw, int fallback, int min, int max, String field, String message) {
        if (raw == null || raw.isBlank()) {
            return fallback;
        }
        String v = raw.trim();
        if (!v.matches("^[0-9]{1,6}$")) {
            throw invalid(field, message);
        }
        int n = Integer.parseInt(v);
        if (n < min || n > max) {
            throw invalid(field, message);
        }
        return n;
    }

    private static ApiException invalid(String field, String message) {
        return new ApiException(ErrorCode.VALIDATION_ERROR, message, List.of(new ApiError.FieldViolation(field, message)));
    }
}
