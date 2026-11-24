package com.ticketing.config;

import java.util.List;

import org.springframework.context.annotation.Configuration;
import org.springframework.web.method.support.HandlerMethodArgumentResolver;
import org.springframework.web.servlet.config.annotation.CorsRegistry;
import org.springframework.web.servlet.config.annotation.WebMvcConfigurer;

import com.ticketing.auth.CurrentUserResolver;
import com.ticketing.auth.SessionAuth;

/**
 * {@code @CurrentUser} 인자(로그인 사용자 id)를 채우는 resolver를 등록한다.
 * CORS는 기본 비활성(Ingress 경로 분기로 같은 출처). CORS_ALLOWED_ORIGINS가 있을 때만 그 출처를 허용한다.
 */
@Configuration(proxyBeanMethods = false)
public class WebConfig implements WebMvcConfigurer {

    private final AppProperties props;
    private final SessionAuth sessions;

    public WebConfig(AppProperties props, SessionAuth sessions) {
        this.props = props;
        this.sessions = sessions;
    }

    @Override
    public void addArgumentResolvers(List<HandlerMethodArgumentResolver> resolvers) {
        resolvers.add(new CurrentUserResolver(sessions));
    }

    @Override
    public void addCorsMappings(CorsRegistry registry) {
        List<String> origins = props.cors().origins();
        if (origins.isEmpty()) {
            return;
        }
        registry.addMapping("/api/**")
                .allowedOrigins(origins.toArray(String[]::new))
                .allowedMethods("GET", "POST", "DELETE")
                .allowedHeaders("Content-Type", "Idempotency-Key", "X-Queue-Token")
                .exposedHeaders("X-Request-Id", "Retry-After", "RateLimit-Limit", "RateLimit-Remaining")
                .allowCredentials(false)
                .maxAge(600);
    }
}
