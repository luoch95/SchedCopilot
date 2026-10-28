export function stamp(value: string) {
  return new Intl.DateTimeFormat('zh-CN', {
    timeZone: 'Asia/Shanghai',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    hourCycle: 'h23',
  }).format(new Date(value));
}

export function fullStamp(value: string) {
  const parts = new Intl.DateTimeFormat('zh-CN', {
    timeZone: 'Asia/Shanghai',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    hourCycle: 'h23',
  }).formatToParts(new Date(value));
  const part = (type: Intl.DateTimeFormatPartTypes) =>
    parts.find((item) => item.type === type)?.value ?? '';
  return `${part('year')}年${part('month')}月${part('day')}日 ${part('hour')}:${part('minute')}`;
}

export function localInput(value: string) {
  return new Date(new Date(value).getTime() + 8 * 3600_000).toISOString().slice(0, 16);
}

export function dateTime(value: string) {
  return localInput(value).replace('T', ' ');
}

export function readableDateTimes(text: string) {
  return text.replace(
    /\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(?::\d{2}(?:\.\d+)?)?(?:Z|[+-]\d{2}:\d{2})/g,
    (value) => (Number.isFinite(Date.parse(value)) ? dateTime(value) : value),
  );
}
