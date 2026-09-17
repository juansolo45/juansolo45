/* SOURCE OF TRUTH: <repo>/webpages/plot_assets/main.js
 * The copy next to the `ss` binary (build/bin/webpages/...) is written by ss's POST_BUILD step
 * and is overwritten on every build -- edit the tracked one and rebuild, not this. */
/* created by Weinan Lin */

var STATE = "start";

/************************************************************************
 *                          config variables
 ***********************************************************************/
const URL_PARAMS = new URLSearchParams(window.location.search);
const DATA_NAME = URL_PARAMS.get("data") || "S0";
const COUNT_MAPS = DATA_NAME.split("__").length - 1;
const MODE = ["ss", "map", "cofseq"][COUNT_MAPS];
var DATA_JSON = {};

const CONFIG = {
    /* The largest stem the chart can be panned to, and the extent of the grid. It is a bound on the
     * VIEWER, not on the data: `ss plot_ss` exports every stem it has, so a chart whose data runs
     * past this simply cannot be scrolled to the rest. A cofseq chart interleaves the three terms of
     * the triangle at 3 columns per stem (see `x2stem`), so its axis is 3x as wide. */
    x_max: MODE === "cofseq" ? 2000 * 3 : 2000,
    x_min_cofseq: [0, 0, 0],
    y_max: 300,
    y_max_grid: 300,
    x_max_init: 80,
    margin: 30,
    axis_text_sep_screen: 60,
    camera_zoom_rate: navigator.userAgent.match("Macintosh") ? 1.1 : 1.2,
    camera_translate_pixels: 100,
    R_PERM: 1000,
    plot_batchSize: 1000,
};

const CONFIG_DYNAMIC = {
    status: "start",
    camera_unit_screen_init: (window.innerWidth - CONFIG.margin) / (CONFIG.x_max_init + 1),
    camera_unit_screen_min:
        (window.innerWidth - CONFIG.margin) / (CONFIG.x_max + 1),
    camera_unit_screen_max: Math.min(window.innerWidth, window.innerHeight) - 30,
    page: 2,
    dashedLevel: 5,
    showLines: "All diff",
};


/************************************************************************
 *                          elements
 ***********************************************************************/

const svg_ss = document.getElementById("svg_ss");
svg_ss.setAttribute("width", window.innerWidth);
svg_ss.setAttribute("height", window.innerHeight);
const g_svg = document.getElementById("g_svg");
g_svg.setAttribute(
    "transform",
    "translate(0," + window.innerHeight + ") scale(1,-1)"
);
const g_plot = document.getElementById("g_plot");
const g_bullets = {
    "black": document.getElementById("g_bullets_black"),
    "blue": document.getElementById("g_bullets_blue"),
    "grey": document.getElementById("g_bullets_grey"),
};
const g_strtlines = document.getElementById("g_strtlines");
const g_strtlines_purple = document.getElementById("g_strtlines_purple");
const g_labels = document.getElementById("g_labels");
const g_xaxis = document.getElementById("g_xaxis");
const g_yaxis = document.getElementById("g_yaxis");
const g_diff_lines = {
    0: document.getElementById("g_difflines_black"), ////////
    1: document.getElementById("g_difflines_blue"), ////////
    2: document.getElementById("g_difflines_deepskyblue"),
    3: document.getElementById("g_difflines_red"),
    4: document.getElementById("g_difflines_green"),
    5: document.getElementById("g_difflines_blue"),
    6: document.getElementById("g_difflines_orange"),
};

/* Differential-proof panel (see show_proof below). */
const g_diffhits = document.getElementById("g_diffhits");
const div_proof = document.getElementById("div_proof");
const div_proof_title = document.getElementById("div_proof_title");
const div_proof_body = document.getElementById("div_proof_body");

/* Structure-line factor picker (see the FACTORS block below). */
const div_factors = document.getElementById("div_factors");
const div_factors_list = document.getElementById("div_factors_list");
const button_factors = document.getElementById("button_factors");
const div_factors_title = document.getElementById("div_factors_title");

const div_binfo_style = document.getElementById("div_binfo").style;
const circle_mouseon = document.getElementById("circle_mouseon");
const rect_selected = document.getElementById("rect_selected");
const p_deg = document.getElementById("p_deg");
const p_base = document.getElementById("p_base");
const p_latex = document.getElementById("p_latex");
const p_diff = document.getElementById("p_diff");
const g_prod = document.getElementById("g_prod");
const g_map = document.getElementById("g_map");
const div_menu_style = document.getElementById("div_menu").style;

const rect_separator = document.getElementById("rect_separator");
const rect_second_ss = document.getElementById("rect_second_ss");
const select_page = document.getElementById("select_page");

const rect_shade = document.getElementById("rect_shade");

/* Resize window */
function windowResize() {
    svg_ss.setAttribute("width", window.innerWidth);
    svg_ss.setAttribute("height", window.innerHeight);
    g_svg.setAttribute(
        "transform",
        "translate(0," + window.innerHeight + ") scale(1,-1)"
    );
    CONFIG_DYNAMIC.camera_unit_screen_min = (window.innerWidth - CONFIG.margin) / (CONFIG.x_max + 1);
    CONFIG_DYNAMIC.camera_unit_screen_max = Math.min(window.innerWidth, window.innerHeight) - 30;
}
window.addEventListener("resize", windowResize);

/************************************************************************
 *                            camera
 ***********************************************************************/

/** 2d Vector */
class Vector {
    constructor(x, y) {
        this.x = x || 0;
        this.y = y || 0;
    }
    add(v) {
        return new Vector(this.x + v.x, this.y + v.y);
    }
    addV2(x, y) {
        return new Vector(this.x + x, this.y + y);
    }
    sub(v) {
        return new Vector(this.x - v.x, this.y - v.y);
    }
    mul(r) {
        return new Vector(this.x * r, this.y * r);
    }
    dist(v) {
        return Math.sqrt(
            (this.x - v.x) * (this.x - v.x) + (this.y - v.y) * (this.y - v.y)
        );
    }
    interpolate(v, t) {
        return new Vector(this.x * (1 - t) + v.x * t, this.y * (1 - t) + v.y * t);
    }
}

/** Clip value `x` by [min_, max_]. */
function clip(x, min_, max_) {
    if (x < min_) {
        return min_;
    } else if (x > max_) {
        return max_;
    } else {
        return x;
    }
}

const camera = {
    /* The svg length of the world unit */
    unit_svg: CONFIG_DYNAMIC.camera_unit_screen_init,
    /* The svg position of the world origin */
    o_svg: new Vector(
        CONFIG.margin + 0.5 * CONFIG_DYNAMIC.camera_unit_screen_init,
        CONFIG.margin + 0.5 * CONFIG_DYNAMIC.camera_unit_screen_init
    ),
    zoom: function (pivotSvg /* Vector */, rate) {
        let unit_svg1 = clip(
            this.unit_svg * rate,
            CONFIG_DYNAMIC.camera_unit_screen_min,
            CONFIG_DYNAMIC.camera_unit_screen_max
        );
        let rate1 = unit_svg1 / this.unit_svg;
        this.unit_svg = unit_svg1;

        let origin_sp1 = pivotSvg.add(this.o_svg.sub(pivotSvg).mul(rate1));
        let x_min = window.innerWidth - (CONFIG.x_max + 0.5) * this.unit_svg;
        let x_max = CONFIG.margin + 0.5 * this.unit_svg;
        let y_min = window.innerHeight - (CONFIG.y_max + 0.5) * this.unit_svg;
        let y_max = CONFIG.margin + 0.5 * this.unit_svg;
        if (y_min > y_max) { y_min = y_max; }
        this.o_svg = new Vector(
            clip(origin_sp1.x, x_min, x_max),
            clip(origin_sp1.y, y_min, y_max)
        );

        camera.setTransform();
        updateAxisLabels();
    },
    translate: function (deltaSvg /* Vector */) {
        origin_sp1 = this.o_svg.add(deltaSvg);
        let x_min = window.innerWidth - (CONFIG.x_max + 0.5) * this.unit_svg;
        let x_max = CONFIG.margin + 0.5 * this.unit_svg;
        let y_min = window.innerHeight - (CONFIG.y_max + 0.5) * this.unit_svg;
        let y_max = CONFIG.margin + 0.5 * this.unit_svg;
        if (y_min > y_max) { y_min = y_max; }
        this.o_svg = new Vector(
            clip(origin_sp1.x, x_min, x_max),
            clip(origin_sp1.y, y_min, y_max)
        );

        camera.setTransform();
        updateAxisLabels();
    },
    world2svg: function (ptWorld /* Vector */) {
        return this.o_svg.add(ptWorld.mul(this.unit_svg));
    },
    svg2world: function (ptSvg /* Vector */) {
        return ptSvg.sub(this.o_svg).mul(1 / this.unit_svg);
    },
    flip: function (ptScreen /* Vector */) {
        return new Vector(ptScreen.x, window.innerHeight - ptScreen.y);
    },
    world2svg_v2: function (wpx, wpy) {
        let world_pos = new Vector(wpx, wpy);
        return this.o_svg.add(world_pos.mul(this.unit_svg));
    },
    svg2world_v2: function (spx, spy) {
        let screen_pos = new Vector(spx, spy);
        return screen_pos.sub(this.o_svg).mul(1 / this.unit_svg);
    },
    setTransform: function () {
        g_plot.setAttribute("transform", `translate(${this.o_svg.x},${this.o_svg.y}) scale(${this.unit_svg})`);
    },
};

camera.setTransform();

function getAxisNumber(x) {
    if (MODE === "map") {
        if (x < DATA_JSON.sep_right)
            return x - DATA_JSON["cw2"].shift;
        else
            return x - 1;
    }
    else if (MODE === "cofseq") {
        return Math.floor(x / 3) + CONFIG.x_min_cofseq[x % 3];
    }
    else {
        return x;
    }
}

