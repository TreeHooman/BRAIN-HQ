// NOVA layer: immersive 3D scene + motion system + the new Command screen.
// Loads last (after app.js, hud.js, views.js) and overrides a few hud.js functions. No dependencies.
// Everything here is decoration on top of working UI: if WebGL is missing it falls back silently,
// and prefers-reduced-motion freezes it.
"use strict";

const NV = { t0: performance.now(), mx: .5, my: .5, sx: 0, scroll: 0, busy: 0, busyT: 0, listen: 0, pulse: 0, fine: matchMedia("(pointer: fine)").matches };
const lerp = (a, b, k) => a + (b - a) * k;
const nvOn = () => isHud() && !HUD.asleep && !document.hidden;
/** Battery saver: phones (and anyone who picks it) get a near-still background and a slower orb, so the device stays cool. */
const lowPower = () => { try { const v = localStorage.getItem("hq-power"); if (v === "full") return false; if (v === "saver") return true; } catch {} return matchMedia("(pointer: coarse)").matches || matchMedia("(max-width: 760px)").matches; };

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

// ---------------- background: cycling space vistas (nebula + ringed giant, planet sunrise, black hole, galaxy) ----------------
// One fullscreen shader. uA/uB are scene ids, uX the crossfade between them (space.js drives the playlist).
// The mouse parallaxes every layer, so near objects move more than far stars.
const SCENE_FS = `precision highp float;
uniform vec2 uR;uniform float uT,uB,uS,uX;uniform vec2 uM;uniform float uA,uN,uZ;
${GLSL_NOISE}
vec3 stars(vec2 uv,float sc,float sz){vec2 p=uv*sc,id=floor(p),f=fract(p)-.5;float r=h21(id);if(r<.93)return vec3(0.);
 vec2 o=vec2(h21(id+3.1),h21(id+7.7))-.5;float d=length(f-o*.7);float tw=.55+.45*sin(uT*(.6+r*2.5)+r*50.);
 return smoothstep(.05*sz,0.,d)*tw*mix(vec3(.75,.92,1.),vec3(1.,.82,1.),h21(id+1.3));}
vec3 sky(vec2 uv,vec2 m,float t,float neb){
 vec3 col=vec3(.003,.006,.02);
 col+=stars(uv+m*.006,90.,.7)*.6+stars(uv+m*.016,48.,.8)*.85+stars(uv+m*.035,24.,1.)*1.;
 if(neb>0.){vec2 q=uv*1.25+m*.04;float w=fbm(q*1.1+vec2(t,-t*.6));float nb=fbm(q*2.1+w*1.7+vec2(-t*.8,t*.5));
  vec3 c=mix(vec3(.0,.32,.46),vec3(.26,.12,.52),smoothstep(.3,.8,w));c=mix(c,vec3(.55,.08,.38),smoothstep(.55,.95,nb)*.4);
  col+=c*pow(smoothstep(.32,1.,nb),1.7)*.55*neb;}
 return col;}
vec3 glow(vec2 uv,vec2 p,vec3 c,float k){return c*k/(dot(uv-p,uv-p)*400.+1.);}
// 4: the original deep-space nebula (no floor grid)
vec3 s4(vec2 uv,vec2 m,float t){
 vec2 q=uv*1.25+m*.06;
 float w=fbm(q*1.1+vec2(t,-t*.6)); float nb=fbm(q*2.1+w*1.7+vec2(-t*.8,t*.5));
 vec3 col=mix(vec3(.0,.32,.46),vec3(.26,.12,.52),smoothstep(.3,.8,w)); col=mix(col,vec3(.55,.08,.38),smoothstep(.55,.95,nb)*.4);
 col*=pow(smoothstep(.32,1.,nb),1.7)*(.5+uB*.25);
 col+=vec3(.003,.007,.025)+vec3(0.,.025,.05)*max(0.,1.-length(uv));
 return col;}
vec3 pick(float id,vec2 uv,vec2 m,float t){return s4(uv,vec2(m.x,-m.y),t);} // planets removed: nebula only
void main(){
 vec2 uv=(gl_FragCoord.xy-.5*uR)/uR.y; vec2 m=uM-.5; m.y=-m.y; float t=uT*.022*(1.+uB*2.);
 uv/=1.+uZ*.04; uv.y-=uS*.00004;
 vec3 col=pick(uA,uv,m,t); if(uX>0.001)col=mix(col,pick(uN,uv,m,t),uX);
 vec2 mp=m*vec2(uR.x/uR.y,1.);
 if(uA>3.5&&uX<.001){col+=vec3(.05,.25,.4)*.05/(length(uv-vec2(mp.x,-mp.y))+.25);}
 else{col*=1.+uB*.15; col+=vec3(.05,.25,.4)*.035/(length(uv-mp)+.25); col*=1.-.35*dot(uv*.6,uv*.6); col=col/(1.+col*.35);}
 gl_FragColor=vec4(col,1.);}`;
