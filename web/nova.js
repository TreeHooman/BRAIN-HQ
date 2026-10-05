// NOVA layer: immersive 3D scene + motion system + the new Command screen.
// Loads last (after app.js, hud.js, views.js) and overrides a few hud.js functions. No dependencies.
// Everything here is decoration on top of working UI: if WebGL is missing it falls back silently,
// and prefers-reduced-motion freezes it.
"use strict";

const NV = { t0: performance.now(), mx: .5, my: .5, sx: 0, scroll: 0, busy: 0, busyT: 0, listen: 0, pulse: 0, fine: matchMedia("(pointer: fine)").matches };
const lerp = (a, b, k) => a + (b - a) * k;
const nvOn = () => isHud() && !HUD.asleep && !document.hidden;

// ---------------- tiny WebGL helper ----------------
function glProgram(gl, fs) {
  const vs = "attribute vec2 p;void main(){gl_Position=vec4(p,0.,1.);}";
  const mk = (type, src) => { const s = gl.createShader(type); gl.shaderSource(s, src); gl.compileShader(s); if (!gl.getShaderParameter(s, gl.COMPILE_STATUS)) throw new Error(gl.getShaderInfoLog(s)); return s; };
  const pr = gl.createProgram(); gl.attachShader(pr, mk(gl.VERTEX_SHADER, vs)); gl.attachShader(pr, mk(gl.FRAGMENT_SHADER, fs)); gl.linkProgram(pr);
  if (!gl.getProgramParameter(pr, gl.LINK_STATUS)) throw new Error(gl.getProgramInfoLog(pr));
  gl.useProgram(pr);
  const b = gl.createBuffer(); gl.bindBuffer(gl.ARRAY_BUFFER, b); gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 3, -1, -1, 3]), gl.STATIC_DRAW);
  const loc = gl.getAttribLocation(pr, "p"); gl.enableVertexAttribArray(loc); gl.vertexAttribPointer(loc, 2, gl.FLOAT, false, 0, 0);
  const u = {}; return { pr, u: name => u[name] ??= gl.getUniformLocation(pr, name) };
}
const GLSL_NOISE = `
float h21(vec2 p){p=fract(p*vec2(123.34,456.21));p+=dot(p,p+45.32);return fract(p.x*p.y);}
float n2(vec2 p){vec2 i=floor(p),f=fract(p);f=f*f*(3.-2.*f);return mix(mix(h21(i),h21(i+vec2(1,0)),f.x),mix(h21(i+vec2(0,1)),h21(i+vec2(1,1)),f.x),f.y);}
float fbm(vec2 p){float v=0.,a=.5;mat2 r=mat2(.8,.6,-.6,.8);for(int i=0;i<5;i++){v+=a*n2(p);p=r*p*2.03;a*=.5;}return v;}
float h31(vec3 p){p=fract(p*.3183099+.1);p*=17.;return fract(p.x*p.y*p.z*(p.x+p.y+p.z));}
float n3(vec3 x){vec3 i=floor(x),f=fract(x);f=f*f*(3.-2.*f);
 return mix(mix(mix(h31(i),h31(i+vec3(1,0,0)),f.x),mix(h31(i+vec3(0,1,0)),h31(i+vec3(1,1,0)),f.x),f.y),
            mix(mix(h31(i+vec3(0,0,1)),h31(i+vec3(1,0,1)),f.x),mix(h31(i+vec3(0,1,1)),h31(i+vec3(1,1,1)),f.x),f.y),f.z);}
float fbm3(vec3 p){float v=0.,a=.5;for(int i=0;i<4;i++){v+=a*n3(p);p=p*2.02+vec3(1.7,9.2,3.1);a*=.5;}return v;}`;

