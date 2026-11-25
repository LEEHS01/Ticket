package com.ticketing.migrate;

import java.time.DayOfWeek;
import java.time.LocalDate;
import java.time.LocalTime;
import java.time.temporal.ChronoUnit;
import java.util.ArrayList;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;

import com.ticketing.migrate.Seeder.SeedGrade;
import com.ticketing.migrate.Seeder.SeedPerf;
import com.ticketing.migrate.Seeder.SeedShow;
import com.ticketing.show.Genre;

/**
 * 추가 공연 50개(19~68번, docs/next/SHOWS-ADD.md). Seeder.SHOWS의 기존 18개 뒤에 이 순서 그대로 붙는다
 * → 새 DB에서도, 18개가 있는 DB에서도 id가 19~68(포스터 파일 frontend/public/posters/{id}.webp와 연결).
 * <p>
 * 제목·slug·공연장·기간·회차 수·예매 상태·한 줄 소개는 문서의 표 그대로다. 출연진·소개 글·관람 등급·공연 시간·등급과 가격·포스터 색은
 * 이 파일에서 새로 지었다(모두 가상의 이름과 문구). 회차 날짜·시각과 판매율은 문서의 규칙대로 아래 함수가 정한다(결정적).
 * <p>
 * 날짜는 기존 공연처럼 "시드를 돌린 날 기준 상대 날짜"다. 표의 날짜는 기준일 {@link #BASE}(2026-11-25)에 돌렸을 때의 날짜이고,
 * 회차 시각(평일 저녁, 주말 낮·저녁)도 기준일로 계산한 요일을 따른다.
 */
final class AddedShows {

    private AddedShows() {
    }

    /** 표의 날짜를 상대 날짜로 바꿀 때의 기준일. */
    static final LocalDate BASE = LocalDate.of(2026, 11, 25);

    /** 새 공연장(문서의 표). 기존 공연장은 지금 쓰는 배치를 그대로 쓴다(Seeder의 기존 18개와 같음). */
    static final Map<String, VenueLayout> VENUE_LAYOUTS = Map.ofEntries(
            Map.entry("누리 아트홀", VenueLayout.FAN),
            Map.entry("별무리 라이브홀", VenueLayout.SMALL),
            Map.entry("물결 야외극장", VenueLayout.MEDIUM),
            Map.entry("온새미로 극장", VenueLayout.MEDIUM),
            Map.entry("다온 아트센터 대극장", VenueLayout.CUT_CORNERS),
            Map.entry("별빛 씨어터", VenueLayout.FAN),
            Map.entry("소금꽃 소극장", VenueLayout.SMALL),
            Map.entry("나래 소극장", VenueLayout.SMALL),
            Map.entry("모퉁이 극장", VenueLayout.CUT_CORNERS),
            Map.entry("하늘결 체임버홀", VenueLayout.FAN),
            Map.entry("미리내 콘서트홀", VenueLayout.MEDIUM),
            // 새 공연장 6곳
            Map.entry("윤슬 홀", VenueLayout.MEDIUM),
            Map.entry("은행나무 소극장", VenueLayout.SMALL),
            Map.entry("바다숲 아트홀", VenueLayout.MEDIUM),
            Map.entry("가온 아트홀", VenueLayout.CUT_CORNERS),
            Map.entry("새솔 극장", VenueLayout.SMALL),
            Map.entry("파도소리 홀", VenueLayout.FAN));

    /** 공연 slug → 한 줄 소개(표의 값 그대로). ContentSeed.TAGLINES에 합쳐진다. */
    static final Map<String, String> TAGLINES = new LinkedHashMap<>();

    /** 공연 번호(19~68) → slug. 테스트가 번호와 순서를 대조한다. */
    static final Map<Integer, String> NUMBERS = new LinkedHashMap<>();

    // ---------------------------------------------------------------------------------------------- 예매 시작

    /** 예매 시작: 일(기준일과의 차이)과 시각. */
    record Open(int day, LocalTime time) {
    }

    /** 판매 중: daysAgo일 전 14시(클래식은 10시)에 열렸다. */
    private static Open onSale(int daysAgo) {
        return new Open(-daysAgo, null);
    }

    /** 오픈 예정: 표에 적힌 일시. md = "12-01" */
    private static Open opens(String md, int hour) {
        return new Open(day(md), LocalTime.of(hour, 0));
    }

    // ---------------------------------------------------------------------------------------------- 등급

    /** 소극장 2등급: R 앞 3행, S 나머지. */
    private static List<SeedGrade> two(int r, int s) {
        return List.of(new SeedGrade("R", "R석", r, 3), new SeedGrade("S", "S석", s, 0));
    }

    /** 3등급: VIP 앞 vipRows행, R 4행, S 나머지. */
    private static List<SeedGrade> three(int vipRows, int vip, int r, int s) {
        return List.of(new SeedGrade("VIP", "VIP석", vip, vipRows), new SeedGrade("R", "R석", r, 4),
                new SeedGrade("S", "S석", s, 0));
    }

