import { useId, useRef, useState, type FormEvent, type ReactNode } from 'react';
import { Link, Navigate, useLocation, useNavigate, useSearchParams } from 'react-router';
import { api, toApiError, type ApiError } from '../api';
import { safeNext, useAuth } from '../auth';
import { usePageTitle } from '../shell';
import { Notice, readNotice, Spinner, useCountdown } from '../components/bits';
import { Icon } from '../components/Icon';

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

function waitLabel(sec: number) {
  const m = Math.floor(sec / 60);
  const s = sec % 60;
  return m > 0 ? `${m}분 ${s}초` : `${s}초`;
}

/** 로그인·가입 공용: 이미 로그인했으면 돌아갈 곳으로. 돌아갈 곳은 앱 안 경로만(safeNext) */
function useAuthPage() {
  const { status, user } = useAuth();
  const [params] = useSearchParams();
  const next = safeNext(params.get('next'));
  const location = useLocation();
  const st = location.state as { booking?: unknown } | null;
  const fromBooking = !!st?.booking || next.startsWith('/book/') || /[?&]perf=/.test(next);
  return { status, user, next, notice: readNotice(location.state), fromBooking };
}

function Field({ id, label, error, help, children }: { id: string; label: string; error?: string; help?: string; children: ReactNode }) {
  return (
    <div className="field">
      <label className="field__label" htmlFor={id}>{label}</label>
      {children}
      {help && <p className="field__help" id={`${id}-help`}>{help}</p>}
      {error && (
        <p className="field__err" id={`${id}-err`}>
          <Icon name="info" size={14} />
          {error}
        </p>
      )}
    </div>
  );
}

const described = (id: string, help?: boolean, error?: string) =>
  [help ? `${id}-help` : '', error ? `${id}-err` : ''].filter(Boolean).join(' ') || undefined;

function PasswordInput({
  id,
  value,
  onChange,
  autoComplete,
  error,
  help,
  disabled,
}: {
  id: string;
  value: string;
  onChange: (v: string) => void;
  autoComplete: 'current-password' | 'new-password';
  error?: string;
  help?: boolean;
  disabled: boolean;
}) {
  const [show, setShow] = useState(false);
  return (
    <div className="pw">
      <input
        id={id}
        className="input"
        type={show ? 'text' : 'password'}
        autoComplete={autoComplete}
        maxLength={72}
        value={value}
        disabled={disabled}
        onChange={(e) => onChange(e.target.value)}
        aria-invalid={error ? true : undefined}
        aria-describedby={described(id, help, error)}
      />
      <button type="button" className="pw__toggle" onClick={() => setShow((v) => !v)} aria-pressed={show} aria-controls={id}>
        <Icon name={show ? 'eyeOff' : 'eye'} size={18} />
        {show ? '숨기기' : '보기'}
      </button>
    </div>
  );
}