// ---------------- background: deep space, nebula, parallax starfield, holo floor ----------------
const SCENE_FS = `precision highp float;
uniform vec2 uR;uniform float uT,uB,uS;uniform vec2 uM;
${GLSL_NOISE}
vec3 stars(vec2 uv,float sc,float sz){vec2 p=uv*sc,id=floor(p),f=fract(p)-.5;float r=h21(id);if(r<.93)return vec3(0.);
 vec2 o=vec2(h21(id+3.1),h21(id+7.7))-.5;float d=length(f-o*.7);float tw=.55+.45*sin(uT*(.6+r*2.5)+r*50.);
 return smoothstep(.05*sz,0.,d)*tw*mix(vec3(.75,.92,1.),vec3(1.,.82,1.),h21(id+1.3));}
void main(){
 vec2 uv=(gl_FragCoord.xy-.5*uR)/uR.y; vec2 m=uM-.5; float t=uT*.022*(1.+uB*2.);
 vec2 q=uv*1.25+m*.06+vec2(0.,uS*.00012);
 float w=fbm(q*1.1+vec2(t,-t*.6)); float nb=fbm(q*2.1+w*1.7+vec2(-t*.8,t*.5));
 vec3 c1=vec3(.0,.32,.46),c2=vec3(.26,.12,.52),c3=vec3(.55,.08,.38);
 vec3 col=mix(c1,c2,smoothstep(.3,.8,w)); col=mix(col,c3,smoothstep(.55,.95,nb)*.4);
 col*=pow(smoothstep(.32,1.,nb),1.7)*(.5+uB*.25);
 col+=vec3(.003,.007,.025)+vec3(0.,.025,.05)*max(0.,1.-length(uv));
 col+=stars(uv+m*.008,64.,1.)*.55; col+=stars(uv+m*.022+vec2(t*.15,0.),36.,1.4)*.8; col+=stars(uv+m*.05,19.,2.)*.95;
 float hz=-.3+m.y*.03;
 if(uv.y<hz){float z=1./(hz-uv.y+.002);vec2 g=vec2((uv.x+m.x*.05)*z,z+uT*.35*(1.+uB*2.5));vec2 gf=abs(fract(g*.5)-.5);
  float ln=1.-smoothstep(0.,.035*min(z,6.),min(gf.x,gf.y)); float fd=exp(-z*.16)*smoothstep(0.,.25,hz-uv.y+.02);
  col+=mix(vec3(.25,.85,1.),vec3(.7,.5,1.),uB)*ln*fd*.32;}
 col+=vec3(.35,.85,1.)*exp(-abs(uv.y-hz)*55.)*.1;
 vec2 mp=m*vec2(uR.x/uR.y,1.); col+=vec3(.05,.25,.4)*.05/(length(uv-mp)+.25);
 gl_FragColor=vec4(col,1.);}`;
const Scene = { c: null, gl: null, p: null, raf: 0, scale: .6, frame: 0, ok: false };
function sceneStart() {
  if (Scene.ok || Scene.failed) return sceneKick();
  const c = document.createElement("canvas"); c.id = "nova-bg"; c.setAttribute("aria-hidden", "true"); document.body.prepend(c);
  const gl = c.getContext("webgl", { antialias: false, alpha: false, powerPreference: "low-power" });
  if (!gl) { Scene.failed = true; c.remove(); return; }
  try { Scene.p = glProgram(gl, SCENE_FS); } catch (e) { Scene.failed = true; c.remove(); console.warn("nova scene", e); return; }
  Object.assign(Scene, { c, gl, ok: true });
  sceneSize(); addEventListener("resize", sceneSize);
  sceneKick();
}
function sceneSize() {
  if (!Scene.ok) return;
  const d = Math.min(1.5, devicePixelRatio || 1) * Scene.scale;
  Scene.c.width = Math.round(innerWidth * d); Scene.c.height = Math.round(innerHeight * d);
  Scene.gl.viewport(0, 0, Scene.c.width, Scene.c.height);
  if (reduced()) sceneDraw();
}
function sceneDraw() {
  const { gl, p } = Scene, t = (performance.now() - NV.t0) / 1000;
  gl.uniform2f(p.u("uR"), Scene.c.width, Scene.c.height); gl.uniform1f(p.u("uT"), reduced() ? 12 : t);
  gl.uniform1f(p.u("uB"), NV.busy); gl.uniform1f(p.u("uS"), NV.scroll); gl.uniform2f(p.u("uM"), NV.sx, NV.sy ?? .5);
  gl.drawArrays(gl.TRIANGLES, 0, 3);
}
function sceneLoop() {
  Scene.raf = 0;
  if (!Scene.ok || !nvOn()) return;
  NV.sx = lerp(NV.sx || .5, NV.mx, .04); NV.sy = lerp(NV.sy ?? .5, NV.my, .04);
  NV.busy = lerp(NV.busy, NV.busyT, .03);
  if (++Scene.frame % 2 === 0 || NV.busy > .05) sceneDraw();
  if (!reduced()) Scene.raf = requestAnimationFrame(sceneLoop);
}
function sceneKick() { if (Scene.ok && !Scene.raf) { if (reduced()) { sceneDraw(); return; } Scene.raf = requestAnimationFrame(sceneLoop); } }

