package com.ticketing.migrate;

import java.time.Instant;
import java.time.ZoneId;
import java.time.format.DateTimeFormatter;
import java.util.List;
import java.util.Locale;
import java.util.Map;

/**
 * v4 시드 문구(docs/next/API-v4.md 3장): 공연 한 줄 소개·지역, 홈 배너 6개, 공지.
 * 모두 이 프로젝트를 위해 새로 쓴 문구이고, 공연·공연장·인물은 지어낸 것이다.
 */
final class ContentSeed {

    private ContentSeed() {
    }

    private static final ZoneId KST = ZoneId.of("Asia/Seoul");

    /** 공연 slug → 한 줄 소개(30자 이내). */
    private static final Map<String, String> FIRST_18_TAGLINES = Map.ofEntries(
            Map.entry("dawnlight-blue-frequency", "데뷔 5주년, 밴드 편곡으로 듣는 대표곡"),
            Map.entry("citypop-summer-night", "도시의 밤을 닮은 두 팀의 시티팝 무대"),
            Map.entry("mulgyeol-indie-fest-2026", "강가 야외무대에서 이틀간 이어지는 인디 축제"),
            Map.entry("girl-who-folds-time", "종이 한 장으로 하루를 되돌리는 소녀"),
            Map.entry("lighthouse-keeper-song", "외딴섬 등대에서 보낸 사계절의 노래"),
            Map.entry("cloud-station", "길 잃은 기차를 기다리는 가족 뮤지컬"),
            Map.entry("last-letter-thursday", "목요일마다 도착하는 편지를 기다리는 두 사람"),
            Map.entry("rooftop-observatory", "옥탑방 망원경 아래 세 친구의 코미디"),
            Map.entry("second-move", "같은 집에 두 번 이사 온 사람의 기억"),
            Map.entry("autumn-chamber-night", "현악 사중주로 듣는 가을 밤의 실내악"),
            Map.entry("mirinae-youth-orchestra", "청년 연주자 80명이 들려주는 교향곡"),
            Map.entry("piano-memory-of-water", "물을 주제로 고른 소품들의 피아노 독주회"),
            Map.entry("sunset-jazz-eleven-pm", "늦은 밤에 어울리는 재즈 쿼텟 라이브"),
            Map.entry("first-snow-folk-concert", "통기타와 목소리로 채우는 겨울 포크 무대"),
            Map.entry("moonlight-laundry", "밤에만 문을 여는 세탁소에 모인 사연들"),
            Map.entry("bus-leaves-at-eight", "막차 정류장에서 만난 세 사람의 하룻밤"),
            Map.entry("long-winter-cello", "첼로와 피아노로 듣는 겨울 소나타"),
            Map.entry("cat-postman", "편지를 나르는 고양이와 아이들의 모험"));

    /** 공연 slug → 한 줄 소개(1~18번 + 추가 50개는 AddedShows.TAGLINES, 표의 값 그대로). */
    static final Map<String, String> TAGLINES = merged(FIRST_18_TAGLINES, AddedShows.TAGLINES);

    private static Map<String, String> merged(Map<String, String> a, Map<String, String> b) {
        Map<String, String> m = new java.util.LinkedHashMap<>(a);
        m.putAll(b);
        return Map.copyOf(m);
    }

    /** 가상 공연장 → 지역. 공연장마다 고정. 처음 18개는 4개 지역, 추가 50개로 7개 지역이 된다. */
    static final Map<String, String> VENUE_REGIONS = Map.ofEntries(
            Map.entry("누리 아트홀", "서울"),
            Map.entry("별무리 라이브홀", "서울"),
            Map.entry("온새미로 극장", "서울"),
            Map.entry("나래 소극장", "서울"),
            Map.entry("다온 아트센터 대극장", "경기"),
            Map.entry("별빛 씨어터", "경기"),
            Map.entry("하늘결 체임버홀", "경기"),
            Map.entry("모퉁이 극장", "대구"),
            Map.entry("미리내 콘서트홀", "대구"),
            Map.entry("물결 야외극장", "부산"),
            Map.entry("소금꽃 소극장", "부산"),
            // 추가 공연(19~68번)의 새 공연장 6곳 — 지역 7개(서울·경기·대구·부산 + 인천·대전·광주)
            Map.entry("윤슬 홀", "서울"),
            Map.entry("은행나무 소극장", "서울"),
            Map.entry("바다숲 아트홀", "인천"),
            Map.entry("가온 아트홀", "대전"),
            Map.entry("새솔 극장", "광주"),
            Map.entry("파도소리 홀", "부산"));

    static String region(String venue) {
        String r = VENUE_REGIONS.get(venue);
        if (r == null) {
            throw new IllegalStateException("지역이 정해지지 않은 공연장입니다: " + venue);
        }
        return r;
    }

    /** eyebrow 12자·title 28자·subtitle 40자 이내. 그림 파일은 frontend/public/banners/banner-{showId}.webp. */
    record SeedBanner(String showSlug, String eyebrow, String title, String subtitle) {
    }

