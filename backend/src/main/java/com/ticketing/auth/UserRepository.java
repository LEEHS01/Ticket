package com.ticketing.auth;

import java.time.Duration;
import java.util.Optional;

public interface UserRepository {

    /**
     * failedLogins: 지금 기억 중인 연속 로그인 실패 횟수(기억 시간이 지났으면 0).
     * failureWindow: 실패 기억이 끝나는 시각까지 남은 시간(없으면 0). failedLogins가 기준 이상이면 = 잠금 남은 시간.
     * 둘 다 DB 시계(NOW(3)) 기준으로 계산해 온다.
     */
    record UserRow(long id, String email, String name, String passwordHash, boolean loginEnabled,
                   int failedLogins, Duration failureWindow) {

        public UserRow(long id, String email, String name, String passwordHash, boolean loginEnabled) {
            this(id, email, name, passwordHash, loginEnabled, 0, Duration.ZERO);
        }
    }

    /** 실패 기록 직후의 상태: 횟수와 기억이 끝날 때까지 남은 시간. */
    record LoginFailures(int count, Duration remaining) {
    }

    /** 생성된 id. 이메일이 이미 있으면 DuplicateKeyException(유니크 제약 = 가입 경쟁의 최종 방어선). */
    long insert(String email, String passwordHash, String name);

    Optional<UserRow> findByEmail(String normalizedEmail);

    Optional<UserRow> findById(long id);

    /** 시드 전용: 있으면 비밀번호·이름을 바꾸고 로그인 가능으로, 없으면 만든다. */
    void upsertDemo(String email, String passwordHash, String name);

    /**
     * 로그인 실패 1회 기록(원자적 UPDATE). 기억 시간이 지났으면 1부터 다시 센다. 기억 시간은 지금 + window로 다시 잡는다.
     * (Redis의 INCR + PEXPIRE와 같은 규칙. 시각은 DB 시계)
     */
    LoginFailures recordLoginFailure(long userId, Duration window);

    /** 로그인 성공: 실패 횟수 초기화. */
    void resetLoginFailures(long userId);
}
