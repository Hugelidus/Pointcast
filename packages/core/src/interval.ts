/**
 * Distance between two closed intervals [aStart, aEnd] and [bStart, bEnd], in the same unit.
 * 0 when they overlap or touch. Events are intervals (a selection lasts from mousedown to
 * mouseup) and so are words, so "how far apart" must compare intervals, not points (D4.3).
 */
export function intervalGap(aStart: number, aEnd: number, bStart: number, bEnd: number): number {
  return Math.max(0, Math.max(aStart, bStart) - Math.min(aEnd, bEnd));
}
