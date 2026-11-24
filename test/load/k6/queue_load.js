// 요청량 테스트(k6): 대기열 폴링 트래픽을 단계적으로 올리면서, 입장한 사용자의 예매 흐름(좌석 조회·선점·확정·취소) 응답 시간을 함께 잰다.
// 로컬에서는 "스크립트가 제대로 도는지" 예행만 하고 수치를 결론으로 쓰지 않는다(docs/next/load-test.md). 같은 스크립트를 AWS에서 쓴다.
//
//   k6 run -e BASE_URL=http://127.0.0.1:18080 -e PERF_ID=30 test/load/k6/queue_load.js
//
// 매개변수(-e 이름=값)
//   BASE_URL       대상 주소(필수). 예: https://staging.example.com
//   PERF_ID        회차 id(필수). 판매 중이고 좌석이 넉넉한 회차
//   WAITERS        대기 가상 사용자 수의 단계(쉼표). 기본 "20,50,100"
//   STAGE_SECONDS  단계마다 유지 시간(초). 기본 60
//   RAMP_SECONDS   단계 사이 올리는 시간(초). 기본 15
//   BOOKERS        동시에 예매 흐름을 도는 가상 사용자 수. 기본 2
//   POLL_SECONDS   대기 폴링 간격(초). 0이면 서버가 준 pollAfterSeconds를 따른다(권장). 기본 0
//   BASELINE_SECONDS  대기 트래픽 없이 예매만 도는 기준선 시간(초). 기본 30
//   EMAIL_PREFIX   (ACCOUNTS_FILE이 없을 때) 새로 가입할 이메일 앞부분. 기본 "k6"
//   ACCOUNTS_FILE  미리 만든 계정 파일(한 줄에 "이메일,비밀번호"). k6/prepare_accounts.sh로 만든다. 있으면 가입 대신 로그인
// 서버는 요청 제한을 테스트용으로 올려 띄운다(test/load/README.md 3장). 운영 기본값은 바꾸지 않는다.
// 결과: k6 요약의 http_req_duration{flow:...} — book_seats·book_hold·book_confirm·book_cancel·queue_status, 오류율 checks.
//       파일로 남기려면 --summary-export=<파일.json>(요약) 또는 --out json=<파일.json>(요청마다).
import http from 'k6/http';
import { check, sleep } from 'k6';
import { Trend, Counter } from 'k6/metrics';
import exec from 'k6/execution';

const BASE = __ENV.BASE_URL;
const PERF = Number(__ENV.PERF_ID);
if (!BASE || !PERF) throw new Error('BASE_URL과 PERF_ID가 필요합니다');
const WAITERS = (__ENV.WAITERS || '20,50,100').split(',').map(Number);
const STAGE = Number(__ENV.STAGE_SECONDS || 60);
const RAMP = Number(__ENV.RAMP_SECONDS || 15);
const BOOKERS = Number(__ENV.BOOKERS || 2);
const POLL = Number(__ENV.POLL_SECONDS || 0);
const BASELINE = Number(__ENV.BASELINE_SECONDS || 30);
const PREFIX = __ENV.EMAIL_PREFIX || 'k6';

const stages = [];
for (const n of WAITERS) {
  stages.push({ duration: `${RAMP}s`, target: n });
  stages.push({ duration: `${STAGE}s`, target: n });
}
stages.push({ duration: `${RAMP}s`, target: 0 });
const waitersSeconds = stages.reduce((s, x) => s + Number(x.duration.replace('s', '')), 0);

export const options = {
  // 가상 사용자는 한 번 가입하고 같은 세션 쿠키로 계속 돈다(k6 기본값은 반복마다 쿠키를 지워 CSRF가 깨진다 — 예행에서 발견)
  noCookiesReset: true,
  scenarios: {
    // 기준선 → 대기 트래픽 증가 동안 계속 예매 흐름을 돈다
    bookers: { executor: 'constant-vus', vus: BOOKERS, duration: `${BASELINE + waitersSeconds}s`, exec: 'booker' },
    waiters: { executor: 'ramping-vus', startVUs: 0, stages, startTime: `${BASELINE}s`, exec: 'waiter', gracefulRampDown: '10s' },
  },
  summaryTrendStats: ['med', 'p(95)', 'p(99)', 'max'],
  // 흐름별 응답 시간을 요약에 보이게 하는 "항상 통과" 기준(k6는 기준이 걸린 하위 지표만 따로 보여 준다)
  thresholds: Object.fromEntries(['queue_status', 'wait_enter', 'book_enter', 'book_seats', 'book_hold', 'book_confirm',
    'book_cancel'].map((f) => [`http_req_duration{flow:${f}}`, ['max>=0']])),
};

const queueWait = new Trend('queue_wait_seconds');
const booked = new Counter('booked');

/** 멱등키용 UUID v4(외부 라이브러리 없이). */
function uuidv4() {
  const h = [];
  for (let i = 0; i < 32; i++) h.push(Math.floor(Math.random() * 16).toString(16));
  h[12] = '4';
  h[16] = '89ab'[Math.floor(Math.random() * 4)];
  const s = h.join('');
  return `${s.slice(0, 8)}-${s.slice(8, 12)}-${s.slice(12, 16)}-${s.slice(16, 20)}-${s.slice(20)}`;
}

