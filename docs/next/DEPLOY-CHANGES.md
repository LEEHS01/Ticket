# 배포 구성에서 바뀌어야 할 것 (next)

`next`의 코드 변경에 맞춰 배포 구성에서 고쳐야 할 곳을 모았다. `k8s/`와 `infra/`는 이번에 고치지 않고 목록만 둔다(과제 제출본과 태그 `v3.0-improved`의 구성이 그대로 남아 있어야 하고, 클라우드에 다시 올릴 때 한꺼번에 고친다).

## 1. DB 계정 권한

세션을 MySQL에 두면서 앱 계정(`ticketing_app`)이 세션 행을 지울 수 있어야 한다(로그아웃, 만료 정리).
권한은 세션 테이블 두 개에만 준다. 예매·좌석·회원 테이블에는 DELETE를 열지 않는다.

MySQL은 아직 없는 테이블에 `GRANT DELETE`만 주면 거부한다(ERROR 1146). 테이블 단위 권한을 미리 주려면 `CREATE`를 함께 줘야 한다. `CREATE`는 그 이름의 테이블을 만드는 권한일 뿐 DROP·ALTER는 포함하지 않는다.

초기화 스크립트(migrate 전에 실행):

```sql
GRANT SELECT, INSERT, UPDATE ON ticketing.* TO 'ticketing_app'@'%';
GRANT DELETE, CREATE ON ticketing.SPRING_SESSION            TO 'ticketing_app'@'%';
GRANT DELETE, CREATE ON ticketing.SPRING_SESSION_ATTRIBUTES TO 'ticketing_app'@'%';
```

이미 migrate까지 끝난 DB(예: 만들어 둔 RDS):

```sql
GRANT DELETE ON ticketing.SPRING_SESSION            TO 'ticketing_app'@'%';
GRANT DELETE ON ticketing.SPRING_SESSION_ATTRIBUTES TO 'ticketing_app'@'%';
```

| 파일 | 고칠 곳 |
|---|---|
| `k8s/base/mysql-init.yaml` | 앱 계정 GRANT를 위 "초기화 스크립트" 내용으로 |
| `infra/eks/rds-init-users.sh` | 같은 내용. 이미 만들어진 RDS에는 아래쪽 SQL을 한 번 실행 |
| `backend/docker/mysql-init/01-init.sh`, `local/init-db.sh` | 반영됨(커밋 1970aea) |

권한이 없으면 로그아웃과 만료 세션 삭제가 권한 오류로 실패한다.
백엔드 세션이 새 DB로 확인했다: 초기화 → migrate → 가입·로그아웃·만료 정리에 권한 오류가 없고, 앱 계정의 예매·좌석·회원 테이블 DELETE와 세션 테이블 DROP·ALTER는 거부된다.

## 2. 준비 상태 확인(readiness)

`/readyz`는 MySQL만 기준으로 판단한다. Redis가 죽어도 200을 주고 본문에 `redis: "down"`을 담는다.

| 파일 | 고칠 곳 |
|---|---|
| `k8s/base/backend-deployment.yaml` | readinessProbe 설명 주석("MySQL과 Redis") 수정. 설정값은 그대로 |
| 모니터링(나중) | Redis 장애는 readiness로 드러나지 않으므로 `/readyz` 본문이나 로그로 따로 감시해야 한다 |

## 3. 설명 주석

| 파일 | 고칠 곳 |
|---|---|
| `k8s/base/backend-deployment.yaml` | "세션이 Redis" → MySQL, "SELECT, INSERT, UPDATE만" → 세션 테이블 DELETE 포함 |
| `k8s/base/redis-deployment.yaml` | Redis의 역할에서 "로그인 세션" 삭제 |

## 4. 환경변수

| 이름 | 기본값 | 설명 | 넣을 곳 |
|---|---|---|---|
| `REDIS_TIMEOUT_MS` | 500 | Redis 명령·연결 시간 초과 | 선택. `k8s/base/config.yaml` |
| `SESSION_TOUCH_SECONDS` | 60 | 세션 마지막 접근 시각 갱신 간격 | 선택 |
| `SESSION_CLEANUP_SECONDS` | 300 | 만료 세션 정리 간격 | 선택 |

없어진 환경변수는 없다. `REDIS_*`는 그대로 필요하다.

## 5. compose

`compose.yaml`은 바꿀 것이 없다. backend의 `depends_on: redis`는 기동 순서만 정하고, 실행 중 Redis 장애는 애플리케이션이 견딘다.

## 6. 클라우드에 올릴 때 정할 것 (이번 범위 밖)

- Redis: 클라우드마다 따로, 다중 가용 영역 구성(주 서버 + 대기 서버, 자동 전환). 클라우드 사이 복제는 하지 않는다.
- MySQL: 클라우드 사이 복제(binlog 방식). 세션 테이블도 함께 복제되어 장애 전환 뒤 로그인이 유지된다.
- 요청 제한의 전체 한도는 로드밸런서·WAF에서 건다.
- 정적 파일과 포스터·배너는 CDN으로 서빙한다.
