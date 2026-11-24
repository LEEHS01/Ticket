// 티켓 오픈 시각을 캘린더 파일(.ics)로 내려받는다. 서버 없이 브라우저에서 만든다(03 문서 4.4).
import type { ShowSummary } from './api';

const icsDate = (iso: string) => new Date(iso).toISOString().replace(/[-:]/g, '').replace(/\.\d{3}/, '');
const esc = (v: string) => v.replace(/\\/g, '\\\\').replace(/\n/g, '\\n').replace(/([,;])/g, '\\$1');

export function downloadOpenIcs(s: Pick<ShowSummary, 'id' | 'title' | 'venue' | 'saleOpensAt'>) {
  const start = icsDate(s.saleOpensAt);
  const end = icsDate(new Date(Date.parse(s.saleOpensAt) + 30 * 60_000).toISOString());
  const url = `${window.location.origin}/shows/${s.id}`;
  const body = [
    'BEGIN:VCALENDAR',
    'VERSION:2.0',
    'PRODID:-//mirinae-madang//ticket-open//KO',
    'CALSCALE:GREGORIAN',
    'BEGIN:VEVENT',
    `UID:ticket-open-${s.id}@mirinae-madang`,
    `DTSTAMP:${icsDate(new Date().toISOString())}`,
    `DTSTART:${start}`,
    `DTEND:${end}`,
    `SUMMARY:${esc(`티켓 오픈: ${s.title}`)}`,
    `DESCRIPTION:${esc(`${s.venue}\n${url}`)}`,
    `URL:${url}`,
    'BEGIN:VALARM',
    'TRIGGER:-PT10M',
    'ACTION:DISPLAY',
    `DESCRIPTION:${esc('10분 뒤 티켓이 열려요')}`,
    'END:VALARM',
    'END:VEVENT',
    'END:VCALENDAR',
  ].join('\r\n');
  const blob = new Blob([body], { type: 'text/calendar;charset=utf-8' });
  const href = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = href;
  a.download = `ticket-open-${s.id}.ics`;
  document.body.appendChild(a);
  a.click();
  a.remove();
  window.setTimeout(() => URL.revokeObjectURL(href), 1000);
}
