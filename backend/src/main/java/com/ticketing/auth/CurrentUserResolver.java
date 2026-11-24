package com.ticketing.auth;

import jakarta.servlet.http.HttpServletRequest;

import org.springframework.core.MethodParameter;
import org.springframework.web.bind.support.WebDataBinderFactory;
import org.springframework.web.context.request.NativeWebRequest;
import org.springframework.web.method.support.HandlerMethodArgumentResolver;
import org.springframework.web.method.support.ModelAndViewContainer;

/** {@code @CurrentUser long userId} 인자를 채운다. */
public class CurrentUserResolver implements HandlerMethodArgumentResolver {

    private final SessionAuth sessions;

    public CurrentUserResolver(SessionAuth sessions) {
        this.sessions = sessions;
    }

    @Override
    public boolean supportsParameter(MethodParameter parameter) {
        Class<?> type = parameter.getParameterType();
        return parameter.hasParameterAnnotation(CurrentUser.class) && (type == long.class || type == Long.class);
    }

    @Override
    public Object resolveArgument(MethodParameter parameter, ModelAndViewContainer mavContainer,
            NativeWebRequest webRequest, WebDataBinderFactory binderFactory) {
        return sessions.requireUserId(webRequest.getNativeRequest(HttpServletRequest.class));
    }
}