    /** 클래식 3등급: R 3행, S 4행, A 나머지. */
    private static List<SeedGrade> classic(int r, int s, int a) {
        return List.of(new SeedGrade("R", "R석", r, 3), new SeedGrade("S", "S석", s, 4), new SeedGrade("A", "A석", a, 0));
    }

    // ---------------------------------------------------------------------------------------------- 회차

    /** "12-11" → 기준일과의 차이(12월은 2026년, 1~3월은 2027년). */
    static int day(String md) {
        int month = Integer.parseInt(md.substring(0, 2));
        int dom = Integer.parseInt(md.substring(3, 5));
        LocalDate d = LocalDate.of(month >= 11 ? 2026 : 2027, month, dom);
        return (int) ChronoUnit.DAYS.between(BASE, d);
    }

    /** 매진으로 둘 회차(공연 번호, 회차 순번 0부터). 22번은 따로 거의 매진(95%). */
    private static boolean soldOut(int no, int index, int count) {
        return (no == 20 && index == count - 1) || (no == 33 && index == 5) || (no == 46 && index == 0);
    }

    /**
     * 판매율: 가까운 회차일수록 높고 먼 회차일수록 낮다. 2월 이후(기준일 +68일~)는 0~20%. 오픈 예정이면 0.
     * 공연·회차마다 ±10% 흔들어 같은 값이 줄지어 나오지 않게 한다(결정적).
     */
    static double soldRatio(int no, int index, int count, int offset, boolean upcoming) {
        if (upcoming) {
            return 0;
        }
        if (no == 22) {
            return 0.95;
        }
        if (soldOut(no, index, count)) {
            return 1.0;
        }
        double base = offset <= 21 ? 0.6 : offset <= 40 ? 0.42 : offset <= 55 ? 0.28 : offset < 68 ? 0.2 : 0.08;
        double jitter = ((no * 31 + index * 17) % 21) / 100.0 - 0.1;
        double r = Math.max(0, base + jitter);
        return offset >= 68 ? Math.min(r, 0.2) : Math.min(r, 0.9);
    }

    private static boolean weekend(int offset) {
        DayOfWeek d = BASE.plusDays(offset).getDayOfWeek();
        return d == DayOfWeek.SATURDAY || d == DayOfWeek.SUNDAY;
    }

    /**
     * 회차 count개를 첫날~마지막 날에 고르게 놓는다. 평일은 저녁, 주말은 낮·저녁을 번갈아.
     * 같은 날에 두 회차가 떨어지면 낮·저녁으로 나눈다. evening: 평일 저녁 시각, matinee/weekendEvening: 주말 시각.
     */
    private static List<SeedPerf> schedule(int no, String first, String last, int count, boolean upcoming,
            LocalTime evening, LocalTime matinee, LocalTime weekendEvening) {
        int a = day(first);
        int b = day(last);
        List<Integer> days = new ArrayList<>();
        for (int i = 0; i < count; i++) {
            days.add(count == 1 ? a : a + (int) Math.round((double) i * (b - a) / (count - 1)));
        }
        List<SeedPerf> out = new ArrayList<>();
        for (int i = 0; i < count; i++) {
            int d = days.get(i);
            boolean sameDayAsPrev = i > 0 && days.get(i - 1) == d;
            boolean sameDayAsNext = i + 1 < count && days.get(i + 1) == d;
            LocalTime time;
            if (sameDayAsNext) {
                time = matinee;
            } else if (sameDayAsPrev) {
                time = weekendEvening;
            } else if (weekend(d)) {
                time = i % 2 == 0 ? matinee : weekendEvening;
            } else {
                time = evening;
            }
            out.add(new SeedPerf(d, time, soldRatio(no, i, count, d, upcoming)));
        }
        return out;
    }

    private static List<String> cast(String... names) {
        return List.of(names);
    }

    // ---------------------------------------------------------------------------------------------- 공연 하나

