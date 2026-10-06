// A Clock alarm is created only by the owner's iPhone Shortcut after they tap the push.
// LUTHUR keeps a due reminder as a fallback and never calls this a confirmed Clock alarm.
import * as brain from "./brain.ts";
import { loadConfig } from "./config.ts";
import { ntfy } from "./notify.ts";

export function alarmRequest(title: string, due: string, now = new Date()) {
  const name = String(title || "").trim().replace(/[\r\n|]/g, " ").slice(0, 100);
  if (!name) throw new Error("Give the alarm a name.");
  if (!/^\d{4}-\d{2}-\d{2}[ T]\d{1,2}:\d{2}$/.test(String(due || "").trim())) throw new Error("An alarm needs a date and time (YYYY-MM-DD HH:MM).");
  const local = brain.normalizeWhen(due);
  const at = brain.whenToDate(local);
  const roundTrip = `${at.getFullYear()}-${String(at.getMonth() + 1).padStart(2, "0")}-${String(at.getDate()).padStart(2, "0")}T${String(at.getHours()).padStart(2, "0")}:${String(at.getMinutes()).padStart(2, "0")}`;
  if (!Number.isFinite(at.getTime()) || roundTrip !== local || at.getTime() <= now.getTime()) throw new Error("Choose a valid future alarm time.");
  if (at.getTime() - now.getTime() > 24 * 60 * 60 * 1000) throw new Error("iPhone Clock one-time alarms only cover the next occurrence within 24 hours. Use a reminder for later dates.");
  const input = `${local}|${name}`;
  const url = `shortcuts://run-shortcut?name=LUTHUR%20Alarm&input=text&text=${encodeURIComponent(input)}`;
  return { name, local, url };
}

export async function createAlarmRequest(title: string, due: string) {
  const a = alarmRequest(title, due);
  const n = loadConfig().notifications?.ntfy;
  if (!n?.enabled || !n.topic) throw new Error("Turn on phone notifications in Settings before setting an iPhone alarm.");
  const fallback = brain.addReminder({ title: a.name, due: a.local });
  const sent = await ntfy(`Tap to create iPhone alarm · ${a.local.slice(11)}`, a.name, { priority: 4, url: a.url, tags: "alarm_clock" });
  return sent
    ? `Alarm request ${fallback.id} saved for ${a.local.replace("T", " ")}. Tap the phone notification to create the Clock alarm. It is not confirmed until the iPhone Shortcut runs; LUTHUR will also send a reminder when due.`
    : `Phone notification could not be delivered. Reminder ${fallback.id} is saved for ${a.local.replace("T", " ")}, but no Clock alarm was created. Check phone notifications.`;
}