const Scene = { c: null, gl: null, p: null, raf: 0, scale: .6, frame: 0, ok: false };
/** Planets need full resolution to look sharp; the soft nebula is fine (and cheap) at 60%. */
// Auto quality: watches the real frame rate; if this PC can't keep up it steps resolution/frame rate down, and back up when it can.
const Perf = { ema: 16.7, lvl: 0, last: 0, bad: 0, good: 0 };
function perfTick(now) {
  if (Perf.last) {
    Perf.ema += (Math.min(100, now - Perf.last) - Perf.ema) * .05;
    if (Perf.ema > 24) { Perf.good = 0; if (++Perf.bad > 120 && Perf.lvl < 2) { Perf.lvl++; Perf.bad = 0; sceneRes(Scene.sharp); } }
    else if (Perf.ema < 17.5) { Perf.bad = 0; if (++Perf.good > 1800 && Perf.lvl > 0) { Perf.lvl--; Perf.good = 0; sceneRes(Scene.sharp); } }
  }
  Perf.last = now;
}
/** Planets need full resolution to look sharp; the soft nebula is fine (and cheap) at half. */
function sceneRes(sharp) { Scene.sharp = !!sharp; const sc = lowPower() ? .35 : (sharp ? 1 : .5) * [1, .75, .55][Perf.lvl]; if (Scene.scale !== sc) { Scene.scale = sc; sceneSize(); } }
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
  const d = Math.min(Scene.sharp ? 1.5 : 1, devicePixelRatio || 1) * Scene.scale;
  Scene.c.width = Math.round(innerWidth * d); Scene.c.height = Math.round(innerHeight * d);
  Scene.gl.viewport(0, 0, Scene.c.width, Scene.c.height);
  if (reduced()) sceneDraw();
}
function sceneDraw() {
  const { gl, p } = Scene, t = (performance.now() - NV.t0) / 1000;
  gl.uniform2f(p.u("uR"), Scene.c.width, Scene.c.height); gl.uniform1f(p.u("uT"), reduced() ? 12 : t);
  gl.uniform1f(p.u("uB"), NV.busy); gl.uniform1f(p.u("uS"), NV.scroll); gl.uniform2f(p.u("uM"), NV.sx, NV.sy ?? .5);
  const v = typeof spaceView === "function" ? spaceView() : { a: 4, n: 4, x: 0, z: 0 };
  gl.uniform1f(p.u("uA"), v.a); gl.uniform1f(p.u("uN"), v.n); gl.uniform1f(p.u("uX"), v.x); gl.uniform1f(p.u("uZ"), v.z);
  gl.drawArrays(gl.TRIANGLES, 0, 3);
}
function sceneLoop(now) {
  Scene.raf = 0;
  if (!Scene.ok || !nvOn()) return;
  if (window.hqBooting) { Scene.raf = requestAnimationFrame(sceneLoop); return; } // the opening scan gets the GPU to itself
  perfTick(now);
  NV.sx = lerp(NV.sx || .5, NV.mx, .04); NV.sy = lerp(NV.sy ?? .5, NV.my, .04);
  NV.busy = lerp(NV.busy, NV.busyT, .03);
  const lp = lowPower(); if (lp && Scene.scale > .4) { Scene.scale = .35; sceneSize(); }
  // saver ~5 fps; nebula ~20 fps (it drifts slowly); planets ~30 fps; one step slower when the PC is struggling
  const every = lp ? 12 : (Scene.sharp ? 2 : 3) + (Perf.lvl ? 1 : 0);
  if (++Scene.frame % every === 0 || (!lp && NV.busy > .05 && Scene.frame % 2 === 0)) sceneDraw();
  if (!reduced()) Scene.raf = requestAnimationFrame(sceneLoop);
}
function sceneKick() { if (Scene.ok && !Scene.raf) { Perf.last = 0; if (reduced()) { sceneDraw(); return; } Scene.raf = requestAnimationFrame(sceneLoop); } }

