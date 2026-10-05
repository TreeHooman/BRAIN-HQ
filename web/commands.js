// Command box actions. "update HQ" / "check for updates" run here at once (no Claude call); everything else goes to
// LUTHUR with what's on screen, so "check this", "update that project", "mark it done" have a target.
"use strict";
const HQ_UPD = /^(?:(?:hey|ok|yo)\s+luth[ou]r[,!.]?\s+)?(?:can you\s+|please\s+)?(?:(update|upgrade)\s+(?:hq|luth[ou]r|yourself|the app|the dashboard)(?:\s+now)?|install\s+(?:the\s+)?updates?|update now|(check|look)\s+for\s+(?:an?\s+)?updates?|any\s+updates?|are (?:you|we) up to date)\W*$/i;

function cmdContext() {
  const c = { view: route.view };
  if (typeof Scr !== "undefined" && Scr.cur) {
    const v = Scr.cur, u = typeof scrOpenUrl === "function" ? scrOpenUrl() : "";
    c.screen = { k: v.k, title: typeof scrTitle === "function" ? scrTitle(v) : "", url: /^https?:/i.test(u) ? u : "", slug: v.slug || "" };
  }
  return c;
}

function cmdSay(you, text, extra) {
  if (route.view === "command" && typeof cmdShowReply === "function") cmdShowReply({ messages: [{ role: "you", text: you }, { role: "hq", text, at: new Date().toISOString() }] }, true);
  else hudNotify(text);
  if (extra) document.getElementById("cmdReply")?.insertAdjacentHTML("beforeend", extra);
  if (Date.now() - (window.hqVoiceAt || window.hqVoiceTurn || 0) < 15000 && typeof speakAlways === "function") speakAlways(text.replace(/\*\*/g, "").split("\n")[0]);
}

async function hqUpdateCmd(t) {
  const m = t.match(HQ_UPD), install = !!(m[1] || /install|update now/i.test(t));
  cmdSay(t, "Checking for an update…");
  const s = await upCheck(true);
  if (!s.hasToken) return cmdSay(t, "Updates aren't set up yet. Add the GitHub key in **Settings → Updates**.");
  if (s.error) return cmdSay(t, `Couldn't check: ${s.error}`);
  if (!s.available) return cmdSay(t, `I'm up to date${s.installed?.date ? ` (installed ${new Date(s.installed.date).toLocaleDateString()})` : ""}.`);
  const what = s.latest?.msg ? `: “${esc(s.latest.msg)}”` : "";
  if (!s.canApply) return cmdSay(t, `An update is ready${what}. Install it on the HQ PC.`);
  cmdSay(t, `An update is ready${what}.${install ? " Press **Install** to restart into it." : ""}`,
    `<div class="row" style="margin-top:10px"><button type="button" class="btn primary" id="cmdUpGo">Install update</button><span class="small muted">Backs up first, keeps your data. About 20 seconds.</span></div>`);
  const b = document.getElementById("cmdUpGo");
  if (b) b.onclick = async () => { b.disabled = true; try { const r = await api("/update/apply", "POST", { sha: s.latest.sha }); upWait(r.latest?.sha || s.latest.sha); } catch (e) { hudNotify("⚠ " + e.message); b.disabled = false; } };
}

if (typeof scrVoice === "function") {
  const _scrVoiceCmd = scrVoice;
  scrVoice = function (t) { const c = String(t || "").trim(); if (HQ_UPD.test(c)) { if (route.view !== "command") location.hash = "command"; setTimeout(() => hqUpdateCmd(c), route.view === "command" ? 0 : 700); return true; } return _scrVoiceCmd(t); };
}
// cmdSend only routes to scrVoice on the Command page; the update command should work from the box anywhere it shows
if (typeof cmdSend === "function") {
  const _cmdSendUp = cmdSend;
  cmdSend = function (t) { const c = String(t || "").trim(); if (HQ_UPD.test(c)) { const i = document.getElementById("cmdText"); if (i) i.value = ""; hqUpdateCmd(c); return; } return _cmdSendUp(t); };
}
