# 04. 필요한 이미지와 생성 프롬프트

사용자가 생성 도구(젠스파크)에 그대로 붙여 넣을 수 있게 정리했다. 화면에서의 자리와 치수는 [03-screen-spec.md](03-screen-spec.md)를 따른다.
이미지가 오기 전에도 화면은 대체 표시(03 문서 3.7)로 깨지지 않는다.

---

## 1. 결론

| 종류 | 장수 | 필요 | 비고 |
|---|---|---|---|
| A. 메인 배너(PC) | **6** | 필수 | 2400×800(3:1). 왼쪽 40%는 글자 자리로 비움 |
| B. 안내 그림(대기·검색 결과 없음·없는 페이지) | **3** | 필수 | 800×800(1:1), 흰 바탕 |
| C. 공유 미리보기 그림 | 1 | 선택 | 1200×630. 글자 없이 만들고 로고는 나중에 얹음 |
| D. 상징 그림(앱 아이콘용) | 1 | 선택 | 1024×1024. 로고는 글자 로고 + 코드로 그린 별이 기본이라 없어도 됨 |
| 기존 포스터 | 18 (새로 만들 것 0) | — | **그대로 씀**(2장 참고) |

필수 9장, 선택 2장.

---

## 2. 기존 포스터 18장은 그대로 쓴다

- 지금 포스터: 3:4, 큰 것 896×1200(`{id}.webp`), 작은 것 448×600(`{id}-sm.webp`), 글자 없음, 리소 인쇄풍 그림.
- 새 배치에서 포스터가 쓰이는 가장 큰 자리와 필요한 픽셀(화면 배율 2배 기준):

| 자리 | 표시 크기 | 2배 필요 | 쓰는 파일 | 충분? |
|---|---|---|---|---|
| 상세 포스터(PC) | 300×400 | 600×800 | 큰 것 896×1200 | ✅ |
| 모바일 메인 배너 카드(포스터를 cover로 채움) | 335×400 | 670×800 | 큰 것 | ✅ (아래 약 10% 잘림) |
| 모바일 상세 포스터 | 180×240 | 360×480 | 큰 것 | ✅ |
| 랭킹 1~3위 칸 | 168×224 | 336×448 | 작은 것 448×600 | ✅ |
| 목록 카드(PC 5열) | 221×295 | 442×590 | 작은 것 | ✅ |
| 상세 흐린 배경 | 375×320(흐림) | — | 작은 것 | ✅ |

- 실제 서비스도 포스터는 3:4(NOL·티켓링크)~5:7(예스24·멜론) 세로형이라, **다른 비율이 필요 없다.**
- 포스터에 글자가 없는 점이 오히려 맞다: 새 화면은 제목을 늘 HTML 글자로 따로 쓰고, 모바일 배너 카드에서는 포스터 아래쪽에 그라데이션을 깔고 제목을 얹는다.
- 앞으로 포스터를 더 만들 때만 지킬 것: 주인공 형태를 **위쪽 60% 안**에 두기(모바일 배너 카드에서 아래 45%는 어두운 그라데이션과 제목이 덮는다).

---

## 3. 이미지 목록