// ---------------- the core: AI voice orb ----------------
// Layered closed light-waves + a frequency ring around a small core. Idle: slow breathing.
// Listening: driven by the real mic level (Web Audio). Speaking: speech-like envelope while TTS talks.
// Thinking: comet arcs swirl. Canvas 2D, additive light, supersampled for crisp lines.
const Core = { skip: 0, el: null, c: null, x: null, raf: 0, ok: false, w: 0, h: 0, b: 0, amp: 0, spk: 0, last: 0, bars: null };
const Mic = { stream: null, an: null, buf: null, level: 0, want: false, starting: false };
async function micOn() {
  if (Mic.stream || Mic.starting || !navigator.mediaDevices?.getUserMedia) return;
  Mic.starting = true;
  try {
    const s = await navigator.mediaDevices.getUserMedia({ audio: { echoCancellation: true, noiseSuppression: true } });
    if (!Mic.want) { s.getTracks().forEach(t => t.stop()); return; }
    const ac = Snd.ac(), src = ac.createMediaStreamSource(s), an = ac.createAnalyser(); an.fftSize = 512; src.connect(an);
    Object.assign(Mic, { stream: s, an, buf: new Uint8Array(an.fftSize) });
  } catch { /* no microphone samples: remain calm instead of fabricating a level */ } finally { Mic.starting = false; }
}
function micOff() { Mic.stream?.getTracks().forEach(t => t.stop()); Object.assign(Mic, { stream: null, an: null, level: 0 }); }
function micLevel() {
  if (!Mic.an) return 0;
  Mic.an.getByteTimeDomainData(Mic.buf); let s = 0; for (const v of Mic.buf) { const d = (v - 128) / 128; s += d * d; }
  return Math.min(1, Math.sqrt(s / Mic.buf.length) * 5);
}
function coreMount(host) {
  Core.el = host;
  host.querySelector(".gyro")?.remove();
  const c = document.createElement("canvas"); c.setAttribute("aria-hidden", "true"); host.prepend(c);
  Core.c = c; Core.x = c.getContext("2d"); Core.ok = !!Core.x;
  coreSize();
  if (Core.ok && !Core.raf) Core.raf = requestAnimationFrame(coreLoop);
}
function coreSize() {
  if (!Core.ok || !Core.c.isConnected) return;
  const r = Core.c.getBoundingClientRect(), d = Math.min(2, Math.max(1.5, (devicePixelRatio || 1) * 1.25));
  Core.w = r.width; Core.h = r.height;
  Core.c.width = Math.max(64, Math.round(r.width * d)); Core.c.height = Math.max(64, Math.round(r.height * d));
  Core.x.setTransform(d, 0, 0, d, 0, 0);
}
function coreLoop(now = performance.now()) {
  Core.raf = 0;
  if (!Core.ok || !Core.c.isConnected) { Core.ok = false; Mic.want = false; micOff(); return; }
  if (nvOn() && !window.hqBooting && (lowPower() ? ++Core.skip % 3 === 0 : !Perf.lvl || ++Core.skip % 2 === 0)) coreDraw(now); // saver ~20 fps orb; ~30 when struggling
  if (!reduced() || !Core.drawn) { Core.drawn = true; Core.raf = requestAnimationFrame(coreLoop); }
}
function coreDraw(now) {
  const { x, w, h } = Core, dt = Math.min(.05, (now - (Core.last || now)) / 1000); Core.last = now;
  const el = Core.el, busy = el.classList.contains("busy") ? 1 : 0, lis = el.classList.contains("listening") ? 1 : 0;
  const speaking = el.dataset.voiceState === "speaking";
  // mic follows the listening state
  Mic.want = !!lis && !reduced(); if (Mic.want && !Mic.stream && !matchMedia("(pointer: coarse)").matches) micOn(); else if (!Mic.want && Mic.stream) micOff();
  Core.b = lerp(Core.b, busy, .05); NV.listen = lerp(NV.listen, lis, .08); NV.pulse = Math.max(0, NV.pulse - dt * .9);
  Core.spk = lerp(Core.spk, speaking ? 1 : 0, .08);
  // target amplitude per state
  const input=lis&&!reduced()?micLevel():0,output=speaking&&typeof voiceMotionLevel==='function'?voiceMotionLevel(now):0;
  const heardCue=lis&&!Mic.an&&typeof VoiceVisual!=='undefined'?Math.max(0,Math.min(1,(VoiceVisual.heardUntil-Date.now())/900)):0;
  let target=.025;
  if (Core.b > .1) target=Math.max(target,.10*Core.b); // work indicator, not an audio waveform
  if (lis) target=Math.max(target,.035+input*.9+heardCue*.10);
  if (speaking) target=Math.max(target,.035+output*.65);
  Core.input=input;Core.output=output;
  Core.phase=(Core.phase||0)+(reduced()?0:dt*(input*3+output*2+busy*.7+heardCue*.3));const t=Core.phase;
  if(lis&&Mic.an){Mic.freq ||= new Uint8Array(Mic.an.frequencyBinCount);Mic.an.getByteFrequencyData(Mic.freq);}
  target += NV.pulse * .4;
  Core.amp = lerp(Core.amp, target, target > Core.amp ? .35 : .08);
  const A = Core.amp, B = Core.b, L = NV.listen, Sp = Core.spk;
  // Voice palette matches the explicit status: green ready, cyan hearing, amber speech, violet thinking.
  const activeColor=({listening:[100,240,183],hearing:[100,240,255],captured:[100,240,255],speaking:[255,204,126],thinking:[186,150,255],sending:[186,150,255]})[el.dataset.voiceState];
  const hue = (i) => { if(activeColor)return activeColor.map(v=>Math.min(255,v+i*8));const c1 = [110, 240, 255], c2 = [169, 139, 255], c3 = [255, 122, 217]; const k = Math.min(1, B * .9); const base = i === 0 ? c1 : i === 1 ? c2 : i === 2 ? c3 : [200, 245, 255]; const tgt = i === 0 ? c2 : i === 1 ? c3 : c1; return base.map((v, j) => Math.round(lerp(v, tgt[j], k * .7))); };
  const rgba = (c, a) => `rgba(${c[0]},${c[1]},${c[2]},${a.toFixed(3)})`;
  x.clearRect(0, 0, w, h);
  x.globalCompositeOperation = "lighter";
  const ox = w / 2 + ((NV.sx ?? .5) - .5) * 6, oy = h / 2 + ((NV.sy ?? .5) - .5) * 6, R = Math.min(w, h) * .23;
  // soft inner light (small)
  const g = x.createRadialGradient(ox, oy, 0, ox, oy, R * 1.05);
  g.addColorStop(0, rgba([235, 252, 255], .5 + A * .4)); g.addColorStop(.18, rgba(hue(0), .22 + A * .25)); g.addColorStop(.55, rgba(hue(1), .05 + A * .06)); g.addColorStop(1, rgba(hue(1), 0));
  x.fillStyle = g; x.beginPath(); x.arc(ox, oy, R * 1.05, 0, 6.283); x.fill();
  // layered closed waves: integer harmonics keep each loop closed
  const layers = [[2, 3, 5, 0], [3, 4, 7, 1], [2, 5, 6, 2], [4, 6, 9, 3]], P = 220;
  layers.forEach(([f1, f2, f3, ci], li) => {
    const sp = .5 + li * .17, ph = li * 1.7, amp = A * (1 - li * .12) * R * .55, rr = R * (.78 + li * .05);
    x.beginPath();
    for (let i = 0; i <= P; i++) {
      const th = i / P * Math.PI * 2;
      const d = Math.sin(f1 * th + t * sp * 2.1 + ph) * .55 + Math.sin(f2 * th - t * sp * 1.6 + ph * 2) * .3 + Math.sin(f3 * th + t * sp * 3.2) * .15;
      const r = rr + d * amp + Math.sin(th * 2 + t * .6 + li) * R * .015;
      const px = ox + Math.cos(th) * r, py = oy + Math.sin(th) * r;
      i ? x.lineTo(px, py) : x.moveTo(px, py);
    }
    const c = hue(ci);
    x.strokeStyle = rgba(c, .1 + A * .12); x.lineWidth = 4; x.stroke();       // glow
    x.strokeStyle = rgba(c, .55 + A * .4); x.lineWidth = 1.1; x.stroke();      // crisp line
  });
  // frequency ring: thin radial bars, mirrored for symmetry
  const N = 96, R2 = R * 1.42;
  Core.bars ||= new Float32Array(N);
  x.lineCap = "round";
  for (let i = 0; i < N; i++) {
    const th = i / N * Math.PI * 2 - Math.PI / 2, k = Math.min(i, N - i) / (N / 2);
    const sample=lis&&Mic.an?(Mic.freq[Math.min(Mic.freq.length-1,Math.floor(k*Mic.freq.length*.65))]/255)*input:output*(.65+.35*Math.cos(k*Math.PI*4));
    const want = .015+sample*.8;
    Core.bars[i] = lerp(Core.bars[i], want, .25);
    const len = R * (.03 + Core.bars[i] * .5), c = hue(i % 3 === 0 ? 1 : 0);
    x.strokeStyle = rgba(c, .25 + Core.bars[i] * 1.2); x.lineWidth = 1.3;
    x.beginPath(); x.moveTo(ox + Math.cos(th) * R2, oy + Math.sin(th) * R2); x.lineTo(ox + Math.cos(th) * (R2 + len), oy + Math.sin(th) * (R2 + len)); x.stroke();
  }
  // outer hairline rings with slow-moving gaps
  for (const [rk, sp, a] of [[1.32, .15, .2], [1.75, -.08, .1]]) {
    x.strokeStyle = rgba(hue(0), a + A * .1); x.lineWidth = .7;
    for (let s = 0; s < 3; s++) { const a0 = t * sp + s * 2.094; x.beginPath(); x.arc(ox, oy, R * rk, a0, a0 + 1.7); x.stroke(); }
  }
  // thinking: comet arcs swirl around
  if (B > .02) for (let k = 0; k < 3; k++) {
    const a0 = t * (2.2 + k * .6) + k * 2.1, rr = R * (1.12 + k * .09);
    const grd = x.createConicGradient ? x.createConicGradient(a0 - 1.2, ox, oy) : null;
    if (grd) { grd.addColorStop(0, rgba(hue(1), 0)); grd.addColorStop(.19, rgba(hue(2), .9 * B)); grd.addColorStop(.2, rgba(hue(2), 0)); x.strokeStyle = grd; }
    else x.strokeStyle = rgba(hue(2), .7 * B);
    x.lineWidth = 1.6; x.beginPath(); x.arc(ox, oy, rr, a0 - 1.2, a0); x.stroke();
    x.fillStyle = rgba([255, 255, 255], .9 * B); x.beginPath(); x.arc(ox + Math.cos(a0) * rr, oy + Math.sin(a0) * rr, 1.8, 0, 6.283); x.fill();
  }
  // listening: rings breathe outward
  if (L > .02&&input>.025) for (let k = 0; k < 3; k++) {
    const u = ((t * .7 + k / 3) % 1), rr = R * (1 + u * .9);
    x.strokeStyle = rgba(hue(0), (1 - u) * .35 * L*input); x.lineWidth = 1; x.beginPath(); x.arc(ox, oy, rr, 0, 6.283); x.stroke();
  }
  // ping: one expanding shock ring
  if (NV.pulse > .01) { const rr = R * (1 + (1 - NV.pulse) * 1.3); x.strokeStyle = rgba([220, 250, 255], NV.pulse * .8); x.lineWidth = 1.4; x.beginPath(); x.arc(ox, oy, rr, 0, 6.283); x.stroke(); }
  x.globalCompositeOperation = "source-over";
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
  const want = listening ? "LISTENING" : busy ? "THINKING" : window.speechSynthesis?.speaking ? "SPEAKING" : S?.status?.running ? "WORKING" : "ONLINE";
  if (lbl && lbl.dataset.v !== want) { lbl.dataset.v = want; scrambleTo(lbl, want, 400); }
}
/** The holographic entrance for a page (one play: the opening scan calls this when it ends instead of its own fade). */
function nvAssemble(el) {
  el = el || document.getElementById("view"); if (!el || reduced() || !isHud()) return false;
  let i = 0;
  for (const c of el.children) c.style.setProperty("--i", i++);
  el.querySelectorAll(".cols > * > *, .tiles > *").forEach((c, j) => c.style.setProperty("--i", Math.min(14, 2 + j)));
  el.classList.remove("assemble", "view-in"); void el.offsetWidth; el.classList.add("assemble");
  clearTimeout(hudAfterRender.t); hudAfterRender.t = setTimeout(() => el.classList.remove("assemble"), 1700);
  const sw = document.getElementById("nova-sweep"); if (sw) { sw.classList.remove("go"); void sw.offsetWidth; sw.classList.add("go"); }
  Snd.blip(520, .05, "sine", .03); setTimeout(() => Snd.blip(780, .05, "sine", .02), 70);
  return true;
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
    if (!reduced() && isHud() && !window.hqBooting) nvAssemble(el); // during the opening scan the scan's end plays it once
    else if (window.hqBooting) window.nvAssembleLater = true;
  }
  if (route.view !== "command") orbitStop();
}