    /**
     * 배너 16개(이 순서가 sort_order). API-v4.md 3장의 공연 15, 4, 1, 6, 8, 12 + BANNERS-ADD.md의 10개.
     * 노출은 그 공연의 마지막 회차 시작까지라, 앞 공연이 끝나면 뒤 배너가 차례로 올라온다(GET /api/banners는 최대 6개).
     */
    static final List<SeedBanner> BANNERS = List.of(
            new SeedBanner("moonlight-laundry", "뮤지컬", "밤에만 문을 여는 세탁소", "저마다의 사연이 담긴 빨래가 모이는 창작 뮤지컬"),
            new SeedBanner("girl-who-folds-time", "뮤지컬", "접힌 종이 한 장, 되돌린 하루", "판매량 1위 창작 뮤지컬, 네 번의 회차 예매 중"),
            new SeedBanner("dawnlight-blue-frequency", "콘서트", "새벽빛 밴드 〈푸른 주파수〉", "데뷔 5주년 단독 공연, 새 앨범 수록곡 첫 무대"),
            new SeedBanner("cloud-station", "뮤지컬", "구름 위 작은 정거장으로", "온 가족이 함께 보는 뮤지컬, 곧 예매가 열립니다"),
            new SeedBanner("rooftop-observatory", "연극", "옥탑방에 들여놓은 망원경", "별을 보려던 세 친구의 좌충우돌 코미디"),
            new SeedBanner("piano-memory-of-water", "클래식", "피아노 리사이틀 〈물의 기억〉", "물을 주제로 고른 소품들로 꾸민 독주회"),
            // 추가 10개(순서 7~16, docs/next/BANNERS-ADD.md): 공연 33, 21, 34, 37, 52, 56, 42, 32, 68, 45. 말머리는 장르만
            new SeedBanner("snowman-photo-studio", "뮤지컬", "겨울에만 문을 여는 사진관", "녹기 전에 한 장, 눈사람과 함께 찍는 가족 뮤지컬"),
            new SeedBanner("paper-plane-cleared-to-land", "콘서트", "종이비행기 〈착륙 허가〉", "3년 만의 단독 공연, 새 앨범 전곡을 라이브로"),
            new SeedBanner("twelfth-bell", "뮤지컬", "자정의 종이 울리면", "연말과 새해를 잇는 하룻밤의 창작 뮤지컬"),
            new SeedBanner("west-attic-inventor", "뮤지컬", "다락방에서 태어난 발명품들", "4주 동안 이어지는 창작 뮤지컬, 열 번의 무대"),
            new SeedBanner("neighborhood-detective", "연극", "사건은 없고 소문만 많은 동네", "이웃집 탐정이 벌이는 유쾌한 소동극"),
            new SeedBanner("broken-clock-shop", "연극", "모두 다른 시간을 가리키는 가게", "멈춘 시계를 고치는 시계방의 봄"),
            new SeedBanner("thousand-paper-cranes", "뮤지컬", "천 번째 종이학을 접기까지", "늦겨울부터 봄까지 이어지는 창작 뮤지컬"),
            new SeedBanner("solbaram-kkotsaem", "콘서트", "꽃샘추위 끝의 시티팝", "솔바람 트리오가 들려주는 이른 봄의 무대"),
            new SeedBanner("spring-symphony-awakening-fields", "클래식", "교향곡으로 여는 봄", "전원을 그린 교향곡, 봄맞이 교향악의 밤"),
            new SeedBanner("rooftop-gardener", "뮤지컬", "지붕마다 정원을 심는 사람", "도시의 옥상에서 피어나는 봄의 뮤지컬"));


    record SeedNotice(String slug, String title, String body, boolean pinned, int publishedDaysAgo) {
    }

    /** 서비스 안내 3건(그중 1건 고정). */
    static final List<SeedNotice> SERVICE_NOTICES = List.of(
            new SeedNotice("service-queue-guide", "[안내] 접속 대기열 이용 방법",
                    """
                    예매가 몰리는 회차는 접속 대기열을 거쳐 좌석 선택 화면으로 들어갑니다.

                    - 대기 화면에서 내 앞 인원이 자동으로 줄어듭니다. 새로고침하지 않아도 됩니다.
                    - 대기 화면을 30초 넘게 닫아 두면 순서가 사라질 수 있습니다.
                    - 같은 회차를 여러 창에서 열면 마지막에 연 창만 순서가 유지됩니다.
                    - 입장한 뒤에는 정해진 시간 안에 좌석을 골라 예매를 마쳐 주세요.""",
                    true, 20),
            new SeedNotice("service-mock-payment", "[안내] 결제 수단 선택 안내",
                    """
                    예매 확인 화면에서 카드, 간편결제, 계좌이체 중 하나를 고를 수 있습니다.

                    이 서비스의 결제는 모의 결제입니다. 고른 결제 수단의 이름만 기록되며,
                    카드 번호나 계좌 정보는 입력받지 않고 실제 금액도 청구되지 않습니다.""",
                    false, 9),
            new SeedNotice("service-account-security", "[안내] 계정 보호를 위한 로그인 제한",
                    """
                    계정을 보호하기 위해 비밀번호를 연속으로 5번 틀리면 15분 동안 로그인할 수 없습니다.

                    - 제한 시간이 지나면 다시 로그인할 수 있습니다.
                    - 로그인에 성공하면 틀린 횟수는 처음부터 다시 셉니다.""",
                    false, 3));

    private static final DateTimeFormatter OPEN_AT =
            DateTimeFormatter.ofPattern("yyyy년 M월 d일 (E) HH:mm", Locale.KOREAN).withZone(KST);

    static String ticketOpenTitle(String showTitle) {
        return "[티켓 오픈] " + showTitle;
    }

    static String ticketOpenBody(String showTitle, String venue, String ageRating, Instant opensAt) {
        return showTitle + " 티켓 오픈 안내입니다.\n\n"
                + "- 티켓 오픈: " + OPEN_AT.format(opensAt) + "\n"
                + "- 공연 장소: " + venue + "\n"
                + "- 관람 등급: " + ageRating + "\n\n"
                + "1인 1회 최대 4매까지 예매할 수 있습니다.\n"
                + "오픈 직후에는 접속 대기열을 거쳐 좌석 선택 화면으로 들어갑니다.\n"
                + "회차별 일정과 가격은 공연 상세 화면에서 확인해 주세요.";
    }
}
