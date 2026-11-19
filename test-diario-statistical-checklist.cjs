const fs = require("node:fs");
const vm = require("node:vm");
const assert = require("node:assert/strict");

const html = fs.readFileSync(__dirname + "/diario-pro-plus.html", "utf8");
const indexHtml = fs.readFileSync(__dirname + "/index.html", "utf8");
const css = fs.readFileSync(__dirname + "/diario-pro-plus.css", "utf8");
const source = fs.readFileSync(__dirname + "/diario-statistical-checklist.js", "utf8");
const coreSource = fs.readFileSync(__dirname + "/diario-core.js", "utf8");

// 1. Valid JS syntax
new vm.Script(source);
new vm.Script(coreSource);

// 2. HTML placement before login and sidebar ordering guard
assert.equal((html.match(/data-view="stat-checklist"/g) || []).length, 1);
assert.equal((html.match(/id="view-stat-checklist"/g) || []).length, 1);
assert.equal((html.match(/id="statChecklistRoot"/g) || []).length, 1);

const navBtnPos = html.indexOf('data-view="stat-checklist"');
const cloudDetailsPos = html.indexOf('<details class="pro-cloud">');
const cloudBoxPos = html.indexOf('id="cloudBox"');
assert.ok(navBtnPos > 0 && navBtnPos < cloudDetailsPos, "Checklist Estatístico button must appear before cloud login details");
assert.ok(navBtnPos < cloudBoxPos, "Checklist Estatístico button must appear before cloudBox");

assert.match(
    html,
    /data-view="checklist"[^>]*>Checklist de Trade<\/button>\s*<button[^>]*data-view="profit"/,
    "Checklist de Trade must remain immediate previous sibling of Psicologia"
);

const scriptChecklistPos = html.indexOf("diario-statistical-checklist.js");
const scriptCorePos = html.indexOf("diario-core.js");
assert.ok(scriptChecklistPos > 0 && scriptChecklistPos < scriptCorePos, "StatChecklist script must load before diario-core.js");
assert.match(css, /\.pro-plus \.stat-verdict\.is-approved/);

// 3. Home page pre-login access link
const indexLinkPos = indexHtml.indexOf('href="diario-pro-plus.html?view=stat-checklist"');
const indexCloudPos = indexHtml.indexOf('<section class="cloud-panel">');
assert.ok(indexLinkPos > 0 && indexLinkPos < indexCloudPos, "index.html shortcut must appear before cloud-panel login");

// 4. Guest/offline sandbox execution & persistence
function makeStorage(seed = {}) {
    const store = new Map(Object.entries(seed));
    return {
        getItem: (k) => (store.has(k) ? store.get(k) : null),
        setItem: (k, v) => store.set(k, String(v)),
        removeItem: (k) => store.delete(k)
    };
}

