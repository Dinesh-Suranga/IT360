/* =====================================================================
   IT 360 — cinematic scroll experience
   Hero: night-side globe that spins in, then draws lines out to cities
   ===================================================================== */
const $ = id => document.getElementById(id);
const clamp = (x, a = 0, b = 1) => Math.min(b, Math.max(a, x));
const sstep = (a, b, x) => { const t = clamp((x - a) / (b - a)); return t * t * (3 - 2 * t); };
const lerp = (a, b, t) => a + (b - a) * t;

const reduce = matchMedia('(prefers-reduced-motion: reduce)').matches;
const canvas = $('bg');
const heroEl = $('hero');
const heroCopy = $('heroCopy'), heroCta = $('heroCta'), cue = $('cue');
const gB = $('gB');

// logo satellite: SMIL ignores prefers-reduced-motion, so stop it manually
if (reduce) document.querySelectorAll('.logo animateMotion').forEach(a => a.remove());

/* ---------- smooth scrolling (Lenis) ---------- */
let lenis = null;
try {
  if (typeof Lenis !== 'undefined' && !reduce) {
    lenis = new Lenis({ lerp: 0.09, wheelMultiplier: 0.9 });
    (function raf(t) { lenis.raf(t); requestAnimationFrame(raf); })(performance.now());
  }
} catch (e) { lenis = null; }

document.querySelectorAll('a[href^="#"]').forEach(a => a.addEventListener('click', e => {
  const id = a.getAttribute('href');
  const target = id === '#top' ? 0 : document.querySelector(id);
  if (target === null) return;
  e.preventDefault();
  if (lenis) lenis.scrollTo(target, { duration: 1.6 });
  else (target === 0 ? scrollTo({ top: 0, behavior: 'smooth' }) : target.scrollIntoView({ behavior: 'smooth' }));
}));

/* ---------- section metrics ---------- */
let M = { hTop: 0, hH: 1 };
const measure = () => {
  const h = heroEl.getBoundingClientRect();
  M = { hTop: h.top + scrollY, hH: h.height };
};
const prog = (top, h) => clamp((scrollY - top) / Math.max(1, h - innerHeight));

/* =====================================================================
   THREE.JS
   ===================================================================== */
