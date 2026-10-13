/* graph.js -- the chart viewer's "Graph" panel: draw curves s = f(n) over the chart.
 *
 * Each row of the panel is one curve: a colour, and a formula in n (the stem) for s (the Adams
 * filtration), e.g. "s = n/(2p-2) + 1" or "n/q + 3". Curves are drawn at 70% opacity in the chart's
 * own coordinates (x = stem, y = s), with a stroke that keeps its screen width at every zoom.
 *
 * The formula is parsed here, never eval'd. Grammar:
 *   numbers; n (also x); p (the chart's prime); q = 2(p-1); pi; e;
 *   + - * / ^ (right-associative) and parentheses; implicit multiplication ("2n", "3(n+1)", "n p");
 *   functions sqrt, cbrt, abs, floor, ceil, round, exp, ln, log (natural), log2, log10, logp
 *   (log base p), sin, cos, tan, min, max.
 *
 * ?graph=<f1>;<f2>  (optionally <f>@<#rrggbb>) adds those curves at load, so a view can be linked.
 *
 * Reads main.js's globals: CONFIG, DATA_JSON, URL_PARAMS, escapeHtml.
 */
"use strict";

const GRAPH = {
    rows: [],     /* {id, expr, color, fn, error} */
    nextId: 0,
};

/* the first curve is white (meant for the dark theme); later ones cycle through hues that read on both */
const GRAPH_COLORS = ["#ffffff", "#ff7f0e", "#2ca02c", "#d62728", "#9467bd", "#17becf", "#e377c2", "#bcbd22"];
const GRAPH_OPACITY = 0.7;
const GRAPH_SAMPLES = 20000;

/************************************************************************
 *                       Formula parser
 ***********************************************************************/
const GRAPH_FUNCS = {
    sqrt: Math.sqrt, cbrt: Math.cbrt, abs: Math.abs, floor: Math.floor, ceil: Math.ceil, round: Math.round,
    exp: Math.exp, ln: Math.log, log: Math.log, log2: Math.log2, log10: Math.log10,
    sin: Math.sin, cos: Math.cos, tan: Math.tan, min: Math.min, max: Math.max,
};

function graphTokenize(src) {
    const toks = [];
    const re = /\s*(?:(\d+\.?\d*|\.\d+)|([A-Za-z_][A-Za-z_0-9]*)|(\*\*|[-+*/^(),]))/y;
    let pos = 0;
    while (pos < src.length) {
        if (/^\s*$/.test(src.slice(pos)))
            break;
        re.lastIndex = pos;
        const m = re.exec(src);
        if (!m)
            throw new Error(`unexpected "${src.slice(pos).trim()[0]}"`);
        pos = re.lastIndex;
        if (m[1] !== undefined)
            toks.push({ t: "num", v: parseFloat(m[1]) });
        else if (m[2] !== undefined)
            toks.push({ t: "id", v: m[2] });
        else
            toks.push({ t: "op", v: m[3] === "**" ? "^" : m[3] });
    }
    return toks;
}

