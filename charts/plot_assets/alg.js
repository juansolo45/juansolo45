/* alg.js -- the algebra behind the chart viewer's Products panel, in the browser.
 *
 * A port of exactly what `ss` does when it multiplies two classes (ss/utility.cpp Category::Multiply,
 * src/algebras.cpp, src/groebner.cpp, src/linalgp.cpp), working on the data `ss plot_ss` exports:
 * the chart's exact vectors ("b"/"bc", "d"/"dc" on every bullet) and the ".alg.js" sidecar (prime,
 * generator bidegrees, the Groebner basis of the relations). Nothing here touches the DOM, so the same
 * file runs under node for scripts/products_js/harness.js, which checks it against `ss mul_batch`.
 *
 * Conventions mirrored from alg2 (include/algebras/algebras.h, src/algebras.cpp):
 *  - a monomial is a flat array [g, e, g, e, ...] with g ascending; a module monomial is {m, v};
 *  - the order compares generator-exponent pairs as (~g << 16 | e), lexicographically, a prefix
 *    being smaller: per position g DESCENDING, then e ascending. The leading term of a relation is
 *    its SMALLEST term, and the sidecar stores every relation lead first;
 *  - the algebra is graded-commutative over F_p: moving v^f past u^e (v.g < u.g) costs (-1)^{e f}
 *    when both generators have odd STEM (KoszulSign, src/algebras.cpp). At p = 2 every sign is 1;
 *  - polynomial x monomial takes the sign with the term on the LEFT (mulP(poly, mon)); monomial x
 *    module element with the monomial on the left (mulP(mon, mod)); the module generator v carries
 *    no sign.
 *
 * Staircase conventions (ss/main.h): a bullet is one row of its bidegree's staircase, in echelon
 * order. Level L < 5000: a boundary hit by d_L; 9000: a permanent cycle; L > 9000: survives to
 * E_{10000-L} and "d" is d_{10000-L} of it (null = unknown). The E_r page of a bidegree has as basis
 * the rows with r <= L <= 10000 - r.
 */
