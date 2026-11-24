/**
 * 글자 로고(03 문서 3.8): 미리내(text-1) + 마당(brand-600), '내' 오른쪽 위에 네 꼭지 별 하나(--c-star).
 * 크기는 className(logo--lg 24 / logo--md 20 / logo--sm 18 / logo--xs 16)으로 정한다.
 */
export function Logo({ size = 'lg' }: { size?: 'lg' | 'md' | 'sm' | 'xs' }) {
  return (
    <span className={`logo logo--${size}`} aria-hidden="true">
      <span className="logo__a">
        미리<span className="logo__nae">내<Star /></span>
      </span>
      <span className="logo__b">마당</span>
    </span>
  );
}

function Star() {
  return (
    <svg className="logo__star" viewBox="0 0 20 20" focusable="false" aria-hidden="true">
      <path d="M10 0l2.6 7.4L20 10l-7.4 2.6L10 20l-2.6-7.4L0 10l7.4-2.6z" />
    </svg>
  );
}
