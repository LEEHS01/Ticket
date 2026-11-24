package com.ticketing.config;

import java.time.Duration;
import java.util.concurrent.TimeUnit;

import io.lettuce.core.ClientOptions;
import io.lettuce.core.SocketOptions;
import io.lettuce.core.TimeoutOptions;
import io.lettuce.core.resource.Delay;

import org.springframework.boot.autoconfigure.data.redis.LettuceClientConfigurationBuilderCustomizer;
import org.springframework.boot.autoconfigure.data.redis.ClientResourcesBuilderCustomizer;
import org.springframework.context.annotation.Bean;
import org.springframework.context.annotation.Configuration;

/**
 * next: Redis는 "잃어도 되는 상태"(대기열·좌석 선점·멱등키·요청 제한)만 담고, 언제든 비거나 죽을 수 있다고 본다.
 * 그래서 Redis가 응답하지 않을 때 요청이 오래 매달리지 않게 한다.
 * <ul>
 *   <li>명령·연결 시간 초과 = REDIS_TIMEOUT_MS(기본 500ms).</li>
 *   <li>연결이 끊긴 동안 들어온 명령은 쌓아 두지 않고 바로 거절한다(REJECT_COMMANDS) → 예매 진행은 즉시 503.</li>
 *   <li>자동 재연결은 켜 두고 간격을 100ms에서 최대 2초로 짧게 잡는다 → Redis가 돌아오면 서버를 재시작하지 않아도 몇 초 안에 회복.</li>
 * </ul>
 */
@Configuration(proxyBeanMethods = false)
public class RedisClientConfig {

    @Bean
    LettuceClientConfigurationBuilderCustomizer redisFailFast(AppProperties props) {
        Duration timeout = Duration.ofMillis(props.redis().timeoutMs());
        return builder -> builder
                .commandTimeout(timeout)
                .clientOptions(ClientOptions.builder()
                        .autoReconnect(true)
                        .disconnectedBehavior(ClientOptions.DisconnectedBehavior.REJECT_COMMANDS)
                        .socketOptions(SocketOptions.builder().connectTimeout(timeout).keepAlive(true).build())
                        .timeoutOptions(TimeoutOptions.enabled(timeout))
                        .build());
    }

    @Bean
    ClientResourcesBuilderCustomizer redisReconnectDelay() {
        return builder -> builder.reconnectDelay(
                Delay.exponential(Duration.ofMillis(100), Duration.ofSeconds(2), 2, TimeUnit.MILLISECONDS));
    }
}
