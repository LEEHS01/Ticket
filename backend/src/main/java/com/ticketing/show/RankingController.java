package com.ticketing.show;

import java.util.Set;

import jakarta.servlet.http.HttpServletRequest;

import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.RequestParam;
import org.springframework.web.bind.annotation.RestController;

/** v4 랭킹(로그인 불필요, MySQL만 사용 → Redis가 죽어도 동작). */
@RestController
public class RankingController {

    private static final Set<String> ALLOWED_QUERY = Set.of("genre", "period");

    private final ShowService service;

    public RankingController(ShowService service) {
        this.service = service;
    }

    @GetMapping("/api/rankings")
    public ShowViews.Rankings rankings(HttpServletRequest request,
            @RequestParam(required = false) String genre,
            @RequestParam(required = false) String period) {
        for (String name : request.getParameterMap().keySet()) {
            if (!ALLOWED_QUERY.contains(name)) {
                throw ShowController.invalid("query", "지원하지 않는 조건입니다: " + ShowController.safe(name));
            }
        }
        return service.rankings(
                ShowController.parse(Genre.class, genre, "genre", "장르 값이 올바르지 않습니다."),
                ShowController.parse(RankingPeriod.class, period, "period", "기간은 DAILY, WEEKLY, ALL 중 하나여야 합니다."));
    }
}