function updateAxisLabels() {
    var stepLabel = Math.ceil(CONFIG.axis_text_sep_screen / camera.unit_svg);
    if (MODE === "cofseq") {
        if (stepLabel > 3)
            stepLabel = Math.floor(stepLabel / 3) * 3;
        else if (stepLabel == 2)
            stepLabel = 3;
    }
    let i_min = Math.ceil(camera.svg2world(new Vector(30, 0)).x / stepLabel) * stepLabel;
    let i_max = Math.floor(camera.svg2world(new Vector(window.innerWidth, 0)).x);
    g_xaxis.innerHTML = "";
    for (let i = i_min; i <= i_max; i += stepLabel) {
        let xText = camera.world2svg(new Vector(i, 0)).x;
        let label = `<text x="${xText}" y="-10">${getAxisNumber(i)}</text>\n`;
        g_xaxis.insertAdjacentHTML("beforeend", label);
    }
    i_min = Math.ceil(camera.svg2world(new Vector(0, 30)).y / stepLabel) * stepLabel;
    i_max = Math.floor(camera.svg2world(new Vector(0, window.innerHeight)).y);
    g_yaxis.innerHTML = "";
    for (let i = i_min; i <= i_max; i += stepLabel) {
        let yText = camera.world2svg(new Vector(0, i)).y;
        let label = `<text x="26" y="${-yText}" dy="0.25em">${i}</text>\n`;
        g_yaxis.insertAdjacentHTML("beforeend", label);
    }
}

function latexMon(mon, data_json) {
    if (mon.length === 0) {
        return "1";
    }
    else {
        result = "";
        const gen_names = data_json["gen_names"];
        for (let i = 0; i < mon.length - 1; i += 2) {
            if (mon[i + 1] == 1) {
                result += `${gen_names[mon[i]]}`;
            }
            else if (mon[i + 1] < 10) {
                result += `${gen_names[mon[i]]}^${mon[i + 1]}`;
            }
            else {
                result += `${gen_names[mon[i]]}^{${mon[i + 1]}}`;
            }
        }
        if (mon.length % 2 === 1) {
            result += `${data_json["v_names"][mon[mon.length - 1]]}`;
        }
        return result;
    }
}

function mon_no_h012(mon, data_json) {
    const gen_names = data_json["gen_names"];
    for (let i = 0; i < mon.length - 1; i += 2) {
        if (gen_names[mon[i]] == "h_0" || gen_names[mon[i]] == "h_1" || gen_names[mon[i]] == "h_2") {
            if (mon[i + 1] > 1 || mon.length > 2)
                return false;
        }
    }
    return true;
}

function getJsonForBullet(bullet) {
    if (bullet.classList.contains("cw")) {
        return DATA_JSON;
    }
    else if (bullet.classList.contains("cw1")) {
        return DATA_JSON["cw1"];
    }
    else if (bullet.classList.contains("cw2")) {
        return DATA_JSON["cw2"];
    }
    else if (bullet.classList.contains("cs0")) {
        return DATA_JSON["cofseq_groups"][0];
    }
    else if (bullet.classList.contains("cs1")) {
        return DATA_JSON["cofseq_groups"][1];
    }
    else if (bullet.classList.contains("cs2")) {
        return DATA_JSON["cofseq_groups"][2];
    }
    else{
        console.log("Error in getJsonForBullet: ", bullet);
    }
}

function latexBullet(bullet) {
    const data_json = getJsonForBullet(bullet);
    const bullet_json = data_json["bullets"][bullet.dataset.i];
    const basis_json = data_json["basis"];
    let str_base = "";
    const offset_X = parseInt(bullet_json["i0"]);
    for (let i = 0; i < bullet_json["b"].length; ++i) {
        if (i > 0) {
            str_base += "+";
        }
        str_base += latexMon(basis_json[offset_X + parseInt(bullet_json["b"][i])], data_json);
    }
    return str_base;
}

function latexBullet_no_h012(bullet) {
    const data_json = getJsonForBullet(bullet);
    const bullet_json = data_json["bullets"][bullet.dataset.i];
    if (bullet_json["b"].length > 1)
        return "";
    const basis_json = data_json["basis"];
    const offset_X = parseInt(bullet_json["i0"]);
    if (!mon_no_h012(basis_json[offset_X + parseInt(bullet_json["b"][0])], data_json))
        return "";
    return latexMon(basis_json[offset_X + parseInt(bullet_json["b"][0])], data_json);
}

function replaceAll(str, find, replace) {
    return str.replace(new RegExp(find, 'g'), replace);
}

/* The LaTeX letter macros as literal characters. Shared by the bullet labels (which then also
 * flatten subscripts, since SVG text has no <sub>) and by the factor picker (which renders them
 * as real subscripts instead). */
function latexGreek(str_mon) {
    str_mon = replaceAll(str_mon, /\\Delta\s?/, "Δ");
    str_mon = replaceAll(str_mon, /\\mu\s?/, "μ");
    str_mon = replaceAll(str_mon, /\\rho\s?/, "ρ");
    str_mon = replaceAll(str_mon, /\\iota\s?/, "ι");
    str_mon = replaceAll(str_mon, /\\eta\s?/, "η");
    str_mon = replaceAll(str_mon, /\\nu\s?/, "ν");
    str_mon = replaceAll(str_mon, /\\bar\\sigma\s?/, "σ&#772");
    str_mon = replaceAll(str_mon, /\\sigma\s?/, "σ");
    str_mon = replaceAll(str_mon, /\\epsilon\s?/, "ε");
    str_mon = replaceAll(str_mon, /\\theta\s?/, "θ");
    str_mon = replaceAll(str_mon, /\\bar\\kappa\s?/, "κ&#772");
    str_mon = replaceAll(str_mon, /\\kappa\s?/, "κ");
    str_mon = replaceAll(str_mon, /\\zeta\s?/, "ζ");
    str_mon = replaceAll(str_mon, /\^\\prime\s?/, "'");
    str_mon = replaceAll(str_mon, /\^\{\\prime\\prime}\s?/, "''");
    return str_mon;
}

/* One factor's name as HTML: h_0 -> h<sub>0</sub>, x_{8,1} -> x<sub>8,1</sub>, b^2 -> b<sup>2</sup>.
 * The names come from the chart's own database, but they are still data, so the escape comes
 * first and only the tags this function itself adds survive. */
function latexToHtmlName(name) {
    let out = name.replace(/&(?!#\d+;?)/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
    out = latexGreek(out);
    out = out.replace(/_\{([^}]*)\}/g, "<sub>$1</sub>").replace(/_(\w)/g, "<sub>$1</sub>");
    out = out.replace(/\^\{([^}]*)\}/g, "<sup>$1</sup>").replace(/\^(\w)/g, "<sup>$1</sup>");
    return out;
}

/* The LaTeX-ish names in the data files rendered for an SVG label: \eta -> η, h_0 -> h0, etc.
 * Factored out of addBulletLabels so the picker can share the letter half above. */
function prettifyLatex(str_mon) {
    str_mon = latexGreek(str_mon);
    str_mon = replaceAll(str_mon, /\\mu\s?/, "μ");
    str_mon = replaceAll(str_mon, /\\rho\s?/, "ρ");
    str_mon = replaceAll(str_mon, /\\iota\s?/, "ι");
    str_mon = replaceAll(str_mon, /\\eta\s?/, "η");
    str_mon = replaceAll(str_mon, /\\nu\s?/, "ν");
    str_mon = replaceAll(str_mon, /\\bar\\sigma\s?/, "σ&#772");
    str_mon = replaceAll(str_mon, /\\sigma\s?/, "σ");
    str_mon = replaceAll(str_mon, /\\epsilon\s?/, "ε");
    str_mon = replaceAll(str_mon, /\\theta\s?/, "θ");
    str_mon = replaceAll(str_mon, /\\bar\\kappa\s?/, "κ&#772");
    str_mon = replaceAll(str_mon, /\\kappa\s?/, "κ");
    str_mon = replaceAll(str_mon, /\\zeta\s?/, "ζ");
    str_mon = replaceAll(str_mon, /\^\\prime\s?/, "'");
    str_mon = replaceAll(str_mon, /\^\{\\prime\\prime}\s?/, "''");
    str_mon = replaceAll(str_mon, /_(\d)/, "$1");
    str_mon = replaceAll(str_mon, /_\{(\d\d)\}/, "$1");
    return str_mon;
}