// ---------------- Command: core + orbiting projects ----------------
const Orb = { raf: 0, th: 0, vel: 0, hover: null, drag: null, sats: [], last: 0, sig: "" };
async function vCommand(el) {
  const name = S.settings.assistantName || "LUTHUR", now = new Date(), hr = now.getHours();
  el.innerHTML = `<div class="nv-head"><div><div class="nv-greet">${hr < 12 ? "Good morning" : hr < 18 ? "Good afternoon" : "Good evening"} · ${esc(DOW[now.getDay()])} ${now.getDate()} ${esc(MON[now.getMonth()])}</div><h1>War Room</h1></div><div class="nv-vitals" id="nvVitals"></div></div>
    <div class="nv-cmd nv-desk">
      <div class="nv-l" id="cmdLeft"></div>
      <div class="nv-mid">
        <div class="nv-stage" id="nvStage">
          <div class="nv-orbit" id="nvOrbit"><svg class="path" aria-hidden="true"><ellipse class="a"/><ellipse class="b"/></svg></div>
          <div class="nv-core core-wrap" id="core" role="button" tabindex="0" aria-label="Talk to ${esc(name)}">${hudRings()}
            <div class="nv-core-label"><b>${esc(name.toUpperCase())}</b><span id="coreState" data-v="">ONLINE</span></div>
          </div>
          <div class="nv-tip" id="nvTip" role="tooltip"></div>
          <section class="nv-gap-card nv-gap-timer" id="gapTimer" aria-label="Focus timer"></section>
          <section class="nv-gap-card nv-gap-live" id="gapLive" aria-label="Multi-agent live activity"></section>
          <section class="nv-gap-card nv-gap-calendar" id="gapCalendar" aria-label="Upcoming calendar events"></section>
        </div>
        <form class="nv-ask" id="cmdAsk" autocomplete="off"><button type="button" class="btn mic" id="cmdMic" title="Talk (Alt+J)" aria-label="Talk">${MIC_SVG}</button><input id="cmdText" placeholder="Ask, or: update a project · do a check · pull up a site…" aria-label="Ask ${esc(name)}"><button class="btn primary">Send</button></form>
        <div class="nv-under">${tierSwitch()}</div>
        <div class="card nv-reply no-fold" id="cmdReply"></div>
      </div>
      <div class="nv-r" id="cmdRight"></div>
    </div>`;
  coreMount(document.getElementById("core"));
  cmdFill(false); coreState(); bindTierSwitch(el); orbitBuild(true);
  gapWidgetsMount(); usageRingMount(); musicHud();
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
    n.innerHTML = satBadge(p) + `<span class="tx"><span class="nm">${esc(p.name)}</span><span class="mt">${esc(p.stage)} · ${projPct(p)}%</span><i class="pb"><i style="width:${projPct(p)}%"></i></i></span>`;
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
    // swipe anywhere in the middle column (orb included, and the band around it on phones); a drag never counts as a tap
    const zone = stage.closest(".nv-mid") || stage;
    if (!zone._drag) {
      zone._drag = 1;
      zone.addEventListener("pointerdown", e => { if (e.button > 0 || e.target.closest("input, textarea, select, a, .nv-tip, .nv-panel, .card, button:not(.nv-sat)")) return; Orb.drag = { x: e.clientX, th: Orb.th, t: performance.now() }; Orb.dragMoved = false; });
      zone.addEventListener("click", e => { if (Orb.dragMoved) { e.stopPropagation(); e.preventDefault(); } }, true);
    }
    addEventListener("pointermove", e => { if (!Orb.drag) return; const dx = e.clientX - Orb.drag.x; if (Math.abs(dx) > 8) Orb.dragMoved = true; const nt = Orb.drag.th - dx / (innerWidth < 500 ? 160 : 260) /* front projects follow the finger */; Orb.vel = (nt - Orb.th) * 60; Orb.th = nt; orbitStart(); });
    const end = () => { if (Orb.drag) { Orb.drag = null; setTimeout(() => { Orb.dragMoved = false; }, 30); } };
    addEventListener("pointerup", end); addEventListener("pointercancel", end);
  }
}
// Stark-style radial HUD around the voice orb (vector, crisp): segmented rings, degree scale, brackets, live diagnostics fan
function hudRings() {
  const c = 200, pt = (r, a) => [c + Math.cos(a) * r, c + Math.sin(a) * r].map(v => v.toFixed(2));
  const arc = (r, a0, a1) => { const [x0, y0] = pt(r, a0), [x1, y1] = pt(r, a1); return `M${x0} ${y0}A${r} ${r} 0 ${a1 - a0 > Math.PI ? 1 : 0} 1 ${x1} ${y1}`; };
  const sector = (r0, r1, a0, a1) => { const [ax, ay] = pt(r1, a0), [bx, by] = pt(r1, a1), [cx2, cy2] = pt(r0, a1), [dx, dy] = pt(r0, a0); return `M${ax} ${ay}A${r1} ${r1} 0 0 1 ${bx} ${by}L${cx2} ${cy2}A${r0} ${r0} 0 0 0 ${dx} ${dy}Z`; };
  const D = Math.PI / 180;
  let ticks = "", nums = "";
  for (let i = 0; i < 120; i++) { const a = i * 3 * D, r2 = i % 10 === 0 ? 176 : i % 5 === 0 ? 172 : 169; const [x0, y0] = pt(166, a), [x1, y1] = pt(r2, a); ticks += `M${x0} ${y0}L${x1} ${y1}`; }
  for (let i = 0; i < 12; i++) { const a = (i * 30 - 90) * D, [x, y] = pt(184, a); nums += `<text x="${x}" y="${y}" transform="rotate(${i * 30} ${x} ${y})">${String(i * 30).padStart(3, "0")}</text>`; }
  const seg = Array.from({ length: 36 }, (_, i) => i % 9 === 8 ? "" : arc(150, (i * 10 + 1) * D, (i * 10 + 8) * D)).join("");
  const brackets = [0, 120, 240].map(o => arc(132, (o + 8) * D, (o + 92) * D) + (() => { const [x0, y0] = pt(126, (o + 8) * D), [x1, y1] = pt(138, (o + 8) * D), [x2, y2] = pt(126, (o + 92) * D), [x3, y3] = pt(138, (o + 92) * D); return `M${x0} ${y0}L${x1} ${y1}M${x2} ${y2}L${x3} ${y3}`; })()).join("");
  const fan = ["runs", "queue", "inbox", "outbox"].map((k, i) => { const r0 = 196 + i * 13, a0 = 200 * D, a1 = 252 * D; return `<path class="fan-bg" d="${sector(r0, r0 + 10, a0, a1)}"/><path class="fan-v" data-fan="${k}" d="${sector(r0, r0 + 10, a0, a0 + .001)}" data-r0="${r0}"/><text class="fan-l" x="${pt(r0 + 5, 255 * D)[0]}" y="${pt(r0 + 5, 255 * D)[1]}">${k.toUpperCase()}</text>`; }).join("");
  // Mirror of the left fan: bars fill from the bottom end up, labels sit in a column under the bottom end of the arcs.
  const [ux, uy] = pt(201, 344 * D);
  const usage = [["context", "CLAUDE CTX"], ["fiveHour", "CLAUDE 5H"],["codexContext","GPT CTX"],["codexFiveHour","GPT 5H"]].map(([key, label], i) => {
    const r0 = 196 + i * 13, a0 = 288 * D, a1 = 340 * D, x = ux, y = (+uy + 6 + i * 9).toFixed(2);
    return `<path class="usage-bg" d="${sector(r0, r0 + 10, a0, a1)}"/><path class="usage-v" data-usage="${key}" data-r0="${r0}" d="${sector(r0, r0 + 10, a1 - .001, a1)}"/><text class="usage-l" data-usage-label="${key}" x="${x}" y="${y}">${label} —</text>`;
  }).join("");
  const right = arc(205, -40 * D, 40 * D) + arc(212, -30 * D, 30 * D);
  return `<svg class="nv-hud" viewBox="-60 -60 520 520" aria-hidden="true">
    <g class="h-scale"><path d="${ticks}"/></g>
    <g class="h-seg"><path d="${seg}"/></g>
    <g class="h-brk"><path d="${brackets}"/></g>
    <circle class="h-hair" cx="200" cy="200" r="158"/><circle class="h-hair b" cx="200" cy="200" r="118"/>
    <g class="h-fan">${fan}</g>
    <g class="h-usage">${usage}</g>
    <g class="h-right"><path d="${right}"/><text class="h-clock" id="hudClock" x="${ux}" y="${(+uy + 50).toFixed(2)}"></text></g>
  </svg>`;
}
function hudFan(vals) {
  const svg = document.querySelector(".nv-hud"); if (!svg) return;
  const D = Math.PI / 180, c = 200, pt = (r, a) => [c + Math.cos(a) * r, c + Math.sin(a) * r].map(v => v.toFixed(2));
  for (const p of svg.querySelectorAll("[data-fan]")) {
    const [v, max] = vals[p.dataset.fan] || [0, 1], r0 = +p.dataset.r0, r1 = r0 + 10, a0 = 200 * D, a1 = a0 + Math.max(.02, Math.min(1, v / Math.max(1, max))) * 52 * D;
    const [ax, ay] = pt(r1, a0), [bx, by] = pt(r1, a1), [cx2, cy2] = pt(r0, a1), [dx, dy] = pt(r0, a0);
    p.setAttribute("d", `M${ax} ${ay}A${r1} ${r1} 0 0 1 ${bx} ${by}L${cx2} ${cy2}A${r0} ${r0} 0 0 0 ${dx} ${dy}Z`);
    p.classList.toggle("hot", v > 0);
  }
  const ck = document.getElementById("hudClock"); if (ck) { const n = new Date(); ck.textContent = `${pad(n.getHours())}:${pad(n.getMinutes())}`; }
}
// holographic project badge: initials in a hex core, health-coloured progress arc, rotating tick ring
function satBadge(p) {
  const pct = projPct(p), C = 2 * Math.PI * 15, ini = (p.name.match(/\b[A-Za-z0-9]/g) || ["?"]).slice(0, 2).join("").toUpperCase();
  const hex = Array.from({ length: 6 }, (_, i) => { const a = Math.PI / 3 * i - Math.PI / 6; return `${(20 + Math.cos(a) * 9.5).toFixed(2)},${(20 + Math.sin(a) * 9.5).toFixed(2)}`; }).join(" ");
  const ticks = Array.from({ length: 24 }, (_, i) => { const a = i / 24 * Math.PI * 2, r1 = 18.2, r2 = i % 6 ? 19.2 : 20; return `M${(20 + Math.cos(a) * r1).toFixed(2)} ${(20 + Math.sin(a) * r1).toFixed(2)}L${(20 + Math.cos(a) * r2).toFixed(2)} ${(20 + Math.sin(a) * r2).toFixed(2)}`; }).join("");
  return `<svg class="badge" viewBox="0 0 40 40" aria-hidden="true">
    <g class="spin"><path d="${ticks}" stroke="currentColor" stroke-width=".6" opacity=".55"/></g>
    <circle cx="20" cy="20" r="15" fill="none" stroke="rgba(150,220,255,.14)" stroke-width="1.6"/>
    <circle cx="20" cy="20" r="15" fill="none" stroke="var(--c)" stroke-width="1.6" stroke-linecap="round" stroke-dasharray="${(C * pct / 100).toFixed(1)} ${C.toFixed(1)}" transform="rotate(-90 20 20)" class="arc"/>
    <polygon points="${hex}" fill="rgba(10,20,40,.7)" stroke="var(--c)" stroke-width=".8"/>
    <text x="20" y="20.4" text-anchor="middle" dominant-baseline="middle">${esc(ini)}</text></svg>`;
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
    const lx = W < 500 ? Math.max(4, Math.min(W - s.w - 4, x - s.w / 2)) : x - s.w / 2; // phones: keep labels on screen
    s.n.style.transform = `translate3d(${lx.toFixed(1)}px, ${(y - s.h / 2).toFixed(1)}px, 0) scale(${(s.n === Orb.hover ? 1.08 : k).toFixed(3)})`;
    s.n.style.opacity = s.n === Orb.hover ? 1 : op.toFixed(2);
    s.n.style.zIndex = depth > 0 ? 5 : 1;
    const back = depth < -.25 && s.n !== Orb.hover; if (back !== s.back) { s.back = back; s.n.classList.toggle("back", back); }
    // phones: only the front-most projects show their name (the rest are dots), so labels never pile up or clip
    const lbl = W >= 500 || depth > .9 || s.n === Orb.hover; if (lbl !== s.lbl) { s.lbl = lbl; s.n.classList.toggle("nolbl", !lbl); s.w = s.n.offsetWidth; s.h = s.n.offsetHeight; }
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
    `<span class="nv-vital" data-codex-status title="Local Codex CLI sign-in status"><i class="${st.codexStatus==='online'?'':st.codexStatus==='needs-login'||st.codexStatus==='unavailable'?'red':'amber'}"></i>Codex <b>${esc(({online:'online','needs-login':'sign-in needed',unavailable:'unavailable',unknown:'status unavailable',checking:'checking'})[st.codexStatus]||(st.codexBin?'checking':'unavailable'))}</b></span>`,
    `<span class="nv-vital">Runs <b>${st.today}/${st.maxRunsPerDay}</b></span>`,
    st.queued ? `<span class="nv-vital"><i class="amber"></i>Queue <b>${st.queued}</b></span>` : "",
    paused ? `<span class="nv-vital"><i class="amber"></i>Paused <b>${esc(fmtWhen(st.pausedUntil))}</b></span>` : "",
    `<span class="nv-vital">Focus <b>${esc(ap ? projName(ap) : "All")}</b></span>`].join("");

  hudFan({ runs: [st.today, st.maxRunsPerDay], queue: [st.queued, 5], inbox: [S.inbox.length, 10], outbox: [drafts.length, 5] });
  // timeline: calendar events + reminders, today and tomorrow, with a NOW marker
  const evs = (S.calendar?.upcoming || []).map(e => ({ t: e.title, s: e.allDay ? toDate(e.start + "T00:00") : new Date(e.start), en: e.allDay ? toDate(e.end + "T00:00") : new Date(e.end), all: e.allDay, loc: e.location, k: "ev" }));
  const rem = open.map(r => ({ id: r.id, t: r.title, s: toDate(r.due), en: toDate(r.due), all: String(r.due).length <= 10, k: "rem", p: r.project }));
  const items = [...evs, ...rem].filter(x => x.en >= new Date(ymd(now) + "T00:00") && x.s <= tmrEnd).sort((a, b) => a.s - b.s);
  const over = rem.filter(r => r.s < now);
  let tl = "", nowShown = false, tmrShown = false;
  for (const x of items) {
    if (x.k === "rem" && x.s < now) continue; // overdue goes to Needs you
    if (!tmrShown && x.s > todayEnd) { tmrShown = true; tl += `<div class="nv-now" style="color:var(--text3)">TOMORROW</div>`; }
    if (!nowShown && x.s > now && x.s <= todayEnd) { nowShown = true; tl += `<div class="nv-now">NOW ${pad(now.getHours())}:${pad(now.getMinutes())}</div>`; }
    const live = x.k === "ev" && !x.all && x.s <= now && x.en > now;
    tl += `<a class="nv-row ${live ? "t-live" : x.k === "ev" ? "t-ev" : "t-rem"}" data-upopen="${esc(JSON.stringify(x.k === "rem" ? { kind: "reminder", id: x.id } : { kind: "agenda" }))}" href="${x.p ? "#project/" + x.p : "#calendar"}"><span class="tm">${x.all ? "all day" : `${pad(x.s.getHours())}:${pad(x.s.getMinutes())}`}</span><div style="min-width:0"><div class="t">${esc(x.t)}</div><small>${live ? "HAPPENING NOW" : x.k === "ev" ? "CALENDAR" : "REMINDER"}${x.loc ? " · " + esc(x.loc).slice(0, 40) : ""}${x.p ? " · " + esc(projName(x.p)) : ""}</small></div></a>`;
  }
  const feedOn = (S.calendar?.feeds || []).length > 0;
  L.innerHTML = `<div class="card nv-panel"><div class="ttl">Today <b>${items.filter(x => !(x.k === "rem" && x.s < now)).length || "clear"}</b></div>${tl || `<div class="nv-empty">Nothing scheduled.${feedOn ? "" : ` <a href="#settings">Connect your calendar</a>`}</div>`}</div>
    ${st.running || st.queued || S.missions.some(m => m.enabled) ? `<div class="card nv-panel"><div class="ttl">Missions <b>${st.queued} queued</b></div>
      ${st.running ? `<a class="nv-row" href="#missions"><span class="led"></span><div><div class="t">${esc(st.running.title)}</div><small>RUNNING · ${esc(ago(st.running.startedAt))}</small></div></a>` : ""}
      ${S.missions.filter(m => m.enabled).slice(0, 4).map(m => `<a class="nv-row" href="#missions"><span class="led off"></span><div><div class="t">${esc(m.title)}</div><small>${esc(m.scheduleText)} · ${esc(cap(tierModel(m.tier)))}</small></div></a>`).join("")}</div>` : ""}`;

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
  const groups = [["red", "Urgent"], ["amber", "Waiting on you"], ["", "Coming up"]].map(([k, label]) => [k, label, A.filter(a => a[0] === k)]).filter(g => g[2].length);
  const rowA = a => `<a class="nv-row sev-${a[0] || "blue"}" href="${a[3]}"><span class="led ${a[0]}"></span><div style="min-width:0"><div class="t">${esc(a[1])}</div><small>${a[2]}</small></div></a>`;
  R.innerHTML = `<div class="card nv-panel"><div class="ttl">Needs you <b>${A.length || "clear"}</b></div>${groups.map(([k, label, items]) => `<div class="nv-grp g-${k || "blue"}">${label}<b>${items.length}</b></div>${items.slice(0, matchMedia("(max-width: 760px)").matches ? 2 : 5).map(rowA).join("")}${matchMedia("(max-width: 760px)").matches && items.length > 2 ? `<div class="nv-more">+${items.length - 2} more</div>` : ""}`).join("") || `<div class="nv-row sev-green"><span class="led green"></span><div><div class="t">All clear</div><small>NOTHING WAITING ON YOU</small></div></div>`}</div>
    <div class="card nv-panel nv-quick"><div class="ttl">Quick actions</div><div class="row" style="flex-wrap:wrap;gap:8px">
      <a class="btn sm" href="#code">Code</a><button class="btn sm" type="button" data-nv="email">Email</button><button class="btn sm" type="button" data-nv="event">＋ Event</button><a class="btn sm" href="#planner">⬡ Planner</a><button class="btn sm" type="button" data-nv="pal">⌕ Search</button></div></div>`;
  R.querySelector('[data-nv="email"]').onclick = () => outboxCompose("email");
  R.querySelector('[data-nv="event"]').onclick = () => outboxCompose("calendar");
  R.querySelector('[data-nv="pal"]').onclick = () => palOpen();
  if (quiet) orbitBuild(false);
  gapCalendarPaint();
}

