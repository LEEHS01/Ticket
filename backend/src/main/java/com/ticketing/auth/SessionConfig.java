package com.ticketing.auth;

import javax.sql.DataSource;

import jakarta.servlet.DispatcherType;

import org.springframework.boot.autoconfigure.condition.ConditionalOnWebApplication;
import org.springframework.boot.web.servlet.FilterRegistrationBean;
import org.springframework.context.annotation.Bean;
import org.springframework.context.annotation.Configuration;
import org.springframework.context.annotation.Primary;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.jdbc.core.simple.JdbcClient;
import org.springframework.scheduling.annotation.EnableScheduling;
import org.springframework.scheduling.annotation.Scheduled;
import org.springframework.session.FlushMode;
import org.springframework.session.SaveMode;
import org.springframework.session.config.annotation.web.http.EnableSpringHttpSession;
import org.springframework.session.jdbc.JdbcIndexedSessionRepository;
import org.springframework.session.web.http.SessionRepositoryFilter;
import org.springframework.transaction.PlatformTransactionManager;
import org.springframework.transaction.TransactionDefinition;
import org.springframework.transaction.support.TransactionTemplate;

import com.ticketing.config.AppProperties;

/**
 * next: 로그인 세션 저장소 = MySQL(Spring Session JDBC).
 * Spring Boot 자동 구성 대신 직접 조립한다. 바꾼 점 네 가지:
 * <ol>
 *   <li>조회는 트랜잭션 없이 SELECT 1번({@link SessionTransactions}).</li>
 *   <li>마지막 접근 시각은 {@code SESSION_TOUCH_SECONDS}(기본 60초)보다 촘촘하게 쓰지 않는다({@link ThrottledSessionRepository}).</li>
 *   <li>한 요청 안에서 같은 세션을 두 번 읽지 않는다({@link SessionLookupCache}).</li>
 *   <li>Spring Session 자체 정리 작업은 끄고, 여러 서버가 동시에 돌려도 서로 기다리지 않는 정리 작업({@link SessionCleanup})을 쓴다.</li>
 * </ol>
 * 쿠키(TKT_SESSION, HttpOnly, SameSite=Lax, Secure)와 유휴 만료는 server.servlet.session.* 설정을
 * Spring Boot가 만든 CookieSerializer로 그대로 쓴다(Redis 세션 때와 같다).
 * 웹 서버 모드에서만 켜진다(migrate 모드에는 세션이 없다).
 */
@Configuration(proxyBeanMethods = false)
@ConditionalOnWebApplication(type = ConditionalOnWebApplication.Type.SERVLET)
@EnableSpringHttpSession
@EnableScheduling
public class SessionConfig {

    static final String TABLE = "SPRING_SESSION";

    @Bean
    JdbcIndexedSessionRepository jdbcSessionRepository(DataSource dataSource, PlatformTransactionManager txManager,
            AppProperties props) {
        TransactionTemplate tx = new TransactionTemplate(txManager);
        tx.setIsolationLevel(TransactionDefinition.ISOLATION_READ_COMMITTED);
        tx.setTimeout(5);
        JdbcIndexedSessionRepository repo =
                new JdbcIndexedSessionRepository(new JdbcTemplate(dataSource), new SessionTransactions(tx));
        repo.setTableName(TABLE);
        repo.setDefaultMaxInactiveInterval(props.auth().idle());
        repo.setFlushMode(FlushMode.ON_SAVE);          // 요청이 끝날 때 한 번에
        repo.setSaveMode(SaveMode.ON_SET_ATTRIBUTE);   // 값을 바꿀 때만 저장
        repo.setCleanupCron(Scheduled.CRON_DISABLED);  // 정리는 SessionCleanup이 한다
        return repo;
    }

    @Bean
    @Primary
    ThrottledSessionRepository<?> sessionRepository(JdbcIndexedSessionRepository jdbc, AppProperties props) {
        return new ThrottledSessionRepository<>(jdbc, props.auth().touch());
    }

    /** Spring Session 필터 바로 앞(바깥)에서 요청 단위 조회 캐시를 연다. */
    @Bean
    FilterRegistrationBean<SessionLookupCache> sessionLookupCache() {
        FilterRegistrationBean<SessionLookupCache> bean = new FilterRegistrationBean<>(new SessionLookupCache());
        bean.setOrder(SessionRepositoryFilter.DEFAULT_ORDER - 1);
        bean.setDispatcherTypes(DispatcherType.REQUEST, DispatcherType.ERROR, DispatcherType.ASYNC);
        return bean;
    }

    @Bean
    SessionCleanup sessionCleanup(JdbcClient jdbc, PlatformTransactionManager txManager) {
        return new SessionCleanup(jdbc, txManager);
    }
}