// ---------------- the core: plasma sphere with corona (shader) ----------------
const CORE_FS = `precision highp float;
uniform vec2 uR;uniform float uT,uB,uL,uP;uniform vec2 uM;
${GLSL_NOISE}
mat3 rotY(float a){float c=cos(a),s=sin(a);return mat3(c,0.,-s,0.,1.,0.,s,0.,c);}
mat3 rotX(float a){float c=cos(a),s=sin(a);return mat3(1.,0.,0.,0.,c,s,0.,-s,c);}
void main(){
 vec2 p=(gl_FragCoord.xy/uR)*2.-1.; float r=length(p), R=.4; float t=uT*(.35+uB*.9);
 vec3 cA=mix(vec3(.35,.95,1.),vec3(.72,.55,1.),uB), cB=mix(vec3(.55,.45,1.),vec3(1.,.42,.85),uB);
 vec3 col=vec3(0.); float a=0.;
 if(r<R){
  float z=sqrt(R*R-r*r)/R; vec3 n=vec3(p/R,z);
  vec3 q=rotX(.35+(uM.y-.5)*.6)*rotY(t*.35+(uM.x-.5)*.9)*n;
  float f=fbm3(q*2.4+vec3(0.,0.,t*.6)); float f2=fbm3(q*5.+f*2.5-vec3(t*.4));
  float fil=pow(1.-abs(f2-.5)*2.,6.);
  float fr=pow(1.-z,2.2);
  col=mix(cA*.25,cB*.6,f)+fil*mix(cA,vec3(1.),.5)*1.1+cA*fr*1.6;
  col+=vec3(1.)*pow(z,10.)*.55;
  vec3 L=normalize(vec3((uM.x-.5)*1.4,(.5-uM.y)*1.4,1.)); col+=vec3(.9,.98,1.)*pow(max(dot(n,L),0.),28.)*.6;
  a=1.;
 }
 float d=max(r-R,0.); float ang=atan(p.y,p.x);
 float rays=fbm(vec2(ang*2.5+t*.2,d*6.-t*.8)); float cor=exp(-d*(9.-uB*3.))*(.45+rays*.9);
 col+=cA*cor*(r>=R?1.:.25); a=max(a,clamp(cor*1.2,0.,1.));
 float rip=uL*exp(-d*3.)*pow(max(0.,sin((d*28.-uT*6.))),8.)*.6; col+=cA*rip; a=max(a,rip);
 float pr=uP*exp(-abs(d-(1.-uP)*.55)*60.)*.9; col+=vec3(.8,.95,1.)*pr; a=max(a,pr);
 col+=cA*.05*exp(-d*2.);
 gl_FragColor=vec4(col*a, a);}`;
const Core = { el: null, c: null, gl: null, p: null, raf: 0, ok: false };
function coreMount(host) {
  Core.el = host;
  const c = document.createElement("canvas"); c.setAttribute("aria-hidden", "true"); host.prepend(c);
  const gl = c.getContext("webgl", { premultipliedAlpha: true, alpha: true, antialias: true });
  if (!gl) { host.classList.add("no-gl"); return; }
  try { Core.p = glProgram(gl, CORE_FS); } catch (e) { console.warn("nova core", e); host.classList.add("no-gl"); return; }
  Object.assign(Core, { c, gl, ok: true });
  gl.enable(gl.BLEND); gl.blendFunc(gl.ONE, gl.ONE_MINUS_SRC_ALPHA);
  coreSize();
  if (!Core.raf) Core.raf = requestAnimationFrame(coreLoop);
}
function coreSize() {
  if (!Core.ok) return;
  const r = Core.c.getBoundingClientRect(), d = Math.min(2, devicePixelRatio || 1) * .8;
  Core.c.width = Math.max(64, Math.round(r.width * d)); Core.c.height = Math.max(64, Math.round(r.height * d));
  Core.gl.viewport(0, 0, Core.c.width, Core.c.height);
}
function coreLoop() {
  Core.raf = 0;
  if (!Core.ok || !Core.c.isConnected) { Core.ok = false; return; }
  if (nvOn()) {
    const { gl, p } = Core, t = (performance.now() - NV.t0) / 1000;
    const w = Core.el, busy = w.classList.contains("busy") ? 1 : 0, lis = w.classList.contains("listening") ? 1 : 0;
    NV.listen = lerp(NV.listen, lis, .06); NV.pulse = Math.max(0, NV.pulse - .012);
    Core.b = lerp(Core.b || 0, busy, .04);
    gl.clearColor(0, 0, 0, 0); gl.clear(gl.COLOR_BUFFER_BIT);
    gl.uniform2f(p.u("uR"), Core.c.width, Core.c.height); gl.uniform1f(p.u("uT"), reduced() ? 4 : t);
    gl.uniform1f(p.u("uB"), Core.b); gl.uniform1f(p.u("uL"), NV.listen); gl.uniform1f(p.u("uP"), NV.pulse);
    gl.uniform2f(p.u("uM"), NV.sx || .5, NV.sy ?? .5);
    gl.drawArrays(gl.TRIANGLES, 0, 3);
  }
  if (!reduced() || !Core.drawn) { Core.drawn = true; Core.raf = requestAnimationFrame(coreLoop); }
}
addEventListener("resize", () => coreSize());

// overrides: core state + ping drive the shader
function coreState() {
  const w = document.querySelector(".nv-core"); if (!w) return;
  const busy = document.body.classList.contains("ops-busy") || !!S?.status?.chatBusy || Cmd.waiting;
  const listening = !!document.querySelector(".mic.live");
  w.classList.toggle("busy", busy && !listening); w.classList.toggle("listening", listening);
  NV.busyT = busy ? 1 : 0; sceneKick();
  const lbl = document.getElementById("coreState");
  const want = listening ? "LISTENING" : busy ? "PROCESSING" : S?.status?.running ? "WORKING" : "ONLINE";
  if (lbl && lbl.dataset.v !== want) { lbl.dataset.v = want; scrambleTo(lbl, want, 400); }
}
function corePing() { NV.pulse = 1; }

