/* products.js -- the chart viewer's Products panel: type an expression in the chart's generators,
 * pick a page r, and get the product in the E_r basis of its bidegree, or check a relation.
 *
 *   x_{7,1}*x_{39,1}            the product, written as a combination of the bullets of its bidegree
 *   x_{7,1}^2*x_{39,1} = 0      true/false on the chosen page
 *   2(39,1,0) + [39,1,1]        (stem,s,i): the i-th E_2 basis monomial there; [stem,s,k]: the k-th
 *                               bullet there (click "pick" and then a bullet to insert its token)
 *   <x_{7,1},x_{7,1},x_{39,1}>  the Massey product, on its natural page and as seen on the chosen
 *                               page, with Moss's rule for the differential on it; <a,b,c>_r on page
 *                               r (plot_assets/massey.js). The "find" button, then a bullet: the
 *                               Massey products of named generators containing that class.
 *
 * The algebra is plot_assets/alg.js, fed by the exact vectors on the bullets ("b"/"bc", "d"/"dc")
 * and the chart's ".alg.js" sidecar (prime, generator degrees, Groebner relations), which is fetched
 * the first time the panel opens. Everything is computed on the main thread: a product costs
 * microseconds (scripts/products_js/harness.js times ~100k of them in two seconds).
 *
 * Reads main.js's globals: DATA_JSON, CONFIG, CONFIG_DYNAMIC, camera, Vector, loadScript, loadChart,
 * select_page, select_page_map, latexMon.
 */
"use strict";

const PRODUCTS = {
    dir: null,
    data: null,          /* the chart (DATA_JSON) */
    ring: null, module: null, chart: null, ev: null,
    loading: null,       /* promise while the sidecars load */
    pages: null,         /* massey.js's Pages, once the Massey data is loaded (products_massey_load) */
    masseyLoading: null,
    follow: true,        /* the panel's page follows the chart's page selector */
    page: 2,
    pick: false,         /* next bullet click inserts its [stem,s,k] token */
    find: false,         /* next bullet click lists the Massey products containing it */
    plain: false,        /* ?products_plain=1: TeX source instead of KaTeX (for headless tests) */
    results: [],
};

/* Called by main.js once the chart is plotted. Hides the button for charts exported without the
 * sidecar (older `ss plot_ss`) and for map/cofseq pages. */
function initProducts(dir, data_json) {
    PRODUCTS.dir = dir;
    PRODUCTS.data = data_json;
    /* A chart exported before 2026-10-06 lacks the exact data: the button stays, and opening the
     * panel says what to run, rather than vanishing without a word. */
    const usable = data_json && data_json.alg && data_json.prime && Array.isArray(data_json.bullets);
    if (!usable) {
        PRODUCTS.unusable = `This chart (${dir}/${DATA_NAME}) was exported before the Products panel existed, so it lacks the exact coefficients and the relations. Run  ./ss plot_ss ${dir}  (from build/bin) and reload the page.`;
        const button = document.getElementById("button_products");
        if (button)
            button.title = "Not available: re-export this category with ss plot_ss";
        if (URL_PARAMS.get("products"))
            on_toggle_products(); /* a link with a query: show why it cannot be answered */
        return;
    }
    const sel = document.getElementById("products_page");
    if (sel && sel.options.length === 0) {
        for (const opt of select_page.options)
            if (opt.text !== "E0" && opt.text !== "E1")
                sel.insertAdjacentHTML("beforeend", `<option>${opt.text}</option>`);
    }
    products_sync_page();
    select_page.addEventListener("change", products_sync_page);
    document.addEventListener("pointerup", products_on_pointerup, true);

    /* ?products=<query>[&products_page=E5]: open the panel and answer the query at load, so a
     * computation can be linked to (and the page tested headlessly) */
    PRODUCTS.plain = URL_PARAMS.get("products_plain") === "1";
    const query = URL_PARAMS.get("products");
    if (query) {
        const pageName = URL_PARAMS.get("products_page");
        on_toggle_products();
        products_load().then(() => {
            if (pageName && select_page_map[pageName] !== undefined) {
                PRODUCTS.follow = false;
                document.getElementById("products_follow").checked = false;
                document.getElementById("products_page").value = pageName;
                PRODUCTS.page = select_page_map[pageName];
            }
            document.getElementById("products_input").value = query;
            on_products_compute();
        }, (err) => products_show_error(err));
    }
}

function products_sync_page() {
    if (!PRODUCTS.follow)
        return;
    const sel = document.getElementById("products_page");
    if (sel)
        sel.value = select_page.value;
    PRODUCTS.page = select_page_map[select_page.value];
}

function on_products_page(event) {
    PRODUCTS.page = select_page_map[event.target.value];
    PRODUCTS.follow = false;
    document.getElementById("products_follow").checked = false;
}

function on_products_follow(event) {
    PRODUCTS.follow = event.target.checked;
    products_sync_page();
}

function on_toggle_products() {
    const div = document.getElementById("div_products");
    const showing = div.style.visibility === "visible";
    if (!showing && typeof closeOtherPanels === "function")
        closeOtherPanels("div_products");
    div.style.visibility = showing ? "hidden" : "visible";
    if (showing) {
        products_clear_highlight();
        PRODUCTS.pick = false;
        return;
    }
    /* a map or cofiber-sequence page, or a chart without the data: explain instead of computing */
    const why = !PRODUCTS.data ? "The Products panel works on a spectrum's own chart; open the chart of one of the spectra of this map or cofiber sequence." : PRODUCTS.unusable;
    if (why) {
        document.getElementById("products_status").innerHTML = `<span class="prod_warn">${escapeHtml(why)}</span>`;
        document.getElementById("div_products_query").style.display = "none";
        return;
    }
    products_load().then(() => document.getElementById("products_input").focus(), (err) => products_show_error(err));
}

