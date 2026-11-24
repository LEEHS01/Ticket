package com.ticketing.common;

import org.springframework.data.redis.RedisConnectionFailureException;
import org.springframework.data.redis.RedisSystemException;

/** 예외가 Redis 연결·응답 실패에서 온 것인지 판단한다(원인 사슬을 따라가며 확인). */
public final class RedisFailures {

    private RedisFailures() {
    }

    public static boolean isRedisFailure(Throwable e) {
        for (Throwable t = e; t != null; t = t.getCause()) {
            if (t instanceof RedisConnectionFailureException || t instanceof RedisSystemException
                    || t.getClass().getName().startsWith("io.lettuce.")) {
                return true;
            }
            if (t.getCause() == t) {
                break;
            }
        }
        return false;
    }
}
