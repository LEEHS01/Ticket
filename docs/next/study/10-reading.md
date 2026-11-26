# 10. 코드 읽는 순서

실제 파일을 열어 볼 때의 순서다. 예매 한 건을 따라가며 읽으면 앞 장의 내용이 코드에서 그대로 보인다.

저장소는 `LEEHS01/Ticket`의 `next` 브랜치다. backend의 자바 파일은 모두 `backend/src/main/java/com/ticketing/` 아래에 있다.

| 순서 | 알고 싶은 것 | 파일 |
|---|---|---|
| 1 | API 약속 | `docs/ARCHITECTURE.md` 4장, `docs/next/API-v4.md` |
| 2 | 테이블 | `backend/src/main/resources/db/migration/V1__init.sql`부터 V5까지 |
| 3 | 판매 상태 계산 | `show/SaleStatus.java`, `show/ShowService.java` |
| 4 | 대기열 | `queue/QueueService.java`, `resources/redis/queue-common.lua`, `queue-enter.lua`, `queue-poll.lua` |
| 5 | 좌석과 선점 | `seat/SeatService.java`, `resources/redis/hold-create.lua` |
| 6 | 확정과 취소 | `reservation/ReservationService.java` |
| 7 | 로그인과 세션 | `auth/AuthService.java`, `auth/SessionAuth.java`, `auth/CsrfFilter.java` |
| 8 | 오류 처리 | `common/ErrorCode.java`, `common/GlobalExceptionHandler.java` |
| 9 | 프론트의 서버 호출 | `frontend/src/api.ts`, `frontend/src/data.ts` |
| 10 | 프론트의 예매 화면 | `frontend/src/booking.ts`, `pages/QueuePage.tsx`, `SeatsPage.tsx`, `ConfirmPage.tsx` |
| 11 | 화면 주소와 틀 | `frontend/src/App.tsx`, `frontend/src/shell.tsx`, `frontend/src/auth.tsx` |

## 처음이라면 이 세 파일부터

- `reservation/ReservationService.java`의 `createReservation`. 3장의 4단계가 위에서 아래로 그대로 적혀 있다. 주석이 '왜'를 설명한다.
- `resources/redis/hold-create.lua`. 60줄짜리 스크립트 하나에 좌석 잡기의 전부가 있다.
- `frontend/src/api.ts`의 `request` 함수. 화면이 서버를 부를 때 지나는 길이다.

## 테스트로 규칙 확인하기

테스트는 '이렇게 동작해야 한다'를 적어 둔 코드라서 규칙을 확인하기 좋다. `backend/src/test`에 있다.

| 파일 | 시험하는 것 |
|---|---|
| `SeatConcurrencyIT` | 여러 사람이 같은 좌석을 동시에 잡고 확정할 때 한 사람만 성공하는가 |
| `QueueIT` | 줄 서기, 승격, 입장권 확인 |
| `AuthSessionIT` | 가입, 로그인, 세션, 잠금 |
| `RedisLossIT` | Redis가 비워진 뒤에도 로그인과 예매 내역이 남고, 두 번 팔리지 않는가 |

---

[← 9. 디자인 패턴](09-design-patterns.md) · [차례](README.md)