    private static SeedShow show(int no, String slug, String title, Genre genre, String venue, String first, String last,
            int count, Open open, String age, int minutes, List<String> cast, String description,
            List<SeedGrade> grades, int hue, String tagline) {
        VenueLayout layout = VENUE_LAYOUTS.get(venue);
        if (layout == null) {
            throw new IllegalStateException("좌석 배치가 정해지지 않은 공연장: " + venue);
        }
        boolean upcoming = open.day() > 0;
        LocalTime openTime = open.time() != null ? open.time()
                : genre == Genre.CLASSIC ? LocalTime.of(10, 0) : LocalTime.of(14, 0);
        List<SeedPerf> perfs = switch (genre) {
            case CONCERT -> schedule(no, first, last, count, upcoming, LocalTime.of(20, 0), LocalTime.of(15, 0),
                    LocalTime.of(19, 0));
            case MUSICAL -> schedule(no, first, last, count, upcoming, LocalTime.of(19, 30), LocalTime.of(14, 0),
                    LocalTime.of(18, 30));
            case PLAY -> schedule(no, first, last, count, upcoming, LocalTime.of(20, 0), LocalTime.of(15, 0),
                    LocalTime.of(19, 0));
            case CLASSIC -> schedule(no, first, last, count, upcoming, LocalTime.of(19, 30), LocalTime.of(14, 0),
                    LocalTime.of(17, 0));
        };
        if (no == 22) {
            perfs = List.of(new SeedPerf(day(first), LocalTime.of(22, 0), soldRatio(no, 0, 1, day(first), upcoming)));
        }
        TAGLINES.put(slug, tagline);
        NUMBERS.put(no, slug);
        return new SeedShow(slug, title, genre, venue, open.day(), openTime, age, minutes, cast, description, layout,
                grades, perfs, hue);
    }

    private static final Genre C = Genre.CONCERT;
    private static final Genre M = Genre.MUSICAL;
    private static final Genre P = Genre.PLAY;
    private static final Genre K = Genre.CLASSIC;

