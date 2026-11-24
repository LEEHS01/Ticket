-- API v4(docs/next/API-v4.md): 공연 한 줄 소개·지역, 배너, 공지, 모의 결제 수단, 기간별 랭킹용 인덱스.
-- V1~V3는 고치지 않고 위에 쌓는다. 기존 행은 기본값으로 채워지고, 시드(migrate)가 공연의 tagline·region을 채운다.

-- 1) 공연: 한 줄 소개(30자 이내)와 공연장 지역. 등록 시각(createdAt)은 V1의 shows.created_at을 그대로 쓴다.
ALTER TABLE shows
    ADD COLUMN tagline VARCHAR(30) NOT NULL DEFAULT '' AFTER title,
    ADD COLUMN region  VARCHAR(10) NOT NULL DEFAULT '' AFTER venue,
    ADD KEY idx_shows_region (region);                       -- GET /api/shows?region=

-- 2) 예매: 모의 결제 수단(고른 이름만 기록. 결제 정보는 받지 않는다). 기존 예매는 CARD.
ALTER TABLE reservations
    ADD COLUMN payment_method VARCHAR(16) CHARACTER SET ascii COLLATE ascii_bin NOT NULL DEFAULT 'CARD' AFTER total_price,
    ADD CONSTRAINT chk_reservations_payment CHECK (payment_method IN ('CARD', 'EASY_PAY', 'BANK_TRANSFER')),
    -- 기간별 랭킹: "확정 예매 중 created_at >= 기준"을 범위로 읽는다
    ADD KEY idx_reservations_status_created (status, created_at, performance_id);

-- 3) 홈 배너. 노출 기간(starts_at~ends_at, NULL이면 제한 없음) 안의 것만 sort_order 순으로 최대 6개.
--    image_url은 프론트 정적 파일 경로(외부 주소 없음). slug는 시드 재실행 때 같은 배너를 찾기 위한 값.
CREATE TABLE banners (
    id                BIGINT       NOT NULL AUTO_INCREMENT,
    slug              VARCHAR(64)  CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
    show_id           BIGINT       NOT NULL,
    eyebrow           VARCHAR(12)  NOT NULL,
    title             VARCHAR(28)  NOT NULL,
    subtitle          VARCHAR(40)  NOT NULL,
    image_url         VARCHAR(200) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
    mobile_image_url  VARCHAR(200) CHARACTER SET ascii COLLATE ascii_bin NULL,
    sort_order        INT          NOT NULL,
    starts_at         DATETIME(3)  NULL,  -- UTC
    ends_at           DATETIME(3)  NULL,  -- UTC
    PRIMARY KEY (id),
    UNIQUE KEY uk_banners_slug (slug),
    KEY idx_banners_order (sort_order, id),
    CONSTRAINT fk_banners_show FOREIGN KEY (show_id) REFERENCES shows (id),
    CONSTRAINT chk_banners_image CHECK (image_url LIKE '/%')
) ENGINE = InnoDB DEFAULT CHARSET = utf8mb4 COLLATE = utf8mb4_0900_ai_ci;

-- 4) 공지. 본문은 일반 텍스트(줄바꿈 포함, HTML 아님). 고정 공지 먼저, 그다음 최신순.
CREATE TABLE notices (
    id              BIGINT       NOT NULL AUTO_INCREMENT,
    slug            VARCHAR(80)  CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
    category        VARCHAR(16)  CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
    title           VARCHAR(100) NOT NULL,
    body            TEXT         NOT NULL,
    pinned          BOOLEAN      NOT NULL DEFAULT FALSE,
    published_at    DATETIME(3)  NOT NULL,  -- UTC. 이 시각 전에는 목록·상세에 나오지 않는다
    ticket_open_at  DATETIME(3)  NULL,      -- TICKET_OPEN일 때 오픈 일시
    show_id         BIGINT       NULL,
    PRIMARY KEY (id),
    UNIQUE KEY uk_notices_slug (slug),
    KEY idx_notices_list (pinned, published_at, id),                -- 전체 목록(고정 → 최신)
    KEY idx_notices_category (category, pinned, published_at, id),  -- 분류별 목록
    CONSTRAINT fk_notices_show FOREIGN KEY (show_id) REFERENCES shows (id),
    CONSTRAINT chk_notices_category CHECK (category IN ('TICKET_OPEN', 'SERVICE'))
) ENGINE = InnoDB DEFAULT CHARSET = utf8mb4 COLLATE = utf8mb4_0900_ai_ci;