try {
  if (typeof THREE === 'undefined') throw new Error('Three.js failed to load');

  const renderer = new THREE.WebGLRenderer({ canvas, antialias: true, alpha: true });
  renderer.setPixelRatio(Math.min(devicePixelRatio, 1.75));
  renderer.outputEncoding = THREE.sRGBEncoding;
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.toneMappingExposure = 1.05;

  const scene = new THREE.Scene();
  const camera = new THREE.PerspectiveCamera(35, 1, 0.1, 100);

  /* ----- studio reflections (generated, no external HDRI) ----- */
  const pm = new THREE.PMREMGenerator(renderer);
  const envScene = new THREE.Scene();
  envScene.background = new THREE.Color(0x01040d);
  const panel = (w, h, pos, col, k) => {
    const m = new THREE.Mesh(new THREE.PlaneGeometry(w, h), new THREE.MeshBasicMaterial({ color: new THREE.Color(col).multiplyScalar(k), side: THREE.DoubleSide }));
    m.position.set(...pos); m.lookAt(0, 0, 0); envScene.add(m);
  };
  panel(18, 3, [0, 9, 3], 0xffffff, 7);
  panel(3, 14, [-10, 1, 4], 0x5b95ff, 5);
  panel(3, 14, [10, 1, -2], 0x2b6bff, 4);
  panel(14, 2, [0, -6, 6], 0xaac8ff, 1.5);
  panel(10, 10, [0, 2, -10], 0x0b2a7a, 1);
  scene.environment = pm.fromScene(envScene, 0.03).texture;

  /* ----- lights ----- */
  scene.add(new THREE.AmbientLight(0x6f8fd8, 0.18));
  const key = new THREE.DirectionalLight(0xffffff, 0.75); key.position.set(-3, 6, 7); scene.add(key);
  const rim = new THREE.PointLight(0x3b7bff, 60, 30); rim.position.set(0, 3, -5); scene.add(rim);

  const easeOut = k => 1 - Math.pow(1 - k, 3);

  /* =================== globe =================== */
  const R = 2.2;
  const ll = (lat, lon, r = R) => {
    const B = lat * Math.PI / 180, L = lon * Math.PI / 180;
    return new THREE.Vector3(Math.cos(B) * Math.cos(L) * r, Math.sin(B) * r, -Math.cos(B) * Math.sin(L) * r);
  };
  const BNE = { lat: -27.47, lon: 153.03 };

  const blank = new THREE.DataTexture(new Uint8Array([0, 0, 0, 255]), 1, 1); blank.needsUpdate = true;
  const gu = { uLights: { value: blank }, uSpec: { value: blank }, uTime: { value: 0 } };
  const loader = new THREE.TextureLoader(); loader.setCrossOrigin('anonymous');
  const base = 'https://cdn.jsdelivr.net/gh/mrdoob/three.js@r150/examples/textures/planets/';
  loader.load(base + 'earth_lights_2048.png', t => { t.anisotropy = 8; gu.uLights.value = t; });
  loader.load(base + 'earth_specular_2048.jpg', t => { gu.uSpec.value = t; });

  const globeG = new THREE.Group(); scene.add(globeG);
  const earth = new THREE.Mesh(new THREE.SphereGeometry(R, 96, 96), new THREE.ShaderMaterial({
    uniforms: gu,
    vertexShader: `varying vec2 vUv; varying vec3 vN; varying vec3 vV;
      void main(){ vUv = uv; vec4 mv = modelViewMatrix * vec4(position,1.); vN = normalize(normalMatrix*normal); vV = -mv.xyz; gl_Position = projectionMatrix*mv; }`,
    fragmentShader: `uniform sampler2D uLights, uSpec; varying vec2 vUv; varying vec3 vN; varying vec3 vV;
      void main(){
        float l = dot(texture2D(uLights, vUv).rgb, vec3(.3,.5,.2));
        float land = 1. - texture2D(uSpec, vUv).r;
        float f = pow(1. - max(dot(normalize(vN), normalize(vV)), 0.), 2.4);
        vec3 col = mix(vec3(.008,.025,.09), vec3(.02,.08,.26), f);
        col += vec3(.02,.07,.2) * land;
        col += vec3(.42,.68,1.) * smoothstep(.02,.65,l) * 2.1;
        col += vec3(.10,.38,1.) * f * .9;
        gl_FragColor = vec4(col, 1.);
      }`
  }));
  globeG.add(earth);

  const atmo = new THREE.Mesh(new THREE.SphereGeometry(R * 1.1, 64, 64), new THREE.ShaderMaterial({
    side: THREE.BackSide, transparent: true, blending: THREE.AdditiveBlending, depthWrite: false,
    vertexShader: `varying vec3 vNm; void main(){ vNm = normalize(normalMatrix*normal); gl_Position = projectionMatrix*modelViewMatrix*vec4(position,1.); }`,
    fragmentShader: `varying vec3 vNm; void main(){ float i = pow(clamp(1. + dot(vNm, vec3(0.,0.,1.)), 0., 1.), 7.); gl_FragColor = vec4(.16,.46,1., 1.) * i * .55; }`
  }));
  scene.add(atmo);

  // hub pin + pulse ring
  const bne = ll(BNE.lat, BNE.lon, R * 1.003);
  const pin = new THREE.Mesh(new THREE.SphereGeometry(0.04, 16, 16), new THREE.MeshBasicMaterial({ color: 0xffffff }));
  pin.position.copy(bne); globeG.add(pin);
  const pulse = new THREE.Mesh(new THREE.RingGeometry(0.06, 0.075, 48), new THREE.MeshBasicMaterial({ color: 0x7fb0ff, transparent: true, side: THREE.DoubleSide, depthWrite: false }));
  pulse.position.copy(bne); pulse.lookAt(bne.clone().multiplyScalar(2)); globeG.add(pulse);

  // arcs from the hub to cities: great-circle paths lifted above the surface so they never dip inside the globe.
  // Only cities on the hemisphere facing the camera are used, so every line ends on a visible dot.
  const cities = [
    [-33.87, 151.21], [-37.81, 144.96], [-34.93, 138.6], [-31.95, 115.86], [-12.46, 130.84],   // Sydney, Melbourne, Adelaide, Perth, Darwin
    [-36.85, 174.76], [-18.14, 178.44], [-9.44, 147.18], [-6.21, 106.85],                        // Auckland, Suva, Port Moresby, Jakarta
    [1.35, 103.8], [14.6, 121.0], [22.3, 114.2], [35.7, 139.7], [21.3, -157.9]                   // Singapore, Manila, Hong Kong, Tokyo, Honolulu
  ];
  const bneDir = bne.clone().normalize();
  const arcs = cities.map(([lat, lon]) => {
    const eDir = ll(lat, lon, 1), e = eDir.clone().multiplyScalar(R * 1.003);
    const ang = bneDir.angleTo(eDir), sn = Math.sin(ang), alt = R * Math.min(.3, .04 + ang * .14);
    const pts = [];
    for (let i = 0; i <= 90; i++) {
      const t = i / 90;
      const dir = bneDir.clone().multiplyScalar(Math.sin((1 - t) * ang) / sn).add(eDir.clone().multiplyScalar(Math.sin(t * ang) / sn));
      pts.push(dir.normalize().multiplyScalar(R * 1.003 + Math.sin(Math.PI * t) * alt));
    }
    const geo = new THREE.BufferGeometry().setFromPoints(pts);
    const line = new THREE.Line(geo, new THREE.LineBasicMaterial({ color: 0x6fa5ff, transparent: true, opacity: .85, blending: THREE.AdditiveBlending, depthWrite: false }));
    geo.setDrawRange(0, 0);
    const dot = new THREE.Mesh(new THREE.SphereGeometry(0.028, 12, 12), new THREE.MeshBasicMaterial({ color: 0xbfd8ff }));
    dot.position.copy(e); dot.visible = false;
    globeG.add(line, dot);
    return { geo, dot, n: pts.length };
  });

  // stars
  const S = 900, sp = new Float32Array(S * 3);
  for (let k = 0; k < S; k++) {
    const r = 14 + Math.random() * 30, a = Math.random() * 6.2832, b = Math.acos(2 * Math.random() - 1);
    sp.set([r * Math.sin(b) * Math.cos(a), r * Math.sin(b) * Math.sin(a), r * Math.cos(b) - 8], k * 3);
  }
  const sg = new THREE.BufferGeometry(); sg.setAttribute('position', new THREE.BufferAttribute(sp, 3));
  const stars = new THREE.Points(sg, new THREE.PointsMaterial({ color: 0x9dbcff, size: 0.06, transparent: true, opacity: .35, depthWrite: false }));
  scene.add(stars);

  /* ---------- state + loop ---------- */
  const mouse = { x: 0, y: 0 }, tgt = { x: 0, y: 0 };
  addEventListener('pointermove', e => { tgt.x = e.clientX / innerWidth - .5; tgt.y = e.clientY / innerHeight - .5; });

  function resize() {
    renderer.setSize(innerWidth, innerHeight, false);
    camera.aspect = innerWidth / innerHeight; camera.updateProjectionMatrix();
    measure();
  }
  addEventListener('resize', resize); addEventListener('load', measure); resize();

  const aFace = -Math.PI / 2 - BNE.lon * Math.PI / 180;   // rotate the hub to face camera
  const bFace = BNE.lat * Math.PI / 180;
  const S_ = { hp: 0, gp: 0 };
  const v = new THREE.Vector3(), wp = new THREE.Vector3(), gw = new THREE.Vector3();
  const clock = new THREE.Clock();

  (function tick() {
    const t = reduce ? 0 : clock.getElapsedTime();
    S_.hp += (prog(M.hTop, M.hH) - S_.hp) * .12;
    const p = S_.hp;
    mouse.x += (tgt.x - mouse.x) * .05; mouse.y += (tgt.y - mouse.y) * .05;
    const narrow = innerWidth < 800;
    canvas.style.visibility = scrollY < M.hTop + M.hH + innerHeight * .2 ? 'visible' : 'hidden';

    /* --- globe: spins in on load, then lines draw out from the hub --- */
    const intro = reduce ? 1 : clamp((t - .15) / 2.2);
    const arcIntro = reduce ? 1 : clamp((t - 1.5) / 3.4);
    const gs = easeOut(intro);
    const gScale = Math.max(gs * (narrow ? .7 : .68), .0001);
    globeG.scale.setScalar(gScale); atmo.scale.setScalar(gScale);
    globeG.rotation.set(bFace * .85 + mouse.y * .15, aFace - (1 - gs) * 3.2 + p * 1.0 + mouse.x * .35 + (reduce ? 0 : Math.sin(t * .2) * .03), 0);
    globeG.position.y = atmo.position.y = narrow ? -0.6 : -0.5;
    gu.uTime.value = t;
    const pr = (t * .7) % 1; pulse.scale.setScalar(1 + pr * 2.6); pulse.material.opacity = (1 - pr) * .8 * sstep(.2, .5, arcIntro);
    arcs.forEach((a, i) => {
      const q = clamp(arcIntro * (1 + (arcs.length - 1) * .05) - i * .05);
      a.geo.setDrawRange(0, Math.floor(q * a.n)); a.dot.visible = q > .98;
    });
    stars.rotation.y = t * .01 + p * .4;

    camera.position.set(mouse.x * .5, -mouse.y * .3, narrow ? 12.5 : 9.6);
    camera.lookAt(0, 0, 0);

    renderer.render(scene, camera);

    /* --- DOM overlays --- */
    const fadeOut = 1 - sstep(.05, .28, p);
    heroCopy.style.opacity = fadeOut; heroCopy.style.transform = `translateY(${-(1 - fadeOut) * 60}px)`;
    heroCta.style.opacity = 1 - sstep(.03, .2, p); heroCta.style.pointerEvents = p > .12 ? 'none' : 'auto';
    cue.style.opacity = 1 - sstep(0, .08, p);
    const lineB = sstep(.38, .55, p) * (1 - sstep(.88, 1, p));
    gB.style.opacity = lineB; gB.style.transform = `translateY(${(1 - lineB) * 30}px)`;

    requestAnimationFrame(tick);
  })();
} catch (e) {
  console.warn('WebGL unavailable, showing page without 3D.', e);
  canvas.remove();
  measure();
}

