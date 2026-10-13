export function clock(ms: number): string {
  const seconds = Math.floor(Math.max(0, ms) / 1000);
  return [Math.floor(seconds / 3600), Math.floor(seconds / 60) % 60, seconds % 60]
    .map(value => String(value).padStart(2, '0')).join(':');
}

export function duration(ms: number): string {
  if (ms <= 0) return '0m';
  if (ms < 60_000) return `${Math.max(1, Math.floor(ms / 1000))}s`;
  const minutes = Math.floor(ms / 60_000);
  const hours = Math.floor(minutes / 60);
  return hours ? `${hours}h${minutes % 60 ? ` ${minutes % 60}m` : ''}` : `${minutes}m`;
}

export function localDate(date = new Date()): string {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;
}

export function reserveScale(balanceMs: number): number {
  const step = 2 * 60 * 60 * 1000;
  return Math.max(step, Math.ceil(balanceMs / step) * step);
}

export function sessionTime(timestamp: number): string {
  const date = new Date(timestamp);
  const time = date.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
  if (localDate(date) === localDate()) return `Today, ${time}`;
  return `${date.toLocaleDateString([], { month: 'short', day: 'numeric' })}, ${time}`;
}
