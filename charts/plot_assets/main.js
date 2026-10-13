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
     * the triangle at 3 columns per stem (see `x2stem`), so its axis is 3x as wide. Sized for the
     * y(n) charts: y2rp5 runs to stem 9967, and y1rp5's v_1-towers reach filtration 555 by stem 4987. */
    x_max: MODE === "cofseq" ? 12000 * 3 : 12000,
    x_min_cofseq: [0, 0, 0],
    y_max: 600,
    y_max_grid: 600,
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
    dashedLevel: CONFIG.R_PERM, /* "dash all"; keep in step with the selected option in plot.html */
    showLines: "All diff",
};


/************************************************************************
 *                               theme
 *
 * Dark mode is a black/white swap and nothing more: the chart's own colours --
 * blue generators, grey classes, the per-page differential palette, the green
 * product dots -- mean something, so they are identical in both themes. All of
 * it lives in main.css under `:root[data-theme="dark"]`; this only decides which
 * theme is on and records the choice.
 *
 * Precedence: ?theme=dark|light in the url (so a link can pin a theme, e.g. for
 * a screen share) > what was chosen here last > the OS setting.
 *
 * Note this runs at script load, not from init(): main.js is the last element in
 * the body, so the attribute is set before the first paint and a dark-mode user
 * never sees a white flash.
 ***********************************************************************/
const THEME_KEY = "ss_plot_theme";

/* localStorage throws rather than returning null in a few configurations -- Safari with
 * "block all cookies", a file:// page in Chrome with site data disabled -- and the chart
 * is routinely opened over file://, so neither read nor write may be assumed to work. */
function theme_stored() {
    try {
        return localStorage.getItem(THEME_KEY);
    } catch (e) {
        return null;
    }
}

function theme_store(theme) {
    try {
        localStorage.setItem(THEME_KEY, theme);
    } catch (e) { /* not remembered; the toggle still works for this page */ }
}

function apply_theme(theme) {
    document.documentElement.setAttribute("data-theme", theme);
    const button = document.getElementById("button_theme");
    if (button !== null) {
        button.textContent = theme === "dark" ? "☀" : "🌙";
        button.title = theme === "dark" ? "Light mode (d)" : "Dark mode (d)";
    }
}

function current_theme() {
    return document.documentElement.getAttribute("data-theme") === "dark" ? "dark" : "light";
}

function on_toggle_theme() {
    const theme = current_theme() === "dark" ? "light" : "dark";
    theme_store(theme);
    apply_theme(theme);
}

/* Anything that is not exactly "dark" or "light" is ignored rather than written to the
 * attribute, so a typo in the url falls through to the remembered choice. */
function theme_valid(theme) {
    return theme === "dark" || theme === "light" ? theme : null;
}

apply_theme(
    theme_valid(URL_PARAMS.get("theme"))
    || theme_valid(theme_stored())
    || (window.matchMedia && window.matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light")
);


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
/* Bullets of any other colour (the synthetic chart colours a class by its lambda-torsion
 * exponent) get a <g> of their own, made on first use right after the black group. These are
 * hues, so like the differential colours they stay the same in dark mode. */
function bulletGroup(color) {
    if (!(color in g_bullets)) {
        const id = "g_bullets_" + color.replace(/[^A-Za-z0-9]/g, "_");
        g_bullets["black"].insertAdjacentHTML("afterend", `<g id="${id}" fill="${color}"></g>`);
        g_bullets[color] = document.getElementById(id);
    }
    return g_bullets[color];
}
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
    6: document.getElementById("g_difflines_pink"),
    7: document.getElementById("g_difflines_purple"),
    8: document.getElementById("g_difflines_teal"),
    9: document.getElementById("g_difflines_orange"),
    10: document.getElementById("g_difflines_steele")
};
/* d_11..d_50: red -> orange -> yellow -> green -> cyan -> blue -> violet -> magenta, at hue
 * 25 + 300 * ln(r - 10) / ln(40) degrees in OKLCH (L 0.64, C 0.18, chroma reduced until in the
 * sRGB gamut), so the short ones are spread furthest apart and every colour is equally bright.
 * d_2..d_10 keep the hand-picked colours above; longer than d_50 is drawn as d_50. */
const DIFF_COLORS_LONG = [
    "#e55551", "#b4820a", "#8b9511", "#4ea423", "#03a762", "#05a481", "#17a193", "#19a09f",
    "#189ea9", "#0c9db3", "#0a9cbc", "#149ac4", "#1198ce", "#0396da", "#0893e6", "#0d8ff4",
    "#328bf6", "#4588f7", "#5485f8", "#5f82f8", "#697ff8", "#727cf7", "#7a7af5", "#8178f4",
    "#8775f2", "#8d73f0", "#9371ee", "#986feb", "#9c6ee9", "#a16ce6", "#a56ae3", "#a969e0",
    "#ac67dd", "#b066da", "#b364d7", "#b663d4", "#b962d1", "#bc61cd", "#be60ca", "#c15fc7"
];
const DIFF_R_MAX = 10 + DIFF_COLORS_LONG.length;
{
    let prev = g_diff_lines[10];
    for (let r = 11; r <= DIFF_R_MAX; ++r) {
        const g = document.createElementNS("http://www.w3.org/2000/svg", "g");
        g.id = `g_difflines_d${r}`;
        g.setAttribute("stroke", DIFF_COLORS_LONG[r - 11]);
        g.setAttribute("fill", "transparent");
        prev.after(g);
        g_diff_lines[r] = prev = g;
    }
}
/* The group a d_r line is drawn in, which sets its colour */
function diffLineGroup(r) {
    return g_diff_lines[Math.max(0, Math.min(r, DIFF_R_MAX))];
}

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
const p_order = document.getElementById("p_order");
const p_known = document.getElementById("p_known");
const g_prod = document.getElementById("g_prod");
const g_highlights = document.getElementById("g_highlights");
const g_towers = document.getElementById("g_towers");
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
            /* factors are separated by a space, which TeX ignores but which keeps a name ending in
             * a macro (\\beta) from running into the next factor (\\betax) */
            if (i > 0)
                result += " ";
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
            result += ` ${data_json["v_names"][mon[mon.length - 1]]}`;
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

/* The order of the group this class carries, for the charts that know it: an exporter
 * that resolved the extensions writes "free" (a free Z_(p) summand) or "k" (a cyclic
 * Z/p^k) onto the bullet -- see plotBullets in ss/plot.cpp and the Aubry chart in
 * scripts/aubry.  Charts that carry neither get no line at all rather than a guess:
 * for a plain F_p chart a single dot is not the whole group. */
function orderLabel(bullet_json, data_json) {
    const prime = data_json["prime"] ?? "p";
    if (bullet_json["free"] === true) {
        return `Order: &infin; (free Z<sub>(${prime})</sub>)`;
    }
    if (!("k" in bullet_json)) {
        return "";
    }
    const k = bullet_json["k"] | 0;
    return k > 1 ? `Order: ${prime}<sup>${k}</sup>` : `Order: ${prime}`;
}

/* What the chart can prove about this class's differential beyond the stored value: the
 * "dk" field, [kind, r], that DiffKnowledge in ss/plot.cpp writes. Charts plotted before it
 * existed have no "dk" and get no line. */