/* The sidecars (and, for a module chart, the ring's chart meta and sidecar), once. */
function products_load() {
    if (PRODUCTS.ev)
        return Promise.resolve();
    if (PRODUCTS.loading)
        return PRODUCTS.loading;
    const data = PRODUCTS.data, dir = PRODUCTS.dir;
    const status = document.getElementById("products_status");
    status.textContent = "loading the relations…";
    const loadGlobal = (file, variable) => new Promise((resolve, reject) => {
        if (globalThis[variable])
            return resolve(globalThis[variable]);
        loadScript(`${dir}/${file}`, () => (globalThis[variable] ? resolve(globalThis[variable]) : reject(new Error(`${file} did not define ${variable}`))));
    });
    PRODUCTS.loading = (async () => {
        const name = DATA_NAME;
        const algJson = await loadGlobal(data.alg, `ALG_JSON_${name}`);
        let ring, module = null;
        if (data.type === "module") {
            const ringMeta = await new Promise((resolve) => loadChart(dir, data.over, { meta: true }, resolve));
            if (!ringMeta.alg)
                throw new Error(`the ring chart ${data.over} has no .alg.js sidecar; re-export the category`);
            const ringAlg = await loadGlobal(ringMeta.alg, `ALG_JSON_${data.over}`);
            data.gen_names = data.gen_names || ringMeta.gen_names;
            data.gen_degs = data.gen_degs || ringMeta.gen_degs;
            ring = new SSAlg.Ring(ringAlg, ringMeta.gen_names);
            module = new SSAlg.Module(algJson, ring, data.v_names);
        }
        else
            ring = new SSAlg.Ring(algJson, data.gen_names);
        const gid2new = data.gid2new;
        const gid2local = gid2new ? (g) => (gid2new.has(g) ? gid2new.get(g) : -1) : (g) => g;
        PRODUCTS.ring = ring;
        PRODUCTS.module = module;
        PRODUCTS.chart = new SSAlg.Chart(data, gid2local);
        PRODUCTS.ev = new SSAlg.Evaluator(ring, module, PRODUCTS.chart, { gen_names: data.gen_names, v_names: data.v_names });
        /* the presentation the panel computes with: the E_2 page's (Ext's) generators and relations */
        status.textContent = module
            ? `E₂ page over F_${ring.p}: ${module.vDegs.length} module generators and ${module.relations.length} module relations, over the ring's ${ring.genDegs.length} generators and ${ring.relations.length} relations`
            : `E₂ page over F_${ring.p}: ${ring.genDegs.length} generators, ${ring.relations.length} relations`;
        status.title = "These present the E_2 page (Ext). Answers on a later page are this algebra's products reduced to that page's basis.";
    })();
    PRODUCTS.loading.catch((err) => {
        status.textContent = "";
        PRODUCTS.loading = null;
        throw err;
    });
    return PRODUCTS.loading;
}

function on_products_key(event) {
    if (event.key === "Enter") {
        event.preventDefault();
        on_products_compute();
    }
    event.stopPropagation();
}

function on_products_pick() {
    PRODUCTS.pick = !PRODUCTS.pick;
    document.getElementById("products_pick").classList.toggle("active", PRODUCTS.pick);
    if (PRODUCTS.pick && PRODUCTS.find)
        on_products_find();
}

function on_products_find() {
    PRODUCTS.find = !PRODUCTS.find;
    document.getElementById("products_find").classList.toggle("active", PRODUCTS.find);
    if (PRODUCTS.find && PRODUCTS.pick)
        on_products_pick();
    if (PRODUCTS.find)
        document.getElementById("products_status").textContent = "click a bullet: the Massey products containing it on the page shown";
}

/* Capture-phase pointerup on the document: in pick mode a click on a bullet inserts its token; in
 * find mode it lists the Massey products that contain the bullet. */
function products_on_pointerup(event) {
    if (!PRODUCTS.pick && !PRODUCTS.find)
        return;
    const tgt = event.target;
    if (!(tgt instanceof Element) || !tgt.classList.contains("b") || tgt.dataset.i === undefined)
        return;
    const local = Number(tgt.dataset.i);
    const bullet = PRODUCTS.data.bullets[local];
    if (!bullet)
        return;
    const stem = Math.round(bullet.x), s = Math.round(bullet.y), k = local - bullet.i0;
    if (PRODUCTS.find) {
        products_find(stem, s, k);
        return;
    }
    const input = document.getElementById("products_input");
    const token = `[${stem},${s},${k}]`;
    const at = input.selectionStart ?? input.value.length;
    input.value = input.value.slice(0, at) + token + input.value.slice(input.selectionEnd ?? at);
    input.focus();
    input.setSelectionRange(at + token.length, at + token.length);
}

function on_products_clear() {
    PRODUCTS.results = [];
    document.getElementById("products_results").innerHTML = "";
    products_clear_highlight();
}

/* ------------------------------------------------------------------ computing */

function on_products_compute() {
    const input = document.getElementById("products_input");
    const src = input.value.trim();
    if (!src)
        return;
    /* a Massey product needs the Massey data (and, for a module, the ring's staircases) */
    (src.startsWith("<") ? products_massey_load() : products_load()).then(() => {
        let html;
        try {
            html = products_answer(src, PRODUCTS.page);
        }
        catch (err) {
            html = `<div class="prod_error">${escapeHtml(err.message)}</div>`;
        }
        products_push_result(src, html);
    }, (err) => products_show_error(err));
}

function products_show_error(err) {
    document.getElementById("products_status").innerHTML = `<span class="prod_error">${escapeHtml(err.message || String(err))}</span>`;
}

function products_push_result(src, html) {
    const list = document.getElementById("products_results");
    const card = document.createElement("div");
    card.className = "prod_card";
    card.innerHTML = `<div class="prod_query"><code>${escapeHtml(src)}</code> <span class="prod_page">on ${products_page_name(PRODUCTS.page)}</span></div>${html}`;
    list.insertBefore(card, list.firstChild);
    PRODUCTS.results.unshift({ src, page: PRODUCTS.page });
    while (list.children.length > 30)
        list.removeChild(list.lastChild);
    products_apply_highlight(card);
}

function products_page_name(r) {
    return r >= CONFIG.R_PERM ? "E_∞" : `E_${r}`;
}

function products_katex(tex) {
    if (typeof katex === "undefined" || PRODUCTS.plain)
        return `<code>${escapeHtml(tex)}</code>`;
    return katex.renderToString(tex, { throwOnError: false });
}

/* the LaTeX of a staircase row, with coefficients */
function products_row_latex(row, deg) {
    const chart = PRODUCTS.chart, data = PRODUCTS.data;
    return SSAlg.latexPoly(chart.fromVec(row.vec, deg), data.gen_names, data.v_names);
}

/* A class in the E_r basis: chips for the rows. `kind` colours the highlight. */
function products_rows_html(cls, deg, kind) {
    if (cls.rowsCoeffs.length === 0)
        return `<span class="prod_zero">0</span>`;
    const parts = cls.rowsCoeffs.slice().sort((a, b) => a.row.k - b.row.k).map(({ row, c }) => {
        /* c times the bullet's own vector; parenthesised when that vector is a sum or carries a
         * coefficient itself, so that "4(4x)" is not read as "44x" */
        let rowTex = products_row_latex(row, deg);
        const simple = row.vec.inds.length === 1 && row.vec.cs[0] === 1;
        if (c !== 1 && !simple)
            rowTex = `(${rowTex})`;
        const coeff = c === 1 ? "" : `${c}\\cdot `; /* the space: "\\cdotx" is an undefined macro */
        const tex = products_katex(`${coeff}${rowTex}`);
        const title = `bullet [${deg[0]},${deg[1]},${row.k}] (level ${row.level}${row.level > SSAlg.LEVEL_PERM ? `: supports d_{${SSAlg.LEVEL_MAX - row.level}}` : row.level === SSAlg.LEVEL_PERM ? ": permanent" : `: hit by d_{${row.level}}`})`;
        return `<span class="prod_chip prod_hl_${kind}" data-local="${row.local}" data-token="[${deg[0]},${deg[1]},${row.k}]" title="${escapeHtml(title)}" onclick="products_goto(this)">${tex}</span>`;
    });
    return parts.join(`<span class="prod_plus">+</span>`);
}

