package com.ticketing.seat;

import java.util.List;

import jakarta.validation.Valid;
import jakarta.validation.constraints.NotNull;
import jakarta.validation.constraints.Positive;
import jakarta.validation.constraints.Size;

import org.springframework.http.HttpStatus;
import org.springframework.http.MediaType;
import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.DeleteMapping;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PathVariable;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestHeader;
import org.springframework.web.bind.annotation.RestController;

import com.ticketing.auth.CurrentUser;
import com.ticketing.common.ApiException;
import com.ticketing.common.ErrorCode;
import com.ticketing.queue.QueueController;

@RestController
public class SeatController {

    public record HoldRequest(
            @NotNull(message = "좌석을 선택해 주세요.")
            @Size(min = 1, max = 4, message = "좌석은 1~4석까지 선택할 수 있습니다.")
            List<@NotNull(message = "좌석 번호가 올바르지 않습니다.") @Positive(message = "좌석 번호가 올바르지 않습니다.") Long> seatIds) {
    }

    private final SeatService service;

    public SeatController(SeatService service) {
        this.service = service;
    }

    @GetMapping("/api/performances/{id}/seats")
    public SeatViews.SeatMap seats(@PathVariable long id,
            @RequestHeader(value = QueueController.TOKEN_HEADER, required = false) String token,
            @CurrentUser long userId) {
        return service.seatMap(userId, token, positive(id));
    }

    /** v4 좌석 배치 미리보기. 토큰·로그인 불필요, 좌석 상태 없음. */
    @GetMapping("/api/performances/{id}/layout")
    public SeatViews.SeatLayout layout(@PathVariable long id) {
        return service.layout(positive(id));
    }

    @PostMapping(path = "/api/performances/{id}/holds", consumes = MediaType.APPLICATION_JSON_VALUE)
    public ResponseEntity<SeatViews.HoldView> hold(@PathVariable long id,
            @RequestHeader(value = QueueController.TOKEN_HEADER, required = false) String token,
            @Valid @RequestBody HoldRequest body, @CurrentUser long userId) {
        return ResponseEntity.status(HttpStatus.CREATED).body(service.hold(userId, token, positive(id), body.seatIds()));
    }

    @DeleteMapping("/api/holds/{holdId}")
    public ResponseEntity<Void> release(@PathVariable String holdId,
            @RequestHeader(value = QueueController.TOKEN_HEADER, required = false) String token,
            @CurrentUser long userId) {
        service.release(userId, token, holdId);
        return ResponseEntity.noContent().build();
    }

    private static long positive(long id) {
        if (id <= 0) {
            throw new ApiException(ErrorCode.PERFORMANCE_NOT_FOUND);
        }
        return id;
    }
}