// ---------------- start ----------------
// ---------------- hideable sidebar: hidden by default on desktop, a top-left button opens it as a drawer ----------------
function sideSet(open) {
  document.body.classList.toggle("side-open", open);
  document.getElementById("sideBtn")?.setAttribute("aria-expanded", String(open));
  if (open) { Snd.blip(880, .04, "sine", .02); setTimeout(navGlide, 50); }
}
function sideInit() {
  const pinned = hstore.get("hq-side", "hide") === "pin";
  document.body.classList.toggle("side-hide", !pinned);
  const scrim = document.createElement("div"); scrim.className = "side-scrim"; scrim.onclick = () => sideSet(false); (document.querySelector(".app") || document.body).prepend(scrim); // same stacking context as the drawer
  const btn = document.getElementById("sideBtn");
  if (btn) btn.onclick = () => { if (!document.body.classList.contains("side-hide")) { hstore.set("hq-side", "hide"); document.body.classList.add("side-hide"); sideSet(false); return; } sideSet(!document.body.classList.contains("side-open")); };
  document.getElementById("nav")?.addEventListener("click", e => { if (e.target.closest("a") && document.body.classList.contains("side-hide")) sideSet(false); });
  document.addEventListener("keydown", e => {
    if (e.key === "Escape" && document.body.classList.contains("side-open")) sideSet(false);
    if ((e.key === "m" || e.key === "M") && !e.ctrlKey && !e.altKey && !e.metaKey && !/INPUT|TEXTAREA|SELECT/.test(document.activeElement?.tagName || "")) { e.preventDefault(); btn?.click(); }
  });
}
function sidePin(pin) { hstore.set("hq-side", pin ? "pin" : "hide"); document.body.classList.toggle("side-hide", !pin); sideSet(false); setTimeout(navGlide, 400); }

(function novaStart() {
  sideInit();
  const sw = document.createElement("div"); sw.id = "nova-sweep"; sw.setAttribute("aria-hidden", "true"); document.body.appendChild(sw);
  // build the WebGL background after the opening scan (its shader compile would make the scan stutter)
  const sceneWhenFree = () => window.hqBooting ? setTimeout(sceneWhenFree, 250) : sceneStart();
  window.addEventListener("DOMContentLoaded", () => setTimeout(sceneWhenFree, 120));
  cursorStart();
  document.addEventListener("visibilitychange", () => { if (!document.hidden) { sceneKick(); if (Core.ok && !Core.raf) Core.raf = requestAnimationFrame(coreLoop); } });
  RM.addEventListener?.("change", () => sceneKick());
  // wake from power-down: restart loops
  new MutationObserver(() => { if (!HUD.asleep) { sceneKick(); if (Core.ok && !Core.raf) Core.raf = requestAnimationFrame(coreLoop); } }).observe(document.body, { attributes: true, attributeFilter: ["class"] });
})();