/* status + E_r class of a value {deg, vec} at page r; returns {html, cls} */
function products_classify(deg, vec, r, kind) {
    const chart = PRODUCTS.chart, p = PRODUCTS.ring.p;
    if (deg === null || vec.inds.length === 0)
        return { html: `<span class="prod_zero">0</span>`, cls: { status: "ok", rowsCoeffs: [], dropped: [] }, zero: true };
    const rows = chart.rowsAt(deg[0], deg[1]);
    if (!rows)
        throw new Error(`the chart has no classes at (${deg[0]}, ${deg[1]})`);
    const cls = SSAlg.classAtPage(rows, vec, r, p);
    let html;
    if (cls.status === "ok") {
        html = products_rows_html(cls, deg, kind);
        if (cls.rowsCoeffs.length === 0 && cls.dropped.length) {
            const levels = [...new Set(cls.dropped.map((x) => x.row.level))].sort((a, b) => a - b);
            html += `<div class="prod_note">zero on ${products_page_name(r)}: a boundary (hit by ${levels.map((L) => `d_{${L}}`).join(", ")})</div>`;
        }
        else if (cls.dropped.length) {
            const levels = [...new Set(cls.dropped.map((x) => x.row.level))].sort((a, b) => a - b);
            html += `<div class="prod_note">modulo boundaries hit by ${levels.map((L) => `d_{${L}}`).join(", ")}</div>`;
        }
    }
    else if (cls.status === "dies") {
        const tdeg = [deg[0] - 1, deg[1] + cls.rDies];
        let target = "";
        try {
            const trows = chart.rowsAt(tdeg[0], tdeg[1]);
            const tcls = trows ? SSAlg.classAtPage(trows, cls.dvec, cls.rDies, p) : null;
            target = tcls && tcls.status === "ok" ? products_rows_html(tcls, tdeg, "target") : products_katex(SSAlg.latexPoly(chart.fromVec(cls.dvec, tdeg), PRODUCTS.data.gen_names, PRODUCTS.data.v_names));
        }
        catch (err) {
            target = `<span class="prod_error">${escapeHtml(err.message)}</span>`;
        }
        html = `<div class="prod_warn">does not survive to ${products_page_name(r)}: it supports ${products_katex(`d_{${cls.rDies}}`)}</div>`
            + `<div>${products_katex(`d_{${cls.rDies}}(\\cdot) =`)} ${target} <span class="prod_muted">in ${products_page_name(cls.rDies)} at (${tdeg[0]}, ${tdeg[1]})</span></div>`
            + `<div><button class="prod_small" onclick="products_set_page(${cls.rDies})">compute on ${products_page_name(cls.rDies)}</button></div>`;
    }
    else {
        const drawnPermanent = rows.some((row) => row.page >= CONFIG.R_PERM && row.level > SSAlg.LEVEL_PERM);
        html = `<div class="prod_warn">undetermined: it survives to ${products_page_name(cls.rUnknown)}, but ${products_katex(`d_{${cls.rUnknown}}`)} of (part of) it is not known, so its class on ${products_page_name(r)} is not determined by the chart${drawnPermanent ? " (the chart draws such a class as if permanent)" : ""}</div>`
            + `<div><button class="prod_small" onclick="products_set_page(${cls.rUnknown})">compute on ${products_page_name(cls.rUnknown)}</button></div>`;
    }
    return { html, cls, zero: false };
}

function products_set_page(r) {
    const sel = document.getElementById("products_page");
    const name = r >= CONFIG.R_PERM ? "Einf" : `E${r}`;
    if ([...sel.options].some((o) => o.text === name)) {
        sel.value = name;
        PRODUCTS.page = r;
        PRODUCTS.follow = false;
        document.getElementById("products_follow").checked = false;
        on_products_compute();
    }
}

function products_e2_html(value) {
    const data = PRODUCTS.data;
    const P = value.poly || value.mod;
    if (!P) /* a bare number: only 0 gets this far */
        return products_katex(`${value.scalar}`);
    return products_katex(SSAlg.latexPoly(P, data.gen_names, data.v_names));
}

/* the answer to one query, as HTML */
function products_answer(src, r) {
    const ev = PRODUCTS.ev;
    const q = ev.evaluate(src);
    if (q.kind === "massey")
        return products_massey_answer(q, r);
    if (q.kind === "expr") {
        const v = ev.toVec(q.value);
        let html = "";
        if (v.deg)
            html += `<div class="prod_line"><span class="prod_label">bidegree</span> (${v.deg[0]}, ${v.deg[1]})</div>`;
        html += `<div class="prod_line"><span class="prod_label">E_2</span> ${products_e2_html(q.value)}</div>`;
        const c = products_classify(v.deg, v.vec, r, "result");
        html += `<div class="prod_line"><span class="prod_label">${products_page_name(r)}</span> ${c.html}</div>`;
        if (r >= CONFIG.R_PERM)
            html += products_homotopy_html(src, c);
        return html;
    }
    /* equality */
    const L = ev.toVec(q.lhs), R = ev.toVec(q.rhs);
    const deg = L.deg || R.deg;
    if (L.deg && R.deg && (L.deg[0] !== R.deg[0] || L.deg[1] !== R.deg[1]))
        return `<div class="prod_false">FALSE</div><div class="prod_note">the two sides live in different bidegrees, (${L.deg}) and (${R.deg})</div>`;
    const cL = products_classify(deg, L.vec, r, "input"), cR = products_classify(deg, R.vec, r, "input");
    let verdict;
    if (cL.cls.status !== "ok" || cR.cls.status !== "ok")
        verdict = `<div class="prod_warn">cannot compare on ${products_page_name(r)}: a side does not have a class there</div>`;
    else {
        const a = SSAlg.pageCoords(cL.cls), b = SSAlg.pageCoords(cR.cls);
        const equal = SSAlg.vecEqual(a, b);
        verdict = equal ? `<div class="prod_true">TRUE on ${products_page_name(r)}</div>` : `<div class="prod_false">FALSE on ${products_page_name(r)}</div>`;
        const equalE2 = SSAlg.vecEqual(L.vec, R.vec);
        if (equal && !equalE2 && deg) {
            const diff = SSAlg.vecAdd(L.vec, R.vec, PRODUCTS.ring.p - 1, PRODUCTS.ring.p);
            const d = SSAlg.classAtPage(PRODUCTS.chart.rowsAt(deg[0], deg[1]), diff, r, PRODUCTS.ring.p);
            const levels = [...new Set(d.dropped.map((x) => x.row.level))].sort((x, y) => x - y);
            verdict += `<div class="prod_note">not equal on E_2: the difference is a boundary${levels.length ? ` hit by ${levels.map((x) => `d_{${x}}`).join(", ")}` : ""}</div>`;
        }
        else if (equal && equalE2)
            verdict += `<div class="prod_note">equal already on E_2</div>`;
    }
    return verdict
        + `<div class="prod_line"><span class="prod_label">left</span> ${products_e2_html(q.lhs)} <span class="prod_muted">=</span> ${cL.html}</div>`
        + `<div class="prod_line"><span class="prod_label">right</span> ${products_e2_html(q.rhs)} <span class="prod_muted">=</span> ${cR.html}</div>`;
}