function bootModule(storageSeed = {}) {
    const root = {
        id: "statChecklistRoot",
        innerHTML: "",
        listeners: {},
        addEventListener(type, fn) {
            this.listeners[type] = fn;
        }
    };
    const storage = makeStorage(storageSeed);
    const context = {
        console,
        Object,
        Array,
        Boolean,
        String,
        Number,
        JSON,
        currentUser: null,
        canUseCloud: () => false,
        localStorage: storage,
        document: {
            getElementById: (id) => (id === "statChecklistRoot" ? root : null)
        },
        escapeHtml: (s) =>
            String(s)
                .replace(/&/g, "&amp;")
                .replace(/</g, "&lt;")
                .replace(/>/g, "&gt;")
                .replace(/"/g, "&quot;")
                .replace(/'/g, "&#39;")
    };
    vm.runInNewContext(`${source}\nthis.StatChecklist = StatChecklist;`, context);
    context.StatChecklist.init();
    return { api: context.StatChecklist, root, storage };
}

const firstBoot = bootModule();
assert.equal(firstBoot.api.getState().verdict.level, "blocked");
assert.match(firstBoot.root.innerHTML, /AGUARDAR \/ VETADO/);
assert.match(firstBoot.root.innerHTML, /Acesso livre · antes do login/);

// Verify all required key audited figures appear in rendered output
for (const expectedText of [
    "1.245",
    "1,044",
    "+R$ 1.339,20",
    "1,040",
    "+R$ 1.311,70",
    "1,053",
    "0,793",
    "0,774",
    "0,755",
    "+R$ 2.871,55",
    "0,5360"
]) {
    assert.ok(firstBoot.root.innerHTML.includes(expectedText), `Expected audited figure missing: ${expectedText}`);
}

// Toggle 4 F9 required rules -> F9 BASE caution state
for (const ruleId of ["midpoint", "context_origin", "no_weak_solo", "no_opp_avwap"]) {
    firstBoot.api.toggleRule(ruleId, true);
}
assert.equal(firstBoot.api.getState().verdict.level, "caution");
assert.match(firstBoot.root.innerHTML, /F9 BASE/);

// Toggle 5th rule -> AUTORIZADO F9+ Limpo
firstBoot.api.toggleRule("no_opp_ob_swing", true);
assert.equal(firstBoot.api.getState().verdict.level, "approved");
assert.match(firstBoot.root.innerHTML, /AUTORIZADO · F9\+ Limpo/);

// Persistence across reload (without cloud login)
const savedRaw = firstBoot.storage.getItem("diarioStatChecklist_v1");
assert.ok(savedRaw, "Checklist must persist locally in localStorage");
const secondBoot = bootModule({ diarioStatChecklist_v1: savedRaw });
assert.equal(secondBoot.api.getState().verdict.level, "approved");

// Reset clears checks back to blocked
secondBoot.api.resetChecks();
assert.equal(secondBoot.api.getState().verdict.level, "blocked");
assert.equal(secondBoot.api.getState().verdict.checkedCount, 0);

// Table filter counts and rendering
const counts = secondBoot.api.categoryCounts();
assert.deepEqual({ ...counts }, { all: 24, approved: 3, avoid: 7, myth: 4, base: 10 });
for (const [filterKey, expectedCount] of Object.entries(counts)) {
    secondBoot.api.setFilter(filterKey);
    const rowCount = (secondBoot.root.innerHTML.split('<tbody id="statChecklistTableBody">')[1] || "").split("</tbody>")[0].match(/<tr>/g)?.length || 0;
    assert.equal(rowCount, expectedCount, `Filter ${filterKey} row count mismatch`);
}

// Verify interactive delegated change/click handlers work directly on #statChecklistRoot
secondBoot.root.listeners.change({
    target: {
        checked: true,
        closest: (sel) => (sel === "[data-stat-rule]" ? { dataset: { statRule: "midpoint" }, checked: true } : null)
    }
});
assert.equal(secondBoot.api.getState().checks.midpoint, true);
secondBoot.root.listeners.click({
    target: {
        closest: (sel) => (sel === "#btnStatChecklistReset" ? { id: "btnStatChecklistReset" } : null)
    }
});
assert.equal(secondBoot.api.getState().checks.midpoint, false);

// 5. requestedInitialView() behavior (with and without window)
const matchFn = coreSource.match(/function requestedInitialView\(\)[\s\S]*?\n\}/);
assert.ok(matchFn, "requestedInitialView helper must exist in diario-core.js");
const coreNoWin = { URLSearchParams };
vm.runInNewContext(matchFn[0], coreNoWin);
assert.equal(coreNoWin.requestedInitialView(), null);

for (const loc of [
    { search: "?view=stat-checklist", hash: "" },
    { search: "", hash: "#stat-checklist" },
    { search: "?view=other", hash: "" }
]) {
    const coreWithWin = { URLSearchParams, window: { location: loc } };
    vm.runInNewContext(matchFn[0], coreWithWin);
    const expected = loc.search.includes("stat-checklist") || loc.hash.includes("stat-checklist") ? "stat-checklist" : null;
    assert.equal(coreWithWin.requestedInitialView(), expected);
}

// Verify stat-checklist is excluded from asset filters
const assetSetMatch = coreSource.match(/const ASSET_FILTER_VIEWS = new Set\(\[([^\]]+)\]\)/);
assert.ok(assetSetMatch && !assetSetMatch[1].includes("stat-checklist"));

console.log("PASS: Checklist Estatístico pre-login placement, guest interactive rules, localStorage persistence, audited raw12 figures, table filters, and deep-link startup.");