| 번호 | 용도(화면 · 자리) | 크기(px) · 비율 | 장수 | 파일 이름 | 내용 | 금지 사항 |
|---|---|---|---|---|---|---|
| A-1 | 메인 · 배너 1번 | 2400×800 · 3:1 | 1 | `banner-15.png` | 뮤지컬 〈달빛 세탁소〉(공연 15): 밤에만 여는 세탁소, 달처럼 빛나는 둥근 세탁기 창, 별처럼 떠다니는 빨래 | 공통 금지(아래) |
| A-2 | 메인 · 배너 2번 | 2400×800 · 3:1 | 1 | `banner-4.png` | 뮤지컬 〈시간을 접는 소녀〉(공연 4): 무대 조명 아래 뒤돌아선 작은 소녀 실루엣, 소용돌이치는 종이학과 시계 바늘 | 공통 금지 |
| A-3 | 메인 · 배너 3번 | 2400×800 · 3:1 | 1 | `banner-1.png` | 새벽빛 밴드 단독 콘서트 〈푸른 주파수〉(공연 1): 새벽빛 하늘 아래 공연장, 푸른 빛 리본 같은 소리 물결, 작은 밴드 실루엣 | 공통 금지 |
| A-4 | 메인 · 배너 4번 | 2400×800 · 3:1 | 1 | `banner-6.png` | 뮤지컬 〈구름 정거장〉(공연 6, 오픈 예정·가족): 구름 위 작은 기차 정거장과 기다리는 작은 기차 | 공통 금지 |
| A-5 | 메인 · 배너 5번 | 2400×800 · 3:1 | 1 | `banner-8.png` | 연극 〈옥탑방 천문대〉(공연 8): 밤 옥상의 망원경, 빨랫줄, 아래 도시 불빛, 별이 가득한 하늘 | 공통 금지 |
| A-6 | 메인 · 배너 6번 | 2400×800 · 3:1 | 1 | `banner-12.png` | 피아노 리사이틀 〈물의 기억〉(공연 12): 잔잔한 물 위의 그랜드 피아노, 물에 비친 모습, 물결과 물방울 | 공통 금지 |
| B-1 | 대기 화면 · 상자 가운데 그림(160×160 표시) | 800×800 · 1:1 | 1 | `illust-queue.png` | 모래시계 옆 벤치에 앉아 차례를 기다리는 작은 종이 티켓 캐릭터 | 공통 금지 + 사람 없음 |
| B-2 | 검색 결과 없음 · 가운데 그림(160×160) | 800×800 · 1:1 | 1 | `illust-empty.png` | 돋보기가 비어 있는 작은 무대를 비추는 장면, 조명 하나 | 공통 금지 + 사람 없음 |
| B-3 | 없는 페이지 · 가운데 그림(200×200) | 800×800 · 1:1 | 1 | `illust-404.png` | 살짝 열린 무대 막 사이로 보이는 텅 빈 무대, 바닥에 떨어진 티켓 한 장 | 공통 금지 + 사람 없음 |
| C-1 (선택) | 링크 공유 미리보기(OG) | 1200×630 · 약 1.9:1 | 1 | `og-base.png` | 은하수가 흐르는 밤하늘 아래 작은 야외 마당 무대(오른쪽), 왼쪽 45%는 로고를 얹을 빈 밤하늘 | 공통 금지 |
| D-1 (선택) | 앱 아이콘·파비콘 큰 판 | 1024×1024 · 1:1 | 1 | `symbol.png` | 청록 바탕 위 네 꼭지 별 하나와 둥근 무대 아치를 단순화한 상징 | 공통 금지, 글자 절대 없음 |

공통 금지(모든 이미지):
- 글자·한글·영문·숫자·로고·워터마크·서명 없음(간판·포스터·악보 속 글자도 없음).
- 실존 인물 얼굴 없음. 사람은 뒷모습·실루엣·아주 작게만(안내 그림 B는 사람 자체를 넣지 않음).
- 실존 공연장·브랜드·캐릭터·작품을 떠올리게 하는 요소 없음.
- 종이 여백·테두리·액자·목업(벽에 걸린 모습) 없음. **캔버스 가장자리까지 그림이 꽉 참**(B는 흰 바탕이 가장자리까지).