/* ------------------------------------------------------------------ the product in homotopy
 * On E_infinity, a product of classes is also a question about pi_*: the E_infinity product detects the
 * homotopy product only when it is nonzero, and otherwise there may be a hidden extension. The chart
 * knows the answer when one factor f is the multiplier of one of the category's cofiber sequences
 * X --f--> X -> C(f) (times p, alpha_1, beta_1, ...): `ss plot_ss` exports that cofiber sequence's
 * records ("exts"[].rows, ss/plot.cpp PlotHiddenExtensions) -- for every class of X, the image under f
 * with its filtration jump, or that it is zero, or that it is still undetermined. Here x = the other
 * factors, written in those rows' basis (modulo X's boundaries), and f*x is read off. The multiplier
 * map is d(x) = f*x (left multiplication: ss/category.cpp MapMulRing2Ring, MapMulMod2Mod); a factor
 * written to the right of x is moved left with the Koszul sign, as on E_2. */

/* top-level factors of a product "a*b*c" (null for a sum, an equation, a bracket, or one factor) */
function products_split_product(src) {
    const parts = [];
    let depth = 0, start = 0;
    for (let i = 0; i < src.length; ++i) {
        const ch = src[i];
        if ("({[<".includes(ch))
            ++depth;
        else if (")}]>".includes(ch))
            --depth;
        else if (depth === 0 && (ch === "+" || ch === "=" || (ch === "-" && i > 0 && src[i - 1] !== "{")))
            return null;
        else if (depth === 0 && ch === "*") {
            parts.push(src.slice(start, i));
            start = i + 1;
        }
    }
    parts.push(src.slice(start));
    /* a top-level power a^n is n factors a */
    const out = [];
    for (const part of parts.map((s) => s.trim()).filter((s) => s.length)) {
        let d = 0, caret = -1;
        for (let i = 0; i < part.length; ++i) {
            if ("({[<".includes(part[i]))
                ++d;
            else if (")}]>".includes(part[i]))
                --d;
            else if (d === 0 && part[i] === "^")
                caret = i;
        }
        const n = caret > 0 ? Number(part.slice(caret + 1).replace(/[{}]/g, "")) : NaN;
        if (Number.isInteger(n) && n >= 1 && n <= 64)
            for (let k = 0; k < n; ++k)
                out.push(part.slice(0, caret));
        else
            out.push(part);
    }
    return out.length >= 2 ? out : null;
}

function products_inv(a, p) {
    a %= p;
    for (let b = 1; b < p; ++b)
        if ((a * b) % p === 1)
            return b;
    throw new Error(`${a} is not invertible mod ${p}`);
}

/* an exported vector [inds, cs] (cs empty: all ones) as {inds, cs} */
function products_expvec(inds, cs) {
    return { inds: inds.slice(), cs: cs && cs.length ? cs.slice() : inds.map(() => 1) };
}

/* lambda with P = lambda * f, f an exported polynomial [[c, mon], ...]; null if P is not a multiple of f */
function products_poly_ratio(P, fpoly, p) {
    if (!P || !fpoly || P.terms.length !== fpoly.length || P.terms.length === 0)
        return null;
    const want = new Map(fpoly.map(([c, m]) => [JSON.stringify(m), c % p]));
    let lambda = null;
    for (let i = 0; i < P.terms.length; ++i) {
        const c = want.get(JSON.stringify(P.terms[i]));
        if (c === undefined || c === 0)
            return null;
        const l = (P.cs[i] * products_inv(c, p)) % p;
        if (lambda === null)
            lambda = l;
        else if (l !== lambda)
            return null;
    }
    return lambda;
}

/* coefficients a with target = sum a_k vecs[k] over F_p, or null */
function products_solve(vecs, target, p) {
    let n = 0;
    for (const v of [...vecs, target])
        for (const i of v.inds)
            n = Math.max(n, i + 1);
    const m = vecs.length;
    const A = vecs.map((v) => {
        const row = new Array(n + m).fill(0);
        v.inds.forEach((i, k) => (row[i] = ((v.cs[k] % p) + p) % p));
        return row;
    });
    A.forEach((row, k) => (row[n + k] = 1)); /* track the combination */
    const t = new Array(n).fill(0);
    target.inds.forEach((i, k) => (t[i] = ((target.cs[k] % p) + p) % p));
    const coef = new Array(m).fill(0);
    const pivots = [];
    for (let col = 0, r0 = 0; col < n && r0 < m; ++col) {
        let piv = -1;
        for (let r = r0; r < m; ++r)
            if (A[r][col]) {
                piv = r;
                break;
            }
        if (piv < 0)
            continue;
        [A[r0], A[piv]] = [A[piv], A[r0]];
        const inv = products_inv(A[r0][col], p);
        for (let j = 0; j < n + m; ++j)
            A[r0][j] = (A[r0][j] * inv) % p;
        for (let r = 0; r < m; ++r)
            if (r !== r0 && A[r][col]) {
                const f = A[r][col];
                for (let j = 0; j < n + m; ++j)
                    A[r][j] = (A[r][j] - f * A[r0][j] % p + p * p) % p;
            }
        pivots.push([col, r0]);
        ++r0;
    }
    for (const [col, r] of pivots) {
        const f = t[col];
        if (!f)
            continue;
        for (let j = 0; j < n; ++j)
            t[j] = (t[j] - f * A[r][j] % p + p * p) % p;
        for (let k = 0; k < m; ++k)
            coef[k] = (coef[k] + f * A[r][n + k]) % p;
    }
    return t.every((x) => x === 0) ? coef : null;
}

/* Can a hidden extension land anywhere? The E_infinity classes of stem `stem` in filtration > s0 that
 * survive, or whose fate is not known yet. Returns {none: true} when there are none and the chart reaches
 * past the Adams vanishing line in that stem (Ext^{s,t} = 0 for 0 < t-s < (2p-2)s - 1, so s <= stem/(2p-2)+1
 * suffices), i.e. the product is 0 in homotopy; otherwise {none: false, why}. */
function products_room_above(stem, s0) {
    const chart = PRODUCTS.chart, data = PRODUCTS.data, p = PRODUCTS.ring.p;
    const tMax = data.t_max;
    if (typeof tMax !== "number")
        return { none: false, why: "the chart does not record its t_max" };
    const sTop = tMax - stem, sNeed = Math.floor(stem / (2 * (p - 1))) + 2;
    if (sTop < sNeed)
        return { none: false, why: `the chart stops at t = ${tMax}, below the vanishing line in stem ${stem}` };
    const live = [];
    for (let s = s0 + 1; s <= sTop; ++s) {
        let rows;
        try {
            rows = chart.rowsAt(stem, s);
        }
        catch (err) {
            return { none: false, why: `the classes at (${stem}, ${s}) are not loaded` };
        }
        /* survives or may: permanent, or its differential is unknown (or zero on the page reached); a
         * class supporting a known nonzero differential, or a boundary, does not */
        if (rows && rows.some((row) => row.level === SSAlg.LEVEL_PERM || (row.level > SSAlg.LEVEL_PERM && (row.diff === null || row.diff.inds.length === 0))))
            live.push(s);
    }
    return live.length ? { none: false, why: `stem ${stem} has surviving classes in filtration ${live.join(", ")}` } : { none: true };
}

