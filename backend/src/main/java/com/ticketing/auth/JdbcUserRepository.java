package com.ticketing.auth;

import java.time.Duration;
import java.util.Optional;

import org.springframework.jdbc.core.simple.JdbcClient;
import org.springframework.jdbc.support.GeneratedKeyHolder;
import org.springframework.jdbc.support.KeyHolder;
import org.springframework.stereotype.Repository;

import com.ticketing.common.Transactions;

@Repository
public class JdbcUserRepository implements UserRepository {

    /**
     * 실패 기억 시각(failed_login_until)이 DB 시계로 아직 남아 있을 때만 횟수를 인정한다.
     * 남은 시간은 밀리초로 계산해 온다 → 서버마다 시계가 달라도 잠금 판단이 같다.
     */
    private static final String COLUMNS = """
            id, email, name, password_hash, login_enabled,
            IF(failed_login_until > NOW(3), failed_login_count, 0) AS failed_logins,
            IF(failed_login_until > NOW(3), TIMESTAMPDIFF(MICROSECOND, NOW(3), failed_login_until) DIV 1000, 0) AS failure_ms
            """;

    private final JdbcClient jdbc;
    private final Transactions tx;

    public JdbcUserRepository(JdbcClient jdbc, Transactions tx) {
        this.jdbc = jdbc;
        this.tx = tx;
    }

    @Override
    public long insert(String email, String passwordHash, String name) {
        KeyHolder keys = new GeneratedKeyHolder();
        jdbc.sql("INSERT INTO users (email, password_hash, name) VALUES (:email, :hash, :name)")
                .param("email", email).param("hash", passwordHash).param("name", name)
                .update(keys);
        return keys.getKey().longValue();
    }

    @Override
    public Optional<UserRow> findByEmail(String normalizedEmail) {
        return jdbc.sql("SELECT " + COLUMNS + " FROM users WHERE email = :email")
                .param("email", normalizedEmail).query(JdbcUserRepository::map).optional();
    }

    @Override
    public Optional<UserRow> findById(long id) {
        return jdbc.sql("SELECT " + COLUMNS + " FROM users WHERE id = :id")
                .param("id", id).query(JdbcUserRepository::map).optional();
    }

    @Override
    public void upsertDemo(String email, String passwordHash, String name) {
        jdbc.sql("""
                        INSERT INTO users (email, password_hash, name, login_enabled) VALUES (:email, :hash, :name, TRUE) AS new
                        ON DUPLICATE KEY UPDATE password_hash = new.password_hash, name = new.name, login_enabled = TRUE,
                                                failed_login_count = 0, failed_login_until = NULL
                        """)
                .param("email", email).param("hash", passwordHash).param("name", name).update();
    }

    @Override
    public LoginFailures recordLoginFailure(long userId, Duration window) {
        // 한 UPDATE 안에서 "기억 시간이 지났으면 1, 아니면 +1"과 "기억 시간 = 지금 + window"를 함께 바꾼다.
        // MySQL은 SET을 왼쪽부터 적용하므로 횟수 계산은 바뀌기 전의 failed_login_until을 본다.
        // 같은 트랜잭션에서 다시 읽어 이번 실패까지 반영된 값을 돌려준다(행 잠금이 커밋까지 유지됨).
        return tx.inTransaction(() -> {
            jdbc.sql("""
                            UPDATE users
                               SET failed_login_count = IF(failed_login_until > NOW(3), failed_login_count + 1, 1),
                                   failed_login_until = NOW(3) + INTERVAL (:ms * 1000) MICROSECOND
                             WHERE id = :id
                            """)
                    .param("ms", window.toMillis()).param("id", userId).update();
            return jdbc.sql("""
                            SELECT failed_login_count,
                                   GREATEST(TIMESTAMPDIFF(MICROSECOND, NOW(3), failed_login_until) DIV 1000, 0) AS ms
                              FROM users WHERE id = :id
                            """)
                    .param("id", userId)
                    .query((rs, n) -> new LoginFailures(rs.getInt(1), Duration.ofMillis(rs.getLong(2))))
                    .single();
        });
    }

    @Override
    public void resetLoginFailures(long userId) {
        jdbc.sql("UPDATE users SET failed_login_count = 0, failed_login_until = NULL WHERE id = :id")
                .param("id", userId).update();
    }

    private static UserRow map(java.sql.ResultSet rs, int n) throws java.sql.SQLException {
        return new UserRow(rs.getLong("id"), rs.getString("email"), rs.getString("name"),
                rs.getString("password_hash"), rs.getBoolean("login_enabled"), rs.getInt("failed_logins"),
                Duration.ofMillis(Math.max(0, rs.getLong("failure_ms"))));
    }
}
