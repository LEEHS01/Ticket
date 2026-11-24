package com.ticketing.auth;

import java.io.IOException;
import java.util.HashMap;
import java.util.Map;

import jakarta.servlet.Filter;
import jakarta.servlet.FilterChain;
import jakarta.servlet.ServletException;
import jakarta.servlet.ServletRequest;
import jakarta.servlet.ServletResponse;

/**
 * 요청 하나 동안만 유효한 "세션 ID → 조회 결과" 캐시. Spring Session 필터 바로 앞에서 열고 요청이 끝나면 버린다.
 * <p>
 * 왜: Spring Session 필터는 응답이 커밋될 때 한 번, 필터가 끝날 때(finally) 한 번 세션을 커밋하는데,
 * 두 번째 커밋이 요청에 실린 세션 ID를 다시 확인하느라 같은 세션을 DB에서 한 번 더 읽는다(실측: 요청마다 SELECT 2번).
 * 같은 요청 안의 두 번째 조회는 이 캐시로 답해 <b>요청당 세션 조회를 1번</b>으로 줄인다.
 * 요청이 끝나면 버리므로 서버 메모리에 사용자 상태가 남지 않는다.
 */
public final class SessionLookupCache implements Filter {

    private static final ThreadLocal<Map<String, Object>> CURRENT = new ThreadLocal<>();
    /** "찾아봤는데 없었다"도 캐시한다(만료·삭제된 세션 쿠키로 온 요청). */
    static final Object NOT_FOUND = new Object();

    @Override
    public void doFilter(ServletRequest request, ServletResponse response, FilterChain chain)
            throws IOException, ServletException {
        if (CURRENT.get() != null) {
            chain.doFilter(request, response); // 안쪽 디스패치(오류 페이지 등)는 바깥 캐시를 그대로 쓴다
            return;
        }
        CURRENT.set(new HashMap<>());
        try {
            chain.doFilter(request, response);
        } finally {
            CURRENT.remove();
        }
    }

    /** 이 요청에서 이미 조회한 결과. 없으면 null, "없었음"이면 {@link #NOT_FOUND}. */
    static Object get(String sessionId) {
        Map<String, Object> m = CURRENT.get();
        return m == null ? null : m.get(sessionId);
    }

    static void put(String sessionId, Object sessionOrNotFound) {
        Map<String, Object> m = CURRENT.get();
        if (m != null) {
            m.put(sessionId, sessionOrNotFound);
        }
    }

    static void evict(String sessionId) {
        Map<String, Object> m = CURRENT.get();
        if (m != null) {
            m.remove(sessionId);
        }
    }

    /** 세션 ID가 바뀌었으면(로그인) 옛 ID로 캐시된 항목을 버린다. */
    static void evictStale(Object session, String currentId) {
        Map<String, Object> m = CURRENT.get();
        if (m != null) {
            m.entrySet().removeIf(e -> e.getValue() == session && !e.getKey().equals(currentId));
        }
    }
}