function products_homotopy_html(src, cProd) {
    const label = `<span class="prod_label" title="the product in homotopy, pi_*">π<sub>*</sub></span>`;
    const line = (body) => `<div class="prod_line">${label} ${body}</div>`;
    const ev = PRODUCTS.ev, chart = PRODUCTS.chart, p = PRODUCTS.ring.p, data = PRODUCTS.data;
    const factors = products_split_product(src);
    if (!factors || !cProd || cProd.cls.status !== "ok")
        return "";
    const exts = Array.isArray(data.exts) ? data.exts.filter((e) => e.factor_poly && Array.isArray(e.rows)) : [];
    /* a chart exported before the multipliers' records were added (2026-10-12) cannot answer: say so */
    if (Array.isArray(data.exts) && data.exts.length && exts.length === 0)
        return line(`<span class="prod_note">re-export this category with  ./ss plot_ss ${escapeHtml(PRODUCTS.dir || "")}  to see the product in homotopy (hidden extensions)</span>`);
    let vals;
    try {
        vals = factors.map((f) => {
            const q = ev.evaluate(f);
            if (q.kind !== "expr")
                throw new Error("not a product");
            return q.value;
        });
    }
    catch (err) {
        return "";
    }
    /* a factor that is (a multiple of) one of the cofiber sequences' multipliers */
    let j = -1, e = null, lambda = null;
    for (let k = 0; k < vals.length && j < 0; ++k)
        for (const cand of exts) {
            const l = vals[k].poly ? products_poly_ratio(vals[k].poly, cand.factor_poly, p) : null;
            if (l !== null) {
                j = k;
                e = cand;
                lambda = l;
                break;
            }
        }
    const einfZero = cProd.cls.rowsCoeffs.length === 0;
    if (j < 0) {
        if (!einfZero)
            return line(`detected by the E∞ product above <span class="prod_note">(equal to it in homotopy modulo higher Adams filtration)</span>`);
        const vdeg = ev.toVec(ev.evaluate(src).value).deg;
        const room = vdeg ? products_room_above(vdeg[0], vdeg[1]) : { none: true };
        if (room.none)
            return line(`<span class="prod_zero">0</span> <span class="prod_note">(no class survives above it in stem ${vdeg ? vdeg[0] : ""})</span>`);
        return line(`<span class="prod_warn">undetermined</span> <span class="prod_note">the E∞ product is 0 and no tracked multiplier is a factor; ${escapeHtml(room.why)}</span>`);
    }
    /* x = the other factors, in order; f moved to the left past the factors before it */
    let xval = null, parity = 0;
    vals.forEach((v, k) => {
        if (k === j)
            return;
        if (k < j && v.deg)
            parity += v.deg[0] * e.deg[0];
        xval = xval === null ? v : ev.mul(xval, v);
    });
    const scale = (lambda * (parity % 2 ? p - 1 : 1)) % p;
    const xv = ev.toVec(xval);
    const fname = products_katex(e.label);
    if (!xv.deg || xv.vec.inds.length === 0)
        return line(`<span class="prod_zero">0</span>`);
    const [stem, s] = xv.deg;
    const xrows = chart.rowsAt(stem, s);
    const xcls = xrows ? SSAlg.classAtPage(xrows, xv.vec, CONFIG.R_PERM, p) : null;
    if (!xcls || xcls.status !== "ok")
        return line(`<span class="prod_warn">the other factor does not have a class on E∞</span>`);
    if (xcls.rowsCoeffs.length === 0)
        return line(`<span class="prod_zero">0</span> <span class="prod_note">the other factor is zero on E∞</span>`);
    const erows = e.rows.filter((row) => row[0] === stem && row[1] === s);
    const bds = xrows.filter((row) => row.level < SSAlg.LEVEL_MAX / 2).map((row) => row.vec);
    const coef = products_solve([...erows.map((row) => products_expvec(row[2], row[3])), ...bds], xv.vec, p);
    if (!coef)
        return line(`<span class="prod_warn">undetermined</span> <span class="prod_note">the class is not in the span of the ${fname} cofiber sequence's records at (${stem}, ${s})</span>`);
    /* f*x = sum over the rows: 0, a known image with jump r, or undetermined with jump >= r */
    const byR = new Map();
    let undetMin = Infinity;
    erows.forEach((row, k) => {
        const a = coef[k];
        const level = row[4];
        if (!a || level <= SSAlg.LEVEL_PERM)
            return;
        const r = SSAlg.LEVEL_MAX - level;
        if (row[5] === null) {
            undetMin = Math.min(undetMin, r);
            return;
        }
        const img = products_expvec(row[5], row[6]);
        if (img.inds.length === 0)
            return;
        const acc = byR.get(r) || { inds: [], cs: [] };
        byR.set(r, SSAlg.vecAdd(acc, img, (a * scale) % p, p));
    });
    for (const r of [...byR.keys()].sort((x, y) => x - y)) {
        if (r >= undetMin)
            break;
        const tdeg = [stem + e.deg[0], s + r];
        const v = byR.get(r);
        if (v.inds.length === 0)
            continue;
        const c = products_classify(tdeg, v, CONFIG.R_PERM, "result");
        if (c.zero || (c.cls.status === "ok" && c.cls.rowsCoeffs.length === 0))
            continue;
        const kind = r === e.deg[1]
            ? `<span class="prod_note">equal to the E∞ product</span>`
            : `<span class="prod_true">hidden extension</span> <span class="prod_note">by ${fname}: filtration jump ${r} where the E∞ product has ${e.deg[1]} (from the cofiber sequence ${escapeHtml(e.cofseq || "")})</span>`;
        return line(`${c.html} <span class="prod_muted">at (${tdeg[0]}, ${tdeg[1]})</span> ${kind}`);
    }
    if (undetMin < Infinity) {
        const room = products_room_above(stem + e.deg[0], s + undetMin - 1);
        if (room.none)
            return line(`<span class="prod_zero">0</span> <span class="prod_note">(no class survives above it in stem ${stem + e.deg[0]})</span>`);
        return line(`<span class="prod_warn">undetermined extension</span> <span class="prod_note">not yet determined by the ${fname} cofiber sequence; if nonzero, its filtration jump is ≥ ${undetMin}</span>`);
    }
    return line(`<span class="prod_zero">0</span>${einfZero ? "" : ` <span class="prod_warn">(but the E∞ product is not 0: check the ${fname} cofiber sequence)</span>`}`);
}

/* ------------------------------------------------------------------ Massey products
 * <a,b,c> in the panel, and the "find" mode (a click on a bullet lists the Massey products that
 * contain it). The computation is plot_assets/massey.js; see its header for the conventions. The
 * page logic: a bracket is formed on its natural page E_{r0} (where ab and bc have both died). The
 * answer is that bracket, and its image on the page the panel is on; below r0 it is not defined,
 * and strictly on a page above r0 it is its whole indeterminacy. `<a,b,c>_r` asks for page r. */

/* a global defined by a sidecar script, loaded once */
function products_load_global(file, variable) {
    return new Promise((resolve, reject) => {
        if (globalThis[variable])
            return resolve(globalThis[variable]);
        loadScript(`${PRODUCTS.dir}/${file}`, () => (globalThis[variable] ? resolve(globalThis[variable]) : reject(new Error(`${file} did not define ${variable}`))));
    });
}