/* =====================================================================
   PAGE BEHAVIOUR
   ===================================================================== */
// nav colour follows the section beneath it
const nav = $('nav');
const themed = [...document.querySelectorAll('[data-theme]')];
const navTheme = () => {
  const y = 40; let theme = 'dark';
  for (const s of themed) { const r = s.getBoundingClientRect(); if (r.top <= y && r.bottom > y) { theme = s.dataset.theme; break; } }
  nav.classList.toggle('on-light', theme === 'light');
};
addEventListener('scroll', navTheme, { passive: true }); navTheme();

// floating service words
const fw = $('fw');
const words = ['Websites', 'Web Apps', 'Mobile', 'Data', 'Dashboards', 'Automation', 'Design', 'Code', 'Analytics', 'Apps', 'Web', 'Insight', 'AI Agents', 'Microsoft 365'];
const floats = [];
for (let i = 0; i < 18; i++) {
  const s = document.createElement('span'); s.className = 'fw';
  const left = i % 2 === 0;
  s.textContent = words[i % words.length];
  const size = 30 + ((i * 37) % 60);
  s.style.fontSize = size + 'px';
  s.style.top = (2 + (i / 18) * 94) + '%';
  s.style[left ? 'left' : 'right'] = (3 + (i * 13) % 20) + '%';
  s.style.opacity = (.35 + ((i * 17) % 60) / 100).toFixed(2);
  fw.appendChild(s); floats.push({ el: s, speed: (.06 + ((i * 29) % 30) / 100) * (i % 3 === 0 ? -1 : 1) });
}
const oneEl = $('one');
const floatTick = () => {
  const r = oneEl.getBoundingClientRect();
  if (r.bottom > 0 && r.top < innerHeight) {
    const c = (r.top + r.height / 2) - innerHeight / 2;
    floats.forEach(f => { f.el.style.transform = `translateY(${c * f.speed}px)`; });
  }
  requestAnimationFrame(floatTick);
};
if (!reduce) floatTick();

