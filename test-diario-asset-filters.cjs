const fs = require("node:fs");
const vm = require("node:vm");
const assert = require("node:assert/strict");
process.env.TZ = "America/Sao_Paulo";
const core = fs.readFileSync(`${__dirname}/diario-core.js`, "utf8");
const initAt = core.indexOf("\nBacktests.init();");
const now = new Date("2026-10-09T15:00:00Z");
class FixedDate extends Date {
    constructor(...args) { super(...(args.length ? args : [now.getTime()])); }
    static now() { return now.getTime(); }
}
const nodes = new Map(), writes = [], canvasText = [];
const node = id => {
    if (!nodes.has(id)) nodes.set(id, {
        value: "", textContent: "", innerHTML: "", hidden: false, style: {}, dataset: {}, attributes: {},
        parentElement: { clientWidth: 800 }, listeners: {},
        classList: { toggle(name, active) { this[name] = active; } },
        querySelectorAll() { return []; },
        setAttribute(name, value) { this.attributes[name] = value; },
        addEventListener(name, callback) { this.listeners[name] = callback; }
    });
    return nodes.get(id);
};
const buttons = ["all", "win", "cripto", "wdo", "forex"].map(category => {
    const button = node(`button-${category}`);
    button.dataset.assetFilter = category;
    return button;
});
node("assetFilters").querySelectorAll = () => buttons;
const canvas = new Proxy({}, { get: (_, name) => name === "fillText" ? text => canvasText.push(String(text)) : () => {} });
let exported;
const context = vm.createContext({
    Date: FixedDate, console, clearTimeout() {}, requestAnimationFrame() {},
    document: { getElementById: node, querySelectorAll: () => [], createElement: () => ({ click() {} }) },
    localStorage: { getItem: () => null, setItem: (...args) => writes.push(args) },
    Blob: class { constructor(parts) { exported = JSON.parse(parts[0]); } },
    URL: { createObjectURL: () => "blob:test", revokeObjectURL() {} }
});
vm.runInContext(`${core.slice(0, initAt)}
setupCanvas=()=>({ctx:canvas,w:600,h:260});
drawCapitalCurve=(id,points)=>{this.curve=Array.from(points);};
toast=()=>{};
this.api={state,manualTrades,robotTrades,filteredManualTrades,tradeAssetCategory,classifySymbol,tradeFees,
setAssetFilter,bindAssetFilters,renderAssetFilters,switchView,computeStats,calendarResults,drawEquity,drawDist,drawHour,
renderKPIs,renderRecent,renderTrades,renderCalendar,renderAdvancedStats,renderTagStats,renderStreaks,renderJournal,exportJSON};`, Object.assign(context, { canvas }));
const api = context.api;
const row = (id, symbol, pnl, r, extra = {}) => ({
    id, symbol, pnl, r, fees: 0, qty: 1, side: "long", status: r > 0 ? "target" : r < 0 ? "stop" : "breakeven",
    date: "2026-10-09T15:00:00Z", dateLocal: "2026-10-09T12:00", tags: [`tag-${id}`], notes: `note-${id}`, ...extra
});
const fixtures = [
    row("win-target", "WINZ26", 200, 2), row("win-be", "WIN", 0, 0),
    row("crypto-target", "BAT/USDT", 50, 1, { fees: 1 }), row("crypto-stop", "ETHUSD", -30, -1),
    row("wdo-stop", "WDOX26", -100, -1, { side: "short" }),
    row("fx-eur", "EUR/USD", 80, 2, { fees: 3 }), row("fx-cad", "USDCADm", 40, 1, { fees: 3 }),
    row("other", "PETR4", 20, 1), row("robot", "WIN", 9999, 99, { source: "robo_smc" })
];
api.state.trades = fixtures;
api.state.fees = { win: 5, wdo: 2, cripto: 1 };
const snapshot = JSON.stringify(fixtures);
const categories = { all: [8, 240], win: [2, 190], cripto: [2, 18], wdo: [1, -102], forex: [2, 114] };
assert.equal(api.state.assetFilter, "all", "A fresh journal shows every asset");
for (const symbol of ["EURUSD", "EUR/USD", "GBPJPY.a", "USDJPYpro", "USDCHF", "USDCAD", "AUDUSD", "NZDUSD", "XAUUSD"]) {
    assert.equal(api.tradeAssetCategory({ symbol }), "forex", symbol);
}
for (const symbol of ["BTC", "BTCUSDT", "ETH/USD", "SOLUSDC", "BAT/USDT", "1000BONKUSDT"]) {
    assert.equal(api.tradeAssetCategory({ symbol }), "cripto", symbol);
}
for (const symbol of ["", "PETR4", "AAPL", "EUR", "UNKNOWN"]) assert.equal(api.tradeAssetCategory({ symbol }), null, symbol);
assert.equal(api.classifySymbol("USDCAD"), "cripto", "Display filtering preserves existing fee classification");
api.bindAssetFilters();
for (const [category, [count, pnl]] of Object.entries(categories)) {
    buttons.find(button => button.dataset.assetFilter === category).listeners.click();
    const selected = api.filteredManualTrades();
    assert.equal(selected.length, count, category);
    assert.equal(api.computeStats(selected).pnlTotal, pnl, `${category} net P&L`);
    assert.equal(api.manualTrades().length, 8, "Raw manual trades are never filtered");
    assert.equal(api.robotTrades().length, 1);
    assert.equal(buttons.filter(button => button.attributes["aria-pressed"] === "true").length, 1);
    assert.equal(buttons.find(button => button.attributes["aria-pressed"] === "true").dataset.assetFilter, category);
    api.renderKPIs(); api.renderRecent(); api.renderTrades(); api.renderJournal(); api.renderTagStats(); api.renderAdvancedStats(); api.renderStreaks();
    api.state.calMonth = new Date(2026, 9, 1);
    api.renderCalendar();
    const ids = Array.from(selected, trade => trade.id);
    assert.equal((node("recentTrades").innerHTML.match(/data-recent-edit=/g) || []).length, count);
    assert.equal((node("tradesTable").innerHTML.match(/data-edit=/g) || []).length, count);
    for (const trade of fixtures) {
        assert.equal(node("journalList").innerHTML.includes(`note-${trade.id}`), ids.includes(trade.id));
        assert.equal(node("tagStats").innerHTML.includes(`tag-${trade.id}`), ids.includes(trade.id));
    }
    assert.ok(node("kpiGrid").innerHTML.includes(pnl.toLocaleString("pt-BR", { style: "currency", currency: "BRL" })));
    assert.ok(node("advancedStats").innerHTML.includes(pnl.toLocaleString("pt-BR", { style: "currency", currency: "BRL" })));
    assert.equal(node("calLast7").textContent, pnl.toLocaleString("pt-BR", { style: "currency", currency: "BRL" }));
    assert.equal(node("calLast30").textContent, node("calLast7").textContent);
    api.drawEquity();
    assert.equal(context.curve.at(-1), pnl);
    canvasText.length = 0;
    api.drawDist();
    assert.equal(canvasText[0], String(count), "Distribution uses selected trades");
    api.state.chartMonth = "2026-10";
    api.drawHour();
    assert.equal((node("hourChart").innerHTML.match(/data-chart-index=/g) || []).length, count);
    for (const view of ["dashboard", "trades", "calendar", "stats", "journal"]) {
        api.switchView(view);
        assert.equal(api.state.assetFilter, category, "Selection follows tab navigation");
        assert.equal(node("assetFilters").hidden, false);
    }
}
api.setAssetFilter("wdo");
api.state.view = "trades";
node("filterSide").value = "long";
api.renderTrades();
assert.match(node("tradesTable").innerHTML, /Nenhum trade encontrado/);
node("filterSide").value = "short";
node("filterResult").value = "loss";
node("filterText").value = "wdo-stop";
api.renderTrades();
assert.equal(node("filterCount").textContent, "1 de 1", "Asset, direction, outcome and search filters compose");
assert.match(node("tradesTable").innerHTML, /data-edit="wdo-stop"/);
for (const view of ["fees", "robot", "backtests"]) {
    api.state.view = view;
    api.renderAssetFilters();
    assert.equal(node("assetFilters").hidden, true);
}
api.setAssetFilter("unrecognized");
assert.equal(api.state.assetFilter, "wdo");
api.exportJSON();
assert.deepEqual(exported, fixtures, "Export includes all trades, regardless of the display filter");
assert.equal(JSON.stringify(api.state.trades), snapshot);
assert.equal(writes.length, 0, "Filtering never writes local or cloud records");
console.log("PASS: asset classification, net totals, all five views, both chart types, composed filters, navigation, complete export, and unchanged records.");
