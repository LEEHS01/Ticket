import { createContext, useCallback, useContext, useEffect, useId, useMemo, useRef, useState, type ReactNode } from 'react';
import { Icon } from './Icon';

/**
 * 대화상자·하단 판은 브라우저 기본 <dialog>(showModal)를 쓴다.
 * - 포커스 가두기, Esc 닫기, 배경 비활성(inert)을 브라우저가 해 준다.
 * - 열려 있는 동안 뒤 페이지가 스크롤되지 않게 html에 클래스를 붙인다.
 */
function useModal(open: boolean) {
  const ref = useRef<HTMLDialogElement>(null);
  useEffect(() => {
    const d = ref.current;
    if (!d) return;
    if (open && !d.open) {
      d.showModal();
      document.documentElement.classList.add('is-modal-open');
    } else if (!open && d.open) {
      d.close();
    }
    if (!open) document.documentElement.classList.remove('is-modal-open');
  }, [open]);
  useEffect(() => () => document.documentElement.classList.remove('is-modal-open'), []);
  return ref;
}

export function Dialog({
  open,
  onClose,
  title,
  children,
  actions,
  backdropClose = true,
}: {
  open: boolean;
  onClose: () => void;
  title: string;
  children?: ReactNode;
  actions?: ReactNode;
  /** 위험 동작 확인은 덮개를 눌러도 닫히지 않게 false */
  backdropClose?: boolean;
}) {
  const ref = useModal(open);
  const id = useId();
  return (
    <dialog
      ref={ref}
      className="dialog"
      aria-labelledby={`${id}-t`}
      onCancel={(e) => {
        e.preventDefault();
        onClose();
      }}
      onClick={(e) => {
        if (backdropClose && e.target === ref.current) onClose();
      }}
    >
      {open && (
        <div className="dialog__box">
          <h2 className="dialog__title" id={`${id}-t`}>{title}</h2>
          {children && <div className="dialog__body">{children}</div>}
          {actions && <div className="dialog__actions">{actions}</div>}
        </div>
      )}
    </dialog>
  );
}

/** 모바일 하단 판: 위 모서리 16, 손잡이, 최대 85vh, 아래 고정 버튼 영역 */
export function Sheet({
  open,
  onClose,
  title,
  children,
  footer,
}: {
  open: boolean;
  onClose: () => void;
  title: string;
  children: ReactNode;
  footer?: ReactNode;
}) {
  const ref = useModal(open);
  const id = useId();
  return (
    <dialog
      ref={ref}
      className="sheet"
      aria-labelledby={`${id}-t`}
      onCancel={(e) => {
        e.preventDefault();
        onClose();
      }}
      onClick={(e) => {
        if (e.target === ref.current) onClose();
      }}
    >
      {open && (
        <div className="sheet__box">
          <span className="sheet__handle" aria-hidden="true" />
          <div className="sheet__head">
            <h2 className="sheet__title" id={`${id}-t`}>{title}</h2>
            <button type="button" className="icon-btn" onClick={onClose} aria-label="닫기">
              <Icon name="close" size={22} />
            </button>
          </div>
          <div className="sheet__body">{children}</div>
          {footer && <div className="sheet__foot">{footer}</div>}
        </div>
      )}
    </dialog>
  );
}

// ── 토스트: 화면 아래 가운데(모바일은 하단 탭 위), 3초 ──
type ToastCtx = (message: string) => void;
const ToastContext = createContext<ToastCtx>(() => undefined);

export function ToastProvider({ children }: { children: ReactNode }) {
  const [msg, setMsg] = useState<{ text: string; n: number } | null>(null);
  const timer = useRef<number | undefined>(undefined);
  const show = useCallback((text: string) => {
    window.clearTimeout(timer.current);
    setMsg((m) => ({ text, n: (m?.n ?? 0) + 1 }));
    timer.current = window.setTimeout(() => setMsg(null), 3000);
  }, []);
  useEffect(() => () => window.clearTimeout(timer.current), []);
  const value = useMemo(() => show, [show]);
  return (
    <ToastContext.Provider value={value}>
      {children}
      <div className="toast-region" role="status" aria-live="polite">
        {msg && <p className="toast" key={msg.n}>{msg.text}</p>}
      </div>
    </ToastContext.Provider>
  );
}

export const useToast = () => useContext(ToastContext);
