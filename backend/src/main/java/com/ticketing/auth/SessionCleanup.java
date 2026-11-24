package com.ticketing.auth;

import java.util.List;

import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.jdbc.core.simple.JdbcClient;
import org.springframework.scheduling.annotation.Scheduled;
import org.springframework.transaction.PlatformTransactionManager;
import org.springframework.transaction.TransactionDefinition;
import org.springframework.transaction.support.TransactionTemplate;

/**
 * 만료 세션 정리. <b>정합성은 이 작업에 기대지 않는다</b> — 만료된 세션은 읽을 때 Spring Session이 만료로 판단해 버리고 지운다.
 * 이 작업은 테이블이 커지지 않게 하는 청소일 뿐이다(돌지 않아도 결과는 틀리지 않는다).
 * <p>
 * 여러 서버가 같은 시각에 돌려도 안전하다:
 * <ul>
 *   <li>한 번에 {@value #BATCH}행씩 {@code SELECT … FOR UPDATE SKIP LOCKED}로 "다른 서버가 지우고 있지 않은 행"만 잡고 지운다
 *       → 서버끼리 서로 기다리거나 같은 행을 두고 교착 상태가 되지 않는다.</li>
 *   <li>READ COMMITTED라 범위 잠금(gap lock)이 없어, 정리하는 동안에도 새 세션 INSERT가 막히지 않는다.</li>
 *   <li>잠금 순서는 세션 행 → (ON DELETE CASCADE) 속성 행으로, 요청의 세션 저장과 같은 순서다.</li>
 *   <li>같은 행을 두 번 지우려 해도 결과는 같다(멱등).</li>
 * </ul>
 */
public class SessionCleanup {

    private static final Logger log = LoggerFactory.getLogger(SessionCleanup.class);
    static final int BATCH = 500;
    private static final int MAX_BATCHES_PER_RUN = 40;

    private final JdbcClient jdbc;
    private final TransactionTemplate tx;

    public SessionCleanup(JdbcClient jdbc, PlatformTransactionManager txManager) {
        this.jdbc = jdbc;
        this.tx = new TransactionTemplate(txManager);
        this.tx.setIsolationLevel(TransactionDefinition.ISOLATION_READ_COMMITTED);
        this.tx.setTimeout(10);
    }

    /** 기동 직후가 아니라 한 주기 뒤부터. 주기는 SESSION_CLEANUP_SECONDS. */
    @Scheduled(fixedDelayString = "${app.auth.session-cleanup-seconds}", initialDelayString = "${app.auth.session-cleanup-seconds}",
            timeUnit = java.util.concurrent.TimeUnit.SECONDS)
    public void run() {
        try {
            int deleted = deleteExpired();
            if (deleted > 0) {
                log.info("만료 세션 {}건 정리", deleted);
            }
        } catch (RuntimeException e) {
            // 다음 주기에 다시 한다. 정리가 늦어져도 만료 세션은 이미 무효다.
            log.warn("만료 세션 정리 실패(다음 주기에 다시 시도): {}", e.getClass().getSimpleName());
        }
    }

    /** 지운 행 수. 시각은 DB 시계(NOW(3))로 판단한다. */
    public int deleteExpired() {
        int total = 0;
        for (int i = 0; i < MAX_BATCHES_PER_RUN; i++) {
            Integer n = tx.execute(status -> {
                List<String> ids = jdbc.sql("""
                                SELECT PRIMARY_ID FROM SPRING_SESSION
                                 WHERE EXPIRY_TIME < CAST(UNIX_TIMESTAMP(NOW(3)) * 1000 AS SIGNED)
                                 ORDER BY EXPIRY_TIME
                                 LIMIT :batch
                                 FOR UPDATE SKIP LOCKED
                                """)
                        .param("batch", BATCH).query(String.class).list();
                if (ids.isEmpty()) {
                    return 0;
                }
                return jdbc.sql("DELETE FROM SPRING_SESSION WHERE PRIMARY_ID IN (:ids)").param("ids", ids).update();
            });
            int deleted = n == null ? 0 : n;
            total += deleted;
            if (deleted < BATCH) {
                break;
            }
        }
        return total;
    }
}
