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

export function localInput(value: string) {
  return new Date(new Date(value).getTime() + 8 * 3600_000).toISOString().slice(0, 16);
}
