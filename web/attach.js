// Images + drafts for the boxes that talk to LUTHUR: Assistant chat (#chatText), War Room (#cmdText) and Code (#cdText).
// Images: paste, drop or the clip button. Each is shrunk here, uploaded to /api/uploads and sent as ids with the message.
// Drafts: what you typed (and attached) is kept on the HQ server in memory (/api/drafts), so it survives closing a panel,
// the tab or the window, and is gone when LUTHUR restarts. Loads after the other modules: it wraps api() and codeMsgHTML.
const Att = { state: new Map(), loaded: new Set(), timers: new Map(), MAX: 4 };
const ATT_BOXES = [["cdText", () => (typeof Code !== "undefined" && Code.slug ? "code:" + Code.slug : null)], ["chatText", () => "chat"], ["cmdText", () => "chat"]];
const attGet = key => { if (!Att.state.has(key)) Att.state.set(key, { text: "", images: [] }); return Att.state.get(key); };
const attKeyOf = el => ATT_BOXES.find(([id]) => id === el?.id)?.[1]() || null;
const attBoxes = key => ATT_BOXES.map(([id, k]) => k() === key ? document.getElementById(id) : null).filter(Boolean);
const attImg = id => `/api/uploads/${encodeURIComponent(id)}`;

function attThumbs(ids) {
  return ids?.length ? `<div class="att-sent">${ids.map(id => `<a href="${attImg(id)}" target="_blank" rel="noopener"><img src="${attImg(id)}" alt="Attached image" loading="lazy"></a>`).join("")}</div>` : "";
}

function attSave(key, now) {
  clearTimeout(Att.timers.get(key));
  const run = () => { Att.timers.delete(key); const s = attGet(key); fetch("/api/drafts/" + key, { method: "PUT", keepalive: true, headers: { "Content-Type": "application/json", "X-HQ": "1" }, body: JSON.stringify(s) }).catch(() => {}); };
  if (now) run(); else Att.timers.set(key, setTimeout(run, 400));
}
addEventListener("pagehide", () => { for (const key of [...Att.timers.keys()]) attSave(key, true); });

function attPaint(key) {
  const s = attGet(key);
  for (const el of attBoxes(key)) {
    const tray = el.closest("form")?.previousElementSibling;
    if (!tray?.classList.contains("att-tray")) continue;
    tray.hidden = !s.images.length;
    tray.innerHTML = s.images.map((id, i) => `<span class="att-th"><img src="${attImg(id)}" alt="Attached image ${i + 1}"><button type="button" data-attrm="${i}" aria-label="Remove image ${i + 1}">×</button></span>`).join("");
    tray.querySelectorAll("[data-attrm]").forEach(b => b.onclick = () => { s.images.splice(Number(b.dataset.attrm), 1); attPaint(key); attSave(key); });
  }
}

// Shrinks big photos/screenshots (longest side 2000 px, JPEG) so they stay under the 1.5 MB upload limit.
async function attShrink(file) {
  const read = blob => new Promise((ok, no) => { const r = new FileReader(); r.onload = () => ok(r.result); r.onerror = () => no(r.error); r.readAsDataURL(blob); });
  if (/^image\/(png|jpeg|webp|gif)$/.test(file.type) && file.size <= 1.1e6) return read(file);
  const bmp = await createImageBitmap(file);
  for (const [side, q] of [[2000, .85], [1600, .75], [1200, .7]]) {
    const k = Math.min(1, side / Math.max(bmp.width, bmp.height));
    const c = document.createElement("canvas"); c.width = Math.round(bmp.width * k); c.height = Math.round(bmp.height * k);
    c.getContext("2d").drawImage(bmp, 0, 0, c.width, c.height);
    const blob = await new Promise(ok => c.toBlob(ok, "image/jpeg", q));
    if (blob && blob.size <= 1.4e6) return read(blob);
  }
  throw new Error("That image is too large to attach.");
}

async function attAdd(key, files) {
  const s = attGet(key);
  const imgs = [...files].filter(f => f.type.startsWith("image/"));
  if (!imgs.length) return toast("Only images can be attached.");
  for (const f of imgs) {
    if (s.images.length >= Att.MAX) { toast(`Up to ${Att.MAX} images per message.`); break; }
    try { const r = await api("/uploads", "POST", { dataUrl: await attShrink(f) }); s.images.push(r.id); attPaint(key); attSave(key); }
    catch (e) { toast("⚠ " + e.message, 4000); }
  }
}