/* the Massey machinery: the ".massey.js" sidecar (E_2 brackets) and, for a module, the ring's
 * staircases (b and c, and bc, live there) */
function products_massey_load() {
    if (PRODUCTS.pages)
        return Promise.resolve(PRODUCTS.pages);
    if (PRODUCTS.masseyLoading)
        return PRODUCTS.masseyLoading;
    PRODUCTS.masseyLoading = (async () => {
        await products_load();
        const data = PRODUCTS.data;
        let e2 = null;
        if (data.massey)
            e2 = await products_load_global(data.massey, `MASSEY_JSON_${DATA_NAME}`);
        let chartR = PRODUCTS.chart;
        if (PRODUCTS.module) {
            const ringData = await new Promise((resolve) => loadChart(PRODUCTS.dir, data.over, { window: true }, resolve));
            const g2n = ringData.gid2new;
            chartR = new SSAlg.Chart(ringData, g2n ? (g) => (g2n.has(g) ? g2n.get(g) : -1) : (g) => g);
        }
        PRODUCTS.pages = new SSMassey.Pages({ ring: PRODUCTS.ring, module: PRODUCTS.module, chartS: PRODUCTS.chart, chartR, e2 });
        return PRODUCTS.pages;
    })();
    PRODUCTS.masseyLoading.catch(() => { PRODUCTS.masseyLoading = null; });
    return PRODUCTS.masseyLoading;
}

/* LaTeX of a Massey element {side, deg, vec} */
function products_el_latex(el) {
    const pg = PRODUCTS.pages, data = PRODUCTS.data;
    const chart = el.side === "R" && PRODUCTS.module ? pg.chart.R : PRODUCTS.chart;
    return SSAlg.latexPoly(chart.fromVec(el.vec, el.deg), data.gen_names, data.v_names);
}

/* an element as an expression the panel can read back (for "open") */
function products_el_expr(el) {
    const pg = PRODUCTS.pages, data = PRODUCTS.data;
    const chart = el.side === "R" && PRODUCTS.module ? pg.chart.R : PRODUCTS.chart;
    const P = chart.fromVec(el.vec, el.deg);
    const genName = (g) => {
        const n = data.gen_names && data.gen_names[g];
        if (n)
            return n;
        const d = PRODUCTS.ring.genDegs[g];
        let k = 0;
        for (let i = 0; i <= g; ++i)
            if (PRODUCTS.ring.genDegs[i][0] === d[0] && PRODUCTS.ring.genDegs[i][1] === d[1])
                ++k;
        return k === 1 ? `x_{${d[0]},${d[1]}}` : `x_{${d[0]},${d[1]},${k}}`;
    };
    const vName = (v) => {
        const n = data.v_names && data.v_names[v];
        if (n)
            return n;
        const d = PRODUCTS.module.vDegs[v];
        let k = 0;
        for (let i = 0; i <= v; ++i)
            if (PRODUCTS.module.vDegs[i][0] === d[0] && PRODUCTS.module.vDegs[i][1] === d[1])
                ++k;
        return k === 1 ? `v_{${d[0]},${d[1]}}` : `v_{${d[0]},${d[1]},${k}}`;
    };
    return P.terms.map((t, i) => {
        const m = t.m !== undefined ? t.m : t;
        const parts = [];
        for (let j = 0; j < m.length; j += 2)
            parts.push(genName(m[j]) + (m[j + 1] === 1 ? "" : `^${m[j + 1]}`));
        if (t.v !== undefined)
            parts.push(vName(t.v));
        const c = P.cs[i];
        return (c === 1 ? "" : `${c}*`) + parts.join("*");
    }).join(" + ");
}

/* chips for a vector at the spectrum's bidegree on page r (the E_r classes it reads as) */
function products_vec_html(deg, vec, r, kind) {
    return products_classify(deg, vec, r, kind).html;
}

