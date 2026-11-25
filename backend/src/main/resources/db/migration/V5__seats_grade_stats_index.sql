-- 공연 목록·상세·랭킹의 회차×등급 좌석 집계(JdbcShowRepository.findPerformanceStats)를 인덱스만 읽고 끝내도록 덮는 인덱스.
-- 공연 68개·좌석 약 3.9만 석에서 집계 쿼리 42ms → 24ms(측정). 기존 idx_seats_performance_status는
-- 판매 가능 좌석 조회(performance_id, status)가 쓰므로 그대로 둔다.
CREATE INDEX idx_seats_performance_grade_status ON seats (performance_id, grade_code, status);