받는 방법: 생성한 원본(PNG 또는 JPG)을 `D:\ticketing-next\.ref\images-incoming\`에 위 파일 이름으로 넣어 주면 된다(git 제외 폴더). WebP 변환과 작은 크기(배너 1200×400 `-sm`) 만들기, `frontend/public/` 배치는 UI 세션이 한다.

---

## 4. 프롬프트

생성 도구가 한 번에 한 장만 만든다면, 블록의 **[공통 규격]**과 **[장별 내용] 중 한 항목**을 함께 붙여 넣는다. 같은 공연의 포스터(`frontend/public/posters/{id}.webp`)를 참고 이미지로 함께 넣을 수 있으면 화풍이 맞는다.
영어 문장이 이미지 생성 모델에서 더 안정적이라 프롬프트는 영어로 썼다(각 항목의 한국어 요약은 3장 표).

### 4.1 A. 메인 배너 6장 (2400×800, 3:1)

비율 3:1을 고를 수 없으면 21:9 또는 16:9로 만든다. 그때는 위아래가 잘리므로 **중요한 것은 세로 가운데 56% 띠 안**에 두라는 문장이 이미 들어 있다.

```text
[COMMON SPEC — apply to every image below]
Wide web banner illustration, exact aspect ratio 3:1, 2400x800 pixels (if 3:1 is not available, use 21:9 and keep all important content inside the central horizontal band covering the middle 56% of the height).
Style: hand-printed risograph poster look, visible grain and halftone dots, 2 to 3 flat ink colors plus one accent, slightly misregistered layers, rich deep tones, cinematic theatrical lighting. Consistent with a set of riso-style theater posters.
Composition: the LEFT 40% of the canvas is calm negative space — a deep, dark, low-detail area of the background color with only soft texture, so that white headline text can be placed there later. Place the main subject in the RIGHT 55% of the canvas. Keep the right 6% free of small important details (a carousel counter will sit at the bottom-right corner).
Full bleed: the artwork fills the canvas edge to edge. No paper margin, no border, no frame, no vignette frame, no mockup.
Strictly NO text of any kind: no letters, no Korean or English words, no numbers, no logos, no signage, no watermark, no signature, no musical notation with readable symbols.
No real people, no recognizable faces. Human figures only as small silhouettes or seen from behind.
No real venues, brands, characters or existing artworks.

[IMAGE CONTENTS — make each one separately]

A-1 (banner-15): A small laundromat that only opens at night, seen from the street. Round washing machine windows glow like full moons; shirts and socks float up out of the doors and drift across the dark sky like stars and constellations. Palette: deep indigo night, warm lamp yellow, soft cream. The left 40% is empty indigo night sky with faint grain.

A-2 (banner-4): A tiny girl seen from behind, standing in a single cream spotlight on a dark stage, holding an open folded paper. Around her, a spiral of white and magenta origami cranes and floating clock hands swirls upward. Heavy purple stage curtains frame only the far right edge. Palette: magenta, violet, cream. The left 40% is a smooth dark violet stage background.

A-3 (banner-1): A concert stage at dawn under a wide sky turning from deep blue to pale orange at the horizon. Ribbons of glowing blue light flow out from the stage like sound waves. A four-piece band appears as small dark silhouettes from behind, and a few raised hands of the audience are silhouetted at the bottom right. Palette: midnight blue, electric cyan, pale dawn orange. The left 40% is calm deep-blue sky.

A-4 (banner-6): A small, charming train platform sitting on top of fluffy clouds high in the sky, with a little vintage train waiting, a wooden bench and a single station lamp. Gentle, friendly, family-show mood. Palette: soft sky blue, cloud white, warm coral accent. The left 40% is open pale-to-mid blue sky with soft cloud texture (keep it calm and slightly darker so white text stays readable).

A-5 (banner-8): A rooftop at night above a dense low-rise city. A brass telescope points to a sky full of stars; a laundry line with a few shirts stretches across; three tiny friends seen from behind sit on plastic chairs. City windows glow far below. Warm and a little comic. Palette: navy, mustard yellow, brick red. The left 40% is deep navy starry sky with very small, sparse stars only.

A-6 (banner-12): A black grand piano standing on perfectly still water at dusk, mirrored in the surface. Concentric ripples spread from a few falling water drops; delicate droplets hang in the air. Quiet, elegant, cool. Palette: deep teal, slate blue, silver highlights. The left 40% is calm dark teal water and sky with gentle texture.
```

### 4.2 B. 안내 그림 3장 (800×800, 1:1, 흰 바탕)

화면의 흰 상자 안에 놓이므로 바탕은 반드시 순수한 흰색이다. 색은 서비스 색(청록 `#0A7C78`, 별 노랑 `#F2B200`)과 회색만 쓴다.