function products_massey_answer(q, r) {
    const pg = PRODUCTS.pages, ev = PRODUCTS.ev, p = PRODUCTS.ring.p;
    if (!pg)
        throw new Error("the Massey data is not loaded");
    if (q.args.length !== 3)
        throw new Error("only triple Massey products <a,b,c> are computed");
    const isMod = !!PRODUCTS.module;
    const els = q.args.map((v, i) => {
        if (ev.isScalar(v))
            throw new Error(`the ${"abc"[i]} of <a,b,c> is a number, not a class`);
        if (i === 0 && isMod && !v.mod)
            throw new Error("in a module chart the first class must be a module class (with its module generator)");
        if (i > 0 && v.mod)
            throw new Error(`the ${"abc"[i]} of <a,b,c> must be a class of the ring`);
        const P = v.poly || v.mod;
        if (v.deg === null || SSAlg.isZero(P))
            throw new Error(`the ${"abc"[i]} of <a,b,c> is zero`);
        const chart = i > 0 && isMod ? pg.chart.R : PRODUCTS.chart;
        return pg.el(i === 0 ? "S" : "R", v.deg, chart.toVec(P, v.deg));
    });
    const [A, B, C] = els;
    const br = pg.bracket(A, B, C, q.page);
    const name = (R) => products_page_name(R);
    let html = "";
    if (br.deg)
        html += `<div class="prod_line"><span class="prod_label">bidegree</span> (${br.deg[0]}, ${br.deg[1]})</div>`;
    if (br.r0 === null) {
        if (br.ab && br.bc) {
            const killed = (L) => (L === 1 ? "zero in E_2" : L < SSAlg.LEVEL_MAX / 2 ? `killed by d_${L}` : "not killed on any page");
            html += `<div class="prod_line"><span class="prod_label">ab, bc</span> ${killed(br.Lab)}; ${killed(br.Lbc)}</div>`;
        }
        return html + `<div class="prod_warn">not defined on any page: ${escapeHtml(br.note)}</div>`;
    }
    html += `<div class="prod_line"><span class="prod_label">formed on</span> ${name(br.r0)} <span class="prod_muted">(ab ${br.Lab === 1 ? "is zero in E_2" : `is killed by d_${br.Lab}`}, bc ${br.Lbc === 1 ? "is zero in E_2" : `is killed by d_${br.Lbc}`})</span></div>`;
    if (br.status === "undefined") {
        html += `<div class="prod_warn">${escapeHtml(br.note)}</div>`;
        if (q.page !== null && q.page < br.r0)
            html += `<div><button class="prod_small" onclick="products_set_page(${br.r0})">compute on ${name(br.r0)}</button></div>`;
        return html;
    }
    if (br.status === "e2") {
        const exprs = els.map((el) => products_el_expr(el));
        html += `<div class="prod_warn">${escapeHtml(br.note)}. E_2 brackets are Ext brackets, computed at the chain level by Adamsp; run (in build/bin)</div>`
            + `<div class="prod_note"><code>./Adamsp massey ${escapeHtml(DATA_NAME.replace(/p\d+$/, ""))} '${escapeHtml(exprs[0])}' '${escapeHtml(exprs[1])}' '${escapeHtml(exprs[2])}' chart=&lt;category&gt;/${escapeHtml(DATA_NAME)}_AdamsSS.db${isMod ? " over=.. ring_chart=.." : ""}</code></div>`
            + `<div class="prod_note">and, for every generator triple at once, <code>Adamsp massey_all</code> then <code>ss plot_ss</code>.</div>`;
        return html;
    }
    const R = br.R;
    const zero = pg.containsZero(br);
    html += `<div class="prod_line"><span class="prod_label">${name(R)}</span> ${products_vec_html(br.deg, br.rep.vec, R, "result")}</div>`;
    if (br.indet.length)
        html += `<div class="prod_line"><span class="prod_label">modulo</span> ${br.indet.map((v) => products_vec_html(br.deg, v, R, "input")).join(`<span class="prod_muted">, </span>`)}${br.uncertain ? ` <span class="prod_muted">(an upper bound: some classes there have an unknown fate before ${name(R)})</span>` : ""}</div>`;
    else
        html += `<div class="prod_note">no indeterminacy</div>`;
    if (br.source && br.source !== "computed")
        html += `<div class="prod_note">from Adamsp's ${escapeHtml(br.source)}</div>`;
    else if (br.u)
        html += `<div class="prod_note">from ${name(R - 1)}: ${products_katex(`u = ${products_el_latex(br.u)},\\ v = ${products_el_latex(br.v)}`)} <span class="prod_muted">(d u = ab, d v = bc; the bracket is u c - (-1)^{|a|} a v)</span></div>`;
    if (zero) {
        html += `<div class="prod_note">it contains zero, so it says nothing more than its indeterminacy</div>`;
        return html;
    }
    /* the page the panel is on */
    if (q.page === null && r !== R) {
        if (r < R)
            html += `<div class="prod_warn">not defined on ${name(r)}, the page shown: it is formed on ${name(R)}</div><div><button class="prod_small" onclick="products_set_page(${R})">show ${name(R)}</button></div>`;
        else
            html += `<div class="prod_line"><span class="prod_label">on ${name(r)}</span> ${products_vec_html(br.deg, br.rep.vec, r, "result")}</div>`
                + `<div class="prod_note">the image of the ${name(R)} bracket (strictly, the Massey product formed on ${name(r)} is its whole indeterminacy, which contains zero)</div>`;
    }
    /* Moss's higher Leibniz rule for d_R on it */
    const lz = pg.leibniz(A, B, C, br);
    if (lz.status === "ok" && lz.empty)
        html += `<div class="prod_note">Moss's rule: ${products_katex(`d_{${R}}`)} lands at (${lz.target[0]}, ${lz.target[1]}), where there is nothing</div>`;
    else if (lz.status === "ok") {
        const span = lz.In.length ? ` <span class="prod_muted">+ span</span> ${lz.In.map((v) => products_vec_html(lz.target, v, R, "target")).join(`<span class="prod_muted">, </span>`)}` : "";
        html += `<div class="prod_line"><span class="prod_label">Moss</span> ${products_katex(`d_{${R}}\\langle a,b,c\\rangle \\in`)} ${products_vec_html(lz.target, lz.y.vec, R, "target")}${span}</div>`;
        if (lz.known.status === "unknown")
            html += `<div class="prod_note">the chart does not know ${products_katex(`d_{${R}}`)} of it${lz.In.length ? "" : ": the rule determines it (ss deduce massey records it)"}</div>`;
        else
            html += `<div class="${lz.agrees ? "prod_note" : "prod_false"}">the chart has ${products_katex(`d_{${R}}`)} of it ${products_vec_html(lz.target, lz.known.vec, R, "target")}: ${lz.agrees ? "consistent with the rule" : "INCONSISTENT with the rule"}</div>`;
    }
    else
        html += `<div class="prod_note">Moss's rule: ${escapeHtml(lz.note)}</div>`;
    return html;
}

/* find mode: the Massey products that contain bullet [stem,s,k] on the panel's page */
function products_find(stem, s, k) {
    const r = PRODUCTS.page;
    const src = `[${stem},${s},${k}] in <?,?,?>`;
    const status = document.getElementById("products_status");
    status.textContent = "searching the Massey products…";
    products_massey_load().then(() => setTimeout(() => {
        let html;
        try {
            html = products_find_html(stem, s, k, r);
        }
        catch (err) {
            html = `<div class="prod_error">${escapeHtml(err.message)}</div>`;
        }
        status.textContent = "";
        products_push_result(src, html);
    }, 0), (err) => products_show_error(err));
}

function products_find_html(stem, s, k, r) {
    const pg = PRODUCTS.pages, chart = PRODUCTS.chart;
    const rows = chart.rowsAt(stem, s);
    const x = pg.el("S", [stem, s], rows[k].vec);
    const t0 = performance.now();
    const res = pg.search(x, r, { maxPage: 40 });
    const ms = Math.round(performance.now() - t0);
    let html = `<div class="prod_line"><span class="prod_label">class</span> ${products_vec_html([stem, s], x.vec, 2, "input")}</div>`;
    if (res.zero)
        return html + `<div class="prod_note">it is zero on ${products_page_name(r)}</div>`;
    const hits = res.hits.slice().sort((a, b) => a.r0 - b.r0);
    if (hits.length === 0)
        html += `<div class="prod_note">in no Massey product of named generators on ${products_page_name(r)}${res.zeroHits.length ? " that misses zero" : ""}</div>`;
    const hitLine = (h) => {
        const q = `<${products_el_expr(h.a)}, ${products_el_expr(h.b)}, ${products_el_expr(h.c)}>`;
        const lam = h.lambda === 1 ? "" : `${h.lambda}\\cdot `;
        return `<div class="prod_line"><span class="prod_label">${products_page_name(h.r0)}</span> ${products_katex(`${lam}x \\in \\langle ${products_el_latex(h.a)},\\ ${products_el_latex(h.b)},\\ ${products_el_latex(h.c)}\\rangle`)} `
            + `<button class="prod_small" data-q="${escapeHtml(q)}" onclick="products_open_query(this)" title="compute it">open</button></div>`;
    };
    for (const h of hits)
        html += hitLine(h);
    const zeroHits = res.zeroHits.slice().sort((a, b) => a.r0 - b.r0);
    if (zeroHits.length)
        html += `<details class="prod_note"><summary>${zeroHits.length} bracket(s) containing zero also contain x</summary>`
            + `<div>each is its indeterminacy a E + E c, so x is in it exactly when x = a y + z c on ${products_page_name(r)}</div>`
            + zeroHits.map(hitLine).join("") + `</details>`;
    const st = res.stats;
    html += `<div class="prod_note">searched: ${pg.e2 ? `${st.e2} exported E_2 bracket(s) at this bidegree` : "no E_2 Massey data exported"}; generator triples formed on E_3 to ${products_page_name(Math.min(r, 40))} with this bidegree (${st.computed} computed${st.errors ? `, ${st.errors} skipped: ${escapeHtml(st.firstError)}` : ""}) in ${ms} ms. Only brackets of named generators are searched; brackets containing zero are listed apart.</div>`;
    return html;
}

function products_open_query(button) {
    document.getElementById("products_input").value = button.dataset.q;
    on_products_compute();
}