// 테스트 계정: ACCOUNTS_FILE(한 줄에 "이메일,비밀번호", prepare_accounts.sh가 만든다)이 있으면 VU마다 한 줄씩 골라 로그인,
// 없으면 VU마다 새로 가입한다. 계정 파일을 쓰면 가입이 측정 구간에 섞이지 않고, 같은 계정으로 여러 번 다시 돌릴 수 있다.
const ACCOUNTS = __ENV.ACCOUNTS_FILE
  ? open(__ENV.ACCOUNTS_FILE).split('\n').map((l) => l.trim()).filter(Boolean).map((l) => l.split(','))
  : null;

// 가상 사용자마다 한 번 로그인(같은 VU 안에서는 쿠키가 유지된다). CSRF 토큰은 응답 body로 받는다.
const state = {};
function login() {
  if (state.csrf) return state.csrf;
  const me = http.get(`${BASE}/api/auth/me`, { tags: { flow: 'auth' } });
  const headers = { 'Content-Type': 'application/json', 'X-CSRF-Token': me.json('csrfToken') };
  let r;
  if (ACCOUNTS) {
    const [email, password] = ACCOUNTS[(exec.vu.idInTest - 1) % ACCOUNTS.length];
    r = http.post(`${BASE}/api/auth/login`, JSON.stringify({ email, password }), { headers, tags: { flow: 'auth' } });
    check(r, { 'login 200': (x) => x.status === 200 });
  } else {
    const email = `${PREFIX}-${exec.vu.idInTest}-${Date.now()}@example.com`;
    r = http.post(`${BASE}/api/auth/signup`, JSON.stringify({ email, password: 'password-123', name: '부하' }),
      { headers, tags: { flow: 'auth' } });
    check(r, { 'signup 201': (x) => x.status === 201 });
  }
  state.csrf = r.json('csrfToken');
  return state.csrf;
}

function post(path, body, extra, flow) {
  return http.post(`${BASE}${path}`, body == null ? null : JSON.stringify(body), {
    headers: Object.assign({ 'Content-Type': 'application/json', 'X-CSRF-Token': state.csrf }, extra || {}),
    tags: { flow },
  });
}

const shown = { n: 0 };
/** 예상 밖 응답은 VU마다 처음 3개만 로그로 남긴다(원인 확인용). */
function report(name, r) {
  if (shown.n++ < 3) console.warn(`${name}: HTTP ${r.status} ${(r.body || '').toString().slice(0, 200)}`);
}

function enterAndWait(flowPrefix, maxSeconds) {
  const e = post('/api/queue/enter', { performanceId: PERF }, null, `${flowPrefix}_enter`);
  if (!check(e, { 'enter 200': (x) => x.status === 200 })) {
    report('enter', e);
    sleep(1); // 실패해도 빈 루프로 서버를 두드리지 않게
    return null;
  }
  const token = e.json('queueToken');
  let status = e.json('status');
  let after = e.json('pollAfterSeconds');
  const started = Date.now();
  while (status !== 'ADMITTED' && (Date.now() - started) / 1000 < maxSeconds) {
    sleep(POLL > 0 ? POLL : after);
    const s = http.get(`${BASE}/api/queue/status`, { headers: { 'X-Queue-Token': token }, tags: { flow: 'queue_status' } });
    if (!check(s, { 'status 200': (x) => x.status === 200 })) return null;
    status = s.json('status');
    after = s.json('pollAfterSeconds');
  }
  queueWait.add((Date.now() - started) / 1000, { flow: flowPrefix });
  return status === 'ADMITTED' ? token : null;
}

// 대기자: 진입 → 입장할 때까지 폴링 → 입장하면 바로 이탈(자리를 비워 다음 사람이 승격) → 반복
export function waiter() {
  login();
  const token = enterAndWait('wait', 120);
  if (token) {
    http.del(`${BASE}/api/queue`, null, { headers: { 'X-Queue-Token': token, 'X-CSRF-Token': state.csrf }, tags: { flow: 'queue_leave' } });
  }
}

// 예매자: 진입 → 입장 → 좌석 조회 → 빈 좌석 1석 선점 → 확정 → 취소(좌석을 되돌려 계속 돌 수 있게)
export function booker() {
  login();
  const token = enterAndWait('book', 300);
  if (!token) return;
  const q = { 'X-Queue-Token': token };
  const seats = http.get(`${BASE}/api/performances/${PERF}/seats`, { headers: q, tags: { flow: 'book_seats' } });
  if (!check(seats, { 'seats 200': (x) => x.status === 200 })) return;
  const free = seats.json('seats').filter((s) => s.status === 'AVAILABLE');
  if (free.length === 0) return;
  const pick = free[Math.floor(Math.random() * free.length)].id;
  const hold = post(`/api/performances/${PERF}/holds`, { seatIds: [pick] }, q, 'book_hold');
  if (!check(hold, { 'hold 201 or 409': (x) => x.status === 201 || x.status === 409 }) || hold.status !== 201) return;
  const conf = post('/api/reservations', { holdId: hold.json('holdId') }, Object.assign({ 'Idempotency-Key': uuidv4() }, q), 'book_confirm');
  if (!check(conf, { 'confirm 201': (x) => x.status === 201 })) return;
  booked.add(1);
  const cancel = post(`/api/me/reservations/${conf.json('code')}/cancel`, null, null, 'book_cancel');
  check(cancel, { 'cancel 200': (x) => x.status === 200 });
}