/* Recursive descent to a closure (env) => number, env = {n, p}. */
function graphParse(src) {
    const toks = graphTokenize(src);
    let i = 0;
    const peek = () => toks[i];
    const isOp = (v) => toks[i] && toks[i].t === "op" && toks[i].v === v;
    const expect = (v) => {
        if (!isOp(v))
            throw new Error(`expected "${v}"`);
        ++i;
    };
    const startsAtom = () => {
        const t = peek();
        return t && (t.t === "num" || t.t === "id" || (t.t === "op" && t.v === "("));
    };

    function expr() {
        let f = term();
        while (isOp("+") || isOp("-")) {
            const op = toks[i++].v, a = f, b = term();
            f = op === "+" ? (e) => a(e) + b(e) : (e) => a(e) - b(e);
        }
        return f;
    }
    function term() {
        let f = unary();
        for (;;) {
            if (isOp("*") || isOp("/")) {
                const op = toks[i++].v, a = f, b = unary();
                f = op === "*" ? (e) => a(e) * b(e) : (e) => a(e) / b(e);
            }
            else if (startsAtom()) { /* implicit multiplication */
                const a = f, b = power();
                f = (e) => a(e) * b(e);
            }
            else
                return f;
        }
    }
    function unary() {
        if (isOp("-")) {
            ++i;
            const a = unary();
            return (e) => -a(e);
        }
        if (isOp("+")) {
            ++i;
            return unary();
        }
        return power();
    }
    function power() {
        const a = atom();
        if (isOp("^")) {
            ++i;
            const b = unary(); /* right-associative, and 2^-n works */
            return (e) => Math.pow(a(e), b(e));
        }
        return a;
    }
    function atom() {
        const t = peek();
        if (!t)
            throw new Error("unexpected end of formula");
        if (t.t === "num") {
            ++i;
            const v = t.v;
            return () => v;
        }
        if (t.t === "op" && t.v === "(") {
            ++i;
            const a = expr();
            expect(")");
            return a;
        }
        if (t.t === "id") {
            ++i;
            const name = t.v;
            if (isOp("(")) {
                ++i;
                const args = [expr()];
                while (isOp(",")) {
                    ++i;
                    args.push(expr());
                }
                expect(")");
                if (name === "logp") {
                    if (args.length !== 1)
                        throw new Error("logp takes one argument");
                    return (e) => Math.log(args[0](e)) / Math.log(e.p);
                }
                const fn = GRAPH_FUNCS[name];
                if (!fn)
                    throw new Error(`unknown function "${name}"`);
                return (e) => fn(...args.map((a) => a(e)));
            }
            switch (name) {
                case "n": case "x": return (e) => e.n;
                case "p": return (e) => e.p;
                case "q": return (e) => 2 * (e.p - 1);
                case "pi": return () => Math.PI;
                case "e": return () => Math.E;
            }
            throw new Error(`unknown name "${name}" (the variable is n)`);
        }
        throw new Error(`unexpected "${t.v}"`);
    }

    const f = expr();
    if (i < toks.length)
        throw new Error(`unexpected "${toks[i].v}"`);
    return f;
}

/* "s = f(n)" or just "f(n)" */
function graphCompile(text) {
    const body = text.replace(/^\s*s\s*=/, "");
    if (/^\s*$/.test(body))
        return null;
    return graphParse(body);
}

/************************************************************************
 *                       Drawing
 ***********************************************************************/
function graphPrime() {
    const p = Number(DATA_JSON && DATA_JSON.prime);
    return Number.isFinite(p) && p > 1 ? p : 2;
}

/* The stems to draw over: the chart's range when it says, else the whole grid */
function graphStemMax() {
    let m = 0;
    if (DATA_JSON && Array.isArray(DATA_JSON.degs))
        for (const d of DATA_JSON.degs)
            m = Math.max(m, d[1]);
    if (!(m > 0) && DATA_JSON && DATA_JSON.t_max > 0)
        m = DATA_JSON.t_max;
    return m > 0 ? Math.min(CONFIG.x_max, m + 20) : CONFIG.x_max;
}

/* SVG path data for y = fn(x), x in [0, xMax]: a new subpath wherever fn is undefined or leaves the grid */
function graphPath(fn) {
    const xMax = graphStemMax(), yMin = -1, yMax = CONFIG.y_max_grid + 1, p = graphPrime();
    const step = Math.max(0.05, xMax / GRAPH_SAMPLES);
    const env = { n: 0, p };
    const parts = [];
    let pen = false;
    for (let k = 0; ; ++k) {
        const x = Math.min(k * step, xMax);
        env.n = x;
        const y = fn(env);
        if (Number.isFinite(y) && y >= yMin && y <= yMax) {
            parts.push(`${pen ? "L" : "M"}${+x.toFixed(3)} ${+y.toFixed(4)}`);
            pen = true;
        }
        else
            pen = false;
        if (x >= xMax)
            break;
    }
    return parts.join("");
}