function addBulletLabels() {
    const bullets = document.getElementsByClassName("b");
    g_labels.innerHTML = "";
    for (const bullet of bullets) {
        if (bullet.tagName === "circle" && bullet.id.slice(0, 1) === "b") {
            let str_mon = latexBullet(bullet.id);
            str_mon = prettifyLatex(str_mon);

            const re = /^(?!(P|P\^\d|P\^\d\d|Δ|M|M_1|\()h(0|1|2)).*h(0|1|2)/;
            if (str_mon.length <= 10 && parseFloat(bullet.getAttribute("cx")) <= 127 && !(str_mon.match(re) && str_mon.length > 2)) {
                const r = parseFloat(bullet.getAttribute("r"));
                let class_ = "label";
                if (bullet.classList.contains("b0"))
                    class_ += " label0";
                else if (bullet.classList.contains("b1"))
                    class_ += " label1";
                const label = `<text class="${class_}" x=${parseFloat(bullet.getAttribute("cx")) - r * 0.75} y=${-parseFloat(bullet.getAttribute("cy")) + r * 2} font-size=${r * 1.125} data-page=${bullet.dataset.page}>${str_mon}</text>\n`;
                g_labels.insertAdjacentHTML("beforeend", label);
            }
        }
    }
}

/************************************************************************
 *                     Why a differential holds
 *
 * `ss` records every differential it establishes in log.db together with the
 * reason, and for a deduction the alternatives it refuted on the way. plot.cpp
 * joins that to the chart, so each entry of DATA_JSON["diffs"] may carry a "pf":
 *
 *   {code, x, dx, exact, note?, steps: [{code, x, dx, note?}, ...]}
 *
 * with `code` a key into DATA_JSON["reasons"] = {code: [short, sentence]}.
 * Clicking a differential shows that. Differentials with no "pf" are ones the
 * log does not cover -- it holds only what the most recent deduction run
 * established, and `Adamsp rebuild` starts a fresh one.
 ***********************************************************************/
function escapeHtml(s) {
    return String(s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

/* The x/dx of a log row are coordinates in the staircase basis of their bidegree, stored the way
 * `ss` serializes them: "0" is basis vector 0, "0*3" is 3 times basis vector 0, and the EMPTY
 * string is the zero vector. Rendered in brackets, which is how `ss` itself writes them in the log
 * text quoted right underneath -- `d_2[0]=[]` versus `d_2[0]=[0]`. Printing the empty vector as a
 * bare "0" instead would make those two read identically, which is exactly the distinction the list
 * of refuted alternatives turns on. */
function proofVec(v) {
    return "[" + escapeHtml(v === undefined ? "" : v) + "]";
}

function reasonOf(code) {
    const r = (DATA_JSON["reasons"] || {})[code];
    return r ? { short: r[0], long: r[1] } : { short: code, long: "" };
}

function hide_proof() {
    div_proof.style.visibility = "hidden";
}

/* `iDiff` indexes DATA_JSON["diffs"]; (posX, posY) is where the click landed. */
function show_proof(iDiff, posX, posY) {
    const diff = DATA_JSON["diffs"][iDiff];
    if (diff === undefined)
        return;
    const b1 = DATA_JSON["bullets"][diff["i"]];
    const b2 = DATA_JSON["bullets"][diff["j"][0]];
    div_proof_title.innerHTML = `d<sub>${diff["r"]}</sub> : (${Math.round(b1.x)}, ${Math.round(b1.y)}) &rarr; (${Math.round(b2.x)}, ${Math.round(b2.y)})`;

    const pf = diff["pf"];
    let html = "";
    if (pf === undefined) {
        html += `<p>No recorded proof.</p>`;
        html += `<p class="proof_caveat">log.db covers only the most recent deduction run for this
                 category; a differential established earlier, imported, or entered before the log
                 was last reset has nothing on file here.</p>`;
    }
    else {
        const reason = reasonOf(pf["code"]);
        html += `<p><span class="proof_reason">${escapeHtml(reason.short)}</span>`;
        if (reason.long)
            html += ` &mdash; ${escapeHtml(reason.long)}`;
        html += `</p>`;
          if (pf["code"] === "unavailable") {
              html += `<p class="proof_caveat">No derivation record was saved for this differential, so the chart cannot distinguish a degree, naturality, Adams d2, product, cofiber, or other deduction.</p>`;
          }
          else {
              html += `<p>Logged as d<sub>${diff["r"]}</sub>(${proofVec(pf["x"])}) = ${proofVec(pf["dx"])}`;
              html += ` <span class="factor_deg">(coordinates in the staircase basis)</span></p>`;
          }
        if (pf["note"])
            html += `<div class="proof_note">${escapeHtml(pf["note"])}</div>`;
        if (pf["steps"] && pf["steps"].length) {
            html += `<div class="proof_steps_head">Alternatives ruled out (${pf["steps"].length}):</div><ol>`;
            for (const step of pf["steps"]) {
                html += `<li>d<sub>${diff["r"]}</sub>(${proofVec(step["x"])}) = ${proofVec(step["dx"])}`;
                if (step["note"])
                    html += `<div class="proof_note">${escapeHtml(step["note"])}</div>`;
                html += `</li>`;
            }
            html += `</ol>`;
        }
        if (pf["exact"] === false)
            html += `<p class="proof_caveat">Matched by bidegree and length only: the log entry's
                     coordinates were written against an earlier staircase basis, so if this
                     bidegree carries more than one d<sub>${diff["r"]}</sub> this may describe a
                     different one.</p>`;
    }
    div_proof_body.innerHTML = html;

    /* Keep the panel on screen regardless of where the click landed. Its height depends on how
     * long the proof is, so make it visible first and measure -- a fixed guess overflows the bottom
     * of the window on the long deductions, which are exactly the ones worth reading. */
    const margin = 8;
    div_proof.style.left = "0px";
    div_proof.style.top = "0px";
    div_proof.style.visibility = "visible";
    const h = div_proof.offsetHeight, w = div_proof.offsetWidth;
    div_proof.style.left = Math.max(margin, Math.min(posX + 12, window.innerWidth - w - margin)) + "px";
    div_proof.style.top = Math.max(margin, Math.min(posY + 12, window.innerHeight - h - margin)) + "px";
}

/************************************************************************
 *                   Structure-line factor picker
 *
 * Every chart carries the products of ALL its multipliers (both "plot_factors"
 * lists from ss.json), each tagged in "prods" with the factor that produced it
 * ("j") and with how ss.json wanted it presented ("l": 1 = drawn as a structure
 * line, 0 = shown only as green dots when you select a class). So moving a
 * multiplier between those two presentations is a pure client-side toggle -- no
 * re-plot, no re-export. FACTORS.on holds the set of factor indices currently
 * drawn as lines; it starts as the first `n_lines_factors` of them, which is
 * exactly ss.json's list [0].
 *
 * Lines for a factor are created the first time it is switched on (FACTORS.drawn)
 * and thereafter only hidden/shown, so initial load costs exactly what it did
 * before and a factor you never look at is never built.
 ***********************************************************************/
const FACTORS = {
    active: false,   /* only "ss" mode has a single ring whose factors these are */
    on: new Set(),
    drawn: new Set(),
};

function factorIsOn(j) {
    return !FACTORS.active || FACTORS.on.has(Number(j));
}

/* Create the <line> elements for one factor, over the whole chart. Mirrors the
 * structure-line half of loadPlot, but for a single j and in one pass. */
function drawFactorLines(j) {
    if (FACTORS.drawn.has(j))
        return;
    FACTORS.drawn.add(j);
    const data_json = DATA_JSON;
    /* Same transform loadPlot applies; the identity in "ss" mode, which is the only mode the
     * picker runs in, but kept in step with it rather than silently assuming so. */
    const xshift = "shift" in data_json ? data_json.shift : 0;
    const xfactor = "factor" in data_json ? data_json.factor : 1;
    const trans = (x) => ((x - Math.round(x)) + Math.round(x) * xfactor + xshift);
    let html = "";
    for (const key in data_json["prods"]) {
        for (const line of data_json["prods"][key]) {
            if (line['j'] !== j)
                continue;
            const bullet1 = data_json["bullets"][key];
            for (const i of line["p"]) {
                const bullet2 = data_json["bullets"][i];
                const width = Math.min(bullet1['r'], bullet2['r']) / 4;
                const page = Math.min(bullet1['p'], bullet2['p']);
                html += `<line class="p sl ${data_json.class}" x1="${trans(bullet1.x)}" y1="${bullet1.y}" x2="${trans(bullet2.x)}" y2="${bullet2.y}" stroke="black" stroke-width="${width}" data-page="${page}" data-j="${j}" style="visibility:hidden"> </line>`;
            }
        }
    }
    g_strtlines.insertAdjacentHTML("beforeend", html);
}

function setFactor(j, on) {
    if (on) {
        drawFactorLines(j);
        FACTORS.on.add(j);
    }
    else
        FACTORS.on.delete(j);
    updateVisibility();
}

function on_factor_toggle(event) {
    setFactor(Number(event.target.dataset.j), event.target.checked);
    syncFactorChecks();
}

function on_factors_all(on) {
    for (let j = 0; j < DATA_JSON["degs_factors"].length; ++j) {
        if (on)
            drawFactorLines(j);
        on ? FACTORS.on.add(j) : FACTORS.on.delete(j);
    }
    syncFactorChecks();
    updateVisibility();
}

function on_factors_reset() {
    const n = DATA_JSON["n_lines_factors"] ?? 0;
    FACTORS.on.clear();
    for (let j = 0; j < n; ++j)
        FACTORS.on.add(j);
    syncFactorChecks();
    updateVisibility();
}

function syncFactorChecks() {
    for (const box of div_factors_list.querySelectorAll("input[type=checkbox]"))
        box.checked = FACTORS.on.has(Number(box.dataset.j));
    div_factors_title.textContent = `Structure lines ${FACTORS.on.size}/${DATA_JSON["degs_factors"].length}`;
}

/* Render one row per multiplier: a checkbox, the factor's name, and its (stem, s).
 * Names come from the chart's "names_factors"; they are LaTeX-ish, so run them
 * through the same prettifier the bullet labels use. */
function buildFactorPanel() {
    const degs = DATA_JSON["degs_factors"] || [];
    const names = DATA_JSON["names_factors"] || [];
    if (degs.length === 0) {
        button_factors.style.display = "none";
        return;
    }
    FACTORS.active = true;
    on_factors_reset();
    /* loadPlot draws exactly these, so they must count as already built -- otherwise switching one
     * off and back on would ask drawFactorLines to create a second copy of every one of its lines. */
    FACTORS.drawn = new Set(FACTORS.on);
    let html = "";
    for (let j = 0; j < degs.length; ++j) {
        const name = latexToHtmlName(names[j] !== undefined ? names[j] : `x_{${degs[j][0]},${degs[j][1]}}`);
        html += `<label class="factor_row"><input type="checkbox" data-j="${j}" onchange="on_factor_toggle(event)">` +
                `<span class="factor_name">${name}</span>` +
                `<span class="factor_deg">(${degs[j][0]}, ${degs[j][1]})</span></label>`;
    }
    div_factors_list.innerHTML = html;
    syncFactorChecks();
}

function on_toggle_factors() {
    const showing = div_factors.style.visibility === "visible";
    div_factors.style.visibility = showing ? "hidden" : "visible";
}

function addRects() {
    if (MODE === "ss") { // products
        let i = 0;
        for (const deg of DATA_JSON['degs_factors']) {
            let rect_product = `<rect id="rect_prod${i++}" x="-1000" y="-1000" width="1" height="1" fill="green" opacity="0.1"  data-x="${deg[0]}" data-y="${deg[1]}" />`;
            g_plot.insertAdjacentHTML("afterbegin", rect_product);
        }
    }
    if (MODE === "cofseq") { // color separators
        const rects = [];
        for (let i = 0; i < CONFIG.x_max / 3; i += 2)
            rects.push(`<rect x="${3 * i - 0.5}" y="-0.5" width="3" height="300" fill="#dddddd"/>`);
        g_plot.insertAdjacentHTML("afterbegin", rects.join("\n"));
    }
}

/************************************************************************
 *                       Pointer events
 ************************************************************************/

/* pointers */
const pointerCache = new Array();
var prevPtsDist = null;
var prevPt = null;
var prevPinchScale = null;

/* other globals */
var timerClearCache = null;

function getDistPts() {
    let p1Screen = new Vector(pointerCache[0].clientX, pointerCache[0].clientY);
    let p2Screen = new Vector(pointerCache[1].clientX, pointerCache[1].clientY);
    return p1Screen.dist(p2Screen);
}

function restartTimer() {
    clearTimeout(timerClearCache);
    timerClearCache = window.setTimeout(function () { pointerCache.length = 0; }, 3000);
}

function on_pointerdown(event) {
    if (STATE === "start") {
        if (event.button === 0) {
            div_menu_style.visibility = "hidden";
            div_binfo_style.visibility = "hidden";
            hide_proof();
            if (event.shiftKey && "sep_right" in DATA_JSON) {
                DATA_JSON.sep_right = Math.ceil(camera.svg2world_v2(event.clientX, 0).x);
                updateVisibility();
                updateAxisLabels();
            }

            /* This event is cached to support 2-finger gestures */
            pointerCache.push(event);

            if (pointerCache.length === 1) {
                prevPt = new Vector(event.clientX, event.clientY);
            }
            else if (pointerCache.length === 2) {
                prevPtsDist = getDistPts();
            }
            restartTimer();
        }
    }
    else if (STATE === "screenshot_start") {
        if (event.button === 0) {
            STATE = "screenshot_first_pt";
            FIRST_PT = new Vector(event.clientX, event.clientY);
            FIRST_PT = camera.svg2world(camera.flip(FIRST_PT));
        }
    }
}

/* This function implements a 2-pointer horizontal pinch/zoom gesture. */
function on_pointermove(event) {
    if (STATE === "start") {
        /* Check if this event is in the cache and update it */
        let index = 0;
        for (; index < pointerCache.length; index++) {
            if (event.pointerId === pointerCache[index].pointerId) {
                pointerCache[index] = event;
                break;
            }
        }

        /* Move only when the only one down pointer moves */
        if (pointerCache.length === 1 && index < pointerCache.length) {
            let curPt = new Vector(event.clientX, event.clientY);
            let deltaScreen = curPt.sub(prevPt);
            camera.translate(new Vector(deltaScreen.x, -deltaScreen.y));
            prevPt = curPt;
        }

        /* If two pointers are down, check for pinch gestures */
        if (pointerCache.length === 2 && index < pointerCache.length) {
            let p1Svg = camera.flip(new Vector(pointerCache[0].clientX, pointerCache[0].clientY));
            let p2Svg = camera.flip(new Vector(pointerCache[1].clientX, pointerCache[1].clientY));
            let curDist = p1Svg.dist(p2Svg);
            camera.zoom(index === 0 ? p2Svg : p1Svg, curDist / prevPtsDist);
            prevPtsDist = curDist;
        }
    }
    else if (STATE === "screenshot_first_pt") {
        SECOND_PT = new Vector(event.clientX, event.clientY);
        SECOND_PT = camera.svg2world(camera.flip(SECOND_PT));
        SCREENSHOT_X_MIN = Math.min(FIRST_PT.x, SECOND_PT.x);
        SCREENSHOT_Y_MIN = Math.min(FIRST_PT.y, SECOND_PT.y);
        SCREENSHOT_X_MAX = Math.max(FIRST_PT.x, SECOND_PT.x);
        SCREENSHOT_Y_MAX = Math.max(FIRST_PT.y, SECOND_PT.y);
        rect_shade.setAttribute("x", SCREENSHOT_X_MIN);
        rect_shade.setAttribute("y", SCREENSHOT_Y_MIN);
        rect_shade.setAttribute("width", Math.abs(SECOND_PT.x - FIRST_PT.x));
        rect_shade.setAttribute("height", Math.abs(SECOND_PT.y - FIRST_PT.y));
    }
}

/**
 * Return if at least one event is removed
 */
function removeEvent(event_id) {
    /* Remove this event from the target's cache */
    for (let i = 0; i < pointerCache.length; i++) {
        if (pointerCache[i].pointerId === event_id) {
            pointerCache.splice(i, 1);
            return true;
        }
    }
    return false;
}

var bullet_selected = null;

function select_bullet(bullet) {
    bullet_selected = bullet;
    bullet_selected.setAttribute("fill", "red");
    rect_selected.setAttribute("x", Math.round(bullet.getAttribute("cx")) - 0.5);
    rect_selected.setAttribute("y", Math.round(bullet.getAttribute("cy")) - 0.5);

    g_prod.innerHTML = "";
    g_map.innerHTML = "";
    // products
    if (MODE == "ss") {
        prods = DATA_JSON["prods"][bullet.dataset.i];
        for (const j in DATA_JSON["degs_factors"]) {
            let rect_prod = document.getElementById(`rect_prod${j}`);
            rect_prod.setAttribute('x', parseFloat(rect_selected.getAttribute("x")) + parseFloat(rect_prod.dataset.x));
            rect_prod.setAttribute('y', parseFloat(rect_selected.getAttribute("y")) + parseFloat(rect_prod.dataset.y));
        }
        for (const j in prods) {
            for (const i of prods[j]['p']) {
                const bullet2 = DATA_JSON["bullets"][i];
                const circle_prod = `<circle class="p" cx="${bullet2.x}" cy="${bullet2.y}" r="${bullet2['r'] * 1.7}", data-i=${i}></circle>`;
                g_prod.insertAdjacentHTML("beforeend", circle_prod);
            }
        }
    }

    // images of maps
    if (bullet.classList.contains("cw1") && Math.round(bullet.getAttribute("cx")) == DATA_JSON.sep_right && bullet.dataset.i in DATA_JSON["maps"]) {
        for (const i of DATA_JSON["maps"][bullet.dataset.i]) {
            const bullet2 = DATA_JSON["cw2"]["bullets"][i];
            const circle_image = `<circle class="p baux cw2" cx="${bullet2.x + DATA_JSON["cw2"].shift}" cy="${bullet2.y}" r="${bullet2['r'] * 1.7}", data-i=${i}></circle>`;
            g_map.insertAdjacentHTML("beforeend", circle_image);
        }
    }
}

function on_pointerup(event) {
    if (STATE === "start") {
        /* Remove this pointer from the cache */
        if (event.button === 0) {
            if (removeEvent(event.pointerId)) {
                if (pointerCache.length === 0) {
                    prevPt = null;
                }
                else if (pointerCache.length === 1) {
                    prevPt = new Vector(pointerCache[0].clientX, pointerCache[0].clientY);
                }
                else if (pointerCache.length === 2) {
                    prevPtsDist = getDistPts();
                }
            }

            const bullet = event.target;
            if (bullet == bullet_selected) {
                /* Info pane */
                const posX = event.clientX;
                const posY = window.innerHeight - event.clientY;

                div_binfo_style.left = posX + "px";
                div_binfo_style.bottom = posY + "px";
                div_binfo_style.visibility = "visible";

                const bullet_json = getJsonForBullet(bullet)["bullets"][bullet.dataset.i];

                p_deg.innerHTML = `Deg: (${getAxisNumber(Math.round(bullet.getAttribute("cx")))},${Math.round(bullet.getAttribute("cy"))})`;
                p_base.innerHTML = `Basis: ${bullet_json['b']}`;
                const str_base = latexBullet(bullet);
                const tex_base = katex.renderToString(str_base, { throwOnError: false });
                p_latex.innerHTML = `LaTeX: ${tex_base}`;

                const level = bullet_json['l'];
                if (level === 5000) { p_diff.innerHTML = `Permanent`; }
                else if (level === 10000 - CONFIG.R_PERM) { p_diff.innerHTML = `Permanent`; }
                else if (level > 10000 - CONFIG.R_PERM) {
                    const r = 10000 - level;
                    let str_diff = `d_{${r}}(\\mathrm{this})=(${bullet_json['d']})`;
                    str_diff = str_diff.replace('null', '?');
                    p_diff.innerHTML = katex.renderToString(str_diff, { throwOnError: false });
                }
                else {
                    const r = level;
                    let str_diff = `d_{${r}}(${bullet_json['d']})=\\mathrm{this}`;
                    str_diff = str_diff.replace('null', '?');
                    p_diff.innerHTML = katex.renderToString(str_diff, { throwOnError: false });
                }
            }
            else if (bullet.classList.contains("dlhit")) {
                show_proof(Number(bullet.dataset.pf), event.clientX, event.clientY);
            }
            else if (bullet.classList.contains("b")) {
                if (bullet_selected !== null) {
                    if (bullet_selected.getAttribute("stroke-width") !== null) {
                        bullet_selected.setAttribute("fill", "transparent");
                    }
                    else {
                        bullet_selected.removeAttribute("fill");
                    }
                    bullet_selected = null;
                }
                select_bullet(bullet);
            }

            restartTimer();
        }
    }
    else if (STATE === "screenshot_first_pt") {
        STATE = "start";
        rect_shade.setAttribute("x", "-10000");
        take_screenshot();
    }
}

function on_wheel(event) {
    let pivotScreen = new Vector(event.clientX, event.clientY);
    let pivotSvg = camera.flip(pivotScreen);
    camera.zoom(pivotSvg, event.deltaY < 0 ? CONFIG.camera_zoom_rate : 1 / CONFIG.camera_zoom_rate);
    event.preventDefault();
}

/* For macbook trackpad pinch gesture */
function on_pinch(event) {
    let pivotScreen = new Vector(event.clientX, event.clientY);
    let pivotSvg = camera.flip(pivotScreen);
    camera.zoom(pivotSvg, event.scale / prevPinchScale);
    prevPinchScale = event.scale;
    event.preventDefault();
}

function on_key_down(event) {
    //console.log(event.which)
    if (!event.shiftKey) {
        if (event.which === 39) { /* Right */
            camera.translate(new Vector(-CONFIG.camera_translate_pixels, 0));
        }
        else if (event.which === 37) { /* Left */
            camera.translate(new Vector(CONFIG.camera_translate_pixels, 0));
        }
        else if (event.which === 38) { /* Up */
            camera.translate(new Vector(0, -CONFIG.camera_translate_pixels));
        }
        else if (event.which === 40) { /* Down */
            camera.translate(new Vector(0, CONFIG.camera_translate_pixels));
        }
        else if (event.which === 189) { /* - */
            const pivotSvg = new Vector(window.innerWidth / 2, window.innerHeight / 2);
            camera.zoom(pivotSvg, 1 / CONFIG.camera_zoom_rate);
        }
        else if (event.which === 187) { /* = */
            const pivotSvg = new Vector(window.innerWidth / 2, window.innerHeight / 2);
            camera.zoom(pivotSvg, CONFIG.camera_zoom_rate);
        }
    }
    if ("from" in DATA_JSON && event.shiftKey) {
        if (event.which === 39) { // Right arrow
            if (DATA_JSON.sep_right < CONFIG.x_max) {
                DATA_JSON.sep_right += 1;
                updateVisibility();
                updateAxisLabels();
            }
        }
        else if (event.which === 37) { // Left arrow
            if (DATA_JSON.sep_right > 1) {
                DATA_JSON.sep_right -= 1;
                updateVisibility();
                updateAxisLabels();
            }
        }
    }
}

function on_pointerenter_bullet(event) {
    let tgt = event.target;
    circle_mouseon.setAttribute("cx", tgt.getAttribute("cx"));
    circle_mouseon.setAttribute("cy", tgt.getAttribute("cy"));
    circle_mouseon.setAttribute("r", Number(tgt.getAttribute("r")) * 1.3);
}
function on_pointerleave_bullet(event) {
    circle_mouseon.setAttribute("cx", "-1000");
}

/************************************
 * Menu events handlers 
 ************************************/

function on_contextmenu(event) {
    if (!event.ctrlKey) {
        let posX = event.clientX;
        let posY = event.clientY;

        if (event.target.id === "button_cm") {
            div_menu_style.left = null;
            div_menu_style.right = (window.innerWidth - posX) + "px";
        }
        else {
            div_menu_style.left = posX + "px";
            div_menu_style.right = null;
        }
        div_menu_style.top = posY + "px";
        div_menu_style.visibility = "visible";

        event.preventDefault();
    }
}

function RoundCoor(x) {
    return Math.round(x * 1000) / 1000;
}

function Convert2TikzColor(color) {
    if (color === "DeepSkyBlue") {
        return "cyan";
    }
    else if (color === "green") {
        return "green";
    }
    return color;
}

function on_screenshot() {
    STATE = "screenshot_start";
    document.body.style.cursor = "crosshair";
}

function in_screenshot(x, y) {
    return x >= SCREENSHOT_X_MIN && x <= SCREENSHOT_X_MAX && y >= SCREENSHOT_Y_MIN && y <= SCREENSHOT_Y_MAX;
}

function RoundToHalf(x) {
    return Math.floor(x) + 0.5;
}

function CountTrailingZeros(n)
{
    let bit = n.toString(2);
    bit = bit.split("");
    bit = bit.reverse();
    let num = 0;
    for (let i = 0; i < 64; i++) {
        if (bit[i] == '0')
            num++;
        else
            break;
    }
    return num;
}

function take_screenshot() {
    // SCREENSHOT_X_MIN = -0.5;
    // SCREENSHOT_Y_MIN = -0.5;
    // SCREENSHOT_X_MAX = 140.5;
    // SCREENSHOT_Y_MAX = 71.5;
    let tex_string = "\\newdimen\\widthA\\newcommand{\\resizelabel}[2]{\\settowidth{\\widthA}{#2}\\pgfmathsetmacro{\\ratio}{min((0.8cm)/max(\\widthA, 0.8cm), #1)}\\scalebox{\\ratio}{#2}}\n";
    tex_string += "\\begin{figure}\n\\centering\n\\scalebox{1}{\\begin{tikzpicture}[line width=0.1pt]\n";
    tex_string += `\\draw (${RoundToHalf(SCREENSHOT_X_MIN)},${RoundToHalf(SCREENSHOT_Y_MIN)}) rectangle (${RoundToHalf(SCREENSHOT_X_MAX)},${RoundToHalf(SCREENSHOT_Y_MAX)});\n`
    
    // y axis labels
    if (SCREENSHOT_X_MAX - SCREENSHOT_X_MIN > 20) {
        for (let x = Math.ceil(SCREENSHOT_X_MIN); x < Math.ceil(SCREENSHOT_X_MAX) - 1; x++) {
            if (x % 4 == 0) {
                for (let y = Math.ceil(SCREENSHOT_Y_MIN); y < Math.ceil(SCREENSHOT_Y_MAX) - 1; y++) {
                    tex_string += `\\node[text=black!10] at (${x},${y}) {$${y}$};\n`;
                }
            }
        }
    }

    // axis
    for (let x = Math.ceil(SCREENSHOT_X_MIN); x < Math.ceil(SCREENSHOT_X_MAX); x++) {
        tex_string += `\\node at (${x},${Math.floor(SCREENSHOT_Y_MIN)}) {$${x}$};\n`;
    }
    for (let y = Math.ceil(SCREENSHOT_Y_MIN); y < Math.ceil(SCREENSHOT_Y_MAX); y++) {
        tex_string += `\\node at (${Math.floor(SCREENSHOT_X_MIN)},${y}) {$${y}$};\n`;
    }
    tex_string += `\\begin{scope}\n\\clip (${RoundToHalf(SCREENSHOT_X_MIN)},${RoundToHalf(SCREENSHOT_Y_MIN)}) rectangle (${RoundToHalf(SCREENSHOT_X_MAX)},${RoundToHalf(SCREENSHOT_Y_MAX)});\n`
    for (let x = Math.ceil(SCREENSHOT_X_MIN); x < Math.ceil(SCREENSHOT_X_MAX) - 1; x++) {
        tex_string += `\\draw[black!10] (${x + 0.5},${RoundToHalf(SCREENSHOT_Y_MIN)}) -- (${x + 0.5},${RoundToHalf(SCREENSHOT_Y_MAX)});\n`;
    }
    for (let y = Math.ceil(SCREENSHOT_Y_MIN); y < Math.ceil(SCREENSHOT_Y_MAX) - 1; y++) {
        tex_string += `\\draw[black!10] (${RoundToHalf(SCREENSHOT_X_MIN)},${y + 0.5}) -- (${RoundToHalf(SCREENSHOT_X_MAX)},${y + 0.5});\n`;
    }
    
    
    // cache number of text
    let nums_tex = {};
    let nums_bullets = {};
    for (const ele of document.getElementsByClassName("p")) {
        const classList = ele.classList;
        if (classList.contains("b") || classList.contains("baux")) {
            // console.log(ele);////
            if ((!classList.contains("cw1") || Math.round(ele.getAttribute("cx")) >= sep_right) && (!classList.contains("cw2") || Math.round(ele.getAttribute("cx")) <= sep_left)) {
                const data_json = getJsonForBullet(ele);
                const bullet_json = data_json["bullets"][ele.dataset.i];
                // console.log(bullet_json);////
                if (bullet_json['p'] >= CONFIG_DYNAMIC.page) {
                    let ploted = false;
                    if (bullet_json['p'] == CONFIG.R_PERM && bullet_json['d'] !== null) {
                    }
                    if (!ploted && in_screenshot(ele.getAttribute("cx"), ele.getAttribute("cy"))) {
                        bullet_latex = latexBullet_no_h012(ele);
                        const key = `${Math.round(ele.getAttribute("cx"))},${Math.round(ele.getAttribute("cy"))}`;
                        if (bullet_latex !== "") {
                            nums_tex[key] = nums_tex[key] ? nums_tex[key] + 1 : 1;
                        }
                        nums_bullets[key] = nums_bullets[key] ? nums_bullets[key] + 1 : 1;
                    }
                }
            }
        }
    }
    for (const ele of document.getElementsByClassName("p")) {
        const classList = ele.classList;
        if (classList.contains("b") || classList.contains("baux")) {
            // console.log(ele);////
            if ((!classList.contains("cw1") || Math.round(ele.getAttribute("cx")) >= sep_right) && (!classList.contains("cw2") || Math.round(ele.getAttribute("cx")) <= sep_left)) {
                const data_json = getJsonForBullet(ele);
                const bullet_json = data_json["bullets"][ele.dataset.i];
                // console.log(bullet_json);////
                if (bullet_json['p'] >= CONFIG_DYNAMIC.page) {
                    let ploted = false;
                    if (bullet_json['p'] == CONFIG.R_PERM && bullet_json['d'] !== null) {
                        // if (bullet_json['l'] > 10000 - CONFIG_DYNAMIC.page) {
                        //     tex_string += `  \\fill[${bullet_json['c']}] (${RoundCoor(ele.getAttribute("cx"))},${RoundCoor(ele.getAttribute("cy"))}) circle (${RoundCoor(ele.getAttribute("r") * 0.8)});\n`;
                        //     ploted = true;
                        // }
                    }
                    if (!ploted && in_screenshot(ele.getAttribute("cx"), ele.getAttribute("cy"))) {
                        bullet_latex = latexBullet_no_h012(ele);
                        //bullet_latex = "";
                        if (bullet_latex !== "") {
                            const key = `${Math.round(ele.getAttribute("cx"))},${Math.round(ele.getAttribute("cy"))}`;
                            if (nums_tex[key] > 1) {
                                bullet_latex = ` node[below] {\\resizelabel{${RoundCoor(0.5 / nums_tex[key])}}{$${bullet_latex}$}}`
                            }
                            else {
                                bullet_latex = ` node[below] {\\resizelabel{${RoundCoor(2.0 / (2.0 + nums_bullets[key]))}}{$${bullet_latex}$}}`
                            }
                        }
                        tex_string += `  \\fill (${RoundCoor(ele.getAttribute("cx"))},${RoundCoor(ele.getAttribute("cy"))}) circle (${RoundCoor(ele.getAttribute("r") * 0.8)})${bullet_latex};\n`;
                    }
                }
            }
        }
        else {
            if (!classList.contains("cw1") || (Math.round(ele.getAttribute("x1")) >= sep_right && Math.round(ele.getAttribute("x2")) >= sep_right)) {
                if (!classList.contains("cw2") || (Math.round(ele.getAttribute("x1")) <= sep_left && Math.round(ele.getAttribute("x2")) <= sep_left)) {
                    if (classList.contains("sl")) {
                        /* `factorIsOn` here too, so a screenshot exports the lines you can
                         * actually see rather than whatever ss.json originally chose. */
                        if (ele.dataset.page >= CONFIG_DYNAMIC.page && factorIsOn(ele.dataset.j)) {
                            let x1 = ele.getAttribute("x1"), y1 = ele.getAttribute("y1"), x2 = ele.getAttribute("x2"), y2 = ele.getAttribute("y2");
                            if (in_screenshot(x1, y1) || in_screenshot(x2, y2)) {
                                tex_string += `  \\draw (${RoundCoor(x1)},${RoundCoor(y1)}) -- (${RoundCoor(x2)},${RoundCoor(y2)});\n`;
                            }
                        }
                    }
                    // else if (classList.contains("ml")) {
                    //     if (Math.round(ele.getAttribute("x1")) == sep_right && ele.dataset.page >= CONFIG_DYNAMIC.page) {
                    //         ele.removeAttribute("style");
                    //     }
                    // }
                    else if (classList.contains("dl")) {
                        if (ele.dataset.page == CONFIG_DYNAMIC.page || (CONFIG_DYNAMIC.showLines === "All diff" && ele.dataset.page > CONFIG_DYNAMIC.page)) {
                            let x1 = ele.getAttribute("x1"), y1 = ele.getAttribute("y1"), x2 = ele.getAttribute("x2"), y2 = ele.getAttribute("y2");
                            if (in_screenshot(x1, y1) || in_screenshot(x2, y2)) {
                                tex_string += `  \\draw[${Convert2TikzColor(ele.parentElement.getAttribute("stroke"))}] (${RoundCoor(x1)},${RoundCoor(y1)}) -- (${RoundCoor(x2)},${RoundCoor(y2)});\n`;
                            }
                        }
                    }
                    // else if (classList.contains("nd")) {
                    //     if (ele.dataset.r <= CONFIG_DYNAMIC.dashedLevel && (CONFIG_DYNAMIC.showLines === "All diff" || ele.dataset.r <= CONFIG_DYNAMIC.page)) {
                    //         ele.removeAttribute("style");
                    //     }
                    // }
                    // else if (classList.contains("lb")) { // labels
                    //     if (ele.dataset.page >= CONFIG_DYNAMIC.page) {
                    //         ele.removeAttribute("style");
                    //     }
                    // }
                }
            }
        }
    }
    tex_string += "\\end{scope}\\end{tikzpicture}}\n\\caption{figurename}\n\\end{figure}\n";
    navigator.clipboard.writeText(tex_string);
    alert(`Tikz code is copied!`);
    document.body.style.cursor = "default";
}

function on_time() {
    alert(`Time: ${DATA_JSON.time}`);
}

function on_about() {
    alert("Author: Weinan Lin");
}

function updateVisibility() {
    if (MODE == "map") {
        var sep_right = DATA_JSON.sep_right;
        var sep_left = sep_right - 1;
        rect_separator.setAttribute('x', sep_left);
        rect_second_ss.setAttribute('x', sep_left - 300);
    }
    for (const ele of document.getElementsByClassName("p")) {
        const classList = ele.classList;
        if (!classList.contains("bp"))
            ele.style.visibility = "hidden";
        if (classList.contains("grp")) {
            /* the square / k-label overlays follow their own bullet's page */
            const data_json = getJsonForBullet(ele);
            const bullet_json = data_json["bullets"][ele.dataset.i];
            if (bullet_json['p'] >= CONFIG_DYNAMIC.page)
                ele.removeAttribute("style");
            continue;
        }
        if (classList.contains("b") || classList.contains("baux")) {
            if ((!classList.contains("cw1") || Math.round(ele.getAttribute("cx")) >= sep_right) && (!classList.contains("cw2") || Math.round(ele.getAttribute("cx")) <= sep_left)) {
                const data_json = getJsonForBullet(ele);
                const bullet_json = data_json["bullets"][ele.dataset.i];
                if (bullet_json['p'] >= CONFIG_DYNAMIC.page) {
                    ele.removeAttribute("style");
                    if (bullet_json['p'] == CONFIG.R_PERM && bullet_json['d'] !== null) {
                        if (bullet_json['l'] > 10000 - CONFIG_DYNAMIC.page) {
                            ele.setAttribute("fill", "transparent");
                            ele.setAttribute("stroke", bullet_json['c']);
                            ele.setAttribute("stroke-width", bullet_json['r'] / 3);
                        }
                        else {
                            ele.removeAttribute("fill");
                            ele.removeAttribute("stroke");
                            ele.removeAttribute("stroke-width");
                        }
                    }
                    /* Group structure overrides the dot: a free Z_(p) is drawn
                     * by its square overlay alone (the circle stays as an
                     * invisible hit target), a Z/p^k as an open circle. */
                    if (bullet_json['free'] === true) {
                        ele.setAttribute("fill", "none");
                        ele.setAttribute("stroke", "none");
                    }
                    else if ((bullet_json['k'] | 0) > 1) {
                        ele.setAttribute("fill", "transparent");
                        ele.setAttribute("stroke", bullet_json['c']);
                        ele.setAttribute("stroke-width", bullet_json['r'] / 4);
                    }
                }
            }
        }
        else {
            if (!classList.contains("cw1") || (Math.round(ele.getAttribute("x1")) >= sep_right && Math.round(ele.getAttribute("x2")) >= sep_right)) {
                if (!classList.contains("cw2") || (Math.round(ele.getAttribute("x1")) <= sep_left && Math.round(ele.getAttribute("x2")) <= sep_left)) {
                    if (classList.contains("sl")) {
                        if (ele.dataset.page >= CONFIG_DYNAMIC.page && factorIsOn(ele.dataset.j)) {
                            ele.removeAttribute("style");
                        }
                    }
                    else if (classList.contains("ml")) {
                        if (Math.round(ele.getAttribute("x1")) == sep_right && ele.dataset.page >= CONFIG_DYNAMIC.page) {
                            ele.removeAttribute("style");
                        }
                    }
                    else if (classList.contains("dl") || classList.contains("dlhit")) {
                        if (ele.dataset.page == CONFIG_DYNAMIC.page || (CONFIG_DYNAMIC.showLines === "All diff" && ele.dataset.page > CONFIG_DYNAMIC.page)) {
                            ele.removeAttribute("style");
                        }
                    }
                    else if (classList.contains("nd")) {
                        if (ele.dataset.r <= CONFIG_DYNAMIC.dashedLevel && (CONFIG_DYNAMIC.showLines === "All diff" || ele.dataset.r <= CONFIG_DYNAMIC.page)) {
                            ele.removeAttribute("style");
                        }
                    }
                    else if (classList.contains("lb")) { // labels
                        if (ele.dataset.page >= CONFIG_DYNAMIC.page) {
                            ele.removeAttribute("style");
                        }
                    }
                }
            }
        }
    }
}

const select_page_map = {
    "E0": 0,
    "E1": 1,
    "E2": 2,
    "E3": 3,
    "E4": 4,
    "E5": 5,
    "E6": 6,
    "Einf": CONFIG.R_PERM,
};

function on_select_page(event) {
    CONFIG_DYNAMIC.page = select_page_map[event.target.value];
    updateVisibility();
}

const select_dashed_map = {
    "dash none": 0,
    "dash d2": 2,
    "dash d3": 3,
    "dash d4": 4,
    "dash d5": 5,
    "dash d6": 6,
    "dash all": CONFIG.R_PERM,
};

function on_select_dashed(event) {
    CONFIG_DYNAMIC.dashedLevel = select_dashed_map[event.target.value];
    updateVisibility();
}

function on_select_lines(event) {
    CONFIG_DYNAMIC.showLines = event.target.value
    updateVisibility();
}

/*****************************************************************************
 *                   Initialization of event handlers
 *****************************************************************************/
function initHandlers() {
    svg_ss.addEventListener("wheel", on_wheel);
    svg_ss.addEventListener("pointerdown", on_pointerdown);
    svg_ss.addEventListener("pointermove", on_pointermove);
    svg_ss.addEventListener("pointerup", on_pointerup);
    svg_ss.addEventListener("pointerleave", on_pointerup);

    svg_ss.addEventListener("contextmenu", on_contextmenu);
    document.addEventListener("keydown", on_key_down);

    const div_menu = document.getElementById("div_menu");
    div_menu.onclick = event => { div_menu_style.visibility = "hidden"; };


    /* For macbook */
    if (navigator.userAgent.match("Macintosh")) {
        window.addEventListener("gesturestart", event => { prevPinchScale = 1.0; event.preventDefault(); });
        window.addEventListener("gesturechange", on_pinch);
        window.addEventListener("gestureend", event => event.preventDefault());
    }

    if (navigator.userAgent.match("Macintosh")) {
        CONFIG.camera_zoom_rate = 1.06;
    }

    let str_text_date = `<text id="text8733d2c" x="60" y="-40" opacity="0.5" transform="scale(1,-1)" style="-moz-user-select: none;-webkit-user-select: none;-ms-user-select: none;user-select: none;-o-user-select: none;">js:07/29</text>`;
    g_yaxis.insertAdjacentHTML("afterend", str_text_date);
    const text_date = document.getElementById('text8733d2c');
    window.setTimeout(function () { text_date.remove(); }, 5000);
}



/************************************************************************
 *                         Plot svg by json
 ***********************************************************************/
/* class
    * p: plot
    * b: bullet
    * bp: bullet in cofseq_gp indicating more permanent cycles
*/

function loadPlot(data_json) {
    const xshift = "shift" in data_json ? data_json.shift : 0;
    const xfactor = "factor" in data_json ? data_json.factor : 1;
    const trans = (x) => ((x - Math.round(x)) + Math.round(x) * xfactor + xshift);
    for (const batchEnd = data_json.iPlotB + CONFIG.plot_batchSize; data_json.iPlotB < batchEnd && data_json.iPlotB < data_json["bullets"].length; data_json.iPlotB++) {
        const bullet = data_json["bullets"][data_json.iPlotB];
        /* Group structure, when the exporter resolved the extensions:
         *   free  -> a free Z_(p), drawn as an open SQUARE
         *   k > 1 -> Z/p^k, drawn as an open circle with k inside
         *   k <= 1 -> Z/p, the ordinary filled dot
         * The <circle> is always emitted and keeps its cx/cy/r, so selection,
         * hover, structure lines and the LaTeX export all keep working; the
         * square/label are non-interactive overlays drawn on top of it. */
        const isFree = bullet['free'] === true;
        const kGrp = bullet['k'] | 0;
        const cx = trans(bullet.x), cy = bullet.y, r = bullet.r;
        const hit = isFree ? ` pointer-events="all"` : "";
        const ele_bullet = `<circle data-i="${data_json.iPlotB}" class="p b ${data_json.class}" cx="${cx}" cy="${cy}" r="${r}"${hit}> </circle>`;
        g_bullets[bullet['c']].insertAdjacentHTML("beforeend", ele_bullet);
        if (isFree) {
            const a = r * 1.8;
            g_bullets[bullet['c']].insertAdjacentHTML("beforeend",
                `<rect data-i="${data_json.iPlotB}" class="p grp ${data_json.class}" x="${cx - a / 2}" y="${cy - a / 2}" width="${a}" height="${a}" fill="none" stroke="${bullet['c']}" stroke-width="${r / 4}" pointer-events="none"> </rect>`);
        }
        else if (kGrp > 1) {
            /* g_svg (an ancestor) is `scale(1,-1)` so math-style y-up reads
             * correctly for bullets; text drawn in that frame renders mirrored,
             * so counter-flip around this label's own y so the digit reads
             * upright without disturbing its position. */
            g_bullets[bullet['c']].insertAdjacentHTML("beforeend",
                `<text data-i="${data_json.iPlotB}" class="p grp ${data_json.class}" x="${cx}" y="${cy}" transform="translate(0,${2 * cy}) scale(1,-1)" font-size="${r * 1.6}" text-anchor="middle" dominant-baseline="central" fill="${bullet['c']}" pointer-events="none">${kGrp}</text>`);
        }
    }
    if (data_json["type"] === "cofseq_gp" && "bullets_p" in data_json) {
        for (const batchEnd = data_json.iPlotBP + CONFIG.plot_batchSize; data_json.iPlotBP < batchEnd && data_json.iPlotBP < data_json["bullets_p"].length; data_json.iPlotBP++) {
            const bullet = data_json["bullets_p"][data_json.iPlotBP];
            const ele_bullet = `<circle class="p bp ${data_json.class}" cx="${trans(bullet.x)}" cy="${bullet.y}" r="${bullet.r * 0.75}" fill="transparent" stroke="${bullet.c}" stroke-width="${bullet.r / 2}"> </circle>`;
            g_bullets[bullet['c']].insertAdjacentHTML("beforeend", ele_bullet);
        }
    }
    let keys_prods = Object.keys(data_json["prods"]);
    for (const batchEnd = data_json.iPlotSL + CONFIG.plot_batchSize / 2; data_json.iPlotSL < batchEnd && data_json.iPlotSL < keys_prods.length; data_json.iPlotSL++) {
        const lines = data_json["prods"][keys_prods[data_json.iPlotSL]];
        for (const line of lines) {
            /* This pass always builds exactly ss.json's structure-line set ("l"), whatever the
             * picker currently shows, so that FACTORS.drawn stays an honest record even if the
             * user toggles while the chart is still streaming in. Anything they switch ON beyond
             * this set is built later by drawFactorLines; visibility is settled below and in
             * updateVisibility. */
            if (line['l'] == 0) {
                continue;
            }
            const bullet1 = data_json["bullets"][keys_prods[data_json.iPlotSL]];
            for (const i of line["p"]) {
                const bullet2 = data_json["bullets"][i];
                const width = Math.min(bullet1['r'], bullet2['r']) / 4;
                const page = Math.min(bullet1['p'], bullet2['p']);
                /* Born hidden if the picker has already switched this factor off. */
                const hidden = factorIsOn(line['j']) ? "" : ` style="visibility:hidden"`;
                const ele_line = `<line class="p sl ${data_json.class}" x1="${trans(bullet1.x)}" y1="${bullet1.y}" x2="${trans(bullet2.x)}" y2="${bullet2.y}" stroke="black" stroke-width="${width}" data-page="${page}" data-j="${line['j']}"${hidden}> </line>`;
                g_strtlines.insertAdjacentHTML("beforeend", ele_line);
            }
        }
    }
    if (data_json["type"] !== "cofseq_gp") {
        for (const batchEnd = data_json.iPlotDL + CONFIG.plot_batchSize / 4; data_json.iPlotDL < batchEnd && data_json.iPlotDL < data_json["diffs"].length; data_json.iPlotDL++) {
            const diff = data_json["diffs"][data_json.iPlotDL];
            const bullet1 = data_json["bullets"][diff["i"]];
            for (const j of diff["j"]) {
                const bullet2 = data_json["bullets"][j];
                const width = Math.min(bullet1['r'], bullet2['r']) / 4;
                const page = Math.min(bullet1['p'], bullet2['p']);
                const ele_line = `<line class="p dl ${data_json.class}" x1="${trans(bullet1.x)}" y1="${bullet1.y}" x2="${trans(bullet2.x)}" y2="${bullet2.y}" stroke-width="${width}" data-page="${page}"> </line>`;
                g_diff_lines[diff["r"] <= 6 ? diff["r"] : 6].insertAdjacentHTML("beforeend", ele_line);
                /* Its click target: same geometry, several times the width, invisible. Class
                 * "dlhit" rather than "dl" on purpose -- updateVisibility gives it the same page
                 * filtering just below, while the Tikz export, which keys off "dl", skips it and so
                 * never draws the line twice.
                 *
                 * Only for MODE === "ss". Clicking a differential shows its proof, and only the
                 * spectrum charts carry proofs: `ss plot_ss` attaches a "pf" object to each
                 * differential, while `ss plot_cofseq` and the map charts attach none, so a hit
                 * target on those would open a panel with nothing to say. The reasoning for a
                 * cofseq differential IS recorded (in `log.db`, keyed "<cofseq>:<iTri>"); what is
                 * missing is the matching and display path -- see the note on `main_plot_cofseq` in
                 * `ss/plot.cpp` for why, and for what it would take. */
                if (MODE === "ss") {
                    const hit = `<line class="p dlhit ${data_json.class}" x1="${trans(bullet1.x)}" y1="${bullet1.y}" x2="${trans(bullet2.x)}" y2="${bullet2.y}" stroke-width="${width * 8}" data-page="${page}" data-pf="${data_json.iPlotDL}"> </line>`;
                    g_diffhits.insertAdjacentHTML("beforeend", hit);
                }
            }
        }
    } 
    else {
        const trans2 = (x, nx) => ((x - Math.round(x)) + nx);
        for (const batchEnd = data_json.iPlotDL + CONFIG.plot_batchSize / 4; data_json.iPlotDL < batchEnd && data_json.iPlotDL < data_json["diffs"].length; data_json.iPlotDL++) {
            const diff = data_json["diffs"][data_json.iPlotDL];
            const bullet1 = data_json["bullets"][diff["i"]];
            const x1 = trans(bullet1.x);
            const nx2 = Math.round(x1) - 1;
            for (const j of diff["j"]) {
                const bullet2 = data_json["bullets2"][j];
                const width = Math.min(bullet1['r'], bullet2['r']) / 4;
                const page = Math.min(bullet1['p'], bullet2['p']);
                const ele_line = `<line class="p dl ${data_json.class}" x1="${x1}" y1="${bullet1.y}" x2="${trans2(bullet2.x, nx2)}" y2="${bullet2.y}" stroke-width="${width}" data-page="${page}"> </line>`;
                g_diff_lines[diff["r"] <= 6 ? diff["r"] : 6].insertAdjacentHTML("beforeend", ele_line);
            }
        }
    }
    for (const batchEnd = data_json.iPlotND + CONFIG.plot_batchSize / 4; data_json.iPlotND < batchEnd && data_json.iPlotND < data_json["nds"].length; data_json.iPlotND++) {
        const nd = data_json["nds"][data_json.iPlotND];
        const bullet1 = data_json["bullets"][nd["i"]];
        const width = bullet1['r'] / 4;
        const ele_line = `<line class="p nd ${data_json.class}" x1="${trans(bullet1.x)}" y1="${bullet1.y}" x2="${trans(Math.round(bullet1.x)) - 1}" y2="${Math.round(bullet1.y) + nd['r']}" stroke-width="${width}" stroke-dasharray="0.1,0.1" data-r="${nd['r']}"> </line>`;
        g_diff_lines[nd["r"] <= 6 ? nd["r"] : 6].insertAdjacentHTML("beforeend", ele_line);
    }
    if (data_json.iPlotB < data_json["bullets"].length || data_json.iPlotSL < keys_prods.length || data_json.iPlotDL < data_json["diffs"].length || data_json.iPlotND < data_json["nds"].length || ("bullets_p" in data_json && data_json.iPlotBP < data_json["bullets_p"].length)) {
        window.requestAnimationFrame(() => loadPlot(data_json));
    }
    else {
        /* Desktop browser will support pointer enter and leave events */
        if (navigator.userAgent.match("Windows") || navigator.userAgent.match("Macintosh")) {
            const bullets = document.getElementsByClassName("b");

            for (const b of bullets) {
                b.onpointerenter = on_pointerenter_bullet;
                b.onpointerleave = on_pointerleave_bullet;
            }
        }
        updateVisibility();
        updateAxisLabels();
    }
}

function loadPlotMap(data_json) {
    const shift2 = data_json["cw2"].shift;
    const map_keys = Object.keys(data_json["maps"]);
    for (const batchEnd = data_json.iPlotMap + CONFIG.plot_batchSize; data_json.iPlotMap < batchEnd && data_json.iPlotMap < map_keys.length; data_json.iPlotMap++) {
        const key = map_keys[data_json.iPlotMap];
        const bullet1 = data_json["cw1"]["bullets"][key];
        for (const i of data_json["maps"][key]) {
            const bullet2 = data_json["cw2"]["bullets"][i];
            const width = Math.min(bullet1['r'], bullet2['r']) / 4;
            const page = Math.min(bullet1['p'], bullet2['p']);
            const ele_line = `<line class="p ml" x1="${bullet1.x + 1}" y1="${bullet1.y}" x2="${bullet2.x + shift2}" y2="${bullet2.y}" stroke-width="${width}" data-page="${page}"> </line>`;
            g_strtlines_purple.insertAdjacentHTML("beforeend", ele_line);
        }
    }
    if (data_json.iPlotMap < map_keys.length) {
        window.requestAnimationFrame(() => loadPlotMap(data_json));
    }
    else {
        updateVisibility();
    }
}

function Plot(data_json) {
    if (data_json["type"] === "map") {
        data_json.iPlotMap = 0;
        window.requestAnimationFrame(() => loadPlotMap(data_json));
    }
    else if (["ring", "module", "cofseq_gp"].includes(data_json["type"])) {
        data_json.iPlotB = 0; /* bullets */
        data_json.iPlotSL = 0; /* structure lines */
        data_json.iPlotDL = 0; /* diff lines */
        data_json.iPlotND = 0; /* null differential lines */
        if (data_json["type"] == "cofseq_gp")
            data_json.iPlotBP = 0; /* bullets_p */
        window.requestAnimationFrame(() => loadPlot(data_json));
    }
}

const LOADED_SCRIPTS = new Set();
function waitUntil(checkFlag, doSomething) {
    if (checkFlag() === false) {
        window.setTimeout(() => { waitUntil(checkFlag, doSomething) }, 200); /* this checks the flag every 100 milliseconds*/
    } else {

        doSomething();
    }
}
function loadScript(path, on_load) {
    if (LOADED_SCRIPTS.has(path)) {
        waitUntil(() => { return LOADED_SCRIPTS.has(path + "_done") }, on_load);
    }
    else {
        LOADED_SCRIPTS.add(path);
        const scriptEle = document.createElement("script");
        scriptEle.setAttribute("src", path);
        document.body.appendChild(scriptEle);
        scriptEle.addEventListener("load", () => { on_load(); LOADED_SCRIPTS.add(path + "_done"); });
    }
}

function processParams() {
    const dir = URL_PARAMS.get("diagram") || "mix";
    const data = DATA_NAME;
    document.getElementById("title").innerHTML = `${data}: AdamsSS`;

    /* Adjust camera */
    if (URL_PARAMS.get("scale") !== null) {
        const pivot_svg = camera.world2svg(new Vector(URL_PARAMS.get("x"), URL_PARAMS.get("y")));
        const scale = Number(URL_PARAMS.get("scale"));
        camera.zoom(pivot_svg, scale);
    }
    if (URL_PARAMS.get("x") !== null) {
        const wx = Number(URL_PARAMS.get("x")) + (data.includes("__") ? 1 : 0);
        const pivot_svg = camera.world2svg(new Vector(wx, 0));
        camera.translate(new Vector(CONFIG.margin + (window.innerWidth - CONFIG.margin) / 2 - pivot_svg.x, 0));
    }
    if (URL_PARAMS.get("y") !== null) {
        const wy = Number(URL_PARAMS.get("y"));
        const pivot_svg = camera.world2svg(new Vector(0, wy));
        camera.translate(new Vector(0, CONFIG.margin + (window.innerHeight - CONFIG.margin) / 2 - pivot_svg.y));
    }

    /* Add bullets */
    loadScript(`${dir}/${data}.js`, () => {
        DATA_JSON = globalThis[`DATA_JSON_${data}`];
        addRects();
        if (MODE === "ss") {
            DATA_JSON.class = "cw";
            buildFactorPanel(); /* sets FACTORS.on, which Plot's first pass reads */
            Plot(DATA_JSON);

            /* module */
            if ("over" in DATA_JSON) {
                loadScript(`${dir}/${DATA_JSON["over"]}.js`, () => {
                    DATA_JSON["gen_names"] = globalThis[`DATA_JSON_${DATA_JSON["over"]}`]["gen_names"];
                });
            }
        }
        /* map */
        else if (MODE === "map") {
            DATA_JSON.sep_right = 1;
            loadScript(`${dir}/${DATA_JSON["from"]}.js`, () => {
                DATA_JSON["cw1"] = Object.assign({}, globalThis[`DATA_JSON_${DATA_JSON["from"]}`]);
                DATA_JSON["cw1"].class = "cw1";
                DATA_JSON["cw1"].shift = 1;
                Plot(DATA_JSON["cw1"]);

                loadScript(`${dir}/${DATA_JSON["to"]}.js`, () => {
                    DATA_JSON["cw2"] = Object.assign({}, globalThis[`DATA_JSON_${DATA_JSON["to"]}`]);
                    DATA_JSON["cw2"].class = "cw2";
                    DATA_JSON["cw2"].shift = DATA_JSON["sus"];
                    Plot(DATA_JSON["cw2"]);
                    Plot(DATA_JSON);

                    /* modules */
                    if ("over" in DATA_JSON["cw1"]) {
                        loadScript(`${dir}/${DATA_JSON["cw1"]["over"]}.js`, () => {
                            DATA_JSON["cw1"]["gen_names"] = globalThis[`DATA_JSON_${DATA_JSON["cw1"]["over"]}`]["gen_names"];

                            if ("over" in DATA_JSON["cw2"]) {
                                loadScript(`${dir}/${DATA_JSON["cw2"]["over"]}.js`, () => {
                                    DATA_JSON["cw2"]["gen_names"] = globalThis[`DATA_JSON_${DATA_JSON["cw2"]["over"]}`]["gen_names"];
                                });
                            }
                        });
                    }
                });
            });
        }
        /* cofseq */
        else if (MODE === "cofseq") {
            const n0 = Math.min(0, -DATA_JSON["degs_maps"][0][0], -DATA_JSON["degs_maps"][0][0] - DATA_JSON["degs_maps"][1][0]);
            CONFIG.x_min_cofseq = [n0 + DATA_JSON["degs_maps"][0][0] + DATA_JSON["degs_maps"][1][0], n0 + DATA_JSON["degs_maps"][0][0], n0];

            for (let iCw = 0; iCw < 3; ++iCw) {
                DATA_JSON["cofseq_groups"][iCw].shift = 2 - iCw - 3 * CONFIG.x_min_cofseq[2 - iCw];
                DATA_JSON["cofseq_groups"][iCw].factor = 3;
                DATA_JSON["cofseq_groups"][iCw].class = "cs" + iCw;
                DATA_JSON["cofseq_groups"][iCw]["bullets2"] = DATA_JSON["cofseq_groups"][(iCw + 1) % 3]["bullets"]
                Plot(DATA_JSON["cofseq_groups"][iCw]);

                loadScript(`${dir}/${DATA_JSON["names"][iCw]}.js`, () => {
                    const data_json_csi = globalThis[`DATA_JSON_${DATA_JSON["names"][iCw]}`];
                    DATA_JSON["cofseq_groups"][iCw]["basis"] = data_json_csi["basis"];
                    if ("gen_names" in data_json_csi)
                        DATA_JSON["cofseq_groups"][iCw]["gen_names"] = data_json_csi["gen_names"];
                    else {
                        DATA_JSON["cofseq_groups"][iCw]["v_names"] = data_json_csi["v_names"];
                        loadScript(`${dir}/${data_json_csi["over"]}.js`, () => {
                            DATA_JSON["cofseq_groups"][iCw]["gen_names"] = globalThis[`DATA_JSON_${data_json_csi["over"]}`]["gen_names"];
                        });
                    }
                });
            }
        }
    });
}

/***************************************************
 *                   initialization
 ***************************************************/
function addGridLines() {
    const g_grid = document.getElementById("g_grid");
    /* Built as one string and inserted once: there are O(x_max) lines, and `insertAdjacentHTML`
     * re-parses its target on every call, so inserting them one at a time is what makes a wide
     * chart slow to open. */
    const lines = [];
    for (let i = 0; i <= CONFIG.y_max_grid; i += 1)
        lines.push(`<line x1="-0.5" y1="${i}" x2="${CONFIG.x_max + 0.5}" y2="${i}"></line>`);
    for (let i = 0; i <= CONFIG.x_max; i += 1)
        lines.push(`<line x1="${i}" y1="-.5" x2="${i}" y2="${CONFIG.y_max_grid}"></line>`);
    g_grid.insertAdjacentHTML("beforeend", lines.join("\n"));
}

function init() {
    if (MODE === "cofseq") {
        const options = "<option>E0</option>\n<option>E1</option>\n";
        select_page.insertAdjacentHTML("afterbegin", options);
        CONFIG_DYNAMIC.page = select_page_map["E0"];
    }

    addGridLines();
    // if (MODE !== "FromRes")
    //     addBulletLabels();
    updateAxisLabels();

    initHandlers();

    processParams();
}