// ---------------- pointer: light, 3D tilt, magnetic, cursor halo, shockwave ----------------
const LIT_SEL = ".card, .tile, .proj, .nv-panel";
const MAG_SEL = ".btn.primary, .mic, .nv-sat, .chip, .power";
const Ptr = { x: innerWidth / 2, y: innerHeight / 2, lit: null, tilt: new Map(), mag: new Map(), raf: 0, cur: null, cx: 0, cy: 0 };
function ptrMove(e) {
  Ptr.x = e.clientX; Ptr.y = e.clientY; NV.mx = e.clientX / innerWidth; NV.my = e.clientY / innerHeight;
  if (!isHud()) return;
  const t = e.target instanceof Element ? e.target : null;
  const card = t?.closest(LIT_SEL) || null;
  if (card !== Ptr.lit) { Ptr.lit?.classList.remove("lit"); Ptr.lit = card; card?.classList.add("lit"); }
  if (card) {
    const r = card.getBoundingClientRect();
    card.style.setProperty("--mx", `${e.clientX - r.left}px`); card.style.setProperty("--my", `${e.clientY - r.top}px`);
    if (!reduced() && NV.fine && !card.closest(".nv-stage")) {
      const k = Math.max(1.2, Math.min(5, 90000 / (r.width * r.height) * 2.2)); // big panels tilt less
      const st = Ptr.tilt.get(card) || { rx: 0, ry: 0, trx: 0, try: 0 };
      st.trx = -((e.clientY - r.top) / r.height - .5) * k; st.try = ((e.clientX - r.left) / r.width - .5) * k;
      Ptr.tilt.set(card, st); card.classList.add("n3d");
    }
  }
  const mag = t?.closest(MAG_SEL);
  if (mag && !reduced() && NV.fine) { const r = mag.getBoundingClientRect(); const st = Ptr.mag.get(mag) || { x: 0, y: 0 }; st.tx = (e.clientX - r.left - r.width / 2) * .18; st.ty = (e.clientY - r.top - r.height / 2) * .25; Ptr.mag.set(mag, st); }
  for (const [el, st] of Ptr.mag) if (el !== mag) { st.tx = 0; st.ty = 0; }
  if (Ptr.cur) Ptr.cur.classList.toggle("hot", !!t?.closest("a, button, [role=link], [role=button], .nv-sat, .day, .node, select, label.row, .cd-proj"));
  ptrKick();
}
function ptrKick() { if (!Ptr.raf) Ptr.raf = requestAnimationFrame(ptrLoop); }
function ptrLoop() {
  Ptr.raf = 0; let alive = false;
  for (const [el, st] of Ptr.tilt) {
    if (el !== Ptr.lit) { st.trx = 0; st.try = 0; }
    st.rx = lerp(st.rx, st.trx, .12); st.ry = lerp(st.ry, st.try, .12);
    if (!el.isConnected || (el !== Ptr.lit && Math.abs(st.rx) < .02 && Math.abs(st.ry) < .02)) { el.style.removeProperty("--rx"); el.style.removeProperty("--ry"); el.classList.remove("n3d"); Ptr.tilt.delete(el); continue; }
    el.style.setProperty("--rx", st.rx.toFixed(2) + "deg"); el.style.setProperty("--ry", st.ry.toFixed(2) + "deg"); alive = true;
  }
  for (const [el, st] of Ptr.mag) {
    st.x = lerp(st.x, st.tx || 0, .16); st.y = lerp(st.y, st.ty || 0, .16);
    if (!el.isConnected || (!st.tx && !st.ty && Math.abs(st.x) < .05 && Math.abs(st.y) < .05)) { el.style.translate = ""; Ptr.mag.delete(el); continue; }
    el.style.translate = `${st.x.toFixed(1)}px ${st.y.toFixed(1)}px`; alive = true;
  }
  if (Ptr.cur && isHud()) {
    Ptr.cx = lerp(Ptr.cx, Ptr.x, .22); Ptr.cy = lerp(Ptr.cy, Ptr.y, .22);
    Ptr.cur.style.transform = `translate3d(${Ptr.cx.toFixed(1)}px, ${Ptr.cy.toFixed(1)}px, 0)`;
    if (Math.abs(Ptr.cx - Ptr.x) > .3 || Math.abs(Ptr.cy - Ptr.y) > .3) alive = true;
  }
  if (alive) ptrKick();
}
function ptrDown(e) {
  if (!isHud() || reduced()) return;
  Ptr.cur?.classList.add("press");
  if (!e.target.closest?.("input, textarea, select")) {
    const s = document.createElement("i"); s.className = "nova-shock"; s.style.left = e.clientX + "px"; s.style.top = e.clientY + "px";
    document.body.appendChild(s); setTimeout(() => s.remove(), 750);
  }
}
function cursorStart() {
  if (!NV.fine || reduced() || Ptr.cur) return;
  Ptr.cur = document.createElement("i"); Ptr.cur.id = "nova-cursor"; Ptr.cur.setAttribute("aria-hidden", "true"); document.body.appendChild(Ptr.cur);
  addEventListener("pointermove", () => Ptr.cur.classList.add("on"), { once: true });
  document.addEventListener("mouseleave", () => Ptr.cur.classList.remove("on"));
  document.addEventListener("mouseenter", () => Ptr.cur.classList.add("on"));
}
addEventListener("pointermove", ptrMove, { passive: true });
addEventListener("pointerdown", ptrDown, { passive: true });
addEventListener("pointerup", () => Ptr.cur?.classList.remove("press"), { passive: true });
addEventListener("scroll", () => { NV.scroll = scrollY; }, { passive: true });

