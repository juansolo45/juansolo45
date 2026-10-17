/* SOURCE OF TRUTH: <repo>/webpages/plot_assets/plot3d.js -- the copy beside the `ss` binary is
   written at build time (ss/CMakeLists.txt) and is overwritten on every build.

   plot3d.html: the F_p-synthetic Adams-Novikov E_2-page in three dimensions.

       x = n   stem
       y = s   F_p-Adams filtration  (Adams-Novikov filtration + algebraic Novikov weight)
       z = -f  Adams-Novikov filtration, f = 0 nearest the viewer so that the front view is the
               2D synE2 chart (n to the right, s up)

   Data file <diagram>/<name>syn3d.js (algnov5/stage2/synthetic.py, write_chart3d):
       pos  [n,s,f, ...]   one lattice point per element of the a_0-towers
       w    weight per element; tex: LaTeX name; mod: index into mods, the module of its bidegree
       a0   [i,j, ...]     red  lines, a_0 x = y      (s rises by one)
       lam  [i,j, ...]     blue lines, lambda x = y   (s drops by one; y may stand for p y)
       lam_arrows [i, ...] blue arrow in -s at a lambda-free element that is not a_0-divisible:
                           its lambda-tower, not drawn out
       a0_arrows  [i, ...] red arrow in +s: the a_0-tower runs off the computed weight range
   Elements sharing a lattice point are spread on a small circle in the n-f plane.

   URL: ?diagram=algnov&data=S0syn3d[&stem_min=..&stem_max=..][&focus=n,s[,f]][&theme=dark|light]
   Keys: arrows pan, shift+up/down move into/out of the page, a / n the Adams / Adams-Novikov
   perspective, r reset, 1/2/3 toggle a_0 lines / lambda lines / arrows, g grid, d theme, Esc.
   Reads theme.js's globals (current_theme, on_toggle_theme) and the css tokens of main.css.

   This is a classic script, not an ES module: the charts are routinely opened over file://, where
   Chrome refuses to load a local module script.  plot3d.html imports three.js and its addons from
   the CDN in a small inline module (allowed on file://) and hands them to plot3d_main. */
"use strict";

