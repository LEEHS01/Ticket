package com.ticketing.it;

import static org.assertj.core.api.Assertions.assertThat;

import java.util.ArrayList;
import java.util.List;
import java.util.UUID;
import java.util.concurrent.CountDownLatch;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;
import java.util.concurrent.Future;

import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.jdbc.core.simple.JdbcClient;
import org.springframework.transaction.PlatformTransactionManager;

import com.ticketing.auth.SessionCleanup;

/**
 * 만료 세션 정리를 "서버 두 대"가 같은 순간에 돌려도: 예외·교착 없이 만료 세션만(속성까지) 지워지고 살아 있는 세션은 남는다.
 * 정리 작업 두 개를 각자의 커넥션으로 동시에 시작한다(배치 500행 × 여러 번 → SKIP LOCKED로 서로 다른 행을 가져간다).
 * 외래 키 연쇄 삭제의 간격 잠금으로 드물게 교착이 나도 배치를 다시 시도해 끝까지 지운다(5번 반복해 확인).
 */
@SpringBootTest(webEnvironment = SpringBootTest.WebEnvironment.NONE, properties = "spring.flyway.enabled=true")
class SessionCleanupIT {

    @Autowired
    JdbcClient jdbc;
    @Autowired
    PlatformTransactionManager txManager;

    @org.junit.jupiter.api.RepeatedTest(5)
    void 두_서버가_동시에_정리해도_만료_세션만_지워지고_오류가_없다() throws Exception {
        String tag = UUID.randomUUID().toString().substring(0, 8);
        long now = System.currentTimeMillis();
        List<String> expired = insert(tag, 1100, now - 3_600_000, now - 1_800_000);
        List<String> alive = insert(tag, 20, now, now + 1_800_000);

        SessionCleanup one = new SessionCleanup(jdbc, txManager);
        SessionCleanup two = new SessionCleanup(jdbc, txManager);
        ExecutorService pool = Executors.newFixedThreadPool(2);
        CountDownLatch go = new CountDownLatch(1);
        Future<Integer> f1 = pool.submit(() -> {
            go.await();
            return one.deleteExpired();
        });
        Future<Integer> f2 = pool.submit(() -> {
            go.await();
            return two.deleteExpired();
        });
        go.countDown();
        int d1 = f1.get();
        int d2 = f2.get();
        pool.shutdown();
        System.out.println("[측정] 동시 정리: 서버1 " + d1 + "건, 서버2 " + d2 + "건, 교착 재시도 " + (one.retries() + two.retries()) + "번");

        assertThat(d1 + d2).isGreaterThanOrEqualTo(expired.size());
        assertThat(count("SPRING_SESSION", "PRIMARY_ID", expired)).isZero();
        assertThat(count("SPRING_SESSION_ATTRIBUTES", "SESSION_PRIMARY_ID", expired)).isZero();
        assertThat(count("SPRING_SESSION", "PRIMARY_ID", alive)).isEqualTo(alive.size());
        assertThat(count("SPRING_SESSION_ATTRIBUTES", "SESSION_PRIMARY_ID", alive)).isEqualTo(alive.size());

        jdbc.sql("DELETE FROM SPRING_SESSION WHERE PRIMARY_ID IN (:ids)").param("ids", alive).update();
    }

    /** 세션 n개(+ 속성 1개씩). 반환: PRIMARY_ID 목록 */
    private List<String> insert(String tag, int n, long lastAccess, long expiry) {
        List<String> ids = new ArrayList<>();
        for (int i = 0; i < n; i++) {
            String pk = UUID.randomUUID().toString();
            jdbc.sql("""
                            INSERT INTO SPRING_SESSION (PRIMARY_ID, SESSION_ID, CREATION_TIME, LAST_ACCESS_TIME,
                                                        MAX_INACTIVE_INTERVAL, EXPIRY_TIME)
                            VALUES (:pk, :sid, :t, :t, 1800, :e)""")
                    .param("pk", pk).param("sid", UUID.randomUUID().toString()).param("t", lastAccess).param("e", expiry)
                    .update();
            jdbc.sql("INSERT INTO SPRING_SESSION_ATTRIBUTES VALUES (:pk, :name, :bytes)")
                    .param("pk", pk).param("name", "it-" + tag).param("bytes", new byte[] {1, 2, 3}).update();
            ids.add(pk);
        }
        return ids;
    }

    private int count(String table, String column, List<String> ids) {
        int total = 0;
        for (int i = 0; i < ids.size(); i += 500) {
            total += jdbc.sql("SELECT COUNT(*) FROM " + table + " WHERE " + column + " IN (:ids)")
                    .param("ids", ids.subList(i, Math.min(ids.size(), i + 500))).query(Integer.class).single();
        }
        return total;
    }
}
