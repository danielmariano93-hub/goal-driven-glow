export function xpToLevel(xp: number): number {
  return Math.max(1, Math.floor(Math.sqrt(xp / 100)) + 1);
}

export function levelFloor(level: number): number {
  return Math.pow(Math.max(0, level - 1), 2) * 100;
}

export function progressToNext(xp: number): { level: number; current: number; next: number; percent: number } {
  const level = xpToLevel(xp);
  const cur = levelFloor(level);
  const nxt = levelFloor(level + 1);
  const percent = nxt === cur ? 0 : Math.min(100, ((xp - cur) / (nxt - cur)) * 100);
  return { level, current: xp - cur, next: nxt - cur, percent };
}
