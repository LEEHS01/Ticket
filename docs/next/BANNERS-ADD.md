# 추가 배너 10개

2026-11-25 사용자 요청: 메인 배너도 내년 3월까지 이어지게 그림과 공연을 더 넣는다.
지금 배너 6개는 12월 중순이면 공연이 모두 끝나 사라진다. 추가 공연(`SHOWS-ADD.md`) 가운데 10개를 배너로 올린다.

## 규칙

- 배너는 모두 16개가 된다. 순서는 기존 6개(공연 15, 4, 1, 6, 8, 12) 다음에 아래 표의 순서다.
- `GET /api/banners`의 계약은 그대로다: 노출 기간 안의 것만, 정해 둔 순서대로, 최대 6개.
- 노출 기간도 그대로다: 시작 제한 없음 ~ 그 공연의 마지막 회차 시작. 앞 순서의 공연이 끝나면 뒤 순서의 배너가 차례로 올라온다.
- 그림 경로는 `/banners/banner-{공연 id}.webp`. 그림이 오기 전에는 프론트의 대체 표시가 나온다.
- 말머리(eyebrow)는 장르만 쓴다. "오픈 예정" 같은 말은 예매가 열리면 틀린 말이 되므로 쓰지 않는다.

2026-11-25 기준으로 계산한 노출 개수: 지금~1월 초 6개, 2월 중순 5~6개, 3월 중순 4개, 3월 21일 뒤 2개, 3월 27일 뒤 1개(3월 31일까지).

## 목록

| 순서 | 공연 | slug | 말머리 | 제목(28자 이내) | 부제(40자 이내) | 마지막 회차 |
|---|---|---|---|---|---|---|
| 7 | 33 | `snowman-photo-studio` | 뮤지컬 | 겨울에만 문을 여는 사진관 | 녹기 전에 한 장, 눈사람과 함께 찍는 가족 뮤지컬 | 12/27 |
| 8 | 21 | `paper-plane-cleared-to-land` | 콘서트 | 종이비행기 〈착륙 허가〉 | 3년 만의 단독 공연, 새 앨범 전곡을 라이브로 | 12/27 |
| 9 | 34 | `twelfth-bell` | 뮤지컬 | 자정의 종이 울리면 | 연말과 새해를 잇는 하룻밤의 창작 뮤지컬 | 1/3 |
| 10 | 37 | `west-attic-inventor` | 뮤지컬 | 다락방에서 태어난 발명품들 | 4주 동안 이어지는 창작 뮤지컬, 열 번의 무대 | 2/7 |
| 11 | 52 | `neighborhood-detective` | 연극 | 사건은 없고 소문만 많은 동네 | 이웃집 탐정이 벌이는 유쾌한 소동극 | 2/14 |
| 12 | 56 | `broken-clock-shop` | 연극 | 모두 다른 시간을 가리키는 가게 | 멈춘 시계를 고치는 시계방의 봄 | 3/14 |
| 13 | 42 | `thousand-paper-cranes` | 뮤지컬 | 천 번째 종이학을 접기까지 | 늦겨울부터 봄까지 이어지는 창작 뮤지컬 | 3/21 |
| 14 | 32 | `solbaram-kkotsaem` | 콘서트 | 꽃샘추위 끝의 시티팝 | 솔바람 트리오가 들려주는 이른 봄의 무대 | 3/21 |
| 15 | 68 | `spring-symphony-awakening-fields` | 클래식 | 교향곡으로 여는 봄 | 전원을 그린 교향곡, 봄맞이 교향악의 밤 | 3/27 |
| 16 | 45 | `rooftop-gardener` | 뮤지컬 | 지붕마다 정원을 심는 사람 | 도시의 옥상에서 피어나는 봄의 뮤지컬 | 3/31 |

## 그림

크기와 구도는 기존 배너 6장과 같다(`benchmark/04-images.md` 4.1). 파일 이름은 `banner-{공연 번호}`.
받은 원본은 `.ref/images-incoming/`에 두고, WebP 변환과 작은 크기 만들기, `frontend/public/banners/` 배치는 UI 세션이 한다.

