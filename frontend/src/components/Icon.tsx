/**
 * 선 아이콘(24 격자, 굵기 1.8, currentColor). 장식이므로 aria-hidden.
 * 버튼에 쓸 때는 버튼에 글자나 aria-label을 둔다.
 */
const PATHS = {
  search: 'M10.5 4a6.5 6.5 0 1 1 0 13 6.5 6.5 0 0 1 0-13Zm4.7 11.2L20 20',
  ticket: 'M4 7.5A1.5 1.5 0 0 1 5.5 6h13A1.5 1.5 0 0 1 20 7.5V10a2 2 0 0 0 0 4v2.5a1.5 1.5 0 0 1-1.5 1.5h-13A1.5 1.5 0 0 1 4 16.5V14a2 2 0 0 0 0-4V7.5ZM14.5 6v2.2M14.5 10.9v2.2M14.5 15.8V18',
  user: 'M12 12a4 4 0 1 0 0-8 4 4 0 0 0 0 8Zm-7.5 8c.8-3.4 3.8-5.5 7.5-5.5s6.7 2.1 7.5 5.5',
  home: 'M4 10.5 12 4l8 6.5V19a1 1 0 0 1-1 1h-4.5v-5.5h-5V20H5a1 1 0 0 1-1-1v-8.5Z',
  rank: 'M5 20V12M12 20V5M19 20v-9M3.5 20h17',
  clock: 'M12 21a9 9 0 1 0 0-18 9 9 0 0 0 0 18Zm0-13.5V12l3 2',
  close: 'M6 6l12 12M18 6 6 18',
  left: 'M14.5 6 8.5 12l6 6',
  right: 'M9.5 6l6 6-6 6',
  down: 'M6 9.5l6 6 6-6',
  up: 'M6 14.5l6-6 6 6',
  back: 'M19 12H5.5M11 6l-6 6 6 6',
  link: 'M10 14a4 4 0 0 0 5.66 0l3-3a4 4 0 0 0-5.66-5.66l-1 1M14 10a4 4 0 0 0-5.66 0l-3 3a4 4 0 0 0 5.66 5.66l1-1',
  pause: 'M9 6v12M15 6v12',
  play: 'M8 5.5v13l10.5-6.5L8 5.5Z',
  plus: 'M12 5v14M5 12h14',
  minus: 'M5 12h14',
  reset: 'M4.5 12a7.5 7.5 0 1 0 2.2-5.3M4.5 4.5v3.8h3.8',
  check: 'M5 12.5l4.5 4.5L19 7.5',
  info: 'M12 21a9 9 0 1 0 0-18 9 9 0 0 0 0 18Zm0-10v5.5M12 7.6v.1',
  filter: 'M4 7h9M17 7h3M4 17h3M11 17h9M15 5v4M9 15v4',
  calendar: 'M5 6h14a1 1 0 0 1 1 1v12a1 1 0 0 1-1 1H5a1 1 0 0 1-1-1V7a1 1 0 0 1 1-1Zm-1 4h16M8.5 3.5V8M15.5 3.5V8',
  alert: 'M12 3.5 21.5 20h-19L12 3.5Zm0 6v5M12 17.2v.1',
  empty: 'M4 9.5h16M6 9.5l1.2 9.5h9.6L18 9.5M9 5h6l1 4.5H8L9 5Z',
  logout: 'M14 4h4a1 1 0 0 1 1 1v14a1 1 0 0 1-1 1h-4M10 16l4-4-4-4M14 12H4',
  help: 'M12 21a9 9 0 1 0 0-18 9 9 0 0 0 0 18Zm-2.5-11.5a2.5 2.5 0 1 1 3.4 2.3c-.6.3-.9.8-.9 1.4v.6M12 16.9v.1',
  megaphone: 'M4 10v4h3l7 4V6L7 10H4Zm14-1.5a4 4 0 0 1 0 7',
  eye: 'M2.5 12S6 5.5 12 5.5 21.5 12 21.5 12 18 18.5 12 18.5 2.5 12 2.5 12Zm9.5 3a3 3 0 1 0 0-6 3 3 0 0 0 0 6Z',
  eyeOff: 'M3 3l18 18M10.6 5.6c.5-.1.9-.1 1.4-.1 6 0 9.5 6.5 9.5 6.5a17 17 0 0 1-3 3.6M6.6 6.6C4 8.3 2.5 12 2.5 12S6 18.5 12 18.5c1.6 0 3-.4 4.2-1.1M9.9 9.9a3 3 0 0 0 4.2 4.2',
  copy: 'M9 9h10v10H9V9Zm-4 6V5h10',
  hourglass: 'M7 3.5h10M7 20.5h10M8 3.5c0 4 4 5.5 4 8.5s-4 4.5-4 8.5M16 3.5c0 4-4 5.5-4 8.5s4 4.5 4 8.5',
  stage: 'M3 19h18M5 19V8c3-2 11-2 14 0v11M9 19v-5h6v5',
} as const;

export type IconName = keyof typeof PATHS;

export function Icon({ name, size = 24, className }: { name: IconName; size?: number; className?: string }) {
  return (
    <svg
      className={`icon${className ? ` ${className}` : ''}`}
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.8"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      focusable="false"
    >
      <path d={PATHS[name]} />
    </svg>
  );
}