globalThis.plot3d_main = function ({ THREE, OrbitControls, CSS2DRenderer, CSS2DObject }) {

const URL_PARAMS = new URLSearchParams(window.location.search);
const DIAGRAM = URL_PARAMS.get("diagram") || "algnov";
const DATA_NAME = URL_PARAMS.get("data") || "S0syn3d";

const CFG = {
    dot_radius: 0.13,
    spread_radius: 0.2,          // several elements at one lattice point
    line_offset: 0.08,           // red at x - offset, blue at x + offset: antiparallel pairs stay visible
    s_scale: 1.5,                // scene units per step of s: lattice steps in s are wider than in n, f
    arrow_len: 0.55,             // shaft; shaft + cone stay well inside one s-step, so an arrow never
    cone_radius: 0.1,            // reaches the next dot (that looked like lambda x = y)
    cone_height: 0.25,
    x_max_init: 80,              // stems shown by the initial view, as the 2D viewer (CONFIG.x_max_init)
    focus_dist: 14,
};

/* ----------------------------------------------------------------- state */
let DATA = null;
let WINDOW = { min: numParam("stem_min"), max: numParam("stem_max") };
let renderer, labelRenderer, scene, camera, controls, raycaster;
let group = null;                 // everything rebuilt per stem window
let dots = null, inst2dot = null, dotPos = null;
let linesA0, linesLam, shaftsA0, shaftsLam, conesA0, conesLam, selected, axesGroup;
let hemi;
let needRender = false;
let show = { a0: true, lam: true, arrows: true, grid: true };
let selectedDot = null;

function numParam(key) {
    const v = URL_PARAMS.get(key);
    if (v === null || v === "" || isNaN(Number(v))) return null;
    return Number(v);
}

/* ----------------------------------------------------------------- loading */
function loadScript(path, on_load, on_error) {
    const el = document.createElement("script");
    el.src = path;
    el.onload = on_load;
    el.onerror = on_error;
    document.head.appendChild(el);
}

function fail(msg) {
    document.getElementById("status").textContent = msg;
    console.error(msg);
}

function init() {
    loadScript(`${DIAGRAM}/${DATA_NAME}.js`, () => {
        DATA = globalThis["DATA_JSON_" + DATA_NAME];
        if (!DATA || DATA.type !== "syn3d") {
            fail(`${DIAGRAM}/${DATA_NAME}.js is not a syn3d chart; run algnov5/stage2/synthetic.py to write one.`);
            return;
        }
        document.getElementById("title").textContent = `${DATA.spectrum}: synthetic ANSS E2 (3D)`;
        setupScene();
        build();
        resetView();
        applySceneTheme();
        wireUI();
    }, () => fail(`cannot load ${DIAGRAM}/${DATA_NAME}.js`));
}

/* ----------------------------------------------------------------- scene */
function setupScene() {
    const canvas = document.getElementById("canvas3d");
    renderer = new THREE.WebGLRenderer({ canvas, antialias: true });
    renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
    renderer.setSize(window.innerWidth, window.innerHeight);

    labelRenderer = new CSS2DRenderer();
    labelRenderer.setSize(window.innerWidth, window.innerHeight);
    document.getElementById("labels").appendChild(labelRenderer.domElement);

    scene = new THREE.Scene();
    camera = new THREE.PerspectiveCamera(45, window.innerWidth / window.innerHeight, 0.1, 10000);
    hemi = new THREE.HemisphereLight(0xffffff, 0x888888, 1.4);
    scene.add(hemi);
    scene.add(new THREE.AmbientLight(0xffffff, 0.5));

    controls = new OrbitControls(camera, canvas);
    controls.enableDamping = false;
    controls.screenSpacePanning = true;
    controls.addEventListener("change", requestRender);

    raycaster = new THREE.Raycaster();

    window.addEventListener("resize", () => {
        camera.aspect = window.innerWidth / window.innerHeight;
        camera.updateProjectionMatrix();
        renderer.setSize(window.innerWidth, window.innerHeight);
        labelRenderer.setSize(window.innerWidth, window.innerHeight);
        requestRender();
    });
}

function requestRender() {
    if (needRender) return;
    needRender = true;
    requestAnimationFrame(() => {
        needRender = false;
        renderer.render(scene, camera);
        labelRenderer.render(scene, camera);
    });
}

function inWindow(n) {
    return (WINDOW.min === null || n >= WINDOW.min) && (WINDOW.max === null || n <= WINDOW.max);
}

/* Build every object for the current stem window from DATA. */
function build() {
    if (group !== null) {
        scene.remove(group);
        group.traverse(o => { if (o.geometry) o.geometry.dispose(); });
    }
    group = new THREE.Group();
    scene.add(group);

    const P = DATA.pos, N = DATA.w.length;
    const visible = new Int32Array(N).fill(-1);          // dot -> instance, or -1
    const list = [];
    for (let i = 0; i < N; ++i) {
        if (inWindow(P[3 * i])) { visible[i] = list.length; list.push(i); }
    }
    inst2dot = Int32Array.from(list);

    /* placement: elements of one lattice point on a circle in the x-z plane */
    const groups = new Map();
    for (const i of list) {
        const key = `${P[3 * i]},${P[3 * i + 1]},${P[3 * i + 2]}`;
        if (!groups.has(key)) groups.set(key, []);
        groups.get(key).push(i);
    }
    dotPos = new Float32Array(3 * list.length);
    for (const members of groups.values()) {
        const m = members.length;
        members.forEach((i, k) => {
            const ang = m === 1 ? 0 : 2 * Math.PI * k / m + Math.PI / 4;
            const rad = m === 1 ? 0 : CFG.spread_radius;
            const q = 3 * visible[i];
            dotPos[q] = P[3 * i] + rad * Math.cos(ang);
            dotPos[q + 1] = P[3 * i + 1] * CFG.s_scale;
            dotPos[q + 2] = -P[3 * i + 2] + rad * Math.sin(ang);
        });
    }

    /* dots */
    const sphere = new THREE.SphereGeometry(CFG.dot_radius, 12, 9);
    dots = new THREE.InstancedMesh(sphere, new THREE.MeshLambertMaterial({ color: 0x222222 }), Math.max(list.length, 1));
    const mat = new THREE.Matrix4();
    for (let k = 0; k < list.length; ++k) {
        mat.makeTranslation(dotPos[3 * k], dotPos[3 * k + 1], dotPos[3 * k + 2]);
        dots.setMatrixAt(k, mat);
    }
    dots.count = list.length;
    dots.instanceMatrix.needsUpdate = true;
    dots.frustumCulled = false;
    group.add(dots);

    /* lines */
    const segs = (pairs, dx) => {
        const out = [];
        for (let k = 0; k + 1 < pairs.length; k += 2) {
            const a = visible[pairs[k]], b = visible[pairs[k + 1]];
            if (a < 0 || b < 0) continue;
            out.push(dotPos[3 * a] + dx, dotPos[3 * a + 1], dotPos[3 * a + 2],
                     dotPos[3 * b] + dx, dotPos[3 * b + 1], dotPos[3 * b + 2]);
        }
        return out;
    };
    const lineObj = (coords, color) => {
        const g = new THREE.BufferGeometry();
        g.setAttribute("position", new THREE.Float32BufferAttribute(coords, 3));
        const l = new THREE.LineSegments(g, new THREE.LineBasicMaterial({ color }));
        l.frustumCulled = false;
        return l;
    };
    const a0c = segs(DATA.a0, -CFG.line_offset), lamc = segs(DATA.lam, CFG.line_offset);
    linesA0 = lineObj(a0c, 0xd40000); linesLam = lineObj(lamc, 0x1f5fbf);
    group.add(linesA0, linesLam);

    /* arrows: a shaft plus an instanced cone, lambda down, a_0 up */
    const arrows = (ids, dir, color) => {
        const shaft = [], centres = [];
        for (const i of ids) {
            const a = visible[i];
            if (a < 0) continue;
            const x = dotPos[3 * a], y = dotPos[3 * a + 1], z = dotPos[3 * a + 2];
            shaft.push(x, y + dir * CFG.dot_radius, z, x, y + dir * CFG.arrow_len, z);
            centres.push(x, y + dir * (CFG.arrow_len + CFG.cone_height / 2), z);
        }
        const sh = lineObj(shaft, color);
        const cone = new THREE.ConeGeometry(CFG.cone_radius, CFG.cone_height, 10);
        const cones = new THREE.InstancedMesh(cone, new THREE.MeshBasicMaterial({ color }), Math.max(centres.length / 3, 1));
        const m = new THREE.Matrix4(), rot = new THREE.Matrix4().makeRotationX(dir < 0 ? Math.PI : 0);
        for (let k = 0; k < centres.length / 3; ++k) {
            m.makeTranslation(centres[3 * k], centres[3 * k + 1], centres[3 * k + 2]).multiply(rot);
            cones.setMatrixAt(k, m);
        }
        cones.count = centres.length / 3;
        cones.instanceMatrix.needsUpdate = true;
        cones.frustumCulled = false;
        return [sh, cones];
    };
    [shaftsLam, conesLam] = arrows(DATA.lam_arrows, -1, 0x1f5fbf);
    [shaftsA0, conesA0] = arrows(DATA.a0_arrows, +1, 0xd40000);
    group.add(shaftsLam, conesLam, shaftsA0, conesA0);

    /* the selection marker */
    selected = new THREE.Mesh(new THREE.SphereGeometry(CFG.dot_radius * 1.8, 16, 12),
                              new THREE.MeshBasicMaterial({ color: 0xd40000, transparent: true, opacity: 0.45 }));
    selected.visible = false;
    group.add(selected);

    buildAxes();
    applyVisibility();

    document.getElementById("status").textContent =
        `${list.length} elements, ${a0c.length / 6} a₀ lines, ${lamc.length / 6} λ lines` +
        (DATA.exact === false ? " [FALLBACK data]" : "");
}

/* axes with ticks and labels, and a grid in the n-f plane just below s = 0 */
function buildAxes() {
    axesGroup = new THREE.Group();
    const nmin = WINDOW.min ?? 0, nmax = WINDOW.max ?? DATA.n_max;
    const smax = DATA.s_max, fmax = DATA.f_max;
    const axis = [], ticks = [], grid = [];
    const SY = CFG.s_scale, y0 = -0.5 * SY;
    axis.push(nmin, 0, 0, nmax + 2, 0, 0,  nmin, 0, 0, nmin, (smax + 2) * SY, 0,  nmin, 0, 0, nmin, 0, -(fmax + 2));
    const label = (text, x, y, z, cls) => {
        const div = document.createElement("div");
        div.className = cls;
        div.textContent = text;
        const o = new CSS2DObject(div);
        o.position.set(x, y, z);
        axesGroup.add(o);
    };
    const nstep = (nmax - nmin) > 200 ? 50 : (nmax - nmin) > 60 ? 10 : 5;
    for (let n = Math.ceil(nmin / nstep) * nstep; n <= nmax; n += nstep) {
        ticks.push(n, 0, 0, n, -0.6, 0);
        label(String(n), n, -1.4, 0, "tick");
        grid.push(n, y0, 0, n, y0, -fmax);
    }
    const sstep = smax > 60 ? 10 : 5;
    for (let s = sstep; s <= smax; s += sstep) {
        ticks.push(nmin, s * SY, 0, nmin - 0.6, s * SY, 0);
        label(String(s), nmin - 1.6, s * SY, 0, "tick");
    }
    const fstep = fmax > 20 ? 5 : 2;
    for (let f = fstep; f <= fmax; f += fstep) {
        ticks.push(nmin, 0, -f, nmin - 0.6, 0, -f);
        label(String(f), nmin - 1.6, -0.3, -f, "tick");
    }
    for (let f = 0; f <= fmax; f += fstep) grid.push(nmin, y0, -f, nmax, y0, -f);
    label("n", nmax + 3.5, 0, 0, "axname");
    label("s", nmin, (smax + 3.5) * SY, 0, "axname");
    label("f", nmin, 0, -(fmax + 3.5), "axname");
    const mk = (coords, color, opacity) => {
        const g = new THREE.BufferGeometry();
        g.setAttribute("position", new THREE.Float32BufferAttribute(coords, 3));
        const l = new THREE.LineSegments(g, new THREE.LineBasicMaterial({ color, transparent: opacity < 1, opacity }));
        l.frustumCulled = false;
        return l;
    };
    axesGroup.userData.axes = mk(axis, 0x000000, 1);
    axesGroup.userData.ticks = mk(ticks, 0x000000, 1);
    axesGroup.userData.grid = mk(grid, 0xc6c6c6, 0.6);
    axesGroup.add(axesGroup.userData.axes, axesGroup.userData.ticks, axesGroup.userData.grid);
    group.add(axesGroup);
}

function applyVisibility() {
    linesA0.visible = show.a0;
    linesLam.visible = show.lam;
    for (const o of [shaftsA0, conesA0, shaftsLam, conesLam]) o.visible = show.arrows;
    axesGroup.visible = show.grid;
    for (const [id, on] of [["button_a0", show.a0], ["button_lam", show.lam], ["button_arrows", show.arrows], ["button_grid", show.grid]]) {
        document.getElementById(id).classList.toggle("on", on);
    }
    requestRender();
}

/* ----------------------------------------------------------------- camera */
function resetView() {
    const focus = URL_PARAMS.get("focus");
    if (focus) {
        const [n, s, f] = focus.split(",").map(Number);
        lookAt(new THREE.Vector3(n, (s || 0) * CFG.s_scale, -(f || 0)), CFG.focus_dist);
        return;
    }
    const nmin = WINDOW.min ?? 0;
    const nmax = Math.min(WINDOW.max ?? (nmin + CFG.x_max_init), DATA.n_max);
    /* the s-extent of the dots in that stem range, ignoring stem 0 (the unit's a_0-tower is as tall
     * as Wmax and would squeeze everything else into a strip at the bottom) */
    let smax = 1;
    const P = DATA.pos;
    for (let i = 0; i < DATA.w.length; ++i) {
        if (P[3 * i] >= Math.max(nmin, 1) && P[3 * i] <= nmax && P[3 * i + 1] > smax) smax = P[3 * i + 1];
    }
    const w = nmax - nmin + 4, h = (smax + 4) * CFG.s_scale;
    const target = new THREE.Vector3((nmin + nmax) / 2, h / 2 - 2 * CFG.s_scale, -DATA.f_max / 2);
    const fov = camera.fov * Math.PI / 180;
    const dist = Math.max(h / (2 * Math.tan(fov / 2)), w / (2 * Math.tan(fov / 2) * camera.aspect)) * 1.15;
    lookAt(target, dist);
}

function lookAt(target, dist) {
    const dir = new THREE.Vector3(0.25, 0.35, 1.1).normalize();
    camera.up.set(0, 1, 0);
    camera.position.copy(target).addScaledVector(dir, dist);
    controls.target.copy(target);
    controls.update();
    requestRender();
}

/* keyboard navigation: pan in the screen plane (arrow keys), move into / out of the page
 * (shift + up / down); both carry the orbit target along, so the pivot stays where you look */
function pan(dx, dy) {
    const step = camera.position.distanceTo(controls.target) * 0.08;
    const right = new THREE.Vector3(), up = new THREE.Vector3(), back = new THREE.Vector3();
    camera.matrixWorld.extractBasis(right, up, back);
    const d = right.multiplyScalar(dx * step).add(up.multiplyScalar(dy * step));
    camera.position.add(d);
    controls.target.add(d);
    controls.update();
    requestRender();
}

function dolly(sign) {
    const dir = new THREE.Vector3().subVectors(controls.target, camera.position);
    const step = dir.length() * 0.1 * sign;
    dir.normalize().multiplyScalar(step);
    camera.position.add(dir);
    controls.target.add(dir);
    controls.update();
    requestRender();
}

/* the two flat perspectives, keeping the current target and distance:
 *   Adams:         from the front, n to the right, s up       (the 2D synE2 chart, weight unfolded)
 *   Adams-Novikov: from above,     n to the right, f up       (the Ext chart with the weight hidden) */
function viewAdams() {
    const t = controls.target.clone(), dist = camera.position.distanceTo(t);
    camera.up.set(0, 1, 0);
    camera.position.set(t.x, t.y, t.z + dist);
    controls.update();
    requestRender();
}

function viewAdamsNovikov() {
    const t = controls.target.clone(), dist = camera.position.distanceTo(t);
    camera.up.set(0, 0, -1);
    camera.position.set(t.x, t.y + dist, t.z);
    controls.update();
    requestRender();
}

/* ----------------------------------------------------------------- theme */
function cssVar(name) {
    return getComputedStyle(document.documentElement).getPropertyValue(name).trim();
}

function applySceneTheme() {
    if (!renderer) return;
    const dark = typeof current_theme === "function" && current_theme() === "dark";
    renderer.setClearColor(new THREE.Color(cssVar("--page-bg") || (dark ? "#000" : "#fff")));
    dots.material.color.set(dark ? 0xe8e8e8 : 0x222222);
    const a0 = new THREE.Color(cssVar("--line-a0") || "#d40000"), lam = new THREE.Color(cssVar("--line-lam") || "#1f5fbf");
    linesA0.material.color.copy(a0); shaftsA0.material.color.copy(a0); conesA0.material.color.copy(a0);
    linesLam.material.color.copy(lam); shaftsLam.material.color.copy(lam); conesLam.material.color.copy(lam);
    const fg = new THREE.Color(cssVar("--plot-fg") || (dark ? "#fff" : "#000"));
    axesGroup.userData.axes.material.color.copy(fg);
    axesGroup.userData.ticks.material.color.copy(fg);
    axesGroup.userData.grid.material.color.set(cssVar("--panel-border") || "#c6c6c6");
    selected.material.color.set(cssVar("--sel-ring") || "#d40000");
    requestRender();
}

document.addEventListener("ss-theme", applySceneTheme);

/* ----------------------------------------------------------------- picking and the info panel */
function pick(event) {
    const ndc = new THREE.Vector2((event.clientX / window.innerWidth) * 2 - 1, -(event.clientY / window.innerHeight) * 2 + 1);
    raycaster.setFromCamera(ndc, camera);
    const hit = raycaster.intersectObject(dots, false)[0];
    if (!hit || hit.instanceId === undefined) { hideInfo(); return; }
    showInfo(inst2dot[hit.instanceId], hit.instanceId, event);
}

function kx(tex, display) {
    if (typeof katex === "undefined") return tex;
    return katex.renderToString(tex, { throwOnError: false, displayMode: !!display });
}

function showInfo(dot, inst, event) {
    selectedDot = dot;
    selected.position.set(dotPos[3 * inst], dotPos[3 * inst + 1], dotPos[3 * inst + 2]);
    selected.visible = true;
    const P = DATA.pos, n = P[3 * dot], s = P[3 * dot + 1], f = P[3 * dot + 2];
    document.getElementById("p_latex").innerHTML = `LaTeX: ${kx(DATA.tex[dot])}`;
    document.getElementById("p_deg").innerHTML = `(n, s, f) = (${n}, ${s}, ${f}) &nbsp; weight ${DATA.w[dot]}` +
        (DATA.a0_arrows.includes(dot) ? " &nbsp;(a<sub>0</sub>-tower continues beyond W<sub>max</sub>)" : "") +
        (DATA.lam_arrows.includes(dot) ? " &nbsp;(&lambda;-free)" : "");
    document.getElementById("p_mod").innerHTML = `Module at (${n}, ${f}): ${kx(DATA.mods[DATA.mod[dot]])}`;
    const div = document.getElementById("div_binfo");
    div.style.visibility = "visible";
    div.style.left = `${event.clientX + 12}px`;
    div.style.top = `${event.clientY + 12}px`;
    /* keep it on screen */
    const rect = div.getBoundingClientRect();
    if (rect.right > window.innerWidth - 8) div.style.left = `${Math.max(8, window.innerWidth - rect.width - 8)}px`;
    if (rect.bottom > window.innerHeight - 8) div.style.top = `${Math.max(8, window.innerHeight - rect.height - 8)}px`;
    requestRender();
}

function hideInfo() {
    selectedDot = null;
    document.getElementById("div_binfo").style.visibility = "hidden";
    if (selected) { selected.visible = false; requestRender(); }
}

/* ----------------------------------------------------------------- UI */
function wireUI() {
    const canvas = document.getElementById("canvas3d");
    let down = null;
    canvas.addEventListener("pointerdown", e => { down = [e.clientX, e.clientY]; });
    canvas.addEventListener("pointerup", e => {
        if (down && Math.hypot(e.clientX - down[0], e.clientY - down[1]) < 4 && e.button === 0) pick(e);
        down = null;
    });

    const toggle = key => { show[key] = !show[key]; applyVisibility(); };
    document.getElementById("button_reset").onclick = () => resetView();
    document.getElementById("button_adams").onclick = () => viewAdams();
    document.getElementById("button_an").onclick = () => viewAdamsNovikov();
    document.getElementById("button_a0").onclick = () => toggle("a0");
    document.getElementById("button_lam").onclick = () => toggle("lam");
    document.getElementById("button_arrows").onclick = () => toggle("arrows");
    document.getElementById("button_grid").onclick = () => toggle("grid");
    document.getElementById("button_2d").onclick = () => {
        const q = new URLSearchParams({ diagram: DIAGRAM, data: DATA_NAME.replace(/syn3d$/, "synE2") });
        if (WINDOW.min !== null) q.set("stem_min", WINDOW.min);
        if (WINDOW.max !== null) q.set("stem_max", WINDOW.max);
        window.location.href = `plot.html?${q}`;
    };

    const smin = document.getElementById("stem_min"), smax = document.getElementById("stem_max");
    if (WINDOW.min !== null) smin.value = WINDOW.min;
    if (WINDOW.max !== null) smax.value = WINDOW.max;
    const applyWindow = () => {
        const a = smin.value === "" ? null : Number(smin.value), b = smax.value === "" ? null : Number(smax.value);
        if (a === WINDOW.min && b === WINDOW.max) return;
        WINDOW = { min: a, max: b };
        const q = new URLSearchParams(window.location.search);
        a === null ? q.delete("stem_min") : q.set("stem_min", a);
        b === null ? q.delete("stem_max") : q.set("stem_max", b);
        q.delete("focus");
        history.replaceState(null, "", `${window.location.pathname}?${q}`);
        URL_PARAMS.delete("focus");
        hideInfo();
        build();
        applySceneTheme();
        resetView();
    };
    for (const el of [smin, smax]) {
        el.addEventListener("change", applyWindow);
        el.addEventListener("keydown", e => { if (e.key === "Enter") { el.blur(); } });
    }

    document.addEventListener("keydown", e => {
        if (e.target.tagName === "INPUT") return;
        switch (e.key) {
            case "ArrowLeft": pan(-1, 0); e.preventDefault(); break;
            case "ArrowRight": pan(1, 0); e.preventDefault(); break;
            case "ArrowUp": if (e.shiftKey) dolly(1); else pan(0, 1); e.preventDefault(); break;
            case "ArrowDown": if (e.shiftKey) dolly(-1); else pan(0, -1); e.preventDefault(); break;
            case "a": viewAdams(); break;
            case "n": viewAdamsNovikov(); break;
            case "r": resetView(); break;
            case "1": toggle("a0"); break;
            case "2": toggle("lam"); break;
            case "3": toggle("arrows"); break;
            case "g": toggle("grid"); break;
            case "d": if (typeof on_toggle_theme === "function") on_toggle_theme(); break;
            case "Escape": hideInfo(); break;
        }
    });
}

init();

};  // plot3d_main