```text
아래 10개의 배너 이미지를 각각 따로 생성해 주세요. 총 10장입니다.
파일 이름: banner-33, banner-21, banner-34, banner-37, banner-52, banner-56, banner-42, banner-32, banner-68, banner-45
크기: 가로 2400 x 세로 800 px (가로로 긴 3:1). 3:1을 고를 수 없으면 21:9로 만들어 주세요.

[COMMON SPEC — apply to every image below]
Wide web banner illustration, exact aspect ratio 3:1, 2400x800 pixels (if 3:1 is not available, use 21:9 and keep all important content inside the central horizontal band covering the middle 56% of the height).
Style: hand-printed risograph poster look, visible grain and halftone dots, 2 to 3 flat ink colors plus one accent, slightly misregistered layers, rich deep tones, cinematic theatrical lighting. Consistent with a set of riso-style theater posters.
Composition: the LEFT 40% of the canvas is calm negative space — a deep, dark, low-detail area of the background color with only soft texture, so that white headline text can be placed there later. Place the main subject in the RIGHT 55% of the canvas. Keep the right 6% free of small important details (a carousel counter will sit at the bottom-right corner).
Full bleed: the artwork fills the canvas edge to edge. No paper margin, no border, no frame, no vignette frame, no mockup.
Strictly NO text of any kind: no letters, no Korean or English words, no numbers, no logos, no signage, no watermark, no signature, no musical notation with readable symbols.
No real people, no recognizable faces. Human figures only as small silhouettes or seen from behind.
No real venues, brands, characters or existing artworks.

[IMAGE CONTENTS — make each one separately]

banner-33: A small photo studio on a snowy street at night, seen from outside. Through its wide lit window a snowman poses proudly in front of an old bellows camera on a tripod, caught in a warm burst of flash light; empty picture frames hang on the wall behind. Large soft snowflakes fall. Palette: deep ice-blue night, warm red, cream. The left 40% is dark blue snowy night sky with faint grain.

banner-21: A runway made of two rows of stage lights converging toward the right, where a giant white paper airplane glides down to land. A crowd of small silhouettes with raised hands lines the bottom right, and a simple control tower stands far away. Energetic and soaring. Palette: deep electric blue, white, signal orange. The left 40% is calm deep-blue night sky.

banner-34: A tall clock tower on the right with a large bell caught mid-swing. Concentric golden rings of sound spread from the bell across snowy rooftops, and a tiny figure seen from behind runs over a stone bridge below. The clock dial has no numerals. Grand and mysterious. Palette: deep navy, gold, snow white. The left 40% is dark navy sky where the rings fade out softly.

banner-37: An attic workshop under a sloped roof, crowded with whimsical contraptions: gears, propellers, a pedal-powered flying machine hanging from the beams. A round west-facing window pours in copper sunset light, and a small inventor wearing goggles is seen from behind at the workbench. Quirky and warm. Palette: dark teal, copper orange, cream. The left 40% is dark teal shadowed roof beams with very little detail.

banner-52: A cozy neighborhood alley at night seen from slightly above. A round pool of street-lamp light shaped like a magnifying glass reveals a trail of footprints, a cat sitting on a wall and a parked bicycle. A small figure in a trench coat and hat is seen from behind at the edge of the light. Light and witty. Palette: navy, mustard yellow, brick red. The left 40% is dark navy rooftops and sky with sparse detail.

banner-56: The inside of an old clock repair shop. The wall on the right is crowded with clocks of many shapes, all with plain dials without numerals and hands pointing in different directions; a long pendulum swings; a watchmaker's bench glows under a small lamp with a loupe and tiny gears, and a small figure is seen from behind. Curious and slightly melancholy. Palette: dark walnut brown, brass, deep teal. The left 40% is a dark wall in deep shadow with soft texture.

banner-42: Hundreds of folded paper cranes rising in one long sweeping arc from a pair of open hands at the bottom right toward a bright window at the top right. One crane near the top is a different color from the rest. Hopeful and moving. Palette: deep crimson, white, pale gold. The left 40% is deep crimson darkness with only two or three faint, distant cranes.

banner-32: A plum blossom branch dusted with light snow reaches in from the right edge. Behind it, a pastel city skyline at dusk with a few lit windows, and a few petals drift on the wind. Breezy, bittersweet early-spring mood. Palette: deep dusk violet-blue, plum pink, cream. The left 40% is calm deep dusk sky with soft grain.

banner-68: Rolling farmland at dawn. The plowed furrows run in groups of five parallel lines across the hills, with small birds sitting on the lines. At the far right, a small open-air orchestra shell with tiny silhouettes of players, and a low warm sun rising behind it. Pastoral and joyful. Palette: deep green, warm yellow, sky blue. The left 40% is a dark deep-green hillside under a calm pre-dawn sky.

banner-45: A dense city of rooftops and water towers at blue hour. Several roofs on the right overflow with plants and flowers, and a small figure with a watering can walks along a roof ridge, seen from behind, the arc of water catching the light. Cheerful and uplifting. Palette: deep evening blue, leaf green, brick red, with a warm light accent. The left 40% is deep blue evening sky above dark, plain rooftops.
```