(function (root, factory) {
    if (typeof module === "object" && module.exports)
        module.exports = factory();
    else
        root.SSAlg = factory();
})(typeof globalThis !== "undefined" ? globalThis : this, function () {
    "use strict";

    const LEVEL_MAX = 10000, LEVEL_PERM = 9000, R_PERM = 1000;

    /* ------------------------------------------------------------------ GF(p) */
    const invCache = new Map();
    function modInv(a, p) {
        a = ((a % p) + p) % p;
        if (a === 0)
            throw new Error(`no inverse of 0 mod ${p}`);
        const key = p * 65536 + a;
        let r = invCache.get(key);
        if (r === undefined) {
            for (r = 1; r < p; ++r)
                if ((a * r) % p === 1)
                    break;
            if (r === p)
                throw new Error(`${p} is not prime`);
            invCache.set(key, r);
        }
        return r;
    }
    function modNorm(c, p) {
        return ((c % p) + p) % p;
    }

    /* ------------------------------------------------------------------ monomials */
    function monKey(m) {
        return m.join(",");
    }
    function mmodKey(t) {
        return monKey(t.m) + "|" + t.v;
    }
    /* product of two monomials: merge by generator, adding exponents (Mon operator*) */
    function monMul(a, b) {
        const out = [];
        let i = 0, j = 0;
        while (i < a.length && j < b.length) {
            if (a[i] < b[j]) {
                out.push(a[i], a[i + 1]);
                i += 2;
            }
            else if (a[i] > b[j]) {
                out.push(b[j], b[j + 1]);
                j += 2;
            }
            else {
                out.push(a[i], a[i + 1] + b[j + 1]);
                i += 2;
                j += 2;
            }
        }
        for (; i < a.length; i += 2)
            out.push(a[i], a[i + 1]);
        for (; j < b.length; j += 2)
            out.push(b[j], b[j + 1]);
        return out;
    }
    /* lead | m */
    function monDivides(lead, m) {
        let i = 0, j = 0;
        while (i < lead.length) {
            while (j < m.length && m[j] < lead[i])
                j += 2;
            if (j >= m.length || m[j] !== lead[i] || m[j + 1] < lead[i + 1])
                return false;
            i += 2;
            j += 2;
        }
        return true;
    }
    /* m / lead, assuming lead | m */
    function monDiv(m, lead) {
        const out = [];
        let i = 0;
        for (let j = 0; j < m.length; j += 2) {
            if (i < lead.length && lead[i] === m[j]) {
                const e = m[j + 1] - lead[i + 1];
                if (e > 0)
                    out.push(m[j], e);
                i += 2;
            }
            else
                out.push(m[j], m[j + 1]);
        }
        return out;
    }
    /* alg2's order (see the file comment); negative when a < b */
    function monCmp(a, b) {
        const n = Math.min(a.length, b.length);
        for (let i = 0; i < n; i += 2) {
            if (a[i] !== b[i])
                return a[i] > b[i] ? -1 : 1;
            if (a[i + 1] !== b[i + 1])
                return a[i + 1] < b[i + 1] ? -1 : 1;
        }
        return a.length - b.length;
    }
    /* MMod order: v descending, then the monomial */
    function mmodCmp(a, b) {
        if (a.v !== b.v)
            return a.v > b.v ? -1 : 1;
        return monCmp(a.m, b.m);
    }
    function monPow(m, e) {
        const out = [];
        for (let i = 0; i < m.length; i += 2)
            out.push(m[i], m[i + 1] * e);
        return out;
    }
    /* [stem, s] of a monomial */
    function monDeg(m, genDegs) {
        let stem = 0, s = 0;
        for (let i = 0; i < m.length; i += 2) {
            const d = genDegs[m[i]];
            if (!d)
                throw new Error(`generator ${m[i]} has no degree`);
            stem += m[i + 1] * d[0];
            s += m[i + 1] * d[1];
        }
        return [stem, s];
    }
    function monGens(m) {
        const out = [];
        for (let i = 0; i < m.length; i += 2)
            out.push(m[i]);
        return out;
    }

    /* ------------------------------------------------------------------ polynomials
     * {terms: [mon...], cs: [c...]}, terms sorted ascending (terms[0] is the lead), no zero
     * coefficients, coefficients in 1..p-1. Module elements are the same with terms {m, v}. */
    function sortCombine(terms, cs, cmp, p) {
        const perm = terms.map((_, i) => i);
        perm.sort((a, b) => cmp(terms[a], terms[b]) || a - b);
        const outT = [], outC = [];
        for (let i = 0; i < perm.length;) {
            let j = i, c = 0;
            while (j < perm.length && cmp(terms[perm[j]], terms[perm[i]]) === 0) {
                c = (c + cs[perm[j]]) % p;
                ++j;
            }
            if (c !== 0) {
                outT.push(terms[perm[i]]);
                outC.push(c);
            }
            i = j;
        }
        return { terms: outT, cs: outC };
    }
    /* P + c2 * Q, both sorted (addP) */
    function addPoly(P, Q, c2, cmp, p) {
        c2 = modNorm(c2, p);
        if (c2 === 0)
            return { terms: P.terms.slice(), cs: P.cs.slice() };
        const terms = [], cs = [];
        let i = 0, j = 0;
        while (i < P.terms.length || j < Q.terms.length) {
            if (j === Q.terms.length || (i < P.terms.length && cmp(P.terms[i], Q.terms[j]) < 0)) {
                terms.push(P.terms[i]);
                cs.push(P.cs[i]);
                ++i;
            }
            else if (i === P.terms.length || cmp(Q.terms[j], P.terms[i]) < 0) {
                terms.push(Q.terms[j]);
                cs.push((c2 * Q.cs[j]) % p);
                ++j;
            }
            else {
                const c = (P.cs[i] + c2 * Q.cs[j]) % p;
                if (c !== 0) {
                    terms.push(P.terms[i]);
                    cs.push(c);
                }
                ++i;
                ++j;
            }
        }
        return { terms, cs };
    }
    function scalePoly(P, c, p) {
        c = modNorm(c, p);
        if (c === 0)
            return { terms: [], cs: [] };
        return { terms: P.terms.slice(), cs: P.cs.map((x) => (x * c) % p) };
    }
    function isZero(P) {
        return P.terms.length === 0;
    }

    /* ------------------------------------------------------------------ the ring */
    class Ring {
        /** `alg` is the parsed ".alg.js" of a ring chart; `names` its gen_names (optional). */
        constructor(alg, names) {
            if (!alg || alg.type !== "ring")
                throw new Error("Ring: expected a ring's .alg.js");
            this.p = alg.prime;
            this.tMax = alg.t_max;
            this.genDegs = alg.gen_degs;
            this.names = names || null;
            this.oddStem = this.genDegs.map((d) => d[0] & 1);
            this.relations = alg.relations.map((r) => ({ terms: r.map((t) => t[1]), cs: r.map((t) => modNorm(t[0], this.p)) }));
            /* divisor lookup: relations by the first (smallest) generator of their lead */
            this.leadIndex = new Map();
            this.relations.forEach((rel, k) => {
                const lead = rel.terms[0];
                const g = lead.length ? lead[0] : -1;
                if (!this.leadIndex.has(g))
                    this.leadIndex.set(g, []);
                this.leadIndex.get(g).push(k);
            });
            this.nfCache = new Map(); /* monomial key -> normal form */
        }
        /** Every relation's terms must be sorted with the lead first; true when they are. */
        relationsSorted() {
            return this.relations.every((rel) => rel.terms.every((m, i) => i === 0 || monCmp(rel.terms[i - 1], m) < 0));
        }
        /* (-1)^parity as 1 or p-1: the sign of sorting `left * right` (KoszulSign) */
        koszulSign(left, right) {
            if (this.p === 2)
                return 1;
            let parity = 0;
            for (let i = 0; i < left.length; i += 2) {
                if (!this.oddStem[left[i]] || !(left[i + 1] & 1))
                    continue;
                for (let j = 0; j < right.length; j += 2) {
                    if (right[j] >= left[i])
                        break;
                    parity ^= (right[j + 1] & 1) & this.oddStem[right[j]];
                }
            }
            return parity ? this.p - 1 : 1;
        }
        /* P * q (mulP(poly, mon)) */
        mulPolyMon(P, q) {
            const terms = [], cs = [];
            for (let i = 0; i < P.terms.length; ++i) {
                terms.push(monMul(P.terms[i], q));
                cs.push((P.cs[i] * this.koszulSign(P.terms[i], q)) % this.p);
            }
            return sortCombine(terms, cs, monCmp, this.p);
        }
        /* q * P (mulP(mon, poly)) */
        mulMonPoly(q, P) {
            const terms = [], cs = [];
            for (let i = 0; i < P.terms.length; ++i) {
                terms.push(monMul(q, P.terms[i]));
                cs.push((P.cs[i] * this.koszulSign(q, P.terms[i])) % this.p);
            }
            return sortCombine(terms, cs, monCmp, this.p);
        }
        /* P * Q (mulP(p1, p2)) */
        polyMul(P, Q) {
            const terms = [], cs = [];
            for (let i = 0; i < P.terms.length; ++i)
                for (let j = 0; j < Q.terms.length; ++j) {
                    terms.push(monMul(P.terms[i], Q.terms[j]));
                    cs.push((P.cs[i] * Q.cs[j] * this.koszulSign(P.terms[i], Q.terms[j])) % this.p);
                }
            return sortCombine(terms, cs, monCmp, this.p);
        }
        /* index of a relation whose lead divides m, or -1 */
        findDivisor(m) {
            for (let i = 0; i < m.length; i += 2) {
                const cands = this.leadIndex.get(m[i]);
                if (!cands)
                    continue;
                for (const k of cands)
                    if (monDivides(this.relations[k].terms[0], m))
                        return k;
            }
            const unit = this.leadIndex.get(-1); /* a relation with lead 1: the zero ring */
            return unit ? unit[0] : -1;
        }
        /* Groebner normal form (Groebner::ReduceP) */
        normalForm(P) {
            let cur = { terms: P.terms.slice(), cs: P.cs.slice() };
            let index = 0;
            while (index < cur.terms.length) {
                const m = cur.terms[index];
                const k = this.findDivisor(m);
                if (k < 0) {
                    ++index;
                    continue;
                }
                const g = this.relations[k];
                const q = monDiv(m, g.terms[0]);
                const tmp = this.mulPolyMon(g, q);
                if (monCmp(tmp.terms[0], m) !== 0)
                    throw new Error("normalForm: the order is not multiplicative here");
                const c = cur.cs[index];
                const mult = (this.p - (c * modInv(tmp.cs[0], this.p)) % this.p) % this.p;
                cur = addPoly(cur, tmp, mult, monCmp, this.p);
            }
            return cur;
        }
        /* normal form of a single monomial, cached */
        normalFormMon(m) {
            const key = monKey(m);
            let nf = this.nfCache.get(key);
            if (!nf) {
                nf = this.normalForm({ terms: [m], cs: [1] });
                this.nfCache.set(key, nf);
            }
            return nf;
        }
        /* the reduced product of two polynomials in normal form */
        mul(P, Q) {
            const prod = this.polyMul(P, Q);
            let out = { terms: [], cs: [] };
            for (let i = 0; i < prod.terms.length; ++i)
                out = addPoly(out, this.normalFormMon(prod.terms[i]), prod.cs[i], monCmp, this.p);
            return out;
        }
        deg(P) {
            return isZero(P) ? null : monDeg(P.terms[0], this.genDegs);
        }
        /* every term has the same bidegree? */
        homogeneous(P) {
            if (isZero(P))
                return true;
            const d = monDeg(P.terms[0], this.genDegs);
            return P.terms.every((m) => {
                const e = monDeg(m, this.genDegs);
                return e[0] === d[0] && e[1] === d[1];
            });
        }
        gen(g, e = 1) {
            return { terms: [e > 0 ? [g, e] : []], cs: [1] };
        }
        /* generators by bidegree: the k-th (1-based) at (stem, s), as ss names them, or -1 */
        findGen(stem, s, k = 1) {
            let seen = 0;
            for (let g = 0; g < this.genDegs.length; ++g)
                if (this.genDegs[g][0] === stem && this.genDegs[g][1] === s && ++seen === k)
                    return g;
            return -1;
        }
    }

    /* ------------------------------------------------------------------ a module over the ring */
    class Module {
        constructor(alg, ring, names) {
            if (!alg || alg.type !== "module")
                throw new Error("Module: expected a module's .alg.js");
            this.ring = ring;
            this.p = ring.p;
            this.tMax = alg.t_max;
            this.vDegs = alg.v_degs;
            this.names = names || null;
            this.relations = (alg.relations_mod || []).map((r) => ({ terms: r.map((t) => ({ m: t[1], v: t[2] })), cs: r.map((t) => modNorm(t[0], this.p)) }));
            this.leadIndex = new Map(); /* v -> relation indices */
            this.relations.forEach((rel, k) => {
                const v = rel.terms[0].v;
                if (!this.leadIndex.has(v))
                    this.leadIndex.set(v, []);
                this.leadIndex.get(v).push(k);
            });
            this.nfCache = new Map();
        }
        relationsSorted() {
            return this.relations.every((rel) => rel.terms.every((t, i) => i === 0 || mmodCmp(rel.terms[i - 1], t) < 0));
        }
        /* q * M (mulP(mon, mod)): the sign has the monomial on the left, v carries none */
        mulMonMod(q, M) {
            const terms = [], cs = [];
            for (let i = 0; i < M.terms.length; ++i) {
                terms.push({ m: monMul(q, M.terms[i].m), v: M.terms[i].v });
                cs.push((M.cs[i] * this.ring.koszulSign(q, M.terms[i].m)) % this.p);
            }
            return sortCombine(terms, cs, mmodCmp, this.p);
        }
        /* P * M (mulP(poly, mod)) */
        mulPolyMod(P, M) {
            const terms = [], cs = [];
            for (let i = 0; i < P.terms.length; ++i)
                for (let j = 0; j < M.terms.length; ++j) {
                    terms.push({ m: monMul(P.terms[i], M.terms[j].m), v: M.terms[j].v });
                    cs.push((P.cs[i] * M.cs[j] * this.ring.koszulSign(P.terms[i], M.terms[j].m)) % this.p);
                }
            return sortCombine(terms, cs, mmodCmp, this.p);
        }
        findDivisor(t) {
            const cands = this.leadIndex.get(t.v);
            if (cands)
                for (const k of cands)
                    if (monDivides(this.relations[k].terms[0].m, t.m))
                        return k;
            return -1;
        }
        /* GroebnerMod::ReduceP */
        normalForm(M) {
            let cur = { terms: M.terms.slice(), cs: M.cs.slice() };
            let index = 0;
            while (index < cur.terms.length) {
                const t = cur.terms[index];
                let tmp;
                const k = this.findDivisor(t);
                if (k >= 0) {
                    const rel = this.relations[k];
                    tmp = this.mulMonMod(monDiv(t.m, rel.terms[0].m), rel);
                }
                else {
                    const kr = this.ring.findDivisor(t.m);
                    if (kr < 0) {
                        ++index;
                        continue;
                    }
                    const g = this.ring.relations[kr];
                    const ptmp = this.ring.mulPolyMon(g, monDiv(t.m, g.terms[0]));
                    tmp = { terms: ptmp.terms.map((m) => ({ m, v: t.v })), cs: ptmp.cs };
                }
                if (mmodCmp(tmp.terms[0], t) !== 0)
                    throw new Error("Module.normalForm: the order is not multiplicative here");
                const c = cur.cs[index];
                const mult = (this.p - (c * modInv(tmp.cs[0], this.p)) % this.p) % this.p;
                cur = addPoly(cur, tmp, mult, mmodCmp, this.p);
            }
            return cur;
        }
        normalFormMon(t) {
            const key = mmodKey(t);
            let nf = this.nfCache.get(key);
            if (!nf) {
                nf = this.normalForm({ terms: [t], cs: [1] });
                this.nfCache.set(key, nf);
            }
            return nf;
        }
        /* the reduced product P * M */
        mul(P, M) {
            const prod = this.mulPolyMod(P, M);
            let out = { terms: [], cs: [] };
            for (let i = 0; i < prod.terms.length; ++i)
                out = addPoly(out, this.normalFormMon(prod.terms[i]), prod.cs[i], mmodCmp, this.p);
            return out;
        }
        termDeg(t) {
            const d = monDeg(t.m, this.ring.genDegs), dv = this.vDegs[t.v];
            if (!dv)
                throw new Error(`module generator ${t.v} has no degree`);
            return [d[0] + dv[0], d[1] + dv[1]];
        }
        deg(M) {
            return isZero(M) ? null : this.termDeg(M.terms[0]);
        }
        homogeneous(M) {
            if (isZero(M))
                return true;
            const d = this.termDeg(M.terms[0]);
            return M.terms.every((t) => {
                const e = this.termDeg(t);
                return e[0] === d[0] && e[1] === d[1];
            });
        }
        gen(v) {
            return { terms: [{ m: [], v }], cs: [1] };
        }
        findGen(stem, s, k = 1) {
            let seen = 0;
            for (let v = 0; v < this.vDegs.length; ++v)
                if (this.vDegs[v][0] === stem && this.vDegs[v][1] === s && ++seen === k)
                    return v;
            return -1;
        }
    }

    /* ------------------------------------------------------------------ sparse vectors
     * {inds: [ascending indices], cs: [coefficients]} -- ss's FpVec. */
    function vecAt(v, i) {
        const k = v.inds.indexOf(i);
        return k < 0 ? 0 : v.cs[k];
    }
    /* a + c * b */
    function vecAdd(a, b, c, p) {
        c = modNorm(c, p);
        if (c === 0)
            return { inds: a.inds.slice(), cs: a.cs.slice() };
        const inds = [], cs = [];
        let i = 0, j = 0;
        while (i < a.inds.length || j < b.inds.length) {
            if (j === b.inds.length || (i < a.inds.length && a.inds[i] < b.inds[j])) {
                inds.push(a.inds[i]);
                cs.push(a.cs[i]);
                ++i;
            }
            else if (i === a.inds.length || b.inds[j] < a.inds[i]) {
                inds.push(b.inds[j]);
                cs.push((c * b.cs[j]) % p);
                ++j;
            }
            else {
                const x = (a.cs[i] + c * b.cs[j]) % p;
                if (x !== 0) {
                    inds.push(a.inds[i]);
                    cs.push(x);
                }
                ++i;
                ++j;
            }
        }
        return { inds, cs };
    }
    function vecScale(v, c, p) {
        c = modNorm(c, p);
        return c === 0 ? { inds: [], cs: [] } : { inds: v.inds.slice(), cs: v.cs.map((x) => (x * c) % p) };
    }
    function vecEqual(a, b) {
        return a.inds.length === b.inds.length && a.inds.every((x, i) => x === b.inds[i] && a.cs[i] === b.cs[i]);
    }
    /* a chart vector ("b"/"bc") as a sparse vector */
    function vecFromChart(inds, cs) {
        return { inds: inds.slice(), cs: cs ? cs.slice() : inds.map(() => 1) };
    }
    /** Writes v in terms of `rows` (sparse vectors in echelon order, each pivoting on its first
     * index), exactly as linap::GetInvImage: {inds: row indices, cs: coefficients}. Throws when v is
     * not in their span. */
    function getInvImage(rows, v, p) {
        const inds = [], cs = [];
        let cur = { inds: v.inds.slice(), cs: v.cs.slice() };
        for (let j = 0; j < rows.length; ++j) {
            if (rows[j].inds.length === 0)
                continue;
            const c = vecAt(cur, rows[j].inds[0]);
            if (c !== 0) {
                const a = (c * modInv(rows[j].cs[0], p)) % p;
                cur = vecAdd(cur, rows[j], p - a, p);
                inds.push(j);
                cs.push(a);
            }
        }
        if (cur.inds.length)
            throw new Error("getInvImage: the vector is not in the span of the rows");
        return { inds, cs };
    }

    /* ------------------------------------------------------------------ the chart's staircases
     * `data` is the chart as the viewer holds it (bullets, basis, degs, prime, type, over...).
     * `gid2local(gid)` maps a global class id to its index in data.bullets/data.basis, or -1 when
     * that class is not loaded (stem window / chunk not fetched); identity by default. */
    class Chart {
        constructor(data, gid2local) {
            this.data = data;
            this.p = data.prime;
            this.isModule = data.type === "module";
            this.gid2local = gid2local || ((g) => g);
            this.degIndex = new Map(); /* "stem,s" -> {i0, n} */
            if (Array.isArray(data.degs))
                for (const [i0, stem, s, n] of data.degs)
                    this.degIndex.set(`${stem},${s}`, { i0, n });
            else {
                /* an older chart: group the bullets by their rounded position */
                data.bullets.forEach((b, gid) => {
                    const key = `${Math.round(b.x)},${Math.round(b.y)}`;
                    const e = this.degIndex.get(key);
                    if (!e)
                        this.degIndex.set(key, { i0: gid, n: 1 });
                    else
                        e.n += 1;
                });
            }
            this.rowCache = new Map();
            this.basisCache = new Map();
        }
        hasDeg(stem, s) {
            return this.degIndex.has(`${stem},${s}`);
        }
        /** The bidegree's staircase: rows {gid, local, vec, level, diff, page} in echelon order, or
         * null when the bidegree has no classes. Throws when the rows are not loaded. */
        rowsAt(stem, s) {
            const key = `${stem},${s}`;
            if (this.rowCache.has(key))
                return this.rowCache.get(key);
            const e = this.degIndex.get(key);
            let rows = null;
            if (e) {
                rows = [];
                for (let k = 0; k < e.n; ++k) {
                    const gid = e.i0 + k, local = this.gid2local(gid);
                    const b = local >= 0 ? this.data.bullets[local] : null;
                    if (!b)
                        throw new NotLoaded(stem, s);
                    rows.push({
                        gid, local, k,
                        vec: vecFromChart(b.b, b.bc),
                        level: b.l,
                        diff: b.d === null || b.d === undefined ? null : vecFromChart(b.d, b.dc),
                        page: b.p,
                    });
                }
            }
            this.rowCache.set(key, rows);
            return rows;
        }
        /** The bidegree's E_2 monomial basis: {mons, index: key -> local index}. Module monomials
         * are {m, v}. Null when the bidegree has no classes. */
        basisAt(stem, s) {
            const key = `${stem},${s}`;
            if (this.basisCache.has(key))
                return this.basisCache.get(key);
            const e = this.degIndex.get(key);
            let out = null;
            if (e) {
                const mons = [], index = new Map();
                for (let k = 0; k < e.n; ++k) {
                    const local = this.gid2local(e.i0 + k);
                    const raw = local >= 0 ? this.data.basis[local] : null;
                    if (!raw)
                        throw new NotLoaded(stem, s);
                    let mon;
                    if (this.isModule) {
                        mon = { m: raw.slice(0, raw.length - 1), v: raw[raw.length - 1] };
                        index.set(mmodKey(mon), k);
                    }
                    else {
                        mon = raw.slice();
                        index.set(monKey(mon), k);
                    }
                    mons.push(mon);
                }
                out = { mons, index };
            }
            this.basisCache.set(key, out);
            return out;
        }
        /** A polynomial (ring) or module element at `deg` as a sparse vector in the bidegree's
         * basis. Throws NoBasis for a monomial the chart does not name. */
        toVec(P, deg) {
            if (isZero(P))
                return { inds: [], cs: [] };
            const basis = this.basisAt(deg[0], deg[1]);
            if (!basis)
                throw new NoBasis(deg, P.terms[0]);
            const inds = [], cs = [];
            const pairs = P.terms.map((t, i) => {
                const k = basis.index.get(this.isModule ? mmodKey(t) : monKey(t));
                if (k === undefined)
                    throw new NoBasis(deg, t);
                return [k, P.cs[i]];
            });
            pairs.sort((a, b) => a[0] - b[0]);
            for (const [k, c] of pairs) {
                inds.push(k);
                cs.push(c);
            }
            return { inds, cs };
        }
        /** The inverse of toVec: the polynomial with those coordinates at `deg`. */
        fromVec(v, deg) {
            const basis = this.basisAt(deg[0], deg[1]);
            return { terms: v.inds.map((k) => basis.mons[k]), cs: v.cs.slice() };
        }
    }
    class NotLoaded extends Error {
        constructor(stem, s) {
            super(`the classes at (${stem}, ${s}) are not loaded`);
            this.stem = stem;
            this.s = s;
        }
    }
    class NoBasis extends Error {
        constructor(deg, term) {
            const name = term && term.m !== undefined ? `${monKey(term.m)} v${term.v}` : monKey(term || []);
            super(`no basis element at (${deg[0]}, ${deg[1]}) for the monomial [${name}]: an unnamed class`);
            this.deg = deg;
            this.term = term;
        }
    }

    /* ------------------------------------------------------------------ E_r pages
     * `vec` is a class at the bidegree with staircase `rows`, in the bidegree's E_2 basis.
     * The page r is 2..., or R_PERM for E_infinity.
     * Result: {status, rowsCoeffs: [{row, c}], ...}
     *   status "ok"            vec survives to E_r; rowsCoeffs are its coordinates in the E_r basis
     *                          (the rows with r <= level <= 10000-r); empty means 0 in E_r;
     *   status "dies"          vec supports a nonzero d_{rDies} with rDies < r: dvec is d_{rDies}(vec)
     *                          in the E_2 basis of the target bidegree (deg + (-1, rDies));
     *   status "undetermined"  vec survives to E_{rUnknown} but d_{rUnknown} of part of it is unknown. */
    function classAtPage(rows, vec, r, p) {
        const out = { status: "ok", rowsCoeffs: [], dropped: [] };
        if (vec.inds.length === 0)
            return out;
        const inv = getInvImage(rows.map((x) => x.vec), vec, p);
        let rKnown = Infinity, rUnknown = Infinity;
        const dying = [];
        for (let t = 0; t < inv.inds.length; ++t) {
            const row = rows[inv.inds[t]], c = inv.cs[t];
            const L = row.level;
            if (L > LEVEL_MAX - r) {
                /* survives to E_{r'} with r' < r; what happens there decides */
                const rp = LEVEL_MAX - L;
                const known = row.diff !== null && row.diff.inds.length > 0;
                if (known) {
                    rKnown = Math.min(rKnown, rp);
                    dying.push({ row, c, rp });
                }
                else if (row.diff !== null && row.diff.inds.length === 0) {
                    /* d_{r'} known zero but the row was not promoted: survives to E_{r'+1} */
                    if (rp + 1 < r)
                        rUnknown = Math.min(rUnknown, rp + 1);
                    else
                        out.rowsCoeffs.push({ row, c });
                }
                else
                    rUnknown = Math.min(rUnknown, rp);
            }
            else if (L < r)
                out.dropped.push({ row, c }); /* a d_{<r} boundary: zero in E_r */
            else
                out.rowsCoeffs.push({ row, c });
        }
        if (rUnknown <= rKnown && rUnknown !== Infinity) {
            out.status = "undetermined";
            out.rUnknown = rUnknown;
            return out;
        }
        if (rKnown !== Infinity) {
            out.status = "dies";
            out.rDies = rKnown;
            let d = { inds: [], cs: [] };
            for (const x of dying)
                if (x.rp === rKnown)
                    d = vecAdd(d, x.row.diff, x.c, p);
            out.dvec = d;
            return out;
        }
        return out;
    }
    /* the E_r coordinates of a class as a canonical sparse vector over row positions */
    function pageCoords(cls) {
        const pairs = cls.rowsCoeffs.map((x) => [x.row.k, x.c]).sort((a, b) => a[0] - b[0]);
        return { inds: pairs.map((x) => x[0]), cs: pairs.map((x) => x[1]) };
    }

    /* ------------------------------------------------------------------ expressions
     *   query  := sum ('=' sum)?
     *   sum    := term (('+'|'-') term)*
     *   term   := (int '*'?)? factor ('*' factor)*
     *   factor := atom ('^' int)?
     *   atom   := x_{stem,s[,k]} | v_{stem,s[,k]} | (stem,s[,i]) | [stem,s[,k]] | name | '(' sum ')' | int
     * (stem,s,i) is the i-th (0-based) E_2 basis monomial of the bidegree, [stem,s,k] its k-th
     * (0-based) staircase row, i.e. the chart's bullet; names are the chart's gen_names/v_names.
     * In a module chart the ring factors precede the single module generator.
     * The evaluator returns {deg, poly} with poly in normal form (ring) or {deg, mod}. */
    class Evaluator {
        /** `chart` (a Chart) supplies basis/row atoms and names; `ring` and `module` the algebra
         * (module null for a ring chart). */
        constructor(ring, module, chart, names) {
            this.ring = ring;
            this.module = module;
            this.chart = chart;
            this.p = ring.p;
            this.names = names || {}; /* {gen_names: [...], v_names: [...]} */
            this.alg = module || ring;
            const all = [];
            (this.names.gen_names || []).forEach((n, g) => { if (n && !/^x_\{/.test(n)) all.push([n, "x", g]); });
            (this.names.v_names || []).forEach((n, v) => { if (n && !/^v_\{/.test(n)) all.push([n, "v", v]); });
            all.sort((a, b) => b[0].length - a[0].length);
            this.customNames = all;
        }
        tokenize(src) {
            const tokens = [];
            let i = 0;
            const reGen = /^([xv])_\{(-?\d+),(\d+)(?:,(\d+))?\}/;
            const reNum = /^\d+/;
            while (i < src.length) {
                const rest = src.slice(i);
                let m;
                if (/^\s/.test(rest)) {
                    ++i;
                    continue;
                }
                if ((m = reGen.exec(rest))) {
                    tokens.push({ t: "gen", letter: m[1], stem: +m[2], s: +m[3], k: m[4] === undefined ? 1 : +m[4], text: m[0] });
                    i += m[0].length;
                    continue;
                }
                if ((m = /^\((-?\d+)\s*,\s*(\d+)(?:\s*,\s*(\d+))?\)/.exec(rest))) {
                    tokens.push({ t: "basis", stem: +m[1], s: +m[2], i: m[3] === undefined ? 0 : +m[3], text: m[0] });
                    i += m[0].length;
                    continue;
                }
                if ((m = /^\[(-?\d+)\s*,\s*(\d+)(?:\s*,\s*(\d+))?\]/.exec(rest))) {
                    tokens.push({ t: "row", stem: +m[1], s: +m[2], k: m[3] === undefined ? 0 : +m[3], text: m[0] });
                    i += m[0].length;
                    continue;
                }
                if ((m = reNum.exec(rest))) {
                    tokens.push({ t: "num", value: +m[0], text: m[0] });
                    i += m[0].length;
                    continue;
                }
                let named = null;
                for (const [n, letter, g] of this.customNames)
                    if (rest.startsWith(n)) {
                        named = { t: "name", letter, g, text: n };
                        break;
                    }
                if (named) {
                    tokens.push(named);
                    i += named.text.length;
                    continue;
                }
                const ch = rest[0];
                if ("()*^+-=<>,_".includes(ch)) {
                    tokens.push({ t: ch, text: ch });
                    ++i;
                    continue;
                }
                throw new Error(`cannot read '${rest.slice(0, 12)}' at position ${i}`);
            }
            tokens.push({ t: "end", text: "" });
            return tokens;
        }
        /** Parses and evaluates a query. Returns
         *   {kind: "expr", value}                  value = {deg, poly|mod, zero}
         *   {kind: "eq", lhs, rhs}
         *   {kind: "massey", args: [value, ...], page}   <a,b,c>, or <a,b,c>_r for page r (massey.js) */
        evaluate(src) {
            this.tokens = this.tokenize(src);
            this.pos = 0;
            if (this.peek().t === "<") {
                this.next();
                const args = [this.parseSum()];
                while (this.peek().t === ",") {
                    this.next();
                    args.push(this.parseSum());
                }
                this.expect(">");
                let page = null;
                if (this.peek().t === "_") {
                    this.next();
                    page = this.expect("num").value;
                }
                this.expect("end");
                return { kind: "massey", args, page };
            }
            const lhs = this.parseSum();
            if (this.peek().t === "=") {
                this.next();
                const rhs = this.parseSum();
                this.expect("end");
                return { kind: "eq", lhs, rhs };
            }
            this.expect("end");
            return { kind: "expr", value: lhs };
        }
        peek() {
            return this.tokens[this.pos];
        }
        next() {
            return this.tokens[this.pos++];
        }
        expect(t) {
            const tok = this.next();
            if (tok.t !== t)
                throw new Error(`expected '${t}' but found '${tok.text || "end of input"}'`);
            return tok;
        }
        /* values: {deg: [stem,s] | null (a bare scalar), poly: ring poly | null, mod: module elt | null, scalar} */
        parseSum() {
            let acc = this.parseTerm();
            while (this.peek().t === "+" || this.peek().t === "-") {
                const sign = this.next().t === "+" ? 1 : this.p - 1;
                const rhs = this.parseTerm();
                acc = this.add(acc, this.scale(rhs, sign));
            }
            return acc;
        }
        parseTerm() {
            let acc = null;
            if (this.peek().t === "num") {
                const n = this.next().value;
                acc = this.scalar(n);
                if (this.peek().t === "*")
                    this.next();
                else if (!this.startsFactor(this.peek()))
                    return acc;
            }
            acc = acc === null ? this.parseFactor() : this.mul(acc, this.parseFactor());
            while (this.peek().t === "*" || this.startsFactor(this.peek())) {
                if (this.peek().t === "*")
                    this.next();
                acc = this.mul(acc, this.parseFactor());
            }
            return acc;
        }
        startsFactor(tok) {
            return tok.t === "gen" || tok.t === "basis" || tok.t === "row" || tok.t === "name" || tok.t === "(";
        }
        parseFactor() {
            let base = this.parseAtom();
            if (this.peek().t === "^") {
                this.next();
                const e = this.expect("num").value;
                let acc = this.scalar(1);
                for (let i = 0; i < e; ++i)
                    acc = this.mul(acc, base);
                base = acc;
            }
            return base;
        }
        parseAtom() {
            const tok = this.next();
            switch (tok.t) {
                case "gen": {
                    if (tok.letter === "x") {
                        const g = this.ring.findGen(tok.stem, tok.s, tok.k);
                        if (g < 0)
                            throw new Error(`no ring generator ${tok.text}`);
                        return this.ringValue(this.ring.gen(g));
                    }
                    if (!this.module)
                        throw new Error(`${tok.text}: this is a ring chart; it has no module generators`);
                    const v = this.module.findGen(tok.stem, tok.s, tok.k);
                    if (v < 0)
                        throw new Error(`no module generator ${tok.text}`);
                    return this.modValue(this.module.gen(v));
                }
                case "name":
                    return tok.letter === "x" ? this.ringValue(this.ring.gen(tok.g)) : this.modValue(this.module.gen(tok.g));
                case "basis": {
                    const basis = this.chart.basisAt(tok.stem, tok.s);
                    if (!basis || tok.i >= basis.mons.length)
                        throw new Error(`${tok.text}: the chart has ${basis ? basis.mons.length : 0} basis element(s) at (${tok.stem}, ${tok.s})`);
                    const m = basis.mons[tok.i];
                    return this.chart.isModule ? this.modValue({ terms: [m], cs: [1] }, [tok.stem, tok.s]) : this.ringValue({ terms: [m], cs: [1] }, [tok.stem, tok.s]);
                }
                case "row": {
                    const rows = this.chart.rowsAt(tok.stem, tok.s);
                    if (!rows || tok.k >= rows.length)
                        throw new Error(`${tok.text}: the chart has ${rows ? rows.length : 0} class(es) at (${tok.stem}, ${tok.s})`);
                    const P = this.chart.fromVec(rows[tok.k].vec, [tok.stem, tok.s]);
                    return this.chart.isModule ? this.modValue(P, [tok.stem, tok.s]) : this.ringValue(P, [tok.stem, tok.s]);
                }
                case "(": {
                    const v = this.parseSum();
                    this.expect(")");
                    return v;
                }
                case "num":
                    return this.scalar(tok.value);
                default:
                    throw new Error(`unexpected '${tok.text || "end of input"}'`);
            }
        }
        /* values */
        scalar(n) {
            return { scalar: modNorm(n, this.p), deg: null, poly: null, mod: null };
        }
        ringValue(P, deg) {
            if (this.chart.isModule && !this.module)
                throw new Error("module chart without its algebra");
            const nf = this.ring.normalForm(P);
            return { scalar: null, deg: deg || this.ring.deg(nf), poly: nf, mod: null };
        }
        modValue(M, deg) {
            const nf = this.module.normalForm(M);
            return { scalar: null, deg: deg || this.module.deg(nf), poly: null, mod: nf };
        }
        isScalar(v) {
            return v.scalar !== null;
        }
        scale(v, c) {
            if (this.isScalar(v))
                return this.scalar(v.scalar * c);
            if (v.poly)
                return { ...v, poly: scalePoly(v.poly, c, this.p) };
            return { ...v, mod: scalePoly(v.mod, c, this.p) };
        }
        add(a, b) {
            if (this.isScalar(a) && this.isScalar(b))
                return this.scalar(a.scalar + b.scalar);
            if (this.isScalar(a) || this.isScalar(b)) {
                const [sc, v] = this.isScalar(a) ? [a, b] : [b, a];
                if (sc.scalar === 0)
                    return v;
                throw new Error("cannot add a nonzero number to a class");
            }
            if ((a.poly === null) !== (b.poly === null))
                throw new Error("cannot add a ring class and a module class");
            const A = a.poly || a.mod, B = b.poly || b.mod;
            if (a.deg && b.deg && (a.deg[0] !== b.deg[0] || a.deg[1] !== b.deg[1]))
                throw new Error(`cannot add classes of different bidegrees (${a.deg}) and (${b.deg})`);
            const sum = addPoly(A, B, 1, a.poly ? monCmp : mmodCmp, this.p);
            const deg = a.deg || b.deg;
            return a.poly ? { scalar: null, deg, poly: sum, mod: null } : { scalar: null, deg, poly: null, mod: sum };
        }
        mul(a, b) {
            if (this.isScalar(a) && this.isScalar(b))
                return this.scalar(a.scalar * b.scalar);
            if (this.isScalar(a))
                return this.scale(b, a.scalar);
            if (this.isScalar(b))
                return this.scale(a, b.scalar);
            if (a.mod)
                throw new Error("ring factors must come before the module generator (write x*v, not v*x)");
            const deg = a.deg && b.deg ? [a.deg[0] + b.deg[0], a.deg[1] + b.deg[1]] : null;
            if (b.poly) {
                const P = this.ring.mul(a.poly, b.poly);
                return { scalar: null, deg: isZero(P) ? deg : this.ring.deg(P), poly: P, mod: null };
            }
            const M = this.module.mul(a.poly, b.mod);
            return { scalar: null, deg: isZero(M) ? deg : this.module.deg(M), poly: null, mod: M };
        }
        /** The class of a value in the chart's E_2 basis: {deg, vec} (deg null for a bare zero). */
        toVec(v) {
            if (this.isScalar(v)) {
                if (v.scalar !== 0)
                    throw new Error("a number alone is not a class");
                return { deg: null, vec: { inds: [], cs: [] } };
            }
            const P = v.poly || v.mod;
            if (!this.alg.homogeneous(P))
                throw new Error("the expression is not homogeneous");
            if (v.deg === null)
                return { deg: null, vec: { inds: [], cs: [] } };
            return { deg: v.deg, vec: this.chart.toVec(P, v.deg) };
        }
    }

    /* ------------------------------------------------------------------ LaTeX for display */
    /* Factors are joined by spaces: TeX ignores them, and they keep a name that ends in a macro
     * (\\beta) from fusing with what follows into an undefined one (\\betax). */
    function latexMon(m, genNames, vNames, v) {
        const parts = [];
        for (let i = 0; i < m.length; i += 2) {
            const name = genNames && genNames[m[i]] !== undefined ? genNames[m[i]] : `x_{${m[i]}}`;
            parts.push(name + (m[i + 1] === 1 ? "" : m[i + 1] >= 10 ? `^{${m[i + 1]}}` : `^${m[i + 1]}`));
        }
        if (v !== undefined && v !== null)
            parts.push(vNames && vNames[v] !== undefined ? vNames[v] : `v_{${v}}`);
        return parts.length === 0 ? "1" : parts.join(" ");
    }
    function latexPoly(P, genNames, vNames) {
        if (isZero(P))
            return "0";
        return P.terms.map((t, i) => {
            const c = P.cs[i];
            const mon = t.m !== undefined ? latexMon(t.m, genNames, vNames, t.v) : latexMon(t, genNames);
            if (c === 1)
                return mon;
            return mon === "1" ? `${c}` : `${c} ${mon}`;
        }).join("+");
    }

    return {
        LEVEL_MAX, LEVEL_PERM, R_PERM,
        modInv, modNorm,
        monKey, mmodKey, monMul, monDivides, monDiv, monCmp, mmodCmp, monPow, monDeg, monGens,
        sortCombine, addPoly, scalePoly, isZero,
        Ring, Module,
        vecAt, vecAdd, vecScale, vecEqual, vecFromChart, getInvImage,
        Chart, NotLoaded, NoBasis,
        classAtPage, pageCoords,
        Evaluator,
        latexMon, latexPoly,
    };
});
