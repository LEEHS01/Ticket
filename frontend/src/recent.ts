// 최근 검색어. 개인정보가 아닌 편의 정보라 localStorage에 둔다(최대 8개, 하나씩 지우기).
// 로그인 정보·토큰·이메일은 여기에 넣지 않는다.
const KEY = 'mirinae.recent-search';
const MAX = 8;

export function readRecent(): string[] {
  try {
    const v = JSON.parse(localStorage.getItem(KEY) ?? '[]') as unknown;
    return Array.isArray(v) ? v.filter((x): x is string => typeof x === 'string').slice(0, MAX) : [];
  } catch {
    return [];
  }
}

function write(list: string[]) {
  try {
    localStorage.setItem(KEY, JSON.stringify(list.slice(0, MAX)));
  } catch {
    // 저장소를 못 쓰면 기록하지 않는다
  }
}

export function pushRecent(q: string) {
  const v = q.trim().slice(0, 40);
  if (!v) return;
  write([v, ...readRecent().filter((x) => x !== v)]);
}

export function removeRecent(q: string) {
  write(readRecent().filter((x) => x !== q));
}

export function clearRecent() {
  write([]);
}
