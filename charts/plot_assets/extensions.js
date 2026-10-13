/* extensions.js -- the chart viewer's "Extensions" panel: hidden extensions on the E_infinity page.
 *
 * `ss plot_ss` writes, for each self-map f of the spectrum that is the third map of one of the
 * category's cofiber sequences (times p, alpha_1, v_1, ...), the hidden f-extensions recorded there:
 * "exts": [{map, label, deg: [stem, s] of f, lines: [{i, j: [...], r}], n_undetermined}], with
 * global class ids (ss/plot.cpp, PlotHiddenExtensions). This panel lists the multipliers like the
 * "Lines…" panel lists structure lines; ticking one draws its hidden extensions as dashed lines.
 * They are E_infinity information, so they are drawn on the E_infinity page only, and ticking one
 * switches the chart to that page.
 *
 * Reads main.js's globals: CONFIG, CONFIG_DYNAMIC, URL_PARAMS, select_page, latexToHtmlName,
 * escapeHtml.
 */
"use strict";

const EXTS = {
    data: null,
    on: new Set(),     /* indices into data.exts that are shown */
    drawn: new Set(),  /* indices whose <line>s exist */
};

/* one colour per multiplier, so several can be shown at once; hues read on both themes */
const EXT_COLORS = ["#d62728", "#1f77b4", "#2ca02c", "#9467bd", "#ff7f0e", "#17becf", "#e377c2", "#8c564b"];

function initExtensions(data_json) {
    EXTS.data = data_json;
    const list = document.getElementById("div_exts_list");
    const note = document.getElementById("div_exts_note");
    const exts = Array.isArray(data_json.exts) ? data_json.exts : null;
    if (!exts) {
        note.textContent = `This chart was exported before hidden extensions were added to the charts. Run  ./ss plot_ss ${URL_PARAMS.get("diagram") || ""}  (from build/bin) and reload.`;
        return;
    }
    if (exts.length === 0) {
        note.textContent = "This spectrum is not the source of a multiplication map in any of the category's cofiber sequences, so no hidden extensions are recorded for it.";
        return;
    }
    note.textContent = "Drawn dashed on the E∞ page.";
    let html = "";
    exts.forEach((e, j) => {
        const color = EXT_COLORS[j % EXT_COLORS.length];
        const undet = e.n_undetermined ? `<span class="ext_undet" title="classes whose ${escapeHtml(e.label)}-multiplication the cofiber sequence has not determined yet">${e.n_undetermined} undet.</span>` : "";
        html += `<label class="factor_row" title="${escapeHtml(e.map)} (cofiber sequence ${escapeHtml(e.cofseq || "")})">`
            + `<input type="checkbox" data-e="${j}" onchange="on_ext_toggle(event)">`
            + `<span class="ext_swatch" style="border-color:${color}"></span>`
            + `<span class="factor_name">${latexToHtmlName(e.label)}</span>`
            + `<span class="factor_deg">(${e.deg[0]}, ${e.deg[1]}) · ${e.lines.length}</span>${undet}</label>`;
    });
    list.innerHTML = html;
    select_page.addEventListener("change", exts_sync_page);
    exts_sync_page();

    /* ?exts=all, or ?exts=p,\alpha_{1} (labels or map names): show those at load */
    const want = URL_PARAMS.get("exts");
    if (want) {
        const keys = want.split(",");
        exts.forEach((e, j) => {
            if (want === "all" || keys.includes(e.label) || keys.includes(e.map)) {
                exts_draw(j);
                EXTS.on.add(j);
            }
        });
        if (EXTS.on.size)
            exts_goto_einf();
        exts_apply();
    }
}

function on_toggle_exts() {
    const div = document.getElementById("div_exts");
    if (div.style.visibility !== "visible" && typeof closeOtherPanels === "function")
        closeOtherPanels("div_exts");
    div.style.visibility = div.style.visibility === "visible" ? "hidden" : "visible";
}

/* the chart's local index of a global class id (charts assembled from chunks or a stem window are
 * renumbered; see main.js's assembleChart) */
function exts_local(gid) {
    const map = EXTS.data.gid2new;
    if (!map)
        return gid;
    return map.has(gid) ? map.get(gid) : -1;
}

function exts_draw(j) {
    if (EXTS.drawn.has(j))
        return;
    EXTS.drawn.add(j);
    const data = EXTS.data, e = data.exts[j];
    const color = EXT_COLORS[j % EXT_COLORS.length];
    const parts = [];
    for (const line of e.lines) {
        const a = exts_local(line.i);
        if (a < 0)
            continue;
        const b1 = data.bullets[a];
        for (const g of line.j) {
            const b = exts_local(g);
            if (b < 0)
                continue;
            const b2 = data.bullets[b];
            const w = Math.min(b1.r, b2.r) / 3;
            parts.push(`<line class="extl" data-e="${j}" x1="${b1.x}" y1="${b1.y}" x2="${b2.x}" y2="${b2.y}" stroke="${color}" stroke-width="${w}" stroke-dasharray="${w * 3} ${w * 2}"><title>${escapeHtml(e.label)}: jump ${line.r}</title></line>`);
        }
    }
    document.getElementById("g_extlines").insertAdjacentHTML("beforeend", parts.join(""));
}

function exts_apply() {
    for (const el of document.querySelectorAll("#g_extlines .extl"))
        el.style.display = EXTS.on.has(Number(el.dataset.e)) ? "" : "none";
    for (const box of document.querySelectorAll("#div_exts_list input"))
        box.checked = EXTS.on.has(Number(box.dataset.e));
    exts_sync_page();
}

/* shown on the E_infinity page only */
function exts_sync_page() {
    document.getElementById("g_extlines").style.display = CONFIG_DYNAMIC.page >= CONFIG.R_PERM ? "" : "none";
}

/* ticking a multiplier while another page is shown moves the chart to E_infinity */
function exts_goto_einf() {
    if (CONFIG_DYNAMIC.page >= CONFIG.R_PERM)
        return;
    select_page.value = "Einf";
    select_page.dispatchEvent(new Event("change")); /* main.js's handler and every listener (Products panel) */
}

function on_ext_toggle(event) {
    const j = Number(event.target.dataset.e);
    if (event.target.checked) {
        exts_draw(j);
        EXTS.on.add(j);
        exts_goto_einf();
    }
    else
        EXTS.on.delete(j);
    exts_apply();
}

function on_exts_all(on) {
    if (!EXTS.data || !Array.isArray(EXTS.data.exts))
        return;
    EXTS.data.exts.forEach((_, j) => {
        if (on) {
            exts_draw(j);
            EXTS.on.add(j);
        }
        else
            EXTS.on.delete(j);
    });
    if (on && EXTS.data.exts.length)
        exts_goto_einf();
    exts_apply();
}