function knownLabel(bullet_json) {
    const dk = bullet_json["dk"];
    if (!Array.isArray(dk)) {
        return "";
    }
    const [kind, r] = dk;
    switch (kind) {
        case 1: return `d_{${r}}\\,x\\neq 0`;
        case 2: return `d_{\\leq ${r}}\\,x\\neq 0`;
        case 3: return `d_{${r}}\\text{ target}`;
        case 4: return `d_{\\leq ${r}}\\text{ target}`;
        default: return "";
    }
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
    /* "bc": the odd-p coefficients, parallel to "b"; absent when they are all 1 */
    const coeffs = bullet_json["bc"];
    for (let i = 0; i < bullet_json["b"].length; ++i) {
        if (i > 0) {
            str_base += "+";
        }
        const c = coeffs ? coeffs[i] : 1;
        const mon = latexMon(basis_json[offset_X + parseInt(bullet_json["b"][i])], data_json);
        if (c !== 1)
            str_base += mon === "1" ? `${c}` : `${c}${mon}`;
        else
            str_base += mon;
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
    /* the odd-primary names (alpha_1, beta_{s/j}, gamma_t, the Extensions panel's multipliers) */
    str_mon = replaceAll(str_mon, /\\alpha\s?/, "α");
    str_mon = replaceAll(str_mon, /\\beta\s?/, "β");
    str_mon = replaceAll(str_mon, /\\gamma\s?/, "γ");
    str_mon = replaceAll(str_mon, /\\delta\s?/, "δ");
    str_mon = replaceAll(str_mon, /\\lambda\s?/, "λ");
    str_mon = replaceAll(str_mon, /\\tau\s?/, "τ");
    str_mon = replaceAll(str_mon, /\\chi\s?/, "χ");
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

/* The x/dx of a log row as `ss` serializes them: "0" is basis vector 0, "0*3" is 3 times basis
 * vector 0, and the EMPTY string is the zero vector. Only charts plotted before 2026-10-11 show these;
 * newer ones carry the classes by name (see renderMixed). */
function proofVec(v) {
    return "[" + escapeHtml(v === undefined ? "" : v) + "]";
}

/* Text with TeX between `$...$`, as ss/proof_text.cpp writes every proof string: the TeX is rendered
 * with KaTeX, the rest escaped. KaTeX loads deferred, so before it arrives the TeX shows as source. */
function renderMixed(s) {
    const parts = String(s).split("$");
    let html = "";
    for (let k = 0; k < parts.length; ++k) {
        if (k % 2 === 0)
            html += escapeHtml(parts[k]);
        else if (typeof katex !== "undefined")
            html += katex.renderToString(parts[k], { throwOnError: false });
        else
            html += escapeHtml("$" + parts[k] + "$");
    }
    return html;
}

function renderNoteLines(lines) {
    if (lines === undefined)
        return "";
    if (!Array.isArray(lines)) /* a chart plotted before 2026-10-11: the raw note */
        return `<div class="proof_note">${escapeHtml(lines)}</div>`;
    return lines.map(l => `<div class="proof_note">${renderMixed(l)}</div>`).join("");
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
        const modern = pf["proved"] !== undefined; /* plotted since 2026-10-11: names and TeX */
        html += `<p><span class="proof_reason">${renderMixed(reason.short)}</span>`;
        if (reason.long)
            html += ` &mdash; ${renderMixed(reason.long)}`;
        html += `</p>`;
        if (modern)
            html += `<p>${renderMixed(pf["proved"])}</p>`;
        if (pf["code"] === "unavailable") {
            html += `<p class="proof_caveat">No derivation record was saved for this differential, so the chart cannot distinguish a degree, naturality, Adams d<sub>2</sub>, product, cofiber, or other deduction.</p>`;
        }
        else if (!modern) {
            html += `<p>Logged as d<sub>${diff["r"]}</sub>(${proofVec(pf["x"])}) = ${proofVec(pf["dx"])}`;
            html += ` <span class="factor_deg">(coordinates in the staircase basis)</span></p>`;
        }
        html += renderNoteLines(pf["note"]);
        if (pf["steps"] && pf["steps"].length) {
            html += `<div class="proof_steps_head">Alternatives ruled out (${pf["steps"].filter(st => !(st["depth"] > 1)).length}):</div><ol>`;
            for (const step of pf["steps"]) {
                const nested = step["depth"] > 1;
                html += nested ? `<li class="proof_step_nested">` : `<li>`;
                if (modern)
                    html += `${nested ? "Within it: " : ""}${renderMixed(step["proved"])}`;
                else
                    html += `d<sub>${diff["r"]}</sub>(${proofVec(step["x"])}) = ${proofVec(step["dx"])}`;
                html += renderNoteLines(step["note"]);
                html += `</li>`;
            }
            html += `</ol>`;
        }
        else if (modern && (pf["code"] === "D" || pf["code"] === "DI"))
            html += `<p class="proof_caveat">No refutation is recorded next to this row in log.db.</p>`;
        if (modern ? pf["ambiguous"] === true : pf["exact"] === false)
            html += `<p class="proof_caveat">This bidegree carries more than one d<sub>${diff["r"]}</sub>, and the log
                     records ${modern ? renderMixed(pf["logged"]) : "its differential"} in a form that matches this
                     one only by bidegree and length, so the proof above may be about another of them.</p>`;
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
 * re-plot, no re-export.
 *
 * A page can show more than one spectrum -- two in "map" mode (source and
 * target), three in "cofseq" -- and each of them carries its OWN "degs_factors",
 * so a factor index j means nothing until you also say whose chart it indexes.
 * FACTORS therefore keeps one entry per plotted chart, keyed by the chart's svg
 * class ("cw", "cw1"/"cw2", "cs0".."cs2"), which is also written onto every
 * structure line as data-cw so visibility can be resolved from the element
 * alone. Each entry's `on` starts as the first `n_lines_factors` of its
 * factors, which is exactly that chart's ss.json list [0].
 *
 * Lines for a factor are created the first time it is switched on (entry.drawn)
 * and thereafter only hidden/shown, so initial load costs exactly what it did
 * before and a factor you never look at is never built.
 ***********************************************************************/
const FACTORS = {
    active: false,   /* false until some chart has registered its multipliers */
    charts: [],      /* one entry per plotted chart, in the order they load */
    byKey: {},       /* chart class -> that entry */
};

function factorIsOn(key, j) {
    if (!FACTORS.active)
        return true;
    const chart = FACTORS.byKey[key];
    /* A chart with no factors of its own (or a line drawn before its chart registered) keeps
     * whatever the data file chose rather than vanishing. */
    return chart === undefined || chart.on.has(Number(j));
}

/* Called for each chart just before it is plotted, so the first pass over its structure lines
 * already knows which of them to draw. `label` names the spectrum in the panel; it is ignored
 * when the page shows only one chart. */
function registerFactorChart(data_json, label) {
    const degs = data_json["degs_factors"] || [];
    if (degs.length === 0)
        return;
    const chart = {
        key: data_json.class,
        label: label,
        data_json: data_json,
        degs: degs,
        names: data_json["names_factors"] || [],
        /* Absent in cofseq charts, which plot every factor they carry as a line. */
        n_lines: data_json["n_lines_factors"] ?? degs.length,
        on: new Set(),
        drawn: new Set(),
    };
    FACTORS.active = true;
    FACTORS.charts.push(chart);
    FACTORS.byKey[chart.key] = chart;
    resetFactorChart(chart);
    /* loadPlot builds every line of ss.json's structure-line set (the first n_lines factors) and
     * hides the ones the default leaves off, so all of them count as already built -- otherwise
     * switching one on would ask drawFactorLines to create a second copy of every one of its lines. */
    chart.drawn = new Set([...Array(chart.n_lines).keys()]);
}

/* The factors a chart starts with. At an odd prime that is only h_0 = x_{0,1} and
 * alpha_1 = x_{2p-3,1}, the lowest positive stem in filtration 1: the other multipliers (v_1, v_2,
 * x_{39,1}, ...) draw long lines that clutter the chart, and stay one click away in the factor
 * panel. A chart without h_0 (V(0), V(1), ...) starts with alpha_1 alone. At p = 2 the lowest such
 * stem is 1, and the chart keeps its ss.json list ("n_lines_factors") as before. */
function defaultFactors(chart) {
    const stems1 = chart.degs.filter((d) => d[1] === 1 && d[0] > 0).map((d) => d[0]);
    const stem_alpha1 = stems1.length ? Math.min(...stems1) : null;
    if (stem_alpha1 === null || stem_alpha1 < 3)
        return [...Array(chart.n_lines).keys()];
    const out = [];
    chart.degs.forEach((d, j) => {
        if (d[1] === 1 && (d[0] === 0 || d[0] === stem_alpha1))
            out.push(j);
    });
    return out;
}

function resetFactorChart(chart) {
    chart.on.clear();
    for (const j of defaultFactors(chart))
        chart.on.add(j);
}

/* Create the <line> elements for one factor of one chart, over the whole chart. Mirrors the
 * structure-line half of loadPlot, but for a single j and in one pass. */
function drawFactorLines(chart, j) {
    if (chart.drawn.has(j))
        return;
    chart.drawn.add(j);
    const data_json = chart.data_json;
    /* Not in the file (a `prods=lines` export): compute this multiplier's products in the browser.
     * products_factor_lines inserts the lines when done and refreshes the visibility. */
    if (data_json["prods_mode"] === "lines" && j >= chart.n_lines && typeof products_factor_lines === "function") {
        products_factor_lines(chart, j);
        return;
    }
    /* Same transform loadPlot applies -- the identity in "ss" mode, a shift in "map", a shift and
     * a stretch in "cofseq". */
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
                html += `<line class="p sl ${data_json.class}" x1="${trans(bullet1.x)}" y1="${bullet1.y}" x2="${trans(bullet2.x)}" y2="${bullet2.y}" stroke="black" stroke-width="${width}" data-page="${page}" data-cw="${data_json.class}" data-j="${j}" style="visibility:hidden"> </line>`;
            }
        }
    }
    g_strtlines.insertAdjacentHTML("beforeend", html);
}

