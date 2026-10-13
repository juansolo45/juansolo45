/* massey.js -- triple Massey products on the pages of the chart, in the browser.
 *
 * A port of `ss massey` (ss/massey.cpp) for the viewer's Products panel, checked against
 * `ss massey_batch` by scripts/products_js/harness.js (test M). Nothing here touches the DOM.
 *
 * Conventions (README, "Moss's higher Leibniz rule"): Moss's, Math. Z. 115 (1970) sec. 3:
 *     <a,b,c> = [u c - (-1)^{stem a} a v],   d u = a b,   d v = b c,
 * in the DGA (E_{r-1}, d_{r-1}), modulo a E_r + E_r c. Products are the E_2 products of alg.js
 * (ss's twisted product); a module class stands first, and m * y = (-1)^{stem m stem y} y * m.
 *
 * Pages. A bracket is formed on its natural page r0 = max(page where ab dies, page where bc dies):
 * below r0 it is not defined, above it it is its whole indeterminacy (it contains zero). The panel
 * shows the bracket on r0 and its image on the page the chart is on.
 *   r0 = 2   an Ext bracket: chain-level, computed by `Adamsp massey_all` and exported by
 *            `ss plot_ss` as the ".massey.js" sidecar (looked up here by coordinates, also as the
 *            reverse <c,b,a> for a ring);
 *   r0 >= 3  computed here from the staircases: d_{r-1}-preimages are the sources recorded on the
 *            boundary rows ("d" of a row with level < 5000), the indeterminacy comes from the rows
 *            spanning E_r.
 *
 * Staircases are read exactly as ss reads them (GetDiffAndLevel, IsZeroOnLevel, Residue): a class's
 * coordinates over the rows of its bidegree are unique (getInvImage), its level is the largest level
 * among the rows it uses, and a source / differential is the combination of the "d" of the rows of
 * that level -- with the class's OWN coordinates (the sign error ss's GetDiffAndLevel had until
 * 2026-10-07 is not repeated here).
 */