    /** 19~68번, 문서의 표 순서. 반드시 이 순서를 지킨다(번호 = id). */
    static final List<SeedShow> SHOWS = List.of(
            // ---- 콘서트 19~32 ----
            show(19, "stove-side-acoustic-live", "겨울밤 어쿠스틱 라이브 〈난로 곁에서〉", C, "별무리 라이브홀",
                    "12-11", "12-12", 2, onSale(3), "8세 이상", 100, cast("한겨울 어쿠스틱", "모닥불 세션"),
                    "통기타와 첼로, 목소리만으로 꾸민 작은 겨울 라이브.\n객석 가까이 놓인 난로처럼 조용하고 따뜻한 곡들을 골랐습니다.",
                    two(66_000, 55_000), 18, "난로 곁에 둘러앉아 듣는 통기타 라이브"),
            show(20, "eunhasu-twelve-months", "은하수 듀오 연말 콘서트 〈열두 달의 노래〉", C, "누리 아트홀",
                    "12-18", "12-20", 3, onSale(7), "8세 이상", 120, cast("은하수 듀오"),
                    "1월부터 12월까지, 달마다 한 곡씩 고른 노래로 한 해를 돌아보는 연말 공연입니다.",
                    three(2, 110_000, 99_000, 77_000), 228, "한 해를 열두 곡으로 돌아보는 연말 무대"),
            show(21, "paper-plane-cleared-to-land", "종이비행기 단독 콘서트 〈착륙 허가〉", C, "윤슬 홀",
                    "12-26", "12-27", 2, onSale(11), "만 7세 이상", 140, cast("종이비행기"),
                    "3년 만에 돌아온 종이비행기의 단독 공연.\n새 앨범 수록곡 전곡을 처음으로 라이브로 들려줍니다.",
                    three(2, 132_000, 121_000, 99_000), 200, "3년 만의 단독 공연, 새 앨범 전곡 라이브"),
            show(22, "last-night-first-morning", "해넘이 콘서트 〈마지막 밤, 첫 아침〉", C, "윤슬 홀",
                    "12-31", "12-31", 1, onSale(18), "만 7세 이상", 150, cast("새벽빛 밴드", "솔바람 트리오", "노을빛 재즈 쿼텟"),
                    "세 팀이 차례로 무대에 올라 한 해의 마지막 밤을 함께 보냅니다.\n자정 카운트다운 뒤 새해 첫 곡으로 마무리합니다.",
                    three(2, 143_000, 132_000, 110_000), 12, "카운트다운과 함께 맞는 새해 첫 곡"),
            show(23, "dalmuri-round-night", "달무리 밴드 겨울 투어 〈둥근 밤〉", C, "파도소리 홀",
                    "01-09", "01-10", 2, onSale(5), "8세 이상", 130, cast("달무리 밴드"),
                    "달무리 밴드의 겨울 투어가 바다 곁 공연장에서 이어집니다.\n파도 소리를 닮은 신곡 두 곡을 처음 공개합니다.",
                    three(2, 121_000, 110_000, 88_000), 238, "바다 곁 공연장에서 만나는 겨울 투어"),
            show(24, "new-year-big-band-swing", "신년 빅밴드 콘서트 〈스윙, 새해〉", C, "가온 아트홀",
                    "01-16", "01-16", 1, onSale(9), "전체 관람가", 110, cast("가온 시티 빅밴드", "보컬 여다경"),
                    "열일곱 명의 관악과 리듬 섹션이 들려주는 스윙의 밤.\n흥겨운 편곡으로 새해를 시작합니다.",
                    three(2, 99_000, 88_000, 66_000), 45, "열일곱 명의 관악이 여는 새해의 스윙"),
            show(25, "room-at-four-pm", "늦은 오후 소극장 콘서트 〈오후 네 시의 방〉", C, "은행나무 소극장",
                    "01-22", "01-24", 4, onSale(13), "8세 이상", 90, cast("늦은 오후"),
                    "백 석이 안 되는 작은 방에서 네 번 여는 소극장 콘서트.\n회차마다 마지막 곡이 다릅니다.",
                    two(55_000, 44_000), 32, "가까이에서 듣는 소극장 네 번의 무대"),
            show(26, "night-flowing-backwards", "모래시계 세션 라이브 〈거꾸로 흐르는 밤〉", C, "별무리 라이브홀",
                    "01-29", "01-30", 2, onSale(16), "만 7세 이상", 110, cast("모래시계 세션"),
                    "펑크와 소울로 쉬지 않고 달리는 두 시간.\n스탠딩처럼 즐길 수 있도록 편곡을 새로 짰습니다.",
                    two(77_000, 66_000), 290, "펑크와 소울로 달리는 주말 밤"),
            show(27, "rhythm-of-the-wind", "국악 크로스오버 콘서트 〈바람의 장단〉", C, "새솔 극장",
                    "02-05", "02-06", 2, onSale(2), "8세 이상", 100, cast("바람결 국악 앙상블", "대금 석하윤"),
                    "대금과 가야금, 전자음이 만나는 새로운 장단.\n전통 장단 위에 쌓은 일곱 곡을 들려줍니다.",
                    two(60_000, 45_000), 150, "대금과 전자음이 만나는 새로운 장단"),
            show(28, "valentine-jazz-standards", "발렌타인 재즈 나이트 〈두 사람의 스탠더드〉", C, "별무리 라이브홀",
                    "02-13", "02-14", 2, onSale(6), "8세 이상", 100, cast("노을빛 재즈 쿼텟", "보컬 채이안"),
                    "둘이 함께 듣기 좋은 재즈 스탠더드만 골랐습니다.\n공연 중간에 관객 신청곡을 한 곡 받습니다.",
                    two(77_000, 55_000), 340, "둘이 듣기 좋은 재즈 스탠더드의 밤"),
            show(29, "sunlit-spot", "한낮의 기타 단독 공연 〈볕 드는 자리〉", C, "누리 아트홀",
                    "02-20", "02-21", 2, onSale(10), "8세 이상", 100, cast("한낮의 기타"),
                    "기타 한 대와 목소리로 채우는 늦겨울 오후.\n볕이 잘 드는 창가 같은 노래들을 모았습니다.",
                    three(2, 88_000, 77_000, 55_000), 48, "기타 한 대로 채우는 늦겨울 오후"),
            show(30, "wake-from-hibernation-rock", "인도어 록 페스티벌 〈겨울잠 깨우기〉", C, "바다숲 아트홀",
                    "02-27", "02-28", 2, opens("12-01", 20), "만 7세 이상", 240,
                    cast("파란 소음", "동굴 라디오", "철새 클럽", "녹슨 자전거", "늦잠 밴드", "유리 고래"),
                    "이틀 동안 여섯 팀이 번갈아 무대에 서는 실내 록 페스티벌.\n하루 세 팀씩, 팀마다 한 시간 안팎의 공연입니다.",
                    three(2, 110_000, 99_000, 77_000), 5, "이틀간 여섯 팀이 깨우는 겨울의 끝"),
            show(31, "spring-indie-saesun", "봄맞이 인디 쇼케이스 〈새순〉", C, "은행나무 소극장",
                    "03-05", "03-07", 3, opens("12-15", 14), "8세 이상", 120,
                    cast("봄비 레코드", "작은 정원", "연필 소리", "오후 산책", "흰 종이", "새벽 우편"),
                    "올봄 처음 무대에 서는 신인 여섯 팀의 쇼케이스.\n회차마다 두 팀씩 나와 각자 다섯 곡을 부릅니다.",
                    two(44_000, 33_000), 105, "올봄 처음 무대에 서는 신인 여섯 팀"),
            show(32, "solbaram-kkotsaem", "솔바람 트리오 봄 콘서트 〈꽃샘〉", C, "누리 아트홀",
                    "03-19", "03-21", 3, opens("01-12", 14), "만 7세 이상", 110, cast("솔바람 트리오"),
                    "꽃샘추위가 물러갈 무렵 듣는 따뜻한 시티팝.\n봄을 기다리며 만든 신곡 세 곡을 처음 공개합니다.",
                    three(2, 99_000, 88_000, 66_000), 330, "꽃샘추위 끝에 듣는 따뜻한 시티팝"),

            // ---- 뮤지컬 33~45 ----
            show(33, "snowman-photo-studio", "뮤지컬 〈눈사람 사진관〉", M, "온새미로 극장",
                    "12-08", "12-27", 8, onSale(19), "8세 이상", 140, cast("윤다올", "기서진", "모예린", "탁하준"),
                    "눈이 쌓인 날에만 문을 여는 작은 사진관과, 녹기 전에 사진 한 장을 남기려는 눈사람의 이야기.\n2막 구성, 인터미션 15분.",
                    three(3, 140_000, 120_000, 90_000), 195, "녹기 전에 한 장, 겨울에만 여는 사진관"),
            show(34, "twelfth-bell", "뮤지컬 〈열두 번째 종소리〉", M, "다온 아트센터 대극장",
                    "12-22", "01-03", 8, onSale(15), "8세 이상", 150, cast("남궁새벽", "피도연", "안시율", "구하랑"),
                    "자정의 열두 번째 종이 울리는 순간 시작되는 하룻밤.\n한 해의 마지막 밤, 시계탑 아래에 모인 사람들의 이야기입니다.\n2막 구성, 인터미션 20분.",
                    three(3, 150_000, 130_000, 99_000), 260, "자정의 종이 울리면 시작되는 하룻밤"),
            show(35, "child-who-picks-stars", "뮤지컬 〈별을 줍는 아이〉", M, "별빛 씨어터",
                    "12-19", "12-27", 6, onSale(8), "36개월 이상", 80, cast("소하늘", "전다빈"),
                    "밤하늘에서 떨어진 별을 주워 다시 돌려보내는 아이의 모험.\n온 가족이 함께 보는 겨울 뮤지컬입니다.",
                    three(2, 77_000, 66_000, 44_000), 225, "떨어진 별을 하늘로 돌려보내는 가족 뮤지컬"),
            show(36, "voyage-logbook", "뮤지컬 〈항해일지〉", M, "바다숲 아트홀",
                    "01-08", "01-24", 8, onSale(12), "13세 이상", 155, cast("방서우", "추은결", "길도하", "마예슬"),
                    "할아버지의 낡은 항해일지 한 권을 따라 떠나는 손녀의 여정.\n일지 속 바다와 지금의 바다가 무대 위에서 겹쳐집니다.\n2막 구성, 인터미션 20분.",
                    three(3, 140_000, 120_000, 90_000), 210, "낡은 일지 한 권을 따라 떠나는 항해"),
            show(37, "west-attic-inventor", "뮤지컬 〈서쪽 다락방의 발명가〉", M, "온새미로 극장",
                    "01-15", "02-07", 10, onSale(17), "8세 이상", 145, cast("어지환", "석다온", "편시아", "봉재희"),
                    "서쪽 다락방에 사는 발명가와 그가 만든 엉뚱한 발명품들.\n발명품마다 한 곡씩, 열두 곡의 넘버가 이어집니다.\n2막 구성, 인터미션 15분.",
                    three(3, 140_000, 120_000, 90_000), 35, "다락방에서 태어난 엉뚱한 발명품들"),
            show(38, "rabbit-hole-bakery", "뮤지컬 〈토끼굴 빵집〉", M, "별빛 씨어터",
                    "01-09", "01-17", 5, onSale(4), "36개월 이상", 75, cast("도담희", "연가을"),
                    "땅속 토끼굴에 문을 연 작은 빵집에서 벌어지는 달콤한 소동.\n객석과 함께 부르는 노래가 세 곡 있습니다.",
                    three(2, 70_000, 60_000, 40_000), 30, "땅속 빵집에서 벌어지는 달콤한 소동"),
            show(39, "umbrella-repairman", "뮤지컬 〈우산 수선공〉", M, "가온 아트홀",
                    "01-29", "02-07", 6, onSale(14), "8세 이상", 130, cast("하지호", "묵세린", "류다겸"),
                    "비 오는 골목 끝, 고장 난 우산과 마음을 함께 고쳐 주는 가게.\n세 명의 배우가 열 명의 손님을 연기합니다.",
                    three(2, 110_000, 99_000, 77_000), 205, "고장 난 우산과 마음을 함께 고치는 가게"),
            show(40, "midnight-botanical-garden", "뮤지컬 〈한밤의 식물원〉", M, "다온 아트센터 대극장",
                    "02-12", "02-28", 9, onSale(20), "8세 이상", 150, cast("나도윤", "설하은", "변지오", "탁서아"),
                    "문 닫은 식물원에서 밤마다 깨어나는 식물들과 야간 경비원의 이야기.\n2막 구성, 인터미션 20분.",
                    three(3, 150_000, 130_000, 99_000), 120, "문 닫은 식물원에서 깨어나는 것들"),
            show(41, "hourglass-inn", "뮤지컬 〈모래시계 여관〉", M, "파도소리 홀",
                    "02-19", "02-28", 6, opens("11-27", 14), "13세 이상", 140, cast("양시온", "제나래", "옥도현"),
                    "하룻밤만 묵을 수 있는 바닷가 여관에 모인 손님들.\n모래시계의 모래가 다 떨어지기 전에 각자의 사연이 풀립니다.",
                    three(2, 120_000, 100_000, 80_000), 40, "하룻밤만 묵을 수 있는 바닷가 여관"),
            show(42, "thousand-paper-cranes", "뮤지컬 〈종이학 천 마리〉", M, "온새미로 극장",
                    "02-26", "03-21", 10, opens("12-08", 14), "8세 이상", 145, cast("서다래", "간윤호", "임채온", "표하린"),
                    "천 마리를 접으면 소원이 이루어진다는 종이학.\n천 번째 종이학을 접기까지 한 교실에서 보낸 일 년의 이야기입니다.\n2막 구성, 인터미션 15분.",
                    three(3, 140_000, 120_000, 90_000), 355, "천 번째 종이학을 접기까지의 이야기"),
            show(43, "thief-who-stole-spring", "뮤지컬 〈봄을 훔친 도둑〉", M, "별빛 씨어터",
                    "03-06", "03-21", 6, opens("12-17", 14), "36개월 이상", 85, cast("주예나", "탁은솔"),
                    "어느 날 사라져 버린 봄을 찾아 나선 아이들의 모험.\n봄을 훔친 도둑의 정체는 마지막 장면에서 밝혀집니다.",
                    three(2, 77_000, 66_000, 44_000), 95, "사라진 봄을 찾아 나선 아이들의 모험"),
            show(44, "bluebird-telegram", "뮤지컬 〈파랑새 전보〉", M, "바다숲 아트홀",
                    "03-12", "03-28", 8, opens("01-05", 14), "8세 이상", 150, cast("모시우", "구다인", "엄하율", "길예찬"),
                    "작은 항구 마을의 전신국에 주인 없는 전보 한 통이 도착합니다.\n전보를 전하려는 신입 배달원의 일주일.\n2막 구성, 인터미션 20분.",
                    three(3, 140_000, 120_000, 90_000), 215, "전신국에 도착한 주인 없는 전보 한 통"),
            show(45, "rooftop-gardener", "뮤지컬 〈지붕 위의 정원사〉", M, "다온 아트센터 대극장",
                    "03-19", "03-31", 7, opens("01-14", 14), "8세 이상", 145, cast("한도윤", "차세린", "봉지안", "위다현"),
                    "도시의 지붕마다 몰래 정원을 심는 정원사와 그를 쫓는 구청 직원.\n2막 구성, 인터미션 15분.",
                    three(3, 150_000, 130_000, 99_000), 100, "도시의 지붕마다 정원을 심는 사람"),

            // ---- 연극 46~57 ----
            show(46, "winter-break-homework", "연극 〈겨울 방학 숙제〉", P, "나래 소극장",
                    "12-03", "12-13", 6, onSale(20), "13세 이상", 100, cast("우다솜", "신하람", "명지후"),
                    "서른 살이 되어 다시 펼친 초등학교 겨울 방학 일기장.\n밀린 숙제를 끝내려는 세 친구의 하룻밤입니다.",
                    two(50_000, 40_000), 210, "서른 살에 다시 펼친 일기장 숙제"),
            show(47, "noodle-shop-by-photo-studio", "연극 〈사진관 옆 국숫집〉", P, "소금꽃 소극장",
                    "12-10", "12-20", 6, onSale(10), "13세 이상", 95, cast("공태오", "남윤슬", "피연우"),
                    "오래된 사진관 옆 국숫집에서 국수 한 그릇에 풀려 가는 이웃들의 오해.",
                    two(50_000, 40_000), 25, "국수 한 그릇에 풀리는 이웃의 오해"),
            show(48, "midnight-radio", "연극 〈자정의 라디오〉", P, "모퉁이 극장",
                    "12-09", "12-20", 6, onSale(12), "15세 이상", 100, cast("석지운", "하예담", "도건우"),
                    "마지막 방송을 앞둔 심야 라디오 부스.\n진행자와 작가, 그리고 매일 밤 사연을 보내던 청취자가 처음으로 마주합니다.",
                    two(55_000, 44_000), 250, "마지막 방송을 앞둔 심야 라디오 부스"),
            show(49, "night-elevator-stopped", "연극 〈엘리베이터가 멈춘 밤〉", P, "은행나무 소극장",
                    "12-29", "01-10", 7, onSale(5), "13세 이상", 90, cast("임도하", "채서윤", "변시후", "강다경"),
                    "새해를 몇 시간 앞두고 9층과 10층 사이에 멈춘 엘리베이터.\n처음 만난 네 사람이 갇힌 채 새해를 맞는 코미디입니다.",
                    two(50_000, 40_000), 55, "새해 직전, 9층과 10층 사이에 갇힌 넷"),
            show(50, "grandma-recipe-notebook", "연극 〈할머니의 레시피 노트〉", P, "새솔 극장",
                    "01-07", "01-17", 6, onSale(8), "8세 이상", 100, cast("고은채", "여태윤", "소다인"),
                    "할머니가 남긴 손글씨 레시피 노트를 따라 한 가족이 밥상을 차립니다.\n음식 냄새가 객석까지 퍼지는 연극입니다.",
                    two(45_000, 35_000), 15, "손글씨 노트에 남은 한 가족의 밥상"),
            show(51, "third-drawer", "연극 〈세 번째 서랍〉", P, "모퉁이 극장",
                    "01-14", "01-24", 6, onSale(15), "15세 이상", 105, cast("탁지원", "어하윤", "명서준"),
                    "절대 열면 안 된다는 세 번째 서랍을 둘러싼 하숙집 미스터리.\n서랍이 열리는 순간 이야기가 뒤집힙니다.",
                    two(55_000, 44_000), 275, "열면 안 되는 서랍을 둘러싼 미스터리"),
            show(52, "neighborhood-detective", "연극 〈이웃집 탐정 사무소〉", P, "나래 소극장",
                    "01-21", "02-14", 10, onSale(18), "13세 이상", 100, cast("방도율", "제하나", "구윤재"),
                    "사건은 없고 소문만 많은 동네의 탐정 사무소.\n고양이 실종부터 사라진 화분까지, 사소한 의뢰가 이어지는 코미디입니다.",
                    two(50_000, 40_000), 70, "사건은 없고 소문만 많은 동네 탐정"),
            show(53, "daytime-moon", "연극 〈낮달〉", P, "소금꽃 소극장",
                    "02-04", "02-14", 5, onSale(3), "13세 이상", 95, cast("윤서하", "단지민"),
                    "낮에도 하늘에 떠 있는 달처럼, 떠난 사람의 빈자리를 지키는 두 사람의 이야기.",
                    two(50_000, 40_000), 220, "낮에도 떠 있는 달처럼 남은 사람들"),
            show(54, "rainy-day-aquarium", "연극 〈비 오는 날의 수족관〉", P, "은행나무 소극장",
                    "02-18", "02-28", 6, onSale(11), "13세 이상", 95, cast("하선우", "채도아"),
                    "비 오는 평일, 손님 하나 없는 수족관에서 만난 사육사와 방문객.\n둘만의 두 시간이 천천히 흘러갑니다.",
                    two(50_000, 40_000), 190, "손님 없는 수족관에서 만난 두 사람"),
            show(55, "graduation-photo", "연극 〈졸업 사진〉", P, "가온 아트홀",
                    "02-25", "03-07", 6, opens("12-10", 14), "13세 이상", 110, cast("주하진", "엄지윤", "변도담", "국세아"),
                    "졸업 앨범 속 사진 한 장 때문에 20년 만에 다시 모인 3학년 2반.\n그날 사진에서 빠진 한 사람의 이야기가 시작됩니다.",
                    two(55_000, 44_000), 75, "20년 만에 다시 모인 3학년 2반"),
            show(56, "broken-clock-shop", "연극 〈고장 난 시계방〉", P, "모퉁이 극장",
                    "03-04", "03-14", 6, opens("12-22", 14), "13세 이상", 100, cast("명하온", "석예준", "도시아"),
                    "가게 안의 모든 시계가 서로 다른 시간을 가리키는 시계방.\n시계마다 멈춘 이유를 찾아가는 연극입니다.",
                    two(55_000, 44_000), 300, "모든 시계가 다른 시간을 가리키는 가게"),
            show(57, "before-april-comes", "연극 〈사월이 오기 전에〉", P, "나래 소극장",
                    "03-18", "03-28", 6, opens("01-19", 14), "13세 이상", 95, cast("여지안", "곽도윤", "선하율"),
                    "이사를 앞둔 삼월, 봄이 오기 전에 정리해야 할 짐과 마음들.",
                    two(50_000, 40_000), 135, "봄이 오기 전 정리해야 할 것들"),

            // ---- 클래식 58~68 ----
            show(58, "violin-winter-letter", "바이올린 리사이틀 〈겨울 편지〉", K, "하늘결 체임버홀",
                    "12-11", "12-11", 1, onSale(9), "초등학생 이상", 90, cast("바이올리니스트 윤가람", "피아니스트 석소은"),
                    "겨울을 주제로 고른 바이올린 소나타와 소품들.\n한 곡 한 곡을 편지처럼 들려주는 리사이틀입니다.",
                    classic(70_000, 50_000, 30_000), 205, "바이올린 한 대로 쓰는 겨울의 편지"),
            show(59, "choir-under-candlelight", "크리스마스 합창의 밤 〈촛불 아래〉", K, "하늘결 체임버홀",
                    "12-23", "12-24", 2, onSale(14), "초등학생 이상", 90, cast("하늘결 실내 합창단", "지휘 남다율"),
                    "촛불만 켜 둔 무대에서 부르는 무반주 합창과 캐럴.\n마지막 곡은 객석과 함께 부릅니다.",
                    classic(60_000, 45_000, 30_000), 40, "촛불 아래에서 듣는 무반주 합창"),
            show(60, "year-end-gala-concert", "송년 음악회 〈한 해의 끝에서〉", K, "미리내 콘서트홀",
                    "12-29", "12-30", 2, onSale(16), "초등학생 이상", 120, cast("미리내 필하모닉", "지휘 서하람", "소프라노 연다은"),
                    "한 해의 마지막 주에 관현악으로 듣는 서곡과 교향곡 악장들.",
                    classic(90_000, 70_000, 40_000), 350, "관현악으로 배웅하는 한 해의 마지막"),
            show(61, "first-sunrise-new-year-concert", "신년 음악회 〈첫 해가 뜨는 소리〉", K, "미리내 콘서트홀",
                    "01-02", "01-03", 2, onSale(13), "초등학생 이상", 110, cast("미리내 필하모닉", "지휘 서하람"),
                    "왈츠와 폴카, 서곡으로 여는 새해 첫 주말.\n앙코르는 해마다 같은 곡으로 끝납니다.",
                    classic(90_000, 70_000, 40_000), 50, "왈츠와 서곡으로 여는 새해 첫 주말"),
            show(62, "woodwind-forest-talk", "목관 오중주의 오후 〈숲의 대화〉", K, "하늘결 체임버홀",
                    "01-17", "01-17", 1, onSale(4), "8세 이상", 80, cast("숲길 목관 오중주"),
                    "플루트·오보에·클라리넷·호른·바순, 다섯 악기가 주고받는 숲의 이야기.",
                    classic(50_000, 40_000, 25_000), 110, "다섯 관악기가 주고받는 숲의 이야기"),
            show(63, "youth-orchestra-northern-symphony", "미리내 청년 오케스트라 겨울 연주회 〈북쪽의 교향곡〉", K, "미리내 콘서트홀",
                    "01-30", "01-31", 2, onSale(6), "8세 이상", 120, cast("미리내 청년 오케스트라", "지휘 한소율"),
                    "북쪽 나라 작곡가들의 겨울 교향곡을 청년 연주자 80명이 들려줍니다.",
                    classic(60_000, 45_000, 25_000), 200, "북쪽 나라 작곡가들의 겨울 교향곡"),
            show(64, "six-strings-night", "기타 리사이틀 〈여섯 줄의 밤〉", K, "하늘결 체임버홀",
                    "02-06", "02-06", 1, onSale(1), "8세 이상", 90, cast("기타리스트 마도겸"),
                    "클래식 기타 한 대로 듣는 남쪽 나라의 춤곡과 소나타.",
                    classic(55_000, 40_000, 25_000), 20, "클래식 기타 독주로 듣는 남쪽의 춤곡"),
            show(65, "four-hands-waltz", "피아노 듀오 콘서트 〈네 손의 왈츠〉", K, "하늘결 체임버홀",
                    "02-13", "02-13", 1, onSale(7), "8세 이상", 90, cast("피아니스트 윤해솔", "피아니스트 곽다은"),
                    "한 대의 피아노 앞에 나란히 앉은 두 사람이 연주하는 왈츠와 무곡.",
                    classic(60_000, 45_000, 30_000), 320, "한 대의 피아노, 두 사람의 왈츠"),
            show(66, "opera-gala-aria-night", "오페라 갈라 〈아리아의 밤〉", K, "윤슬 홀",
                    "02-26", "02-27", 2, opens("12-03", 10), "초등학생 이상", 130,
                    cast("소프라노 연다은", "메조소프라노 국하린", "테너 피윤호", "바리톤 석도진"),
                    "네 명의 성악가가 오페라의 명장면 아리아와 이중창을 차례로 부릅니다.\n막마다 짧은 해설이 곁들여집니다.",
                    classic(110_000, 80_000, 50_000), 280, "네 명의 성악가가 부르는 오페라 명장면"),
            show(67, "quartet-spring-sprouts", "하늘결 현악 사중주 봄 연주회 〈새싹의 악장〉", K, "하늘결 체임버홀",
                    "03-12", "03-13", 2, opens("01-07", 10), "8세 이상", 100, cast("하늘결 현악 사중주"),
                    "봄을 주제로 고른 현악 사중주 세 곡.\n첫 곡은 이 공연을 위해 새로 쓴 작품입니다.",
                    classic(70_000, 55_000, 35_000), 90, "현악 사중주로 맞는 첫 봄의 악장"),
            show(68, "spring-symphony-awakening-fields", "봄맞이 교향악의 밤 〈깨어나는 들판〉", K, "윤슬 홀",
                    "03-26", "03-27", 2, opens("01-21", 10), "초등학생 이상", 120, cast("윤슬 심포니", "지휘 남다율"),
                    "들판과 시냇가를 그린 전원 교향곡으로 여는 봄의 음악회.",
                    classic(90_000, 70_000, 40_000), 85, "전원을 그린 교향곡으로 여는 봄"));
}
