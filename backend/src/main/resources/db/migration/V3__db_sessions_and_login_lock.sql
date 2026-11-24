-- next: "잃으면 안 되는 상태"를 MySQL로 옮긴다(로그인 세션, 로그인 실패 잠금). 대기열·선점·멱등키·요청 제한은 Redis 그대로.
-- V1·V2는 고치지 않고 위에 쌓는다.

-- 1) 로그인 세션(Spring Session JDBC). 구조는 spring-session-jdbc의 schema-mysql.sql과 같고,
--    식별자 열만 ascii_bin으로 좁혔다(UUID 36자 = 36바이트, 대소문자를 구분해 정확히 비교).
--    한 세션 = SPRING_SESSION 1행 + 속성마다 SPRING_SESSION_ATTRIBUTES 1행(이 서비스는 uid, csrf 2개).
--    시각 열(…_TIME)은 epoch 밀리초(BIGINT). Spring Session이 이 이름·형식을 그대로 쓴다.
CREATE TABLE SPRING_SESSION (
    PRIMARY_ID             CHAR(36)     CHARACTER SET ascii COLLATE ascii_bin NOT NULL, -- 바뀌지 않는 내부 키(세션 ID가 바뀌어도 유지)
    SESSION_ID             CHAR(36)     CHARACTER SET ascii COLLATE ascii_bin NOT NULL, -- 쿠키 값(base64 해제). 로그인 때 재발급
    CREATION_TIME          BIGINT       NOT NULL,
    LAST_ACCESS_TIME       BIGINT       NOT NULL, -- 갱신은 최대 SESSION_TOUCH_SECONDS 간격(쓰기 줄이기)
    MAX_INACTIVE_INTERVAL  INT          NOT NULL, -- 초
    EXPIRY_TIME            BIGINT       NOT NULL, -- LAST_ACCESS_TIME + MAX_INACTIVE_INTERVAL
    PRINCIPAL_NAME         VARCHAR(100) NULL,     -- 쓰지 않음(Spring Security 미사용). Spring Session 스키마 호환용
    CONSTRAINT SPRING_SESSION_PK PRIMARY KEY (PRIMARY_ID)
) ENGINE = InnoDB ROW_FORMAT = DYNAMIC DEFAULT CHARSET = utf8mb4 COLLATE = utf8mb4_0900_ai_ci;

CREATE UNIQUE INDEX SPRING_SESSION_IX1 ON SPRING_SESSION (SESSION_ID);   -- 요청마다 쿠키로 찾는다
CREATE INDEX SPRING_SESSION_IX2 ON SPRING_SESSION (EXPIRY_TIME);         -- 만료 세션 정리
CREATE INDEX SPRING_SESSION_IX3 ON SPRING_SESSION (PRINCIPAL_NAME);      -- Spring Session 호환(이 서비스는 조회하지 않음)

CREATE TABLE SPRING_SESSION_ATTRIBUTES (
    SESSION_PRIMARY_ID  CHAR(36)     CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
    ATTRIBUTE_NAME      VARCHAR(200) NOT NULL,
    ATTRIBUTE_BYTES     BLOB         NOT NULL, -- JDK 직렬화(Long uid, String csrf)
    CONSTRAINT SPRING_SESSION_ATTRIBUTES_PK PRIMARY KEY (SESSION_PRIMARY_ID, ATTRIBUTE_NAME),
    CONSTRAINT SPRING_SESSION_ATTRIBUTES_FK FOREIGN KEY (SESSION_PRIMARY_ID)
        REFERENCES SPRING_SESSION (PRIMARY_ID) ON DELETE CASCADE           -- 세션을 지우면 속성도 함께
) ENGINE = InnoDB ROW_FORMAT = DYNAMIC DEFAULT CHARSET = utf8mb4 COLLATE = utf8mb4_0900_ai_ci;

-- 2) 로그인 실패 잠금(계정별). Redis의 auth:fail:{해시} 키(횟수 + TTL)를 열 두 개로 옮긴 것이다.
--    failed_login_until = "이 시각까지 실패 횟수를 기억한다". 실패할 때마다 지금 + 15분으로 다시 잡는다.
--    횟수가 5 이상이면 이 시각이 곧 잠금 해제 시각이다. 이 시각이 지나면 횟수는 0으로 본다(지우는 작업이 없어도 된다).
--    시각 비교는 앱 서버가 아니라 DB의 NOW(3) 하나로 한다(서버마다 시계가 달라도 같은 결과).
ALTER TABLE users
    ADD COLUMN failed_login_count INT         NOT NULL DEFAULT 0 AFTER login_enabled,
    ADD COLUMN failed_login_until DATETIME(3) NULL AFTER failed_login_count; -- UTC