(function (root, factory) {
    if (typeof module === "object" && module.exports)
        module.exports = factory(require("./alg.js"));
    else
        root.SSMassey = factory(root.SSAlg);
})(typeof globalThis !== "undefined" ? globalThis : this, function (SSAlg) {
    "use strict";

    const { LEVEL_MAX, LEVEL_PERM, vecAdd, vecScale, vecFromChart, getInvImage, classAtPage, modInv } = SSAlg;
    const ZERO = () => ({ inds: [], cs: [] });
    const isZeroVec = (v) => v.inds.length === 0;

    /* "i,j*c" as ss serializes an FpVec, and back */
    function parseVec(str) {
        if (!str)
            return ZERO();
        const inds = [], cs = [];
        for (const part of str.split(",")) {
            const [i, c] = part.split("*");
            inds.push(+i);
            cs.push(c === undefined ? 1 : +c);
        }
        return { inds, cs };
    }
    function serializeVec(v) {
        return v.inds.map((i, k) => (v.cs[k] === 1 ? `${i}` : `${i}*${v.cs[k]}`)).join(",");
    }

    /* echelon spaces, as linap::GetSpace / linap::Residue */
    function residue(space, v, p) {
        let cur = v;
        for (const row of space) {
            const k = cur.inds.indexOf(row.inds[0]);
            if (k < 0)
                continue;
            const c = (cur.cs[k] * modInv(row.cs[0], p)) % p;
            cur = vecAdd(cur, row, p - c, p);
        }
        return cur;
    }
    function getSpace(vectors, p) {
        const space = [];
        for (const v of vectors) {
            const r = residue(space, v, p);
            if (!isZeroVec(r))
                space.push(r);
        }
        return space;
    }
    const sign = (parity, p) => ((parity & 1) ? p - 1 : 1);
    const degAdd = (a, b) => [a[0] + b[0], a[1] + b[1]];
    const degSub = (a, b) => [a[0] - b[0], a[1] - b[1]];
    const degKey = (d) => `${d[0]},${d[1]}`;

    /**
     * The pages of one spectrum, over its ring.
     *   ring, module   alg.js's Ring and Module (module null for a ring spectrum)
     *   chartS         the spectrum's Chart; chartR the ring's (the same object for a ring)
     *   e2             the parsed ".massey.js" sidecar, or null
     * Elements are {side: "S" | "R", deg: [stem, s], vec} (E_2 coordinates); for a ring both sides
     * are the same chart.
     */
    class Pages {
        constructor({ ring, module, chartS, chartR, e2 }) {
            this.ring = ring;
            this.module = module || null;
            this.p = ring.p;
            this.chart = { S: chartS, R: chartR || chartS };
            this.isModule = !!module;
            this.e2 = e2 ? new E2Index(e2, this.isModule) : null;
        }
        el(side, deg, vec) {
            return { side: this.isModule ? side : "S", deg, vec };
        }
        rows(side, deg) {
            return this.chart[this.isModule ? side : "S"].rowsAt(deg[0], deg[1]);
        }
        hasDeg(side, deg) {
            return this.chart[this.isModule ? side : "S"].hasDeg(deg[0], deg[1]);
        }
        /** x * y in E_2. y is a ring class; x a ring or (first factor) module class. */
        mul(x, y) {
            const deg = degAdd(x.deg, y.deg);
            const xs = this.isModule ? x.side : "R", ys = this.isModule ? y.side : "R";
            const outSide = xs === "S" || ys === "S" ? "S" : "R";
            if (isZeroVec(x.vec) || isZeroVec(y.vec))
                return this.el(outSide, deg, ZERO());
            const cx = this.chart[this.isModule ? xs : "S"], cy = this.chart[this.isModule ? ys : "S"];
            const P = cx.fromVec(x.vec, x.deg), Q = cy.fromVec(y.vec, y.deg);
            let prod, c = 1;
            if (!this.isModule)
                prod = this.ring.mul(P, Q);
            else if (xs === "R" && ys === "R")
                prod = this.ring.mul(P, Q);
            else if (xs === "R" && ys === "S")
                prod = this.module.mul(P, Q);
            else if (xs === "S" && ys === "R") {
                prod = this.module.mul(Q, P); /* m * y = (-1)^{stem m stem y} y * m */
                c = sign(x.deg[0] * y.deg[0], this.p);
            }
            else
                throw new Error("cannot multiply two module classes");
            if (SSAlg.isZero(prod))
                return this.el(outSide, deg, ZERO());
            const vec = this.chart[this.isModule ? outSide : "S"].toVec(prod, deg);
            return this.el(outSide, deg, c === 1 ? vec : vecScale(vec, c, this.p));
        }
        add(x, y, c = 1) {
            return this.el(x.side, x.deg, vecAdd(x.vec, y.vec, c, this.p));
        }
        scale(x, c) {
            return this.el(x.side, x.deg, vecScale(x.vec, c, this.p));
        }
        /** x's coordinates over the rows of its bidegree: [{j, c}] */
        expand(x) {
            if (isZeroVec(x.vec))
                return { rows: [], coeffs: [] };
            const rows = this.rows(x.side, x.deg);
            if (!rows)
                throw new Error(`no classes at (${x.deg[0]}, ${x.deg[1]})`);
            const inv = getInvImage(rows.map((r) => r.vec), x.vec, this.p);
            return { rows, coeffs: inv.inds.map((j, k) => ({ j, c: inv.cs[k] })) };
        }
        /** ss's GetDiffAndLevel, with the honest sign: {L, src} -- L the level of x (1 for zero),
         * src the combination of the "d" of the rows of that level (null if one is unknown). */
        levelInfo(x) {
            if (isZeroVec(x.vec))
                return { L: 1, src: ZERO() };
            const { rows, coeffs } = this.expand(x);
            let L = -1;
            for (const { j } of coeffs)
                L = Math.max(L, rows[j].level);
            let src = ZERO();
            for (const { j, c } of coeffs) {
                if (rows[j].level !== L)
                    continue;
                if (src === null || rows[j].diff === null) {
                    src = null;
                    continue;
                }
                src = vecAdd(src, rows[j].diff, c, this.p);
            }
            return { L, src };
        }
        /** zero on E_R: a combination of rows with level < R (IsZeroOnLevel(sc, x, R)) */
        zeroOnPage(x, R) {
            if (isZeroVec(x.vec))
                return true;
            const { rows, coeffs } = this.expand(x);
            return coeffs.every(({ j }) => rows[j].level < R);
        }
        /** survives to E_R (IsZeroOnLevel(sc, x, LEVEL_MAX - R + 1)) */
        survives(x, R) {
            if (isZeroVec(x.vec))
                return true;
            const { rows, coeffs } = this.expand(x);
            return coeffs.every(({ j }) => rows[j].level <= LEVEL_MAX - R);
        }
        /** x modulo the d_{<R} boundaries (ss's Residue(x, ..., R)): its canonical E_R representative */
        toPage(x, R) {
            if (isZeroVec(x.vec) || !this.hasDeg(x.side, x.deg))
                return x;
            const { rows, coeffs } = this.expand(x);
            let v = x.vec;
            for (const { j, c } of coeffs)
                if (rows[j].level < R)
                    v = vecAdd(v, rows[j].vec, this.p - c, this.p);
            return this.el(x.side, x.deg, v);
        }
        /** u with d_{R-1} u = y on E_{R-1} (ErDGA::SolveD); throws with the reason */
        solveD(y, R) {
            const degU = [y.deg[0] + 1, y.deg[1] - (R - 1)];
            if (isZeroVec(y.vec))
                return this.el(y.side, degU, ZERO());
            const { L, src } = this.levelInfo(y);
            if (L < R - 1)
                return this.el(y.side, degU, ZERO());
            if (L === R - 1) {
                if (src === null)
                    throw new Error(`the d_${R - 1} preimage of the class at (${y.deg[0]}, ${y.deg[1]}) is unknown`);
                return this.el(y.side, degU, src);
            }
            throw new Error(`the class at (${y.deg[0]}, ${y.deg[1]}) is not a d_${R - 1} boundary`);
        }
        /** the rows spanning E_R at deg (ErBasisRows): {vecs, uncertain} */
        erBasisRows(side, deg, R) {
            const rows = this.rows(side, deg);
            const out = { vecs: [], uncertain: false };
            if (!rows)
                return out;
            for (const row of rows) {
                const L = row.level;
                if (L < R)
                    continue;
                if (L <= LEVEL_MAX - R) {
                    out.vecs.push(row.vec);
                    continue;
                }
                const rp = LEVEL_MAX - L;
                const knownNonzero = row.diff !== null && row.diff.inds.length > 0;
                if (knownNonzero)
                    continue;
                if (row.diff !== null && rp + 1 >= R) {
                    out.vecs.push(row.vec);
                    continue;
                }
                out.vecs.push(row.vec);
                out.uncertain = true;
            }
            return out;
        }
        /** (each of firsts) * E_R + E_R * (each of lasts) at deg, as E_R classes (ErIndet) */
        indet(deg, firsts, lasts, R) {
            const vectors = [];
            let uncertain = false;
            const push = (prod) => {
                const v = this.toPage(prod, R).vec;
                if (!isZeroVec(v))
                    vectors.push(v);
            };
            for (const f of firsts) {
                if (!f || isZeroVec(f.vec))
                    continue;
                const d = degSub(deg, f.deg);
                if (!this.hasDeg("R", d))
                    continue;
                const b = this.erBasisRows("R", d, R);
                uncertain = uncertain || b.uncertain;
                for (const v of b.vecs)
                    push(this.mul(f, this.el("R", d, v)));
            }
            for (const g of lasts) {
                if (!g || isZeroVec(g.vec))
                    continue;
                const d = degSub(deg, g.deg);
                if (!this.hasDeg("S", d))
                    continue;
                const b = this.erBasisRows("S", d, R);
                uncertain = uncertain || b.uncertain;
                for (const v of b.vecs)
                    push(this.mul(this.el("S", d, v), g));
            }
            return { space: getSpace(vectors, this.p), uncertain };
        }

        /** The natural page of <a,b,c>: {ab, bc, Lab, Lbc, r0} (r0 null: not defined on any page) */
        natural(a, b, c) {
            const ab = this.mul(a, b), bc = this.mul(b, c);
            const Lab = this.levelInfo(ab).L, Lbc = this.levelInfo(bc).L;
            const half = LEVEL_MAX / 2;
            return { ab, bc, Lab, Lbc, r0: Lab >= half || Lbc >= half ? null : Math.max(Lab, Lbc) + 1 };
        }

        /** <a,b,c> on E_R (R = null: its natural page), as `ss massey_batch` computes it:
         *   {status: "ok" | "undefined" | "e2", r0, R, deg, u, v, rep (on E_R), indet (echelon E_R
         *    classes), uncertain, note}. For R = 2 the E_2 sidecar is consulted ("e2" when absent). */
        bracket(a, b, c, R = null) {
            const out = { status: "undefined", r0: null, R: null, deg: null, note: "" };
            if (isZeroVec(a.vec) || isZeroVec(b.vec) || isZeroVec(c.vec)) {
                out.note = "a factor is zero";
                return out;
            }
            const nat = this.natural(a, b, c);
            Object.assign(out, { ab: nat.ab, bc: nat.bc, Lab: nat.Lab, Lbc: nat.Lbc });
            if (nat.r0 === null) {
                out.note = `${nat.Lab >= LEVEL_MAX / 2 ? "ab" : "bc"} is not killed by any differential`;
                return out;
            }
            out.r0 = nat.r0;
            out.R = R === null ? nat.r0 : R;
            if (out.R < nat.r0) {
                out.note = `not defined below E_${nat.r0}: ${nat.Lab >= out.R ? "ab" : "bc"} is still nonzero on E_${out.R}`;
                return out;
            }
            for (const [x, name] of [[a, "a"], [b, "b"], [c, "c"]])
                if (!this.survives(x, out.R)) {
                    out.note = `${name} does not survive to E_${out.R}`;
                    return out;
                }
            const Rr = out.R;
            out.deg = [a.deg[0] + b.deg[0] + c.deg[0] + 1, a.deg[1] + b.deg[1] + c.deg[1] - (Rr - 1)];
            if (Rr === 2) {
                const hit = this.e2 ? this.e2.find(a, b, c, this.p) : null;
                if (!hit) {
                    out.status = "e2";
                    out.note = this.e2 ? "not among the exported E_2 brackets (generator triples of Adamsp massey_all)" : "no E_2 Massey data was exported for this chart";
                    return out;
                }
                out.status = "ok";
                out.source = hit.reversed ? "E2 data, as the reverse <c,b,a>" : "E2 data";
                out.rep = this.el("S", out.deg, hit.x);
                out.indet = getSpace(hit.indet, this.p);
                out.uncertain = false;
                return out;
            }
            if (!this.hasDeg("S", out.deg)) {
                out.status = "ok";
                out.rep = this.el("S", out.deg, ZERO());
                out.indet = [];
                out.uncertain = false;
                out.note = "no classes at the bracket's bidegree";
                return out;
            }
            try {
                out.u = this.solveD(nat.ab, Rr);
                out.v = this.solveD(nat.bc, Rr);
            }
            catch (err) {
                out.note = err.message;
                return out;
            }
            /* u c - (-1)^{stem a} a v */
            const uc = this.mul(out.u, c), av = this.mul(a, out.v);
            const rep = this.add(this.el("S", out.deg, uc.vec), this.el("S", out.deg, av.vec), this.p - sign(a.deg[0], this.p));
            out.rep = this.toPage(rep, Rr);
            const ind = this.indet(out.deg, [a], [c], Rr);
            out.indet = ind.space;
            out.uncertain = ind.uncertain;
            out.status = "ok";
            out.source = "computed";
            return out;
        }

        /** Does the coset contain zero on E_R? (rep in span(indet) + B_{R-1}) */
        containsZero(br) {
            return isZeroVec(residue(br.indet, this.toPage(br.rep, br.R).vec, this.p));
        }

        /** Moss's higher Leibniz rule for d_R on a bracket formed on E_R (Theorem 1.1):
         *   d_R<a,b,c> in -<(d_R a, a), [[b,0],[(-)^|a| d_R b, b]], [c; (-)^{|a|+|b|} d_R c]>.
         * {status: "ok" | "unknown" | "unavailable" | "undefined", d: [da, db, dc], target, y, In,
         *  uncertain, known: {status, vec}, agrees, note}. */
        leibniz(a, b, c, br) {
            const R = br.R, p = this.p;
            const out = { status: "unavailable", note: "" };
            const target = [br.deg[0] - 1, br.deg[1] + R];
            out.target = target;
            if (!this.hasDeg("S", target)) {
                out.status = "ok";
                out.y = this.el("S", target, ZERO());
                out.In = [];
                out.empty = true;
                out.note = `d_${R} lands where there is nothing`;
                return out;
            }
            const ds = [];
            for (const [x, name] of [[a, "a"], [b, "b"], [c, "c"]]) {
                const rows = this.rows(x.side, x.deg);
                const cls = classAtPage(rows, x.vec, R + 1, p);
                if (cls.status === "undetermined") {
                    out.status = "unknown";
                    out.note = `d_${cls.rUnknown} of ${name} is not known`;
                    return out;
                }
                const ddeg = [x.deg[0] - 1, x.deg[1] + R];
                ds.push(this.el(x.side, ddeg, cls.status === "dies" ? cls.dvec : ZERO()));
            }
            out.d = ds;
            const [dA, dB, dC] = ds;
            const allZero = ds.every((d) => isZeroVec(d.vec));
            let gamma;
            let In;
            if (allZero) {
                gamma = this.el("S", target, ZERO());
                In = this.indet(target, [a], [c], R);
            }
            else if (R >= 3) {
                const sa = a.deg[0], sb = b.deg[0];
                const dbp = this.scale(dB, sign(sa, p)), dcp = this.scale(dC, sign(sa + sb, p));
                const p00 = this.add(this.mul(dA, b), this.mul(a, dbp));
                const p01 = this.mul(a, b);
                const q0 = this.mul(b, c);
                const q1 = this.add(this.mul(dbp, c), this.mul(b, dcp));
                for (const [x, what] of [[p00, "d a b + a d b"], [p01, "ab"], [q0, "bc"], [q1, "d b c + b d c"]])
                    if (!this.zeroOnPage(x, R)) {
                        out.status = "undefined";
                        out.note = `the matric product is not defined: ${what} is nonzero on E_${R}`;
                        return out;
                    }
                let g, u, v, g2;
                try {
                    g = this.solveD(p00, R);
                    u = this.solveD(p01, R);
                    v = this.solveD(q0, R);
                    g2 = this.solveD(q1, R);
                }
                catch (err) {
                    out.status = "undefined";
                    out.note = `the matric product: ${err.message}`;
                    return out;
                }
                /* g c + u d'c - ~(d a) v - ~a g2,  ~x = (-1)^{stem x} x */
                let rep = this.el("S", target, ZERO());
                const acc = (x, coeff) => { rep = this.el("S", target, vecAdd(rep.vec, x.vec, coeff, p)); };
                acc(this.mul(g, c), 1);
                acc(this.mul(u, dcp), 1);
                acc(this.mul(dA, v), p - sign(dA.deg[0], p));
                acc(this.mul(a, g2), p - sign(a.deg[0], p));
                gamma = rep;
                In = this.indet(target, [dA, a], [c, dC], R);
            }
            else {
                const hit = this.e2 ? this.e2.findMatric(a, b, c, ds, p) : null;
                if (!hit) {
                    out.status = "unavailable";
                    out.note = "the E_2 matric product is a chain-level computation not in the exported data: run `ss deduce massey <cat> requests=1 apply=0`, `Adamsp massey_requests`, then `ss plot_ss` again (or scripts/massey_round.sh)";
                    return out;
                }
                gamma = this.el("S", target, hit.x);
                In = { space: getSpace(hit.indet, p), uncertain: false };
            }
            out.y = this.toPage(this.scale(gamma, p - 1), R);
            const inR = [];
            for (const w of In.space) {
                const z = this.toPage(this.el("S", target, w), R).vec;
                if (!isZeroVec(z))
                    inR.push(z);
            }
            out.In = getSpace(inR, p);
            out.uncertain = In.uncertain;
            out.status = "ok";
            /* what the chart knows */
            const fx = classAtPage(this.rows("S", br.deg), br.rep.vec, R + 1, p);
            if (fx.status === "undetermined")
                out.known = { status: "unknown" };
            else {
                const known = fx.status === "dies" ? fx.dvec : ZERO();
                out.known = { status: "known", vec: known };
                const diff = this.toPage(this.el("S", target, vecAdd(known, out.y.vec, p - 1, p)), R).vec;
                out.agrees = isZeroVec(residue(out.In, diff, p));
            }
            return out;
        }

        /* ---------------------------------------------------------------- search
         * Which Massey products contain a class x on page r? Brackets of named generators only:
         * the exported E_2 ones whose bidegree is x's, and the E_r0 ones (3 <= r0 <= r) of generator
         * triples whose bidegrees add up to x's plus (r0 - 1, r0 - 2), formed on their natural page
         * r0 = exactly that one. x lies in a bracket when x = lambda^{-1} (rep - i) modulo the
         * d_{<r} boundaries for some i in the indeterminacy, lambda a unit. A bracket that contains
         * zero is its indeterminacy a E_r + E_r c, a subspace: x lies in it exactly when x is in that
         * subspace, and such hits are reported apart (zeroHits) since they say only that x is
         * decomposable as a y + z c. */
        generators() {
            if (this.gens)
                return this.gens;
            const ringGens = [], firstGens = [];
            const R = this.ring;
            for (let g = 0; g < R.genDegs.length; ++g) {
                const deg = R.genDegs[g];
                if (deg[1] === 0 && deg[0] === 0)
                    continue;
                try {
                    if (!this.hasDeg("R", deg))
                        continue;
                    const vec = this.chart[this.isModule ? "R" : "S"].toVec(R.gen(g), deg);
                    ringGens.push({ g, el: this.el("R", deg, vec) });
                }
                catch (err) {
                    /* an unnamed or unloaded generator */
                }
            }
            if (this.isModule) {
                for (let v = 0; v < this.module.vDegs.length; ++v) {
                    const deg = this.module.vDegs[v];
                    try {
                        if (!this.hasDeg("S", deg))
                            continue;
                        const vec = this.chart.S.toVec(this.module.gen(v), deg);
                        firstGens.push({ v, el: this.el("S", deg, vec) });
                    }
                    catch (err) {
                    }
                }
            }
            const byDeg = new Map();
            for (const x of ringGens) {
                const key = degKey(x.el.deg);
                if (!byDeg.has(key))
                    byDeg.set(key, []);
                byDeg.get(key).push(x);
            }
            this.gens = { ring: ringGens, first: this.isModule ? firstGens : ringGens, byDeg };
            return this.gens;
        }

        /** x in (rep + span(indet)) * lambda modulo B_{r-1} at x's bidegree, for some unit lambda:
         * returns lambda (x = lambda^{-1} * element), or 0. When the bracket contains zero on E_r it
         * is a subspace: returns -1 if x lies in it, 0 otherwise. */
        memberOf(x, br, r) {
            const p = this.p;
            const rows = this.rows("S", x.deg) || [];
            const space = getSpace([...br.indet, ...rows.filter((row) => row.level < r).map((row) => row.vec)], p);
            if (isZeroVec(residue(space, br.rep.vec, p)))
                return isZeroVec(residue(space, x.vec, p)) ? -1 : 0; /* contains zero on E_r */
            for (let lambda = 1; lambda < p; ++lambda)
                if (isZeroVec(residue(space, vecAdd(br.rep.vec, x.vec, p - lambda, p), p)))
                    return lambda;
            return 0;
        }

        /** {hits: [{r0, a, b, c, lambda, source}], zeroHits: [same, lambda 1], stats} for the class
         * x (side S) on page r; zeroHits are the brackets that contain zero and x. */
        search(x, r, opts = {}) {
            const p = this.p, maxPage = Math.min(r, opts.maxPage || 40);
            const hits = [], zeroHits = [];
            const record = (lambda, h) => {
                if (lambda > 0)
                    hits.push({ ...h, lambda });
                else if (lambda < 0)
                    zeroHits.push({ ...h, lambda: 1 });
            };
            const stats = { e2: 0, triples: 0, computed: 0, errors: 0, firstError: "" };
            const rowsX = this.rows("S", x.deg) || [];
            const xr = getSpace(rowsX.filter((row) => row.level < r).map((row) => row.vec), p);
            if (isZeroVec(residue(xr, x.vec, p)))
                return { hits, zeroHits, stats, zero: true };
            /* E_2: the exported brackets at x's bidegree */
            if (this.e2) {
                for (const e of this.e2.at(x.deg)) {
                    ++stats.e2;
                    const br = { R: 2, rep: this.el("S", x.deg, e.x), indet: getSpace(e.indet, p) };
                    record(this.memberOf(x, br, r), { r0: 2, a: this.el("S", e.a.deg, e.a.vec), b: this.el("R", e.b.deg, e.b.vec), c: this.el("R", e.c.deg, e.c.vec), source: "E2 data" });
                }
            }
            /* E_r0, r0 >= 3: generator triples */
            const gens = this.generators();
            const abCache = new Map(), bcCache = new Map();
            const level = (cache, key, f) => {
                if (!cache.has(key)) {
                    try {
                        cache.set(key, f());
                    }
                    catch (err) {
                        cache.set(key, null);
                    }
                }
                return cache.get(key);
            };
            for (let r0 = 3; r0 <= maxPage; ++r0) {
                const total = [x.deg[0] - 1, x.deg[1] + r0 - 1]; /* stem and s of a + b + c */
                for (let ia = 0; ia < gens.first.length; ++ia) {
                    const A = gens.first[ia].el;
                    for (let ib = 0; ib < gens.ring.length; ++ib) {
                        const B = gens.ring[ib].el;
                        const cdeg = degSub(degSub(total, A.deg), B.deg);
                        const cs = gens.byDeg.get(degKey(cdeg));
                        if (!cs)
                            continue;
                        const Lab = level(abCache, `${ia},${ib}`, () => this.levelInfo(this.mul(A, B)).L);
                        if (Lab === null || Lab > r0 - 1)
                            continue;
                        for (const cc of cs) {
                            const C = cc.el;
                            const ic = gens.ring.indexOf(cc);
                            const Lbc = level(bcCache, `${ib},${ic}`, () => this.levelInfo(this.mul(B, C)).L);
                            if (Lbc === null || Lbc > r0 - 1 || Math.max(Lab, Lbc) + 1 !== r0)
                                continue;
                            ++stats.triples;
                            let br;
                            try {
                                br = this.bracket(A, B, C, r0);
                            }
                            catch (err) {
                                ++stats.errors;
                                stats.firstError = stats.firstError || err.message;
                                continue;
                            }
                            if (br.status !== "ok")
                                continue;
                            ++stats.computed;
                            if (br.deg[0] !== x.deg[0] || br.deg[1] !== x.deg[1])
                                continue;
                            record(this.memberOf(x, br, r), { r0, a: A, b: B, c: C, source: "computed" });
                        }
                    }
                }
            }
            /* for a ring, <c,b,a> is <a,b,c> up to sign: keep one of each pair */
            if (!this.isModule && !opts.keepReversed) {
                const key = (h) => `${h.r0}|${serializeVec(h.a.vec)}@${h.a.deg}|${serializeVec(h.b.vec)}@${h.b.deg}|${serializeVec(h.c.vec)}@${h.c.deg}`;
                const dedupe = (list) => {
                    const seen = new Set();
                    const kept = [];
                    for (const h of list) {
                        if (seen.has(key({ r0: h.r0, a: h.c, b: h.b, c: h.a })))
                            continue;
                        seen.add(key(h));
                        kept.push(h);
                    }
                    return kept;
                };
                return { hits: dedupe(hits), zeroHits: dedupe(zeroHits), stats, zero: false };
            }
            return { hits, zeroHits, stats, zero: false };
        }
    }

    /** The ".massey.js" sidecar, indexed by the classes' coordinates and by bidegree. */
    class E2Index {
        constructor(json, isModule) {
            this.isModule = isModule;
            this.byKey = new Map();
            this.byDeg = new Map();
            this.matric = new Map();
            const cls = (row, k) => ({ deg: [row[k], row[k + 1]], vec: parseVec(row[k + 2]) });
            for (const row of json.brackets || []) {
                const e = { a: cls(row, 0), b: cls(row, 3), c: cls(row, 6), deg: [row[9], row[10]], x: parseVec(row[11]), indet: (row[12] || []).map(parseVec) };
                this.byKey.set(this.key(e.a, e.b, e.c), e);
                const dk = degKey(e.deg);
                if (!this.byDeg.has(dk))
                    this.byDeg.set(dk, []);
                this.byDeg.get(dk).push(e);
            }
            for (const row of json.matric || []) {
                const d = (j) => ({ deg: [j[0], j[1]], vec: parseVec(j[2]) });
                const e = { a: cls(row, 0), b: cls(row, 3), c: cls(row, 6), d: [d(row[9]), d(row[10]), d(row[11])], x: parseVec(row[14]), indet: (row[15] || []).map(parseVec) };
                this.matric.set(this.key(e.a, e.b, e.c, e.d), e);
            }
            this.stemMax = json.stem_max;
            this.count = this.byKey.size;
        }
        key(a, b, c, ds) {
            const k = (x) => `${x.deg[0]},${x.deg[1]}:${serializeVec(x.vec)}`;
            return [a, b, c, ...(ds || [])].map(k).join("|");
        }
        /** the bracket <a,b,c>, or for a ring the reverse <c,b,a> with the exact symmetry sign:
         * <a,b,c> = -(-1)^{|a||b| + |a||c| + |b||c|} <c,b,a> */
        find(a, b, c, p) {
            /* <la, mb, nc> = lmn <a,b,c> exactly (same indeterminacy): look up the monic factors */
            const monic = (x) => {
                const lead = x.vec.cs[0];
                return { x: { deg: x.deg, vec: vecScale(x.vec, modInv(lead, p), p) }, lead };
            };
            const A = monic(a), B = monic(b), C = monic(c);
            const scalar = (A.lead * B.lead * C.lead) % p;
            let e = this.byKey.get(this.key(A.x, B.x, C.x));
            if (e)
                return { x: vecScale(e.x, scalar, p), indet: e.indet, reversed: false };
            if (this.isModule)
                return null;
            e = this.byKey.get(this.key(C.x, B.x, A.x));
            if (!e)
                return null;
            const na = a.deg[0], nb = b.deg[0], nc = c.deg[0];
            const s = sign(1 + na * nb + na * nc + nb * nc, p);
            return { x: vecScale(e.x, (s * scalar) % p, p), indet: e.indet, reversed: true };
        }
        /** The matric product of Moss's rule for (a, d a), (b, d b), (c, d c). It is linear in each
         * pair, so scalar multiples of an exported triple are found too: scaling (x, d x) by l scales
         * the product by l. */
        findMatric(a, b, c, ds, p) {
            const unit = (x) => modInv(x.vec.cs[0], p);
            const la = unit(a), lb = unit(b), lc = unit(c);
            const sc = (x, l) => ({ deg: x.deg, vec: vecScale(x.vec, l, p) });
            const e = this.matric.get(this.key(sc(a, la), sc(b, lb), sc(c, lc), [sc(ds[0], la), sc(ds[1], lb), sc(ds[2], lc)]));
            if (!e)
                return null;
            const back = modInv((la * lb * lc) % p, p);
            return { x: vecScale(e.x, back, p), indet: e.indet };
        }
        at(deg) {
            return this.byDeg.get(degKey(deg)) || [];
        }
    }

    return { Pages, E2Index, parseVec, serializeVec, residue, getSpace };
});
