package com.ticketing.health;

import java.util.Map;

import org.springframework.beans.factory.annotation.Value;
import org.springframework.http.HttpStatus;
import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.RestController;

/** K8s 프로브용. liveness=/healthz(프로세스 생존만), readiness=/readyz(MySQL 확인, Redis는 참고 항목). /api/version은 배포된 이미지 버전 확인용. */
@RestController
public class HealthController {

    private final ReadinessService readiness;
    private final String version;

    public HealthController(ReadinessService readiness, @Value("${APP_VERSION:dev}") String version) {
        this.readiness = readiness;
        this.version = version;
    }

    /** 이미지를 빌드할 때 넣은 버전(APP_VERSION). 롤링 업데이트 중 어느 버전이 응답하는지 확인한다. */
    @GetMapping("/api/version")
    public Map<String, String> version() {
        return Map.of("version", version);
    }

    @GetMapping("/healthz")
    public Map<String, String> healthz() {
        return Map.of("status", "ok");
    }

    /**
     * 준비 여부는 MySQL 기준(200 ready / 503 unavailable). next: "redis"(up|down)는 참고용 항목이고 판단에 쓰지 않는다.
     */
    @GetMapping("/readyz")
    public ResponseEntity<Map<String, String>> readyz() {
        ReadinessService.Readiness r = readiness.check();
        String redis = r.redisUp() ? "up" : "down";
        if (r.ready()) {
            return ResponseEntity.ok(Map.of("status", "ready", "redis", redis));
        }
        return ResponseEntity.status(HttpStatus.SERVICE_UNAVAILABLE).body(Map.of("status", "unavailable", "redis", redis));
    }
}