// ---------------- page assembly (override hud.js hook) ----------------
let nvLastView = null;
function hudAfterRender(el, background) {
  navGlide();
  if (!background && route.view !== nvLastView) {
    nvLastView = route.view;
    if (!reduced() && isHud()) {
      let i = 0;
      for (const c of el.children) c.style.setProperty("--i", i++);
      el.querySelectorAll(".cols > * > *, .tiles > *").forEach((c, j) => c.style.setProperty("--i", Math.min(14, 2 + j)));
      el.classList.remove("assemble", "view-in"); void el.offsetWidth; el.classList.add("assemble");
      clearTimeout(hudAfterRender.t); hudAfterRender.t = setTimeout(() => el.classList.remove("assemble"), 1700);
      const sw = document.getElementById("nova-sweep"); if (sw) { sw.classList.remove("go"); void sw.offsetWidth; sw.classList.add("go"); }
      Snd.blip(520, .05, "sine", .03); setTimeout(() => Snd.blip(780, .05, "sine", .02), 70);
    }
  }
  if (route.view !== "command") orbitStop();
}

// ---------------- Command: core + orbiting projects ----------------
const Orb = { raf: 0, th: 0, vel: 0, hover: null, drag: null, sats: [], last: 0, sig: "" };
async function vCommand(el) {
  const name = S.settings.assistantName || "JARVIS", now = new Date(), hr = now.getHours();
  el.innerHTML = `<div class="nv-head"><div><div class="nv-greet">${hr < 12 ? "Good morning" : hr < 18 ? "Good afternoon" : "Good evening"} · ${esc(DOW[now.getDay()])} ${now.getDate()} ${esc(MON[now.getMonth()])}</div><h1>Command</h1></div><div class="nv-vitals" id="nvVitals"></div></div>
    <div class="nv-cmd">
      <div class="nv-l" id="cmdLeft"></div>
      <div class="nv-mid">
        <div class="nv-stage" id="nvStage">
          <div class="nv-orbit" id="nvOrbit"><svg class="path" aria-hidden="true"><ellipse class="a"/><ellipse class="b"/></svg></div>
          <div class="nv-core core-wrap" id="core" role="button" tabindex="0" aria-label="Talk to ${esc(name)}">
            <div class="gyro" aria-hidden="true"><i></i><i></i><i></i></div>
            <div class="nv-core-label"><b>${esc(name.toUpperCase())}</b><span id="coreState" data-v="">ONLINE</span></div>
          </div>
          <div class="nv-tip" id="nvTip" role="tooltip"></div>
        </div>
        <form class="nv-ask" id="cmdAsk" autocomplete="off"><button type="button" class="btn mic" id="cmdMic" title="Talk (Alt+J)" aria-label="Talk">🎙</button><input id="cmdText" placeholder="Ask ${esc(name)} anything…" aria-label="Ask ${esc(name)}"><button class="btn primary">Send</button></form>
        <div class="nv-under">${tierSwitch()}</div>
        <div class="card nv-reply" id="cmdReply"></div>
      </div>
      <div class="nv-r" id="cmdRight"></div>
    </div>`;
  coreMount(document.getElementById("core"));
  cmdFill(false); coreState(); bindTierSwitch(el); orbitBuild(true);
  const core = document.getElementById("core");
  core.onclick = () => document.getElementById("cmdMic").click();
  core.onkeydown = e => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); core.click(); } };
  document.getElementById("cmdAsk").onsubmit = e => { e.preventDefault(); cmdSend(document.getElementById("cmdText").value); };
  document.getElementById("cmdMic").onclick = () => listen((t, done) => { const i = document.getElementById("cmdText"); if (i) i.value = t; if (done) cmdSend(t); }, on => { document.getElementById("cmdMic")?.classList.toggle("live", on); coreState(); if (on) corePing(); });
  if (sessionStorage.getItem("hq-listen") === "1") { sessionStorage.removeItem("hq-listen"); document.getElementById("cmdMic").click(); }
  const c = await api("/chat").catch(() => null);
  if (route.view !== "command") return;
  const box = document.getElementById("cmdReply");
  if (c?.messages?.length || c?.busy) { Cmd.waiting = c.busy; cmdShowReply(c, false); if (c.busy) cmdPollStart(); } else if (box) box.innerHTML = "";
}

