// Mission schedules. Only the most recent missed occurrence runs, so a PC that was off for days catches up once.
export type Schedule =
  | { type: "daily"; time: string; days?: number[] }
  | { type: "weekly"; day: number; time: string }
  | { type: "every"; hours: number }
  | { type: "once"; at: string };

function at(base: Date, time: string): Date {
  const [h, m] = time.split(":").map(Number);
  const d = new Date(base); d.setHours(h || 0, m || 0, 0, 0); return d;
}

/** The latest time this schedule should have fired at or before `now`, or null. */
export function lastOccurrence(s: Schedule | null | undefined, now: Date, lastRun: Date | null): Date | null {
  if (!s) return null;
  if (s.type === "daily") {
    for (let back = 0; back < 8; back++) {
      const d = at(now, s.time); d.setDate(d.getDate() - back);
      if (d <= now && (!s.days?.length || s.days.includes(d.getDay()))) return d;
    }
    return null;
  }
  if (s.type === "weekly") {
    for (let back = 0; back < 8; back++) {
      const d = at(now, s.time); d.setDate(d.getDate() - back);
      if (d <= now && d.getDay() === s.day) return d;
    }
    return null;
  }
  if (s.type === "every") {
    if (!lastRun) return now;
    const next = new Date(lastRun.getTime() + Math.max(0.25, s.hours) * 3600e3);
    return next <= now ? next : null;
  }
  if (s.type === "once") {
    const d = new Date(s.at);
    return d <= now ? d : null;
  }
  return null;
}

export function isDue(s: Schedule | null | undefined, now: Date, lastRun: Date | null): boolean {
  const occ = lastOccurrence(s, now, lastRun);
  return !!occ && (!lastRun || lastRun < occ);
}

export function describe(s: Schedule | null | undefined): string {
  if (!s) return "Manual";
  const days = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
  if (s.type === "daily") return `Daily ${s.time}${s.days?.length ? ` (${s.days.map(d => days[d]).join(", ")})` : ""}`;
  if (s.type === "weekly") return `${days[s.day]} ${s.time}`;
  if (s.type === "every") return `Every ${s.hours}h`;
  return `Once ${s.at.replace("T", " ")}`;
}
