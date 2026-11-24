package com.ticketing.queue;

import jakarta.validation.Valid;
import jakarta.validation.constraints.NotNull;
import jakarta.validation.constraints.Positive;

import org.springframework.http.MediaType;
import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.DeleteMapping;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestHeader;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RestController;

import com.ticketing.auth.CurrentUser;

/** 대기열. v3부터 로그인 필요(401 UNAUTHENTICATED). */
@RestController
@RequestMapping("/api/queue")
public class QueueController {

    public static final String TOKEN_HEADER = "X-Queue-Token";

    public record EnterRequest(
            @NotNull(message = "회차를 선택해 주세요.") @Positive(message = "회차 번호가 올바르지 않습니다.") Long performanceId) {
    }

    private final QueueService service;

    public QueueController(QueueService service) {
        this.service = service;
    }

    @PostMapping(path = "/enter", consumes = MediaType.APPLICATION_JSON_VALUE)
    public QueueState enter(@Valid @RequestBody EnterRequest body, @CurrentUser long userId) {
        return service.enter(userId, body.performanceId());
    }

    @GetMapping("/status")
    public QueueState status(@RequestHeader(value = TOKEN_HEADER, required = false) String token,
            @CurrentUser long userId) {
        return service.status(userId, token);
    }

    @DeleteMapping
    public ResponseEntity<Void> leave(@RequestHeader(value = TOKEN_HEADER, required = false) String token,
            @CurrentUser long userId) {
        service.leave(userId, token);
        return ResponseEntity.noContent().build();
    }
}