// services: pinned horizontal scroller — vertical scroll drives full-screen slides sideways
const hs = $('what-we-do'), hsStick = $('hsStick'), hsTrack = $('hsTrack'), hsBar = $('hsBar'), hsCount = $('hsCount');
const hsPanels = hsTrack.children.length;
let hsMax = 0, hsCur = 0;
const hsMeasure = () => {
  hsMax = Math.max(0, hsTrack.scrollWidth - innerWidth);
  hs.style.height = (innerHeight + hsMax * 0.55) + "px";
};
hsMeasure(); addEventListener('resize', hsMeasure); addEventListener('load', hsMeasure);
if (document.fonts && document.fonts.ready) document.fonts.ready.then(hsMeasure);
const hsTick = () => {
  const r = hs.getBoundingClientRect();
  if (r.bottom > -300 && r.top < innerHeight + 300) {
    const p = clamp(-r.top / Math.max(1, hs.offsetHeight - innerHeight));
    hsCur += (p - hsCur) * (reduce ? 1 : .14);
    hsTrack.style.transform = `translate3d(${-hsCur * hsMax}px,0,0)`;
    hsBar.style.transform = `scaleX(${hsCur})`;
    const idx = Math.round(hsCur * (hsPanels - 1));               // 0 = intro, 1..8 = services, last = closing panel
    hsCount.textContent = String(clamp(idx, 1, hsPanels - 2)).padStart(2, '0') + ' / ' + String(hsPanels - 2).padStart(2, '0');
  }
  requestAnimationFrame(hsTick);
};
hsTick();