function graphRedraw() {
    const g = document.getElementById("g_graphs");
    let html = "";
    for (const row of GRAPH.rows) {
        if (!row.fn)
            continue;
        const d = graphPath(row.fn);
        if (d)
            html += `<path d="${d}" stroke="${row.color}" stroke-opacity="${GRAPH_OPACITY}" stroke-width="2" vector-effect="non-scaling-stroke" fill="none" stroke-linejoin="round"></path>`;
    }
    g.innerHTML = html;
}

/************************************************************************
 *                       Panel
 ***********************************************************************/
function graphRenderRows() {
    const list = document.getElementById("div_graph_list");
    list.innerHTML = GRAPH.rows.map((row) =>
        `<div class="graph_row" data-id="${row.id}">`
        + `<input type="color" value="${row.color}" title="Colour" oninput="on_graph_color(event)">`
        + `<span class="graph_s">s =</span>`
        + `<input type="text" class="graph_expr" spellcheck="false" autocomplete="off" placeholder="f(n), e.g. n/q + 1" value="${escapeHtml(row.expr).replace(/"/g, "&quot;")}" onkeydown="on_graph_key(event)" onchange="on_graph_expr(event)">`
        + `<button onclick="on_graph_remove(event)" title="Remove this curve">&times;</button>`
        + `<div class="graph_err">${row.error ? escapeHtml(row.error) : ""}</div>`
        + `</div>`).join("");
}

function graphRowOf(event) {
    const id = +event.target.closest(".graph_row").dataset.id;
    return GRAPH.rows.find((r) => r.id === id);
}

function graphSetExpr(row, text) {
    row.expr = text;
    try {
        row.fn = graphCompile(text);
        row.error = null;
        if (row.fn)
            row.fn({ n: 1, p: graphPrime() }); /* surface errors that only show when called */
    }
    catch (err) {
        row.fn = null;
        row.error = err.message;
    }
}

function graphAdd(expr, color) {
    const row = { id: GRAPH.nextId++, expr: "", color: color || GRAPH_COLORS[GRAPH.rows.length % GRAPH_COLORS.length], fn: null, error: null };
    graphSetExpr(row, expr || "");
    GRAPH.rows.push(row);
    return row;
}

function on_toggle_graph() {
    const div = document.getElementById("div_graph");
    const show = div.style.visibility !== "visible";
    if (show && typeof closeOtherPanels === "function")
        closeOtherPanels("div_graph");
    div.style.visibility = show ? "visible" : "hidden";
    if (show && GRAPH.rows.length === 0) {
        graphAdd("");
        graphRenderRows();
    }
    if (show) {
        const inputs = document.querySelectorAll("#div_graph_list .graph_expr");
        if (inputs.length)
            inputs[inputs.length - 1].focus();
    }
}

function on_graph_add() {
    graphAdd("");
    graphRenderRows();
    const inputs = document.querySelectorAll("#div_graph_list .graph_expr");
    inputs[inputs.length - 1].focus();
}

function on_graph_clear() {
    GRAPH.rows = [];
    graphAdd("");
    graphRenderRows();
    graphRedraw();
}

function on_graph_remove(event) {
    const row = graphRowOf(event);
    GRAPH.rows = GRAPH.rows.filter((r) => r !== row);
    graphRenderRows();
    graphRedraw();
}

function on_graph_color(event) {
    graphRowOf(event).color = event.target.value;
    graphRedraw();
}

function on_graph_expr(event) {
    const row = graphRowOf(event);
    graphSetExpr(row, event.target.value);
    event.target.parentElement.querySelector(".graph_err").textContent = row.error || "";
    graphRedraw();
}

function on_graph_key(event) {
    if (event.key === "Enter")
        on_graph_expr(event);
}

/* ?graph=n/q+1;2n/3@#ff0000 */
function initGraph() {
    const want = URL_PARAMS.get("graph");
    if (!want)
        return;
    for (const part of want.split(";")) {
        const at = part.lastIndexOf("@");
        const color = at >= 0 && /^#[0-9a-fA-F]{6}$/.test(part.slice(at + 1)) ? part.slice(at + 1) : null;
        graphAdd(color ? part.slice(0, at) : part, color);
    }
    graphRenderRows();
    graphRedraw();
}
