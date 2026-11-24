package com.ticketing.auth;

import java.lang.annotation.Documented;
import java.lang.annotation.ElementType;
import java.lang.annotation.Retention;
import java.lang.annotation.RetentionPolicy;
import java.lang.annotation.Target;

/**
 * 컨트롤러 인자에 붙이면 로그인한 사용자 id(long)가 들어온다. 로그인하지 않았으면 401 UNAUTHENTICATED.
 * 인증 확인은 {@link CurrentUserResolver} → {@link SessionAuth} 한 곳에서만 한다.
 * 나중에 세션 대신 토큰 방식으로 바꿔도 컨트롤러는 고치지 않는다(SessionAuth만 바뀜).
 * 입력 검증(400)이 먼저 보이도록 컨트롤러에서는 이 인자를 {@code @RequestBody} 뒤에 둔다.
 */
@Target(ElementType.PARAMETER)
@Retention(RetentionPolicy.RUNTIME)
@Documented
public @interface CurrentUser {
}