function attEnhance(el) {
  const key = attKeyOf(el), form = el.closest("form");
  if (!key || !form || el.dataset.att === key) return;
  el.dataset.att = key;
  if (!form.previousElementSibling?.classList.contains("att-tray")) { const tray = document.createElement("div"); tray.className = "att-tray"; tray.hidden = true; form.before(tray); }
  if (!form.querySelector(".att-clip")) {
    const pick = document.createElement("input"); pick.type = "file"; pick.accept = "image/png,image/jpeg,image/webp,image/gif"; pick.multiple = true; pick.hidden = true;
    const btn = document.createElement("button"); btn.type = "button"; btn.className = "btn att-clip"; btn.title = "Attach an image (or paste / drop one)"; btn.setAttribute("aria-label", "Attach an image");
    btn.innerHTML = `<svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M21.4 11.6l-8.5 8.5a5.5 5.5 0 0 1-7.8-7.8l8.5-8.5a3.7 3.7 0 0 1 5.2 5.2l-8.5 8.5a1.8 1.8 0 0 1-2.6-2.6l7.8-7.8"/></svg>`;
    btn.onclick = () => pick.click();
    pick.onchange = () => { attAdd(attKeyOf(el) || key, pick.files); pick.value = ""; };
    el.before(btn, pick);
  }
  el.addEventListener("input", () => { const k = attKeyOf(el); if (!k) return; attGet(k).text = el.value; attSave(k); });
  el.addEventListener("paste", e => { const files = [...(e.clipboardData?.files || [])]; if (files.some(f => f.type.startsWith("image/"))) { e.preventDefault(); attAdd(attKeyOf(el) || key, files); } });
  form.addEventListener("dragover", e => { if ([...(e.dataTransfer?.types || [])].includes("Files")) { e.preventDefault(); form.classList.add("att-drop"); } });
  form.addEventListener("dragleave", () => form.classList.remove("att-drop"));
  form.addEventListener("drop", e => { form.classList.remove("att-drop"); if (e.dataTransfer?.files?.length) { e.preventDefault(); attAdd(attKeyOf(el) || key, e.dataTransfer.files); } });
  attRestore(el, key);
}

async function attRestore(el, key) {
  if (!Att.loaded.has(key)) {
    Att.loaded.add(key);
    const d = await api("/drafts/" + key).catch(() => null);
    const s = attGet(key);
    if (d && !s.text && !s.images.length) { s.text = d.text || ""; s.images = d.images || []; }
  }
  const s = attGet(key);
  if (attKeyOf(el) !== key) return;
  if (!el.value && s.text && !el.disabled) { el.value = s.text; el.dispatchEvent(new Event("input")); }
  attPaint(key);
}

// A picture with no words still sends: the send handlers ignore an empty box, so give it a question first.
document.addEventListener("keydown", e => attFillEmpty(e.target, e.key === "Enter" && (e.target?.id === "cdText" ? e.ctrlKey || e.metaKey : !e.shiftKey)), true);
document.addEventListener("submit", e => attFillEmpty(e.target.querySelector?.("[data-att]"), true), true);
function attFillEmpty(el, sending) {
  const key = sending && el?.dataset?.att ? attKeyOf(el) : null;
  if (!key || el.value.trim() || !attGet(key).images.length) return;
  el.value = attGet(key).images.length > 1 ? "What do you see in these images?" : "What do you see in this image?";
  attGet(key).text = el.value;
}

new MutationObserver(() => { for (const [id] of ATT_BOXES) { const el = document.getElementById(id); if (el) attEnhance(el); } }).observe(document.body, { childList: true, subtree: true });

// Sending: the message that matches the box's draft (or what is in the box) takes its images and clears the draft.
// Other code that posts to /chat (roadmap, goals, voice commands) leaves the owner's draft alone.
if (typeof api === "function") {
  const attApi = api;
  api = async function (path, method = "GET", body) {
    const m = method === "POST" && body && typeof body.text === "string" ? path.match(/^\/(chat|code\/([a-z0-9-]+))$/) : null;
    if (!m) return attApi(path, method, body);
    const key = m[2] ? "code:" + m[2] : "chat", s = attGet(key), text = body.text.trim();
    const mine = !!text && (s.text.trim() === text || attBoxes(key).some(b => b.value.trim() === text));
    if (!mine) return attApi(path, method, body);
    const taken = { text: s.text, images: s.images.slice() };
    if (taken.images.length) body = { ...body, images: taken.images };
    s.text = ""; s.images = []; attPaint(key); attSave(key, true);
    try { return await attApi(path, method, body); }
    catch (e) {
      if (!s.text && !s.images.length) { s.text = taken.text; s.images = taken.images; attSave(key, true); }
      for (const b of attBoxes(key)) if (!b.value && !b.disabled) b.value = s.text;
      attPaint(key);
      throw e;
    }
  };
}

if (typeof codeMsgHTML === "function") {
  const attCodeMsg = codeMsgHTML;
  codeMsgHTML = function (m) { const html = attCodeMsg(m); return m?.role === "you" && m.images?.length ? html.replace(/<\/div>\s*$/, attThumbs(m.images) + "</div>") : html; };
}

(() => {
  const st = document.createElement("style");
  st.textContent = `
.att-tray{display:flex;flex-wrap:wrap;gap:8px;padding:8px 2px 4px}
.att-tray[hidden]{display:none}
.att-th{position:relative;display:inline-block;width:64px;height:64px;border-radius:8px;overflow:hidden;border:1px solid var(--line,rgba(255,255,255,.18));background:rgba(0,0,0,.25)}
.att-th img{width:100%;height:100%;object-fit:cover;display:block}
.att-th button{position:absolute;top:2px;right:2px;width:20px;height:20px;border-radius:50%;border:0;background:rgba(0,0,0,.72);color:#fff;font-size:14px;line-height:20px;padding:0;cursor:pointer}
.att-th button:focus-visible{outline:2px solid var(--blue,#4ea1ff)}
.btn.att-clip{flex:0 0 auto;display:inline-flex;align-items:center;justify-content:center;min-width:38px;padding:0 10px}
form.att-drop{outline:2px dashed var(--blue,#4ea1ff);outline-offset:3px}
.att-sent{display:flex;flex-wrap:wrap;gap:6px;margin-top:6px}
.att-sent img{max-width:160px;max-height:120px;border-radius:6px;display:block;border:1px solid var(--line,rgba(255,255,255,.18))}`;
  document.head.appendChild(st);
})();