export function LoginPage() {
  const { status, user, next, notice, fromBooking } = useAuthPage();
  usePageTitle('로그인');
  const navigate = useNavigate();
  const uid = useId();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [errs, setErrs] = useState<{ email?: string; password?: string }>({});
  const [error, setError] = useState<ApiError | null>(null);
  const [pending, setPending] = useState(false);
  const inFlight = useRef(false);
  const lockedCode = error?.code === 'ACCOUNT_LOCKED' || error?.code === 'RATE_LIMITED';
  const wait = useCountdown(lockedCode ? (error?.retryAfterSec ?? 60) : null, error);

  if (status === 'ready' && user && !pending) return <Navigate to={next} replace />;

  async function onSubmit(ev: FormEvent) {
    ev.preventDefault();
    if (inFlight.current || wait > 0) return;
    const e: typeof errs = {};
    if (!EMAIL_RE.test(email.trim())) e.email = '이메일을 확인해 주세요. 예: name@example.com';
    if (!password) e.password = '비밀번호를 입력해 주세요.';
    setErrs(e);
    if (e.email || e.password) {
      document.getElementById(e.email ? `${uid}-email` : `${uid}-pw`)?.focus();
      return;
    }
    inFlight.current = true;
    setPending(true);
    setError(null);
    try {
      await api.login({ email: email.trim(), password });
      setPassword(''); // 비밀번호는 메모리에서도 바로 지운다
      navigate(next, { replace: true });
    } catch (err) {
      setError(toApiError(err));
      setPassword('');
      setPending(false);
    } finally {
      inFlight.current = false;
    }
  }

  return (
    <div className="page page--auth">
      <div className="auth">
        <h1 className="auth__title" tabIndex={-1}>로그인</h1>
        {fromBooking && <p className="auth__sub">예매하려면 로그인해 주세요</p>}
        {notice && !(fromBooking && notice.title.includes('로그인해 주세요')) && (
          <Notice tone={notice.tone} title={notice.title} className="auth__notice">{notice.message && <p>{notice.message}</p>}</Notice>
        )}
        <form className="auth__form" onSubmit={onSubmit} noValidate>
          <Field id={`${uid}-email`} label="이메일" error={errs.email}>
            <input
              id={`${uid}-email`}
              className="input"
              name="email"
              type="email"
              inputMode="email"
              autoComplete="username"
              spellCheck={false}
              placeholder="name@example.com"
              value={email}
              disabled={pending}
              onChange={(e) => setEmail(e.target.value)}
              aria-invalid={errs.email ? true : undefined}
              aria-describedby={described(`${uid}-email`, false, errs.email)}
            />
          </Field>
          <Field id={`${uid}-pw`} label="비밀번호" error={errs.password}>
            <PasswordInput id={`${uid}-pw`} value={password} onChange={setPassword} autoComplete="current-password" error={errs.password} disabled={pending} />
          </Field>

          {error && (
            <Notice
              tone={error.code === 'INVALID_CREDENTIALS' || lockedCode ? 'warn' : 'error'}
              className="auth__notice"
              title={
                error.code === 'INVALID_CREDENTIALS'
                  ? '이메일 또는 비밀번호가 맞지 않아요'
                  : error.code === 'ACCOUNT_LOCKED'
                    ? '로그인이 잠시 잠겼어요'
                    : error.code === 'RATE_LIMITED'
                      ? '요청이 잠시 막혔어요'
                      : '로그인하지 못했어요'
              }
              requestId={error.supportId}
            >
              <p>{error.message}</p>
              {error.code === 'ACCOUNT_LOCKED' && wait > 0 && <p>{waitLabel(wait)} 뒤에 다시 시도할 수 있어요.</p>}
            </Notice>
          )}

          <button type="submit" className="btn btn--primary btn--l btn--block auth__submit" disabled={pending || wait > 0}>
            {pending ? <><Spinner /> 로그인하는 중…</> : wait > 0 ? `${waitLabel(wait)} 뒤에 다시 시도` : '로그인'}
          </button>
          <p className="auth__alt">
            <span>아직 회원이 아니신가요?</span>
            <Link to={`/signup?next=${encodeURIComponent(next)}`} className="auth__altlink">
              회원가입 <Icon name="right" size={14} />
            </Link>
          </p>
        </form>
      </div>
    </div>
  );
}