function orbitBuild(fresh) {
  const host = document.getElementById("nvOrbit"); if (!host) return;
  const projs = S.projects.filter(p => p.stage !== "done");
  const sig = projs.map(p => `${p.slug}:${p.health}:${projPct(p)}`).join("|") + "|" + activeProject();
  if (!fresh && sig === Orb.sig) return;
  Orb.sig = sig;
  host.querySelectorAll(".nv-sat").forEach(n => n.remove());
  Orb.sats = projs.map(p => {
    const n = document.createElement("div");
    n.className = "nv-sat" + (p.slug === activeProject() ? " focus" : ""); n.tabIndex = 0; n.setAttribute("role", "link");
    n.setAttribute("aria-label", `${p.name}, ${p.stage}, ${projPct(p)}%`);
    n.style.setProperty("--c", HCOL[p.health] || "var(--accent)");
    n.innerHTML = `<span class="dot"></span><span class="nm">${esc(p.name)}</span><span class="pc">${projPct(p)}%</span>`;
    n.onclick = () => { if (Orb.dragMoved) return; location.hash = "project/" + p.slug; };
    n.onkeydown = e => { if (e.key === "Enter") n.click(); };
    n.onpointerenter = () => orbitTip(n, p); n.onpointerleave = () => orbitTip(null);
    n.onfocus = () => orbitTip(n, p); n.onblur = () => orbitTip(null);
    host.appendChild(n);
    return { n, p, w: 0, h: 0 };
  });
  requestAnimationFrame(() => { for (const s of Orb.sats) { s.w = s.n.offsetWidth; s.h = s.n.offsetHeight; } orbitStart(); });
  const stage = document.getElementById("nvStage");
  if (stage && !stage._drag) {
    stage._drag = 1;
    stage.addEventListener("pointerdown", e => { if (e.target.closest(".nv-core, .nv-tip")) return; Orb.drag = { x: e.clientX, th: Orb.th, t: performance.now() }; Orb.dragMoved = false; });
    addEventListener("pointermove", e => { if (!Orb.drag) return; const dx = e.clientX - Orb.drag.x; if (Math.abs(dx) > 4) Orb.dragMoved = true; const nt = Orb.drag.th + dx / 260; Orb.vel = (nt - Orb.th) * 60; Orb.th = nt; orbitStart(); });
    addEventListener("pointerup", () => { if (Orb.drag) { Orb.drag = null; setTimeout(() => { Orb.dragMoved = false; }, 30); } });
  }
}
function orbitTip(n, p) {
  const tip = document.getElementById("nvTip"); if (!tip) return;
  Orb.hover = n;
  if (!n) { tip.classList.remove("on"); return; }
  const pct = projPct(p);
  tip.innerHTML = `<b>${esc(p.name)}</b><div class="small muted">${esc(p.stage)} · health ${esc(p.health || "unknown")}</div><div class="bar"><i style="width:${pct}%"></i></div><div class="small">${esc(p.nextStep || p.summary || "No next step set.")}</div>`;
  const st = document.getElementById("nvStage").getBoundingClientRect(), r = n.getBoundingClientRect();
  const x = Math.max(4, Math.min(st.width - 264, r.left - st.left + r.width / 2 - 130));
  const below = r.top - st.top < st.height * .45;
  tip.style.left = x + "px"; tip.style.top = (below ? r.bottom - st.top + 12 : r.top - st.top - 12 - (tip.offsetHeight || 110)) + "px";
  tip.classList.add("on"); Snd.blip(1240, .03, "sine", .015);
}
function orbitStart() { if (!Orb.raf) { Orb.last = performance.now(); Orb.raf = requestAnimationFrame(orbitLoop); } }
function orbitStop() { if (Orb.raf) cancelAnimationFrame(Orb.raf); Orb.raf = 0; }
function orbitLoop(now) {
  Orb.raf = 0;
  const stage = document.getElementById("nvStage"); if (!stage || !Orb.sats.length) return;
  const dt = Math.min(.05, (now - Orb.last) / 1000); Orb.last = now;
  const busy = NV.busyT, base = Orb.hover ? 0 : (.045 + busy * .14);
  if (!Orb.drag) { Orb.vel = lerp(Orb.vel, base, .03); if (!reduced()) Orb.th += Orb.vel * dt; }
  const W = stage.clientWidth, H = stage.clientHeight, cx = W / 2, cy = H / 2 + 8;
  const rx = W < 500 ? W * .43 : Math.min(W * .47, 460), ry = rx * (W < 500 ? .5 : .36);
  const svg = stage.querySelector("svg.path");
  if (svg && svg._w !== W + "x" + H) { svg._w = W + "x" + H; const [a, b] = svg.querySelectorAll("ellipse"); for (const [e, k] of [[a, 1], [b, 1.18]]) { e.setAttribute("cx", cx); e.setAttribute("cy", cy); e.setAttribute("rx", rx * k); e.setAttribute("ry", ry * k); } }
  const N = Orb.sats.length;
  Orb.sats.forEach((s, i) => {
    const a = Orb.th + i / N * Math.PI * 2, depth = Math.sin(a); // +1 = front (lower half)
    const x = cx + Math.cos(a) * rx, y = cy + depth * ry;
    const k = .76 + (depth + 1) * .14, op = .38 + (depth + 1) * .31;
    s.n.style.transform = `translate3d(${(x - s.w / 2).toFixed(1)}px, ${(y - s.h / 2).toFixed(1)}px, 0) scale(${(s.n === Orb.hover ? 1.08 : k).toFixed(3)})`;
    s.n.style.opacity = s.n === Orb.hover ? 1 : op.toFixed(2);
    s.n.style.zIndex = depth > 0 ? 5 : 1;
    const back = depth < -.25 && s.n !== Orb.hover; if (back !== s.back) { s.back = back; s.n.classList.toggle("back", back); }
  });
  if (!reduced() || Orb.drag) Orb.raf = requestAnimationFrame(orbitLoop);
}