function setFactor(chart, j, on) {
    if (on) {
        drawFactorLines(chart, j);
        chart.on.add(j);
    }
    else
        chart.on.delete(j);
    updateVisibility();
}

function on_factor_toggle(event) {
    const chart = FACTORS.byKey[event.target.dataset.cw];
    if (chart === undefined)
        return;
    setFactor(chart, Number(event.target.dataset.j), event.target.checked);
    syncFactorChecks();
}

function on_factors_all(on) {
    for (const chart of FACTORS.charts) {
        for (let j = 0; j < chart.degs.length; ++j) {
            if (on)
                drawFactorLines(chart, j);
            on ? chart.on.add(j) : chart.on.delete(j);
        }
    }
    syncFactorChecks();
    updateVisibility();
}

function on_factors_reset() {
    for (const chart of FACTORS.charts)
        resetFactorChart(chart);
    syncFactorChecks();
    updateVisibility();
}

function syncFactorChecks() {
    for (const box of div_factors_list.querySelectorAll("input[type=checkbox]")) {
        const chart = FACTORS.byKey[box.dataset.cw];
        box.checked = chart !== undefined && chart.on.has(Number(box.dataset.j));
    }
    let n_on = 0, n_total = 0;
    for (const chart of FACTORS.charts) {
        n_on += chart.on.size;
        n_total += chart.degs.length;
    }
    div_factors_title.textContent = `Structure lines ${n_on}/${n_total}`;
}

/* Render one row per multiplier: a checkbox, the factor's name, and its (stem, s).
 * Names come from the chart's "names_factors"; they are LaTeX-ish, so run them
 * through the same prettifier the bullet labels use. When the page shows more than
 * one spectrum each gets its own headed section, because a factor of one chart says
 * nothing about the other's lines. */
function buildFactorPanel() {
    if (FACTORS.charts.length === 0) {
        button_factors.style.display = "none";
        return;
    }
    let html = "";
    for (const chart of FACTORS.charts) {
        if (FACTORS.charts.length > 1)
            html += `<div class="factor_group">${escapeHtml(chart.label)}</div>`;
        for (let j = 0; j < chart.degs.length; ++j) {
            const name = latexToHtmlName(chart.names[j] !== undefined ? chart.names[j] : `x_{${chart.degs[j][0]},${chart.degs[j][1]}}`);
            html += `<div class="factor_row"><label><input type="checkbox" data-cw="${chart.key}" data-j="${j}" onchange="on_factor_toggle(event)">` +
                    `<span class="factor_name">${name}</span>` +
                    `<span class="factor_deg">(${chart.degs[j][0]}, ${chart.degs[j][1]})</span></label>` +
                    `<button class="factor_tower" data-cw="${chart.key}" data-j="${j}" onclick="on_tower_mode(event)" title="Then click classes to draw this multiplier's towers through them">tower</button></div>`;
        }
    }
    div_factors_list.innerHTML = html;
    syncFactorChecks();
}

