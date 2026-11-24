package com.ticketing.auth;

import java.util.List;
import java.util.concurrent.ThreadLocalRandom;
import java.util.concurrent.atomic.AtomicLong;

import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.dao.PessimisticLockingFailureException;
import org.springframework.jdbc.core.simple.JdbcClient;
import org.springframework.scheduling.annotation.Scheduled;
import org.springframework.transaction.PlatformTransactionManager;
import org.springframework.transaction.TransactionDefinition;
import org.springframework.transaction.support.TransactionTemplate;

/**
 * 만료 세션 정리. <b>정합성은 이 작업에 기대지 않는다</b> — 만료된 세션은 읽을 때 Spring Session이 만료로 판단해 버리고 지운다.
 * 이 작업은 테이블이 커지지 않게 하는 청소일 뿐이다(돌지 않아도 결과는 틀리지 않는다).
 * <p>
 * 여러 서버가 같은 시각에 돌려도 결과가 같다:
 * <ul>
 *   <li>한 번에 {@value #BATCH}행씩 {@code SELECT … FOR UPDATE SKIP LOCKED}로 "다른 서버가 지우고 있지 않은 행"만 잡고 지운다
 *       → 서버끼리 같은 행을 두고 기다리지 않는다.</li>
 *   <li>그래도 속성 테이블의 외래 키 연쇄 삭제(ON DELETE CASCADE)는 READ COMMITTED에서도 간격 잠금을 쓰므로, 두 서버의 배치가
 *       겹치면 InnoDB가 드물게 교착으로 한쪽을 되돌린다(실측: 두 정리를 동시에 돌린 통합 테스트 3번 중 1번).
 *       되돌린 쪽은 아무것도 지우지 않았고 지우기는 멱등이므로, 그 배치만 잠시 쉬었다가 다시 시도한다.</li>
 *   <li>READ COMMITTED라 부모 테이블에는 범위 잠금이 없어, 정리하는 동안에도 새 세션 INSERT가 막히지 않는다.</li>
 *   <li>잠금 순서는 세션 행 → (CASCADE) 속성 행으로, 요청의 세션 저장과 같은 순서다.</li>
 * </ul>
 */
public class SessionCleanup {

    private static final Logger log = LoggerFactory.getLogger(SessionCleanup.class);
    static final int BATCH = 500;
    private static final int MAX_BATCHES_PER_RUN = 40;
    private static final int MAX_ATTEMPTS = 5;

    private final JdbcClient jdbc;
    private final TransactionTemplate tx;
    private final AtomicLong retries = new AtomicLong();

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
            int deleted = deleteBatchWithRetry();
            total += deleted;
            if (deleted < BATCH) {
                break;
            }
        }
        return total;
    }

    /** 지금까지 교착·잠금 대기 때문에 배치를 다시 시도한 횟수(관찰용). */
    public long retries() {
        return retries.get();
    }

    private int deleteBatchWithRetry() {
        for (int attempt = 1; ; attempt++) {
            try {
                return deleteBatch();
            } catch (PessimisticLockingFailureException e) {
                retries.incrementAndGet();
                if (attempt >= MAX_ATTEMPTS) {
                    throw e;
                }
                try {
                    Thread.sleep(ThreadLocalRandom.current().nextLong(20, 100) * attempt);
                } catch (InterruptedException ie) {
                    Thread.currentThread().interrupt();
                    throw e;
                }
            }
        }
    }

    private int deleteBatch() {
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
        return n == null ? 0 : n;
    }
}
