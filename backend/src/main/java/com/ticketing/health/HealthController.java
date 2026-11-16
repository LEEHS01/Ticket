package com.ticketing.health;

import java.util.Map;

import org.springframework.http.HttpStatus;
import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.RestController;

/** K8s 프로브용. liveness=/healthz(프로세스 생존만), readiness=/readyz(의존성 확인). */
@RestController
public class HealthController {

    private final ReadinessService readiness;

    public HealthController(ReadinessService readiness) {
        this.readiness = readiness;
    }

    @GetMapping("/healthz")
    public Map<String, String> healthz() {
        return Map.of("status", "ok");
    }

    @GetMapping("/readyz")
    public ResponseEntity<Map<String, String>> readyz() {
        if (readiness.isReady()) {
            return ResponseEntity.ok(Map.of("status", "ready"));
        }
        return ResponseEntity.status(HttpStatus.SERVICE_UNAVAILABLE).body(Map.of("status", "unavailable"));
    }
}