/* ------------------------------------------------------------------ chart interaction */

function products_clear_highlight() {
    document.getElementById("g_products_hl").innerHTML = "";
}

/* circles under the bullets the newest result refers to */
function products_apply_highlight(card) {
    products_clear_highlight();
    const g = document.getElementById("g_products_hl");
    const seen = new Set();
    for (const chip of card.querySelectorAll(".prod_chip")) {
        const local = Number(chip.dataset.local);
        if (seen.has(local))
            continue;
        seen.add(local);
        const b = PRODUCTS.data.bullets[local];
        if (!b)
            continue;
        const kind = [...chip.classList].find((c) => c.startsWith("prod_hl_")) || "prod_hl_result";
        g.insertAdjacentHTML("beforeend", `<circle class="${kind}" cx="${b.x}" cy="${b.y}" r="${b.r * 1.9}" stroke-width="${b.r / 2}"></circle>`);
    }
}

/* centre the chart on a chip's bullet */
function products_goto(chip) {
    const local = Number(chip.dataset.local);
    const b = PRODUCTS.data.bullets[local];
    if (!b)
        return;
    const pivot = camera.world2svg(new Vector(b.x, b.y));
    camera.translate(new Vector(CONFIG.margin + (window.innerWidth - CONFIG.margin) / 2 - pivot.x, CONFIG.margin + (window.innerHeight - CONFIG.margin) / 2 - pivot.y));
    const g = document.getElementById("g_products_hl");
    g.insertAdjacentHTML("beforeend", `<circle class="prod_hl_flash" cx="${b.x}" cy="${b.y}" r="${b.r * 3}" stroke-width="${b.r / 2}"></circle>`);
    setTimeout(() => {
        const flash = g.querySelector(".prod_hl_flash");
        if (flash)
            flash.remove();
    }, 1200);
}

/* ------------------------------------------------------------------ live products for the chart
 * A chart exported with `prods=lines` carries only the structure-line products ("l": 1). The
 * products with the click-only multipliers (ss.json's plot_factors[1]) are computed here instead:
 * on selecting a bullet (products_click, called from main.js's select_bullet) and when such a
 * multiplier is switched on in the "Lines…" picker (products_factor_lines, from drawFactorLines).
 * Both reproduce exactly what the exporter wrote before (scripts/products_js/harness.js, test C):
 * the product in the staircase rows of its bidegree, drawn on the rows it involves. */

/* the multipliers as polynomials, from their names, cached */
function products_factor_poly(j) {
    PRODUCTS.factorPolys = PRODUCTS.factorPolys || new Map();
    if (!PRODUCTS.factorPolys.has(j)) {
        let poly = null;
        try {
            poly = PRODUCTS.ev.evaluate(PRODUCTS.data.names_factors[j]).value.poly;
        }
        catch (err) {
            console.warn(`factor ${j} '${PRODUCTS.data.names_factors[j]}': ${err.message}`);
        }
        PRODUCTS.factorPolys.set(j, poly);
    }
    return PRODUCTS.factorPolys.get(j);
}

/* bullet (local index) times multiplier j: the local indices of the rows of the product, or [] */
function products_times_factor(local, j) {
    const data = PRODUCTS.data, chart = PRODUCTS.chart, ring = PRODUCTS.ring, module = PRODUCTS.module;
    const f = products_factor_poly(j);
    const b = data.bullets[local];
    if (!f || !b)
        return [];
    const stem = Math.round(b.x), s = Math.round(b.y), k = local - b.i0;
    const [fstem, fs] = data.degs_factors[j];
    const degP = [stem + fstem, s + fs];
    if (!chart.hasDeg(degP[0], degP[1]))
        return [];
    try {
        const rows = chart.rowsAt(stem, s);
        const src = chart.fromVec(rows[k].vec, [stem, s]);
        const prod = module ? module.mul(f, src) : ring.mul(f, src);
        if (SSAlg.isZero(prod))
            return [];
        const vec = chart.toVec(prod, degP);
        const trows = chart.rowsAt(degP[0], degP[1]);
        const inv = SSAlg.getInvImage(trows.map((r) => r.vec), vec, ring.p);
        return inv.inds.map((t) => trows[t].local);
    }
    catch (err) {
        if (err instanceof SSAlg.NoBasis || err instanceof SSAlg.NotLoaded)
            return []; /* as the exporter: an unnamed class or an unloaded bidegree draws nothing */
        throw err;
    }
}

/* the click-only multipliers' products of the selected bullet, as select_bullet draws the others */
function products_click(bullet) {
    const data = PRODUCTS.data;
    if (!data || !data.alg)
        return;
    products_load().then(() => {
        if (bullet_selected !== bullet)
            return; /* the selection moved on while the sidecar loaded */
        const local = Number(bullet.dataset.i);
        let html = "";
        for (let j = data.n_lines_factors; j < data.degs_factors.length; ++j)
            for (const i of products_times_factor(local, j)) {
                const bullet2 = data.bullets[i];
                if (bullet2.p < CONFIG_DYNAMIC.page)
                    continue; /* only classes still present on the page shown, as in select_bullet */
                html += `<circle class="p" cx="${bullet2.x}" cy="${bullet2.y}" r="${bullet2.r * 1.7}" data-i="${i}"></circle>`;
            }
        g_prod.insertAdjacentHTML("beforeend", html);
    }, (err) => console.warn(err));
}

/* every bullet times multiplier j, as structure lines; batched so the chart stays responsive */
function products_factor_lines(chart, j) {
    const data = chart.data_json;
    if (!data || !data.alg || data !== PRODUCTS.data)
        return;
    const title = document.getElementById("div_factors_title");
    const titleText = title ? title.textContent : "";
    if (title)
        title.textContent = `${titleText} (computing ${data.names_factors[j]}…)`;
    products_load().then(() => {
        const xshift = "shift" in data ? data.shift : 0;
        const xfactor = "factor" in data ? data.factor : 1;
        const trans = (x) => ((x - Math.round(x)) + Math.round(x) * xfactor + xshift);
        const parts = [];
        let i = 0;
        const step = () => {
            const end = Math.min(i + 2000, data.bullets.length);
            for (; i < end; ++i) {
                const bullet1 = data.bullets[i];
                for (const t of products_times_factor(i, j)) {
                    const bullet2 = data.bullets[t];
                    const width = Math.min(bullet1.r, bullet2.r) / 4;
                    const page = Math.min(bullet1.p, bullet2.p);
                    parts.push(`<line class="p sl ${data.class}" x1="${trans(bullet1.x)}" y1="${bullet1.y}" x2="${trans(bullet2.x)}" y2="${bullet2.y}" stroke="black" stroke-width="${width}" data-page="${page}" data-cw="${data.class}" data-j="${j}" style="visibility:hidden"> </line>`);
                }
            }
            if (i < data.bullets.length)
                setTimeout(step, 0);
            else {
                g_strtlines.insertAdjacentHTML("beforeend", parts.join(""));
                if (title)
                    title.textContent = titleText;
                updateVisibility();
            }
        };
        step();
    }, (err) => {
        if (title)
            title.textContent = titleText;
        console.warn(err);
    });
}