// reveal on scroll
const io = new IntersectionObserver(entries => entries.forEach(en => {
  if (en.isIntersecting) { en.target.classList.add('in'); io.unobserve(en.target); }
}), { threshold: 0.15 });
document.querySelectorAll('.rv').forEach((el, i) => {
  el.style.transitionDelay = `${(i % 4) * 90}ms`;
  io.observe(el);
});

// contact form: POSTs to the Cloudflare Worker, which emails us via SMTP2GO
$('form').addEventListener('submit', async e => {
  e.preventDefault();
  const f = e.target, note = $('note'), btn = $('send');
  if (!f.name.value.trim() || !f.email.validity.valid || !f.message.value.trim()) {
    note.textContent = 'Please fill in your name, a valid email and a message.'; return;
  }
  const token = (f.querySelector('[name="cf-turnstile-response"]') || {}).value;
  if (!token) { note.textContent = 'Please confirm you are not a robot.'; return; }

  btn.disabled = true; note.textContent = 'Sending…';
  const reset = () => { if (window.turnstile) window.turnstile.reset(); btn.disabled = false; };
  try {
    const payload = {};
    new FormData(f).forEach((v, k) => { payload[k] = v; });
    const res = await fetch(f.action, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Accept': 'application/json' },
      body: JSON.stringify(payload)
    });
    const out = await res.json().catch(() => ({}));
    if (res.ok && out.ok) {
      f.reset(); reset();
      note.textContent = 'Thank you — your message has been sent. We will be in touch soon.';
    } else {
      reset();
      note.textContent = out.error || 'Something went wrong. Please try again or email contact@itthreesixty.com.au.';
    }
  } catch (err) {
    reset();
    note.textContent = 'Something went wrong. Please try again or email contact@itthreesixty.com.au.';
  }
});

$('yr').textContent = new Date().getFullYear();
