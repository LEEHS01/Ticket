package com.ticketing.auth;

import java.time.Duration;
import java.time.Instant;
import java.util.Set;

import org.springframework.session.Session;
import org.springframework.session.SessionRepository;

/**
 * Spring Session 저장소를 감싸 세션 테이블 쓰기를 줄인다.
 * <ul>
 *   <li>Spring Session은 요청마다 {@code setLastAccessedTime(now)}를 부르고, JDBC 저장소는 그때마다 UPDATE 한다.
 *       여기서는 저장된 마지막 접근 시각보다 {@code touchInterval} 이상 지났을 때만 반영한다
 *       → 1분 안의 연속 요청은 세션 테이블에 쓰지 않는다(SELECT 1번으로 끝).</li>
 *   <li>그 밖의 변경(속성 추가·변경·삭제, 세션 ID 재발급, 새 세션)은 그대로 넘긴다. JDBC 저장소는 바뀐 것이 없으면 아무 SQL도 보내지 않는다.</li>
 *   <li>한 요청 안의 같은 세션 재조회는 DB에 가지 않는다({@link SessionLookupCache}) → 요청당 세션 SELECT 1번.</li>
 *   <li>조회(findById)는 트랜잭션 없이 SELECT 한 번(autocommit)으로 한다({@link SessionTransactions}).
 *       쓰기(save·deleteById)만 트랜잭션으로 묶는다(세션 행 + 속성 행을 함께 쓰기 때문).</li>
 * </ul>
 * 대가: 유휴 만료가 최대 {@code touchInterval}만큼 일찍 올 수 있다(30분 유휴 기준 최대 1분).
 */
public class ThrottledSessionRepository<S extends Session>
        implements SessionRepository<ThrottledSessionRepository.ThrottledSession<S>> {

    private final SessionRepository<S> delegate;
    private final Duration touchInterval;

    public ThrottledSessionRepository(SessionRepository<S> delegate, Duration touchInterval) {
        this.delegate = delegate;
        this.touchInterval = touchInterval;
    }

    @Override
    public ThrottledSession<S> createSession() {
        return new ThrottledSession<>(delegate.createSession(), touchInterval);
    }

    @Override
    public void save(ThrottledSession<S> session) {
        delegate.save(session.delegate);
        SessionLookupCache.evictStale(session, session.getId());
    }

    /** 같은 요청 안에서 같은 세션을 다시 찾으면 DB에 가지 않는다({@link SessionLookupCache}). */
    @Override
    @SuppressWarnings("unchecked")
    public ThrottledSession<S> findById(String id) {
        Object cached = SessionLookupCache.get(id);
        if (cached == SessionLookupCache.NOT_FOUND) {
            return null;
        }
        if (cached != null) {
            return (ThrottledSession<S>) cached;
        }
        S found = SessionTransactions.readOnly(() -> delegate.findById(id));
        ThrottledSession<S> session = found == null ? null : new ThrottledSession<>(found, touchInterval);
        SessionLookupCache.put(id, session == null ? SessionLookupCache.NOT_FOUND : session);
        return session;
    }

    @Override
    public void deleteById(String id) {
        SessionLookupCache.evict(id);
        delegate.deleteById(id);
    }

    /** 마지막 접근 시각 갱신만 간격을 두고, 나머지는 그대로 위임한다. */
    public static final class ThrottledSession<S extends Session> implements Session {

        private final S delegate;
        private final Duration touchInterval;

        ThrottledSession(S delegate, Duration touchInterval) {
            this.delegate = delegate;
            this.touchInterval = touchInterval;
        }

        @Override
        public void setLastAccessedTime(Instant lastAccessedTime) {
            Instant stored = delegate.getLastAccessedTime();
            if (stored == null || !lastAccessedTime.isBefore(stored.plus(touchInterval))) {
                delegate.setLastAccessedTime(lastAccessedTime);
            }
        }

        @Override
        public String getId() {
            return delegate.getId();
        }

        @Override
        public String changeSessionId() {
            return delegate.changeSessionId();
        }

        @Override
        public <T> T getAttribute(String attributeName) {
            return delegate.getAttribute(attributeName);
        }

        @Override
        public Set<String> getAttributeNames() {
            return delegate.getAttributeNames();
        }

        @Override
        public void setAttribute(String attributeName, Object attributeValue) {
            delegate.setAttribute(attributeName, attributeValue);
        }

        @Override
        public void removeAttribute(String attributeName) {
            delegate.removeAttribute(attributeName);
        }

        @Override
        public Instant getCreationTime() {
            return delegate.getCreationTime();
        }

        @Override
        public Instant getLastAccessedTime() {
            return delegate.getLastAccessedTime();
        }

        @Override
        public void setMaxInactiveInterval(Duration interval) {
            delegate.setMaxInactiveInterval(interval);
        }

        @Override
        public Duration getMaxInactiveInterval() {
            return delegate.getMaxInactiveInterval();
        }

        @Override
        public boolean isExpired() {
            return delegate.isExpired();
        }
    }
}
