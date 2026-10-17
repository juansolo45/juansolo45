/* SOURCE OF TRUTH: <repo>/webpages/plot_assets/theme.js -- the copy beside the `ss` binary is
   written at build time (ss/CMakeLists.txt) and is overwritten on every build. */

/************************************************************************
 *                               theme
 *
 * plot3d.html's copy of the theme block of main.js (same localStorage key, so the two viewers
 * share the choice); loaded as a plain script before plot3d.js, so the functions are globals and
 * the data-theme attribute is set before the first paint.  plot.html must NOT load this file:
 * main.js declares the same names (a duplicate `const` is a SyntaxError), and loading an extra
 * script before main.js made the chart's requestAnimationFrame drawing unreliable (2026-10-17).
 *
 * Dark mode is a black/white swap and nothing more: the chart's own colours --
 * blue generators, grey classes, the per-page differential palette, the green
 * product dots -- mean something, so they are identical in both themes. All of
 * it lives in main.css under `:root[data-theme="dark"]`; this only decides which
 * theme is on and records the choice.
 *
 * Precedence: ?theme=dark|light in the url (so a link can pin a theme, e.g. for
 * a screen share) > what was chosen here last > the OS setting.
 ***********************************************************************/
const THEME_URL_PARAMS = new URLSearchParams(window.location.search);
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
    /* plot3d.js recolours its WebGL scene on this; the svg viewer needs nothing, css does it */
    document.dispatchEvent(new CustomEvent("ss-theme", { detail: theme }));
}

/* Anything that is not exactly "dark" or "light" is ignored rather than written to the
 * attribute, so a typo in the url falls through to the remembered choice. */
function theme_valid(theme) {
    return theme === "dark" || theme === "light" ? theme : null;
}

apply_theme(
    theme_valid(THEME_URL_PARAMS.get("theme"))
    || theme_valid(theme_stored())
    || (window.matchMedia && window.matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light")
);