```text
[COMMON SPEC — apply to every image below]
Square spot illustration for a web app empty-state, exact aspect ratio 1:1, 800x800 pixels.
Style: simple, friendly flat illustration with subtle risograph grain, rounded shapes, thin consistent outlines, lots of breathing room. Limited palette ONLY: teal #0A7C78, a lighter teal tint #CDEBE9, star yellow #F2B200 as a small accent, and neutral grays #4B5260 / #ECEEF1.
Background: pure solid white #FFFFFF all the way to every edge. No colored background shape behind the subject, no frame, no border, no shadow box, no paper texture at the edges.
Subject centered, occupying about 60% of the canvas, with even white space around it.
Strictly NO text: no letters, no words, no numbers (also none on clocks, signs or tickets), no logos, no watermark, no signature.
No people at all, no human faces. A simple object-character is fine (two dot eyes only, no mouth details needed).

[IMAGE CONTENTS — make each one separately]

B-1 (illust-queue): A small paper ticket stub character with two dot eyes sitting patiently on a tiny wooden bench, next to a large hourglass with yellow sand flowing. Two or three small yellow four-pointed stars float above. Calm, patient mood.

B-2 (illust-empty): A large magnifying glass hovering over a small empty stage with a single spotlight beam; inside the lens the stage floor is empty. One tiny yellow four-pointed star sits at the edge of the stage. Gentle, slightly curious mood.

B-3 (illust-404): A theater curtain in teal, slightly parted in the middle, revealing an empty dark-gray stage. On the floor in front of the curtain lies a single small paper ticket stub, a little crumpled. One tiny yellow star above the curtain. Quiet, "lost" mood but not sad.
```

### 4.3 C. 공유 미리보기 그림 1장 (선택, 1200×630)

글자 없이 만든 뒤, UI 세션이 왼쪽 빈자리에 글자 로고를 얹어 PNG로 저장한다.

```text
Wide illustration for a link preview image, aspect ratio about 1.9:1, 1200x630 pixels.
Style: risograph print look with grain and halftone dots, flat inks: deep navy, teal #0A7C78, star yellow #F2B200, cream.
Scene: a band of the Milky Way flowing diagonally across a deep navy night sky; under it, on the RIGHT side, a small open-air courtyard stage with a simple wooden frame and a few warm string lights, seen from a slight distance. The LEFT 45% of the canvas is calm, empty night sky with only a few tiny stars, reserved for a logo to be placed later.
Full bleed to all edges, no margin, no border, no frame.
Strictly NO text, letters, numbers, logos, watermark or signature. No people.
```

### 4.4 D. 상징 그림 1장 (선택, 1024×1024)

생성 도구는 작은 크기에서 또렷한 상징을 잘 못 만든다. 파비콘·로고는 03 문서 3.8처럼 **코드(SVG)로 그리는 것이 기본**이고, 이 항목은 앱 아이콘 큰 판이 따로 필요할 때만 쓴다.

```text
App icon artwork, exact 1:1, 1024x1024 pixels.
A single bold symbol centered: a simple rounded arch shape like a small stage opening, with one four-pointed star (yellow #F2B200) sitting at the top of the arch. Flat geometric vector style, very simple, readable at 48 pixels. Symbol in white and light teal #CDEBE9.
Background: solid teal #0A7C78 filling the entire square edge to edge (no rounded corners, no border, no drop shadow — the platform will round the corners).
Strictly NO letters, words, numbers or logos of any kind. No gradients, no texture, no watermark.
```

---

## 5. 받은 그림 검수 목록

UI 세션(또는 사용자)이 넣기 전에 확인한다.

| 항목 | 기준 |
|---|---|
| 크기·비율 | A 3:1(2400×800 이상, 21:9·16:9로 만들었으면 가운데를 3:1로 잘라도 주제가 남는지), B 1:1, C 약 1.9:1, D 1:1 |
| 글자 | 확대해서 글자·숫자·가짜 글자 모양이 없는지(배경 간판·악보·시계 숫자 포함) |
| 얼굴 | 알아볼 수 있는 사람 얼굴이 없는지 |
| 가장자리 | 종이 여백·테두리·액자 없이 끝까지 찼는지(B는 흰 바탕이 끝까지) |
| 글자 자리 | A는 왼쪽 40%가 어둡고 단순해 흰 글자 대비 4.5:1 이상 나오는지(그라데이션을 깔아도 안 되면 다시 생성) |
| 넘김 표시 자리 | A의 오른쪽 아래 모서리에 중요한 것이 없는지 |
| 화풍 | A 6장이 서로, 그리고 포스터와 같은 계열로 보이는지 |
| 용량 | 변환 후 배너 큰 것 300KB 이하, 작은 것 120KB 이하, 안내 그림 60KB 이하(WebP) |