function cmdFill(quiet) {
  const L = document.getElementById("cmdLeft"), R = document.getElementById("cmdRight"), V = document.getElementById("nvVitals");
  if (!L || !R) return;
  const now = new Date(), st = S.status, ap = activeProject();
  const open = S.reminders.filter(r => !r.done);
  const todayEnd = new Date(ymd(now) + "T23:59"), tmrEnd = new Date(todayEnd.getTime() + 864e5);
  const pend = S.approvals.filter(a => a.status === "pending");
  const drafts = (S.outbox || []).filter(x => x.status === "draft" || x.status === "failed");
  const authBad = st.auth === "needs-login" || !st.claudeBin, paused = st.pausedUntil && new Date(st.pausedUntil) > now;
  if (V) V.innerHTML = [
    `<span class="nv-vital"><i class="${authBad ? "red" : st.auth === "ok" ? "" : "amber"}"></i>Claude <b>${authBad ? "sign-in needed" : st.auth === "ok" ? "online" : "standby"}</b></span>`,
    `<span class="nv-vital">Runs <b>${st.today}/${st.maxRunsPerDay}</b></span>`,
    st.queued ? `<span class="nv-vital"><i class="amber"></i>Queue <b>${st.queued}</b></span>` : "",
    paused ? `<span class="nv-vital"><i class="amber"></i>Paused <b>${esc(fmtWhen(st.pausedUntil))}</b></span>` : "",
    `<span class="nv-vital">Focus <b>${esc(ap ? projName(ap) : "All")}</b></span>`].join("");

  // timeline: calendar events + reminders, today and tomorrow, with a NOW marker
  const evs = (S.calendar?.upcoming || []).map(e => ({ t: e.title, s: e.allDay ? toDate(e.start + "T00:00") : new Date(e.start), en: e.allDay ? toDate(e.end + "T00:00") : new Date(e.end), all: e.allDay, loc: e.location, k: "ev" }));
  const rem = open.map(r => ({ t: r.title, s: toDate(r.due), en: toDate(r.due), all: String(r.due).length <= 10, k: "rem", p: r.project }));
  const items = [...evs, ...rem].filter(x => x.en >= new Date(ymd(now) + "T00:00") && x.s <= tmrEnd).sort((a, b) => a.s - b.s);
  const over = rem.filter(r => r.s < now);
  let tl = "", nowShown = false, tmrShown = false;
  for (const x of items) {
    if (x.k === "rem" && x.s < now) continue; // overdue goes to Needs you
    if (!tmrShown && x.s > todayEnd) { tmrShown = true; tl += `<div class="nv-now" style="color:var(--text3)">TOMORROW</div>`; }
    if (!nowShown && x.s > now && x.s <= todayEnd) { nowShown = true; tl += `<div class="nv-now">NOW ${pad(now.getHours())}:${pad(now.getMinutes())}</div>`; }
    const live = x.k === "ev" && !x.all && x.s <= now && x.en > now;
    tl += `<a class="nv-row" href="${x.p ? "#project/" + x.p : "#calendar"}"><span class="tm">${x.all ? "all day" : `${pad(x.s.getHours())}:${pad(x.s.getMinutes())}`}</span><div style="min-width:0"><div class="t">${esc(x.t)}</div><small>${live ? "HAPPENING NOW" : x.k === "ev" ? "CALENDAR" : "REMINDER"}${x.loc ? " · " + esc(x.loc).slice(0, 40) : ""}${x.p ? " · " + esc(projName(x.p)) : ""}</small></div></a>`;
  }
  const feedOn = (S.calendar?.feeds || []).length > 0;
  L.innerHTML = `<div class="card nv-panel"><div class="ttl">Today <b>${items.filter(x => !(x.k === "rem" && x.s < now)).length || "clear"}</b></div>${tl || `<div class="nv-empty">Nothing scheduled.${feedOn ? "" : ` <a href="#settings">Connect your calendar</a>`}</div>`}</div>
    <div class="card nv-panel"><div class="ttl">Missions <b>${st.queued} queued</b></div>
      ${st.running ? `<a class="nv-row" href="#missions"><span class="led"></span><div><div class="t">${esc(st.running.title)}</div><small>RUNNING · ${esc(ago(st.running.startedAt))}</small></div></a>` : ""}
      ${S.missions.filter(m => m.enabled).slice(0, 4).map(m => `<a class="nv-row" href="#missions"><span class="led off"></span><div><div class="t">${esc(m.title)}</div><small>${esc(m.scheduleText)} · ${esc(cap(tierModel(m.tier)))}</small></div></a>`).join("") || `<div class="nv-empty">No missions yet.</div>`}</div>`;

  // needs you: everything actionable, most urgent first
  const ups = S.milestones.filter(m => !m.done && toDate(m.date + "T23:59") >= now).sort((a, b) => a.date.localeCompare(b.date));
  const dl = ups.find(m => m.kind === "deadline");
  const A = [];
  if (authBad) A.push(["red", "Claude isn't signed in", "MISSIONS + CHAT WAITING", "#settings"]);
  evs.filter(e => !e.all && e.s > now && e.s - now <= 45 * 60e3).forEach(e => A.push(["amber", e.t, `STARTS IN ${Math.max(1, Math.round((e.s - now) / 6e4))} MIN`, "#calendar"]));
  drafts.forEach(d => A.push([d.status === "failed" ? "red" : "amber", d.kind === "email" ? `Email: ${d.payload.subject}` : `Calendar: ${d.payload.title}`, d.status === "failed" ? "NOT SENT · REVIEW" : "WAITING FOR YOUR OK", "#outbox"]));
  pend.forEach(a => A.push(["amber", a.title, "NEEDS YOUR OK", "#missions"]));
  over.slice(0, 4).forEach(r => A.push(["red", r.t, `OVERDUE · ${fmtWhen(ymd(r.s))}`, r.p ? "#project/" + r.p : "#home"]));
  if (paused) A.push(["amber", `Paused until ${fmtWhen(st.pausedUntil)}`, "USAGE LIMIT", "#missions"]);
  S.projects.filter(p => p.health === "risk" && p.stage !== "done").forEach(p => A.push(["red", `${p.name} at risk`, esc(p.nextStep || "").slice(0, 50).toUpperCase(), "#project/" + p.slug]));
  if (dl) { const days = Math.ceil((toDate(dl.date + "T23:59") - now) / 864e5); A.push([days <= 3 ? "red" : "", dl.title, `DEADLINE IN ${days} DAY${days === 1 ? "" : "S"}${dl.project ? " · " + esc(projName(dl.project)).toUpperCase() : ""}`, dl.project ? "#project/" + dl.project : "#roadmap"]); }
  S.projects.filter(p => p.health === "watch" && p.stage !== "done").slice(0, 3).forEach(p => A.push(["amber", `${p.name}: watch`, "HEALTH", "#project/" + p.slug]));
  R.innerHTML = `<div class="card nv-panel"><div class="ttl">Needs you <b>${A.length || "clear"}</b></div>${A.slice(0, 9).map(a => `<a class="nv-row" href="${a[3]}"><span class="led ${a[0]}"></span><div style="min-width:0"><div class="t">${esc(a[1])}</div><small>${a[2]}</small></div></a>`).join("") || `<div class="nv-row"><span class="led green"></span><div><div class="t">All clear</div><small>NOTHING WAITING ON YOU</small></div></div>`}</div>
    <div class="card nv-panel"><div class="ttl">Quick actions</div><div class="row" style="flex-wrap:wrap;gap:8px">
      <a class="btn sm" href="#code">⌨ Code</a><button class="btn sm" type="button" data-nv="email">✉ Email</button><button class="btn sm" type="button" data-nv="event">＋ Event</button><a class="btn sm" href="#planner">⬡ Planner</a><button class="btn sm" type="button" data-nv="pal">⌕ Search</button></div></div>`;
  R.querySelector('[data-nv="email"]').onclick = () => outboxCompose("email");
  R.querySelector('[data-nv="event"]').onclick = () => outboxCompose("calendar");
  R.querySelector('[data-nv="pal"]').onclick = () => palOpen();
  if (quiet) orbitBuild(false);
}

// ---------------- start ----------------
(function novaStart() {
  const sw = document.createElement("div"); sw.id = "nova-sweep"; sw.setAttribute("aria-hidden", "true"); document.body.appendChild(sw);
  sceneStart(); cursorStart();
  document.addEventListener("visibilitychange", () => { if (!document.hidden) { sceneKick(); if (Core.ok && !Core.raf) Core.raf = requestAnimationFrame(coreLoop); } });
  RM.addEventListener?.("change", () => sceneKick());
  // wake from power-down: restart loops
  new MutationObserver(() => { if (!HUD.asleep) { sceneKick(); if (Core.ok && !Core.raf) Core.raf = requestAnimationFrame(coreLoop); } }).observe(document.body, { attributes: true, attributeFilter: ["class"] });
})();