export function SignupPage() {
  const { status, user, next, notice } = useAuthPage();
  usePageTitle('회원가입');
  const navigate = useNavigate();
  const uid = useId();
  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [password2, setPassword2] = useState('');
  const [agree, setAgree] = useState({ terms: false, privacy: false });
  const [errs, setErrs] = useState<{ email?: string; password?: string; password2?: string; name?: string; agree?: string }>({});
  const [error, setError] = useState<ApiError | null>(null);
  const [pending, setPending] = useState(false);
  const inFlight = useRef(false);
  const wait = useCountdown(error?.code === 'RATE_LIMITED' ? (error.retryAfterSec ?? 30) : null, error);

  if (status === 'ready' && user && !pending) return <Navigate to={next} replace />;

  async function onSubmit(ev: FormEvent) {
    ev.preventDefault();
    if (inFlight.current || wait > 0) return;
    const e: typeof errs = {};
    const n = name.trim();
    if (!n) e.name = '이름을 입력해 주세요.';
    else if (n.length > 40) e.name = '이름은 40자까지 입력할 수 있어요.';
    if (!EMAIL_RE.test(email.trim())) e.email = '이메일을 확인해 주세요. 예: name@example.com';
    if (password.length < 8 || password.length > 72) e.password = '비밀번호는 8자 이상 72자 이하로 정해 주세요.';
    if (!e.password && password2 !== password) e.password2 = '비밀번호가 서로 달라요.';
    // 동의는 화면에서만 확인한다(계약 v4 결정: API 변경 없음)
    if (!agree.terms || !agree.privacy) e.agree = '필수 항목에 모두 동의해 주세요.';
    setErrs(e);
    const first = e.name ? 'name' : e.email ? 'email' : e.password ? 'pw' : e.password2 ? 'pw2' : e.agree ? 'agree' : null;
    if (first) {
      document.getElementById(`${uid}-${first}`)?.focus();
      return;
    }
    inFlight.current = true;
    setPending(true);
    setError(null);
    try {
      await api.signup({ email: email.trim(), password, name: n });
      setPassword('');
      setPassword2('');
      navigate(next, { replace: true });
    } catch (err) {
      setError(toApiError(err));
      setPending(false);
    } finally {
      inFlight.current = false;
    }
  }

  const all = agree.terms && agree.privacy;

  return (
    <div className="page page--auth">
      <div className="auth">
        <h1 className="auth__title" tabIndex={-1}>회원가입</h1>
        {notice && <Notice tone={notice.tone} title={notice.title} className="auth__notice">{notice.message && <p>{notice.message}</p>}</Notice>}
        <form className="auth__form" onSubmit={onSubmit} noValidate>
          <Field id={`${uid}-name`} label="이름" error={errs.name} help="예매자 이름으로 쓰여요">
            <input
              id={`${uid}-name`}
              className="input"
              name="name"
              autoComplete="name"
              maxLength={40}
              value={name}
              disabled={pending}
              onChange={(e) => setName(e.target.value)}
              aria-invalid={errs.name ? true : undefined}
              aria-describedby={described(`${uid}-name`, true, errs.name)}
            />
          </Field>
          <Field id={`${uid}-email`} label="이메일" error={errs.email}>
            <input
              id={`${uid}-email`}
              className="input"
              name="email"
              type="email"
              inputMode="email"
              autoComplete="username"
              spellCheck={false}
              placeholder="name@example.com"
              value={email}
              disabled={pending}
              onChange={(e) => setEmail(e.target.value)}
              aria-invalid={errs.email ? true : undefined}
              aria-describedby={described(`${uid}-email`, false, errs.email)}
            />
          </Field>
          <Field id={`${uid}-pw`} label="비밀번호" error={errs.password} help="8자 이상 72자 이하">
            <PasswordInput id={`${uid}-pw`} value={password} onChange={setPassword} autoComplete="new-password" error={errs.password} help disabled={pending} />
          </Field>
          <Field id={`${uid}-pw2`} label="비밀번호 확인" error={errs.password2}>
            <PasswordInput id={`${uid}-pw2`} value={password2} onChange={setPassword2} autoComplete="new-password" error={errs.password2} disabled={pending} />
          </Field>

          <fieldset className="agree auth__agree" aria-describedby={errs.agree ? `${uid}-agree-err` : undefined}>
            <legend className="sr-only">약관 동의</legend>
            <label className="check check--all">
              <input
                id={`${uid}-agree`}
                type="checkbox"
                checked={all}
                disabled={pending}
                onChange={(e) => setAgree({ terms: e.target.checked, privacy: e.target.checked })}
              />
              <span className="check__text">전체 동의</span>
            </label>
            <div className="agree__items">
              <div className="agree__row">
                <label className="check">
                  <input type="checkbox" checked={agree.terms} disabled={pending} onChange={(e) => setAgree((a) => ({ ...a, terms: e.target.checked }))} />
                  <span className="check__text"><span className="check__req">(필수)</span>이용약관</span>
                </label>
                <a className="text-btn" href="/policy/terms" target="_blank" rel="noopener noreferrer">
                  보기 <Icon name="right" size={14} /><span className="sr-only">(새 창)</span>
                </a>
              </div>
              <div className="agree__row">
                <label className="check">
                  <input type="checkbox" checked={agree.privacy} disabled={pending} onChange={(e) => setAgree((a) => ({ ...a, privacy: e.target.checked }))} />
                  <span className="check__text"><span className="check__req">(필수)</span>개인정보 수집·이용</span>
                </label>
                <a className="text-btn" href="/policy/privacy" target="_blank" rel="noopener noreferrer">
                  보기 <Icon name="right" size={14} /><span className="sr-only">(새 창)</span>
                </a>
              </div>
            </div>
            {errs.agree && (
              <p className="field__err" id={`${uid}-agree-err`}>
                <Icon name="info" size={14} />
                {errs.agree}
              </p>
            )}
          </fieldset>

          {error && (
            <Notice
              tone={error.code === 'EMAIL_TAKEN' || error.code === 'VALIDATION_ERROR' || error.code === 'RATE_LIMITED' ? 'warn' : 'error'}
              className="auth__notice"
              title={
                error.code === 'EMAIL_TAKEN'
                  ? '이미 가입된 이메일이에요'
                  : error.code === 'VALIDATION_ERROR'
                    ? '입력 내용을 확인해 주세요'
                    : error.code === 'RATE_LIMITED'
                      ? '요청이 잠시 막혔어요'
                      : '가입하지 못했어요'
              }
              requestId={error.supportId}
              actions={error.code === 'EMAIL_TAKEN' ? <Link className="btn btn--line btn--s" to={`/login?next=${encodeURIComponent(next)}`}>이 이메일로 로그인</Link> : undefined}
            >
              <p>{error.message}</p>
            </Notice>
          )}

          <button type="submit" className="btn btn--primary btn--l btn--block auth__submit" disabled={pending || wait > 0}>
            {pending ? <><Spinner /> 가입하는 중…</> : wait > 0 ? `${wait}초 뒤에 다시 시도` : '가입하고 시작하기'}
          </button>
          <p className="auth__alt">
            <span>이미 회원인가요?</span>
            <Link to={`/login?next=${encodeURIComponent(next)}`} className="auth__altlink">
              로그인 <Icon name="right" size={14} />
            </Link>
          </p>
        </form>
      </div>
    </div>
  );
}