function escapeHtml(s) {
    return String(s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

function on_toggle_factors() {
    const showing = div_factors.style.visibility === "visible";
    if (!showing)
        closeOtherPanels("div_factors");
    div_factors.style.visibility = showing ? "hidden" : "visible";
    if (showing)
        setTowerMode(null); /* the towers drawn stay; only the click mode ends with the panel */
}

/* The toolbar's panels open one at a time: opening one closes the others, each through its own
 * toggle so it can clean up (the Products panel drops its highlight and pick mode). */
function closeOtherPanels(id) {
    const panels = { div_factors: "on_toggle_factors", div_exts: "on_toggle_exts", div_products: "on_toggle_products", div_graph: "on_toggle_graph" };
    for (const pid in panels) {
        const div = document.getElementById(pid);
        if (pid !== id && div && div.style.visibility === "visible" && typeof window[panels[pid]] === "function")
            window[panels[pid]]();
    }
}

/************************************************************************
 *                              Towers
 *
 * With a multiplier a's "tower" toggle on (Lines panel), clicking a class x draws the
 * structure lines of a through x: x -> a x -> a^2 x -> ... as far as the products go, and,
 * when x is a-divisible, back up through every y with a y = x, a y' = y, ... Several classes
 * may be clicked; clicking one again removes its tower; "clear towers" removes them all.
 *
 * The products are E_2 products, the ones structure lines draw, taken from the chart's "prods"
 * when the multiplier's products are in the file and otherwise computed in the browser exactly
 * as a click-only multiplier's are (products.js, products_times_factor). The incoming search only
 * looks in the bidegree deg(x) - deg(a), so it is cheap. Tower lines are "p tl" with a data-page,
 * so the page selector hides them as it hides structure lines.
 ***********************************************************************/
const TOWERS = {
    mode: null,      /* {key, j}: the multiplier whose towers clicks draw, or null */
    drawn: new Map() /* "key:j:i" -> its <g> */
};
const TOWER_MAX_STEPS = 400;

function setTowerMode(mode) {
    TOWERS.mode = mode;
    for (const btn of div_factors_list.querySelectorAll(".factor_tower"))
        btn.classList.toggle("on", mode !== null && btn.dataset.cw === mode.key && Number(btn.dataset.j) === mode.j);
    const status = document.getElementById("tower_status");
    if (status) {
        if (mode === null)
            status.textContent = "Tower: off";
        else {
            const chart = FACTORS.byKey[mode.key];
            const name = chart && chart.names[mode.j] !== undefined ? chart.names[mode.j] : `factor ${mode.j}`;
            status.innerHTML = `Tower: ${latexToHtmlName(name)} &mdash; click classes`;
        }
    }
}

function on_tower_mode(event) {
    event.preventDefault();
    const key = event.target.dataset.cw, j = Number(event.target.dataset.j);
    const same = TOWERS.mode !== null && TOWERS.mode.key === key && TOWERS.mode.j === j;
    setTowerMode(same ? null : { key, j });
}

function on_towers_clear() {
    for (const g of TOWERS.drawn.values())
        g.remove();
    TOWERS.drawn.clear();
}

/* the local indices of (class i) * (multiplier j) in this chart, as a promise */
function towerProducts(chart, i, j) {
    const data = chart.data_json;
    if (!(data["prods_mode"] === "lines" && j >= chart.n_lines)) {
        const out = [];
        for (const line of (data["prods"][i] || []))
            if (line['j'] === j)
                out.push(...line['p']);
        return Promise.resolve(out);
    }
    if (typeof products_times_factor !== "function" || typeof PRODUCTS === "undefined" || data !== PRODUCTS.data || !data.alg)
        return Promise.resolve([]);
    return products_load().then(() => products_times_factor(i, j));
}

function towerByDeg(chart) {
    if (!chart.byDeg) {
        chart.byDeg = new Map();
        chart.data_json["bullets"].forEach((b, i) => {
            const k = `${Math.round(b.x)},${Math.round(b.y)}`;
            if (!chart.byDeg.has(k))
                chart.byDeg.set(k, []);
            chart.byDeg.get(k).push(i);
        });
    }
    return chart.byDeg;
}

async function towerEdges(chart, j, x) {
    const data = chart.data_json, [fstem, fs] = chart.degs[j];
    const edges = [];
    /* outgoing: x, a x, a^2 x, ... */
    let frontier = [x];
    const seen_out = new Set([x]);
    for (let step = 0; frontier.length && step < TOWER_MAX_STEPS; ++step) {
        const next = [];
        for (const y of frontier)
            for (const t of await towerProducts(chart, y, j)) {
                edges.push([y, t]);
                if (!seen_out.has(t)) {
                    seen_out.add(t);
                    next.push(t);
                }
            }
        frontier = next;
    }
    /* incoming: every y in deg(t) - deg(a) whose a-multiple involves t */
    const byDeg = towerByDeg(chart);
    frontier = [x];
    const seen_in = new Set([x]);
    for (let step = 0; frontier.length && step < TOWER_MAX_STEPS; ++step) {
        const next = [];
        for (const t of frontier) {
            const b = data["bullets"][t];
            for (const y of byDeg.get(`${Math.round(b.x) - fstem},${Math.round(b.y) - fs}`) || []) {
                if (!(await towerProducts(chart, y, j)).includes(t))
                    continue;
                edges.push([y, t]);
                if (!seen_in.has(y)) {
                    seen_in.add(y);
                    next.push(y);
                }
            }
        }
        frontier = next;
    }
    return edges;
}

/* A plain click on a class while a tower mode is on: draw (or remove) its tower. True if handled. */
function towerClick(bullet) {
    if (TOWERS.mode === null || !bullet.classList.contains("b"))
        return false;
    const data = getJsonForBullet(bullet);
    const chart = FACTORS.byKey[TOWERS.mode.key];
    if (!chart || !data || data !== chart.data_json)
        return false; /* a class of another chart on a map/cofseq page */
    const j = TOWERS.mode.j, x = Number(bullet.dataset.i);
    const key = `${chart.key}:${j}:${x}`;
    if (TOWERS.drawn.has(key)) {
        TOWERS.drawn.get(key).remove();
        TOWERS.drawn.delete(key);
        return true;
    }
    const g = document.createElementNS("http://www.w3.org/2000/svg", "g");
    g.dataset.key = key;
    g_towers.appendChild(g);
    TOWERS.drawn.set(key, g);
    const xshift = "shift" in data ? data.shift : 0;
    const xfactor = "factor" in data ? data.factor : 1;
    const trans = (v) => ((v - Math.round(v)) + Math.round(v) * xfactor + xshift);
    towerEdges(chart, j, x).then((edges) => {
        if (TOWERS.drawn.get(key) !== g)
            return; /* removed (or cleared) while computing */
        let html = "";
        for (const [a, b] of edges) {
            const b1 = data["bullets"][a], b2 = data["bullets"][b];
            const width = Math.min(b1['r'], b2['r']) / 2.5;
            const page = Math.min(b1['p'], b2['p']);
            html += `<line class="p tl ${data.class}" x1="${trans(b1.x)}" y1="${b1.y}" x2="${trans(b2.x)}" y2="${b2.y}" stroke-width="${width}" data-page="${page}"> </line>`;
        }
        g.innerHTML = html;
        updateVisibility();
    }, (err) => console.warn(err));
    return true;
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
        /* Class "csbg" so the dark theme can invert these: they are a light-grey wash over the
         * paper, and left alone they would read as near-white blocks on a black chart. */
        for (let i = 0; i < CONFIG.x_max / 3; i += 2)
            rects.push(`<rect class="csbg" x="${3 * i - 0.5}" y="-0.5" width="3" height="${CONFIG.y_max_grid}" fill="#dddddd"/>`);
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

/* Shift-click on a class or a differential: a yellow ring around it, removed by a second shift-click.
 * The ring is drawn from the clicked element's own coordinates (they are chart coordinates, like
 * everything in g_plot, so it follows pan and zoom), keyed by what was clicked so the same object
 * toggles it off. A differential gets an oval along its line rather than a circle, which for a long
 * d_r would cover half the chart. */
function isHighlightable(el) {
    return el && el.classList && (el.classList.contains("b") || el.classList.contains("dlhit") || el.classList.contains("ndhit"));
}

function toggleHighlight(el) {
    let key, shape;
    if (el.classList.contains("b")) {
        const cx = parseFloat(el.getAttribute("cx")), cy = parseFloat(el.getAttribute("cy"));
        const r = parseFloat(el.getAttribute("r"));
        key = `b:${el.dataset.i}:${cx}:${cy}`;
        shape = `<circle cx="${cx}" cy="${cy}" r="${r * 3}" stroke-width="${r * 0.35}"></circle>`;
    }
    else {
        const x1 = parseFloat(el.getAttribute("x1")), y1 = parseFloat(el.getAttribute("y1"));
        const x2 = parseFloat(el.getAttribute("x2")), y2 = parseFloat(el.getAttribute("y2"));
        const w = parseFloat(el.getAttribute("stroke-width")) / 8; /* the visible line's width; see the dlhit lines */
        const len = Math.hypot(x2 - x1, y2 - y1);
        const angle = Math.atan2(y2 - y1, x2 - x1) * 180 / Math.PI;
        const pad = Math.max(w * 8, 0.18);
        key = el.classList.contains("ndhit") ? `nd:${el.dataset.i}:${el.dataset.r}:${x1}:${y1}` : `d:${el.dataset.pf}:${x1}:${y1}`;
        shape = `<ellipse cx="${(x1 + x2) / 2}" cy="${(y1 + y2) / 2}" rx="${len / 2 + pad}" ry="${pad * 1.8}" transform="rotate(${angle} ${(x1 + x2) / 2} ${(y1 + y2) / 2})" stroke-width="${pad * 0.22}"></ellipse>`;
    }
    const old = g_highlights.querySelector(`[data-key="${CSS.escape(key)}"]`);
    if (old)
        old.remove();
    else
        g_highlights.insertAdjacentHTML("beforeend", shape.replace(/^<(\w+)/, `<$1 data-key="${key}"`));
    updateHighlightsButton();
}

/* The toolbar's "clear" button for the highlights: shown only while there are some. */
function updateHighlightsButton() {
    const btn = document.getElementById("button_hl_clear");
    if (btn)
        btn.style.display = g_highlights.children.length ? "" : "none";
}

function on_highlights_clear() {
    g_highlights.innerHTML = "";
    updateHighlightsButton();
}

function on_pointerdown(event) {
    if (STATE === "start") {
        if (event.button === 0) {
            div_menu_style.visibility = "hidden";
            div_binfo_style.visibility = "hidden";
            hide_proof();
            if (event.shiftKey && "sep_right" in DATA_JSON && !isHighlightable(event.target)) {
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
    {
        const ring = document.getElementById("circle_selected");
        const r = parseFloat(bullet.getAttribute("r"));
        ring.setAttribute("cx", bullet.getAttribute("cx"));
        ring.setAttribute("cy", bullet.getAttribute("cy"));
        ring.setAttribute("r", r * 2.4);
        ring.setAttribute("stroke-width", r * 0.45);
    }
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
                /* only classes still present on the page shown (p: the last page a class is on) */
                if (bullet2['p'] < CONFIG_DYNAMIC.page)
                    continue;
                const circle_prod = `<circle class="p" cx="${bullet2.x}" cy="${bullet2.y}" r="${bullet2['r'] * 1.7}", data-i=${i}></circle>`;
                g_prod.insertAdjacentHTML("beforeend", circle_prod);
            }
        }
        /* A chart exported with `ss plot_ss ... prods=lines` (the default since 2026-10-06) carries
         * only the structure-line products; the click-only multipliers are computed here, in the
         * browser (plot_assets/products.js), from the exact vectors and the ".alg.js" sidecar. */
        if (DATA_JSON["prods_mode"] === "lines" && typeof products_click === "function")
            products_click(bullet);
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
            if (event.shiftKey && isHighlightable(bullet)) {
                toggleHighlight(bullet);
            }
            else if (!event.shiftKey && bullet.classList && towerClick(bullet)) {
                /* tower mode: the click drew or removed a tower */
            }
            else if (bullet == bullet_selected) {
                /* Info pane */
                const posX = event.clientX;
                const posY = window.innerHeight - event.clientY;

                div_binfo_style.left = posX + "px";
                div_binfo_style.bottom = posY + "px";
                div_binfo_style.visibility = "visible";

                const bullet_json = getJsonForBullet(bullet)["bullets"][bullet.dataset.i];

                p_deg.innerHTML = `Deg: (${getAxisNumber(Math.round(bullet.getAttribute("cx")))},${Math.round(bullet.getAttribute("cy"))})`;
                const str_order = orderLabel(bullet_json, getJsonForBullet(bullet));
                p_order.innerHTML = str_order;
                p_order.style.display = str_order === "" ? "none" : "";
                p_base.innerHTML = `Basis: ${bullet_json['b']}`;
                const str_base = latexBullet(bullet);
                const tex_base = katex.renderToString(str_base, { throwOnError: false });
                p_latex.innerHTML = `LaTeX: ${tex_base}`;
                showSynthetic(bullet_json, getJsonForBullet(bullet), str_base);

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
                const str_known = knownLabel(bullet_json);
                p_known.innerHTML = str_known === "" ? "" : katex.renderToString(str_known, { throwOnError: false });
                p_known.style.display = str_known === "" ? "none" : "";
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
    /* typing in the Products panel (or any input) must not pan the chart */
    const tgt = event.target;
    if (tgt instanceof Element && (tgt.tagName === "INPUT" || tgt.tagName === "TEXTAREA" || tgt.tagName === "SELECT" || tgt.closest("#div_products")))
        return;
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
        else if (event.which === 68) { /* d */
            on_toggle_theme();
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
    /* xcolor has no #rrggbb syntax */
    const hex = /^#([0-9a-f]{2})([0-9a-f]{2})([0-9a-f]{2})$/i.exec(color);
    if (hex)
        return `color={rgb,255:red,${parseInt(hex[1], 16)};green,${parseInt(hex[2], 16)};blue,${parseInt(hex[3], 16)}}`;
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
                        if (ele.dataset.page >= CONFIG_DYNAMIC.page && factorIsOn(ele.dataset.cw, ele.dataset.j)) {
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

/* The About box: a small panel rather than alert(), so that it can carry a link. Click outside it,
 * the close button, or Escape to dismiss. Colours come from the theme variables (main.css). */
function on_about() {
    let box = document.getElementById("div_about");
    if (!box) {
        box = document.createElement("div");
        box.id = "div_about";
        box.style.cssText = "position:fixed; top:50%; left:50%; transform:translate(-50%,-50%); z-index:1000;"
            + "background:var(--panel-bg); color:var(--panel-fg); border:1px solid var(--panel-border);"
            + "border-radius:6px; box-shadow:0 2px 12px var(--panel-shadow); padding:16px 20px; max-width:90vw;"
            + "font:14px/1.6 sans-serif;";
        box.innerHTML = `<div style="font-weight:600; color:var(--plot-fg)">Author: Juan C. Moreno</div>`
            + `<div>Original program by Weinan Lin and Yu Zhang edited with Claude Code</div>`
            + `<div><a href="https://github.com/WayneLin92/SSeqCpp" target="_blank" rel="noopener" style="color:var(--proof-reason)">github.com/WayneLin92/SSeqCpp</a></div>`
            + `<div style="text-align:right; margin-top:10px"><button onclick="on_about_close()">Close</button></div>`;
        document.body.appendChild(box);
        document.addEventListener("pointerdown", (event) => {
            const b = document.getElementById("div_about");
            if (b && b.style.display !== "none" && !b.contains(event.target))
                on_about_close();
        });
        document.addEventListener("keydown", (event) => {
            if (event.key === "Escape")
                on_about_close();
        });
    }
    box.style.display = "";
}

function on_about_close() {
    const box = document.getElementById("div_about");
    if (box)
        box.style.display = "none";
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
                    if (classList.contains("tl")) {
                        if (ele.dataset.page >= CONFIG_DYNAMIC.page)
                            ele.removeAttribute("style");
                    }
                    else if (classList.contains("sl")) {
                        if (ele.dataset.page >= CONFIG_DYNAMIC.page && factorIsOn(ele.dataset.cw, ele.dataset.j)) {
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
                    else if (classList.contains("nd") || classList.contains("ndhit")) {
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

/* Pages E0..E40; plot.html lists E2..E40 (E0/E1 are added in cofseq mode) */
const select_page_map = { "Einf": CONFIG.R_PERM };
for (let r = 0; r <= 40; ++r)
    select_page_map[`E${r}`] = r;

function on_select_page(event) {
    CONFIG_DYNAMIC.page = select_page_map[event.target.value];
    updateVisibility();
}

/* Keys are the option texts in plot.html (dash None, dash d2..d40, dash all) */
const select_dashed_map = { "dash None": 0, "dash all": CONFIG.R_PERM };
for (let r = 2; r <= 40; ++r)
    select_dashed_map[`dash d${r}`] = r;

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
        /* Synthetic charts: `hollow` is a white (theme-background) dot -- a generator whose
         * a_0-tower has lambda-torsion -- and `rings` lists the colours of one concentric ring
         * per lambda-torsion a_0-power, drawn outwards. stroke="black" follows the theme. */
        const hollow = bullet['hollow'] === true ? ` fill="transparent" stroke="black" stroke-width="${r / 4}"` : "";
        const ele_bullet = `<circle data-i="${data_json.iPlotB}" class="p b ${data_json.class}" cx="${cx}" cy="${cy}" r="${r}"${hit}${hollow}> </circle>`;
        bulletGroup(bullet['c']).insertAdjacentHTML("beforeend", ele_bullet);
        if (Array.isArray(bullet['rings']) && bullet['rings'].length > 0) {
            /* at most three rings; a longer tower gets its count printed next to the dot */
            const rings = bullet['rings'], shown = Math.min(rings.length, 3);
            for (let i = 0; i < shown; ++i) {
                bulletGroup(bullet['c']).insertAdjacentHTML("beforeend",
                    `<circle data-i="${data_json.iPlotB}" class="p grp ${data_json.class}" cx="${cx}" cy="${cy}" r="${r * (1.7 + 0.6 * i)}" fill="none" stroke="${rings[i]}" stroke-width="${r / 4}" pointer-events="none"> </circle>`);
            }
            if (rings.length > shown) {
                const tx = cx + r * 3.2, ty = cy + r * 2.2;
                bulletGroup(bullet['c']).insertAdjacentHTML("beforeend",
                    `<text data-i="${data_json.iPlotB}" class="p grp ${data_json.class}" x="${tx}" y="${ty}" transform="translate(0,${2 * ty}) scale(1,-1)" font-size="${r * 2}" text-anchor="start" dominant-baseline="central" fill="${rings[shown - 1]}" pointer-events="none">${rings.length}</text>`);
            }
        }
        if (isFree) {
            const a = r * 1.8;
            bulletGroup(bullet['c']).insertAdjacentHTML("beforeend",
                `<rect data-i="${data_json.iPlotB}" class="p grp ${data_json.class}" x="${cx - a / 2}" y="${cy - a / 2}" width="${a}" height="${a}" fill="none" stroke="${bullet['c']}" stroke-width="${r / 4}" pointer-events="none"> </rect>`);
        }
        else if (kGrp > 1) {
            /* g_svg (an ancestor) is `scale(1,-1)` so math-style y-up reads
             * correctly for bullets; text drawn in that frame renders mirrored,
             * so counter-flip around this label's own y so the digit reads
             * upright without disturbing its position. */
            bulletGroup(bullet['c']).insertAdjacentHTML("beforeend",
                `<text data-i="${data_json.iPlotB}" class="p grp ${data_json.class}" x="${cx}" y="${cy}" transform="translate(0,${2 * cy}) scale(1,-1)" font-size="${r * 1.6}" text-anchor="middle" dominant-baseline="central" fill="${bullet['c']}" pointer-events="none">${kGrp}</text>`);
        }
    }
    if (data_json["type"] === "cofseq_gp" && "bullets_p" in data_json) {
        for (const batchEnd = data_json.iPlotBP + CONFIG.plot_batchSize; data_json.iPlotBP < batchEnd && data_json.iPlotBP < data_json["bullets_p"].length; data_json.iPlotBP++) {
            const bullet = data_json["bullets_p"][data_json.iPlotBP];
            const ele_bullet = `<circle class="p bp ${data_json.class}" cx="${trans(bullet.x)}" cy="${bullet.y}" r="${bullet.r * 0.75}" fill="transparent" stroke="${bullet.c}" stroke-width="${bullet.r / 2}"> </circle>`;
            bulletGroup(bullet['c']).insertAdjacentHTML("beforeend", ele_bullet);
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
                const hidden = factorIsOn(data_json.class, line['j']) ? "" : ` style="visibility:hidden"`;
                const ele_line = `<line class="p sl ${data_json.class}" x1="${trans(bullet1.x)}" y1="${bullet1.y}" x2="${trans(bullet2.x)}" y2="${bullet2.y}" stroke="black" stroke-width="${width}" data-page="${page}" data-cw="${data_json.class}" data-j="${line['j']}"${hidden}> </line>`;
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
                diffLineGroup(diff["r"]).insertAdjacentHTML("beforeend", ele_line);
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
                diffLineGroup(diff["r"]).insertAdjacentHTML("beforeend", ele_line);
            }
        }
    }
    for (const batchEnd = data_json.iPlotND + CONFIG.plot_batchSize / 4; data_json.iPlotND < batchEnd && data_json.iPlotND < data_json["nds"].length; data_json.iPlotND++) {
        const nd = data_json["nds"][data_json.iPlotND];
        const bullet1 = data_json["bullets"][nd["i"]];
        const width = bullet1['r'] / 4;
        const ele_line = `<line class="p nd ${data_json.class}" x1="${trans(bullet1.x)}" y1="${bullet1.y}" x2="${trans(Math.round(bullet1.x)) - 1}" y2="${Math.round(bullet1.y) + nd['r']}" stroke-width="${width}" stroke-dasharray="0.1,0.1" data-r="${nd['r']}"> </line>`;
        diffLineGroup(nd["r"]).insertAdjacentHTML("beforeend", ele_line);
        /* A click target for the dashed stub, as "dlhit" is for a drawn differential: the same
         * geometry, eight times as wide, invisible. Only shift-click uses it (a highlight); its own
         * class "ndhit" keeps it out of anything that keys off "nd". */
        const hit = `<line class="p ndhit ${data_json.class}" x1="${trans(bullet1.x)}" y1="${bullet1.y}" x2="${trans(Math.round(bullet1.x)) - 1}" y2="${Math.round(bullet1.y) + nd['r']}" stroke-width="${width * 8}" data-r="${nd['r']}" data-i="${nd['i']}"> </line>`;
        g_diffhits.insertAdjacentHTML("beforeend", hit);
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

/************************************************************************
 *   Chunked charts and the stem window
 *
 *   `ss plot_ss` writes a chart with more than 100k classes as a manifest <name>.js (no
 *   bullets/basis/prods/diffs/nds, but a "chunks" list) plus chunk files, each holding those
 *   five for a range of stems, under GLOBAL class ids (ss/plot.cpp, WriteSpectrumChart).
 *   `loadChart` loads the chunks the window needs -- ?stem_min= / ?stem_max= in the URL, set
 *   from charts.html -- and `assembleChart` renumbers them into the usual one-file form,
 *   dropping every product, differential and dash whose other end is not loaded. With no
 *   window and an unchunked file the chart object is handed over untouched.
 ***********************************************************************/
function urlStem(key) {
    const v = URL_PARAMS.get(key);
    return v === null || v.trim() === "" || isNaN(Number(v)) ? null : Number(v);
}
const STEM_WINDOW = { min: urlStem("stem_min"), max: urlStem("stem_max") };
const HAS_STEM_WINDOW = STEM_WINDOW.min !== null || STEM_WINDOW.max !== null;
function stemInWindow(stem) {
    return (STEM_WINDOW.min === null || stem >= STEM_WINDOW.min) && (STEM_WINDOW.max === null || stem <= STEM_WINDOW.max);
}
function rangeMeetsWindow(lo, hi) {
    return (STEM_WINDOW.max === null || lo <= STEM_WINDOW.max) && (STEM_WINDOW.min === null || hi >= STEM_WINDOW.min);
}

/* `parts`: objects with ids (global ids, or null for 0..n-1), bullets, basis, prods, diffs,
 * nds, and degs ([i0, stem, s, n] per bidegree, or null to read the stem off the bullet). */
function assembleChart(meta, parts, useWindow) {
    const stemOf = new Map(), where = new Map();
    for (const part of parts) {
        const n = part.bullets.length;
        for (let k = 0; k < n; ++k)
            where.set(part.ids ? part.ids[k] : k, [part, k]);
        if (part.degs) {
            for (const [i0, stem, , cnt] of part.degs)
                for (let k = 0; k < cnt; ++k)
                    stemOf.set(i0 + k, stem);
        }
        else {
            for (let k = 0; k < n; ++k)
                stemOf.set(part.ids ? part.ids[k] : k, Math.round(part.bullets[k].x));
        }
    }
    const kept = [...where.keys()].filter(g => !useWindow || stemInWindow(stemOf.get(g))).sort((a, b) => a - b);
    const newId = new Map();
    kept.forEach((g, k) => newId.set(g, k));

    const out = Object.assign({}, meta);
    delete out.chunks;
    out.bullets = [];
    out.basis = [];
    out.prods = {};
    out.diffs = [];
    out.nds = [];
    for (const g of kept) {
        const [part, k] = where.get(g);
        const b = Object.assign({}, part.bullets[k]);
        b.i0 = newId.get(b.i0);
        out.bullets.push(b);
        if (part.basis)
            out.basis.push(part.basis[k]);
    }
    for (const part of parts) {
        for (const key in part.prods) {
            const src = newId.get(Number(key));
            if (src === undefined)
                continue;
            for (const e of part.prods[key]) {
                const p = e.p.map(j => newId.get(j)).filter(j => j !== undefined);
                if (p.length === 0)
                    continue;
                (out.prods[src] = out.prods[src] || []).push(Object.assign({}, e, { p: p }));
            }
        }
        for (const d of part.diffs) {
            const i = newId.get(d.i);
            const j = d.j.map(x => newId.get(x));
            if (i === undefined || j.some(x => x === undefined))
                continue;
            out.diffs.push(Object.assign({}, d, { i: i, j: j }));
        }
        for (const d of part.nds) {
            const i = newId.get(d.i);
            if (i !== undefined)
                out.nds.push(Object.assign({}, d, { i: i }));
        }
    }
    /* [i0, stem, s, n] per bidegree, in GLOBAL ids (the Products panel maps them through gid2new);
     * an unchunked chart already carries them in its meta. */
    const degs = parts.flatMap(p => p.degs || []);
    if (degs.length)
        out.degs = degs;
    out.gid2new = newId;
    return out;
}

/* Load the chart of spectrum `name`. opts.meta: only the manifest (generator names etc.);
 * opts.window: apply the URL's stem window. Calls back with the chart object. */
const ASSEMBLED = new Map();
function loadChart(dir, name, opts, on_load) {
    loadScript(`${dir}/${name}.js`, () => {
        const raw = globalThis[`DATA_JSON_${name}`];
        const useWindow = opts.window && HAS_STEM_WINDOW;
        if (opts.meta || (!raw.chunks && !useWindow)) {
            on_load(raw);
            return;
        }
        const key = `${name}|${useWindow}`;
        if (ASSEMBLED.has(key)) {
            on_load(ASSEMBLED.get(key));
            return;
        }
        if (!raw.chunks) {
            const part = { ids: null, degs: null, bullets: raw.bullets, basis: raw.basis, prods: raw.prods || {}, diffs: raw.diffs || [], nds: raw.nds || [] };
            const out = assembleChart(raw, [part], useWindow);
            ASSEMBLED.set(key, out);
            on_load(out);
            return;
        }
        const wanted = raw.chunks.filter(c => !useWindow || rangeMeetsWindow(c.stem_min, c.stem_max));
        if (wanted.length === 0) {
            const out = assembleChart(raw, [], useWindow);
            ASSEMBLED.set(key, out);
            on_load(out);
            return;
        }
        let left = wanted.length;
        for (const c of wanted) {
            loadScript(`${dir}/${c.file}`, () => {
                if (--left > 0)
                    return;
                const out = assembleChart(raw, wanted.map(c2 => globalThis[c2.var]), useWindow);
                ASSEMBLED.set(key, out);
                on_load(out);
            });
        }
    });
}

/* A map chart's "maps" use the global ids of both spectra: renumber them like the spectra. */
function renumberMaps(data_json, cw1, cw2) {
    if (!cw1.gid2new && !cw2.gid2new)
        return;
    const maps = {};
    for (const key in data_json["maps"]) {
        const src = cw1.gid2new ? cw1.gid2new.get(Number(key)) : Number(key);
        if (src === undefined)
            continue;
        const tgt = data_json["maps"][key].map(j => cw2.gid2new ? cw2.gid2new.get(j) : j).filter(j => j !== undefined);
        if (tgt.length)
            maps[src] = tgt;
    }
    data_json["maps"] = maps;
}

/************************************************************************
 *   Synthetic charts (algnov5/stage2/synthetic.py): a class is coloured by its
 *   lambda-torsion exponent, carries its quad-degree, its relations and the key of
 *   the Z[lambda]-module of its bidegree (data_json.modules), and the chart has a
 *   legend. Charts without `modules`/`synthetic` are untouched by all of this.
 ***********************************************************************/
function synLambda(k) {
    return k > 1 ? `\\lambda^{${k}}` : "\\lambda";
}

function synSwatch(color) {
    /* black is the lambda-free colour and must follow the theme like the bullets do */
    const bg = color === "black" ? "var(--plot-fg)" : color;
    return `<i class="syn_swatch" style="background:${bg}"></i>`;
}

function showSynthetic(bullet_json, data_json, name) {
    let p_syn = document.getElementById("p_syn");
    if (p_syn === null) {
        document.getElementById("div_binfo").insertAdjacentHTML("beforeend", `<div id="p_syn"></div>`);
        p_syn = document.getElementById("p_syn");
    }
    if (bullet_json["summand"] === undefined) {
        p_syn.style.display = "none";
        return;
    }
    const kx = (s) => katex.renderToString(s, { throwOnError: false });
    /* the LaTeX line shows the summand the class generates, A_0/(...)\{x\}, the degree is the abutment's (s+w,n,s) */
    p_latex.innerHTML = `LaTeX: ${kx(`${bullet_json["summand"]}\\{${name}\\}`)}`;
    p_deg.innerHTML = `Deg: (${bullet_json["abut"].join(",")})`;
    p_order.style.display = "none";   /* the summand already says it */
    /* the torsion is already in the LaTeX line, so the panel carries nothing more */
    p_syn.style.display = "none";
    /* the panel opens at the click and the module line can be wide: keep it on screen */
    const div = document.getElementById("div_binfo");
    const rect = div.getBoundingClientRect();
    if (rect.right > window.innerWidth) {
        div.style.left = Math.max(0, window.innerWidth - rect.width - 8) + "px";
    }
}

function buildSyntheticLegend(data_json) {
    const syn = data_json["synthetic"];
    if (!syn) {
        return;
    }
    let html = `<b>&lambda;-torsion</b>`;
    for (const k of Object.keys(syn.legend).map(Number).sort((a, b) => a - b)) {
        const lab = k === 0 ? "free" : (k === 9 ? "&lambda;<sup>&ge;9</sup>" : `&lambda;<sup>${k}</sup>`);
        html += `<span>${synSwatch(syn.legend[k])}${lab}</span>`;
    }
    document.body.insertAdjacentHTML("beforeend", `<div id="div_synlegend">${html}</div>`);
    document.getElementById("title").innerHTML = `${DATA_NAME}: synthetic ANSS E<sub>2</sub>`;
}

function processParams() {
    const dir = URL_PARAMS.get("diagram") || "mix";
    const data = DATA_NAME;
    const win_label = HAS_STEM_WINDOW ? ` [stems ${STEM_WINDOW.min ?? ""}..${STEM_WINDOW.max ?? ""}]` : "";
    document.getElementById("title").innerHTML = `${data}: AdamsSS${win_label}`;

    /* Adjust camera */
    if (URL_PARAMS.get("scale") !== null) {
        const pivot_svg = camera.world2svg(new Vector(URL_PARAMS.get("x"), URL_PARAMS.get("y")));
        const scale = Number(URL_PARAMS.get("scale"));
        camera.zoom(pivot_svg, scale);
    }
    if (URL_PARAMS.get("x") === null && STEM_WINDOW.min !== null) {
        /* open at the left edge of the window rather than at stem 0 */
        const pivot_svg = camera.world2svg(new Vector(STEM_WINDOW.min + CONFIG.x_max_init / 2, 0));
        camera.translate(new Vector(CONFIG.margin + (window.innerWidth - CONFIG.margin) / 2 - pivot_svg.x, 0));
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

    /* Add bullets. A spectrum goes through loadChart (chunks, stem window); a map or cofiber
     * sequence file is loaded as it is, and its spectra through loadChart below. */
    const loadMain = MODE === "ss" ? (cb) => loadChart(dir, data, { window: true }, cb)
        : (cb) => loadScript(`${dir}/${data}.js`, () => cb(globalThis[`DATA_JSON_${data}`]));
    loadMain((data_json) => {
        DATA_JSON = data_json;
        buildSyntheticLegend(DATA_JSON);
        addRects();
        if (MODE === "ss") {
            DATA_JSON.class = "cw";
            registerFactorChart(DATA_JSON, data); /* sets the factor set Plot's first pass reads */
            buildFactorPanel();
            Plot(DATA_JSON);

            /* module */
            if ("over" in DATA_JSON) {
                loadChart(dir, DATA_JSON["over"], { meta: true }, (ring) => {
                    DATA_JSON["gen_names"] = ring["gen_names"];
                    DATA_JSON["gen_degs"] = ring["gen_degs"];
                });
            }
            /* the Products panel (plot_assets/products.js); hides its button on charts without the data */
            if (typeof initProducts === "function")
                initProducts(dir, DATA_JSON);
            /* the Extensions panel (plot_assets/extensions.js) */
            if (typeof initExtensions === "function")
                initExtensions(DATA_JSON);
            /* the Graph panel's ?graph= curves (plot_assets/graph.js), once the prime is known */
            if (typeof initGraph === "function")
                initGraph();
        }
        /* map */
        else if (MODE === "map") {
            DATA_JSON.sep_right = 1;
            loadChart(dir, DATA_JSON["from"], { window: true }, (from_json) => {
                DATA_JSON["cw1"] = Object.assign({}, from_json);
                DATA_JSON["cw1"].class = "cw1";
                DATA_JSON["cw1"].shift = 1;
                registerFactorChart(DATA_JSON["cw1"], DATA_JSON["from"]);
                Plot(DATA_JSON["cw1"]);

                loadChart(dir, DATA_JSON["to"], { window: true }, (to_json) => {
                    DATA_JSON["cw2"] = Object.assign({}, to_json);
                    renumberMaps(DATA_JSON, DATA_JSON["cw1"], DATA_JSON["cw2"]);
                    DATA_JSON["cw2"].class = "cw2";
                    DATA_JSON["cw2"].shift = DATA_JSON["sus"];
                    registerFactorChart(DATA_JSON["cw2"], DATA_JSON["to"]);
                    /* Both spectra are known only now, and the panel lists them together. */
                    buildFactorPanel();
                    Plot(DATA_JSON["cw2"]);
                    Plot(DATA_JSON);

                    /* modules */
                    if ("over" in DATA_JSON["cw1"]) {
                        loadChart(dir, DATA_JSON["cw1"]["over"], { meta: true }, (ring1) => {
                            DATA_JSON["cw1"]["gen_names"] = ring1["gen_names"];

                            if ("over" in DATA_JSON["cw2"]) {
                                loadChart(dir, DATA_JSON["cw2"]["over"], { meta: true }, (ring2) => {
                                    DATA_JSON["cw2"]["gen_names"] = ring2["gen_names"];
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
                registerFactorChart(DATA_JSON["cofseq_groups"][iCw], DATA_JSON["names"][iCw]);
                Plot(DATA_JSON["cofseq_groups"][iCw]);

                /* the whole term, unwindowed: the cofiber-sequence file indexes its basis by global id */
                loadChart(dir, DATA_JSON["names"][iCw], { window: false }, (data_json_csi) => {
                    DATA_JSON["cofseq_groups"][iCw]["basis"] = data_json_csi["basis"];
                    if ("gen_names" in data_json_csi)
                        DATA_JSON["cofseq_groups"][iCw]["gen_names"] = data_json_csi["gen_names"];
                    else {
                        DATA_JSON["cofseq_groups"][iCw]["v_names"] = data_json_csi["v_names"];
                        loadChart(dir, data_json_csi["over"], { meta: true }, (ring) => {
                            DATA_JSON["cofseq_groups"][iCw]["gen_names"] = ring["gen_names"];
                        });
                    }
                });
            }
            buildFactorPanel();
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
    /* ss mode adds the ?graph= curves once its chart (and so its prime) has loaded */
    if (MODE !== "ss" && typeof initGraph === "function")
        initGraph();
    // if (MODE !== "FromRes")
    //     addBulletLabels();
    updateAxisLabels();

    initHandlers();

    processParams();
}
