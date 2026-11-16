-- 로컬(이 PC의 MySQL 8.4) 실행용 초기화. MySQL Workbench에서 root로 접속해 한 번만 실행한다.
-- 비밀번호는 로컬 개발용 가짜 값이고, 계정은 이 PC(localhost)에서만 접속할 수 있다.
--
-- 계정 분리(최소 권한):
--   ticketing      : 스키마 소유자. 마이그레이션(테이블 생성·변경)에만 사용
--   ticketing_app  : API 서버용. 조회·추가·수정만 가능(테이블 삭제·변경 불가)

CREATE DATABASE IF NOT EXISTS ticketing CHARACTER SET utf8mb4 COLLATE utf8mb4_0900_ai_ci;

CREATE USER IF NOT EXISTS 'ticketing'@'localhost' IDENTIFIED BY 'dev-only-migrate-pw';
GRANT ALL PRIVILEGES ON ticketing.* TO 'ticketing'@'localhost';

CREATE USER IF NOT EXISTS 'ticketing_app'@'localhost' IDENTIFIED BY 'dev-only-app-pw';
GRANT SELECT, INSERT, UPDATE ON ticketing.* TO 'ticketing_app'@'localhost';

FLUSH PRIVILEGES;
