# Docker 없이 이 PC에서 실행하기

Docker 스택 대신 WSL(Ubuntu)과 Windows에 설치된 프로그램으로 직접 실행한다.

| 구성요소 | 어디서 | 주소 |
|---|---|---|
| 화면(프론트엔드) | Windows의 Node.js (Vite 개발 서버) | http://localhost:5173 |
| 백엔드 | WSL의 JDK 21로 jar 실행 | http://localhost:18080 (8080은 WSL의 다른 서버가 사용 중) |
| MySQL | WSL의 MySQL 서비스 | WSL 안에서 127.0.0.1:3306 |
| Redis | WSL의 redis-server | WSL 안에서 127.0.0.1:6379 |

Docker의 게이트웨이(nginx) 역할은 Vite 개발 서버가 대신한다(`/api` 요청을 백엔드로 전달).

## 처음 한 번만 하는 준비 (WSL 터미널에서, 완료됨)

```bash
# JDK 21과 Redis 설치
sudo apt update && sudo apt install -y openjdk-21-jdk-headless redis-server

# 비밀번호 파일 만들기 (저장소 루트에서. .env 는 저장소에 올리지 않는다)
cp .env.example .env     # DB_OWNER_PASSWORD, DB_APP_PASSWORD 를 채운다. 예: openssl rand -hex 16

# MySQL을 켜고 DB와 계정 만들기 (.env 의 비밀번호를 쓴다. 기존 DB의 데이터는 건드리지 않는다)
sudo service mysql start
bash local/init-db.sh
```

## 매번 실행할 때

1. PC를 다시 켰다면 WSL 터미널에서 MySQL과 Redis를 켠다.

```bash
sudo service mysql start && sudo service redis-server start
```

2. `ticketing` 폴더의 PowerShell에서:

```powershell
powershell -ExecutionPolicy Bypass -File .\local\run-local.ps1
```

스크립트가 백엔드(준비물 확인 → 필요하면 빌드 → DB 마이그레이션·시드 → 서버 실행)와 화면을 차례로 띄운다.
준비물이 빠져 있으면 무엇이 없는지와 해결 명령을 알려주고 멈춘다. 끝나면 http://localhost:5173 을 연다.

## 종료

```powershell
powershell -ExecutionPolicy Bypass -File .\local\stop-local.ps1
```

백엔드와 화면만 종료한다. MySQL과 Redis는 그대로 둔다.

## 파일

| 파일 | 역할 |
|---|---|
| `run-local.ps1` | 전체 실행(Windows에서 실행). 백엔드는 WSL의 `run-backend.sh`를 부른다 |
| `run-backend.sh` | WSL에서 백엔드 실행. 직접 실행해도 된다: `bash local/run-backend.sh` |
| `stop-local.ps1` | 종료 |
| `init-db.sh` | DB와 계정 생성(처음 한 번). 비밀번호는 루트의 `.env`에서 읽는다 |
| `.run/` | 실행 로그(`backend.log`, `frontend.log`)와 프로세스 번호 |

## 알아둘 점

- 백엔드는 IPv4로만 열도록 실행한다(`-Djava.net.preferIPv4Stack=true`). IPv6로 열리면 Windows에서 `127.0.0.1:18080`으로 접속되지 않는다.
- Docker 실행(복제본 2개, nginx 게이트웨이, 읽기 전용 컨테이너)과 달리 백엔드가 1개이고 화면은 개발 서버다. 동작 확인과 개발용이며, 배포 형태는 Docker/EKS 쪽이 기준이다.
- Docker의 DB(볼륨)와 WSL의 MySQL은 서로 다른 DB라서 계정과 예매 데이터가 공유되지 않는다.
- 비밀번호는 모두 로컬 개발용 가짜 값이고, DB 계정은 WSL 안(localhost)에서만 접속할 수 있다.

## Docker로 다시 실행하려면

로컬 실행을 종료한 뒤 `ticketing` 폴더에서 `docker compose up -d` (주소는 http://localhost:8088).
