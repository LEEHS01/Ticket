package com.ticketing.auth;

import java.util.function.Supplier;

import org.springframework.transaction.TransactionException;
import org.springframework.transaction.support.SimpleTransactionStatus;
import org.springframework.transaction.support.TransactionCallback;
import org.springframework.transaction.support.TransactionOperations;
import org.springframework.transaction.support.TransactionTemplate;

/**
 * Spring Session JDBC 저장소에 넘기는 트랜잭션 처리.
 * Spring Session은 조회에도 트랜잭션을 쓰는데, 그러면 요청마다 SELECT 1번에
 * autocommit 끄기·COMMIT·autocommit 켜기가 붙어 DB 왕복이 4번이 된다.
 * 세션 조회는 SELECT 한 문장(세션 LEFT JOIN 속성)이라 트랜잭션이 필요 없으므로,
 * {@link #readOnly}로 감싼 구간에서는 트랜잭션 없이 바로 실행한다. 쓰기는 그대로 트랜잭션이다.
 */
public final class SessionTransactions implements TransactionOperations {

    private static final ThreadLocal<Boolean> READ_ONLY = new ThreadLocal<>();

    private final TransactionTemplate template;

    public SessionTransactions(TransactionTemplate template) {
        this.template = template;
    }

    /** 이 안에서 Spring Session이 여는 "트랜잭션"은 실제로 열지 않는다(autocommit 한 문장). */
    static <T> T readOnly(Supplier<T> work) {
        Boolean previous = READ_ONLY.get();
        READ_ONLY.set(Boolean.TRUE);
        try {
            return work.get();
        } finally {
            if (previous == null) {
                READ_ONLY.remove();
            } else {
                READ_ONLY.set(previous);
            }
        }
    }

    @Override
    public <T> T execute(TransactionCallback<T> action) throws TransactionException {
        if (Boolean.TRUE.equals(READ_ONLY.get())) {
            return action.doInTransaction(new SimpleTransactionStatus(false));
        }
        return template.execute(action);
    }
}
