const fs = require("node:fs");
const vm = require("node:vm");
const assert = require("node:assert/strict");

const core = fs.readFileSync(`${__dirname}/diario-core.js`, "utf8");
const initAt = core.indexOf("\nBacktests.init();");
assert.ok(initAt > 0);
const now = new Date(2026, 9, 8, 12);
class FixedDate extends Date {
    constructor(...args) { super(...(args.length ? args : [now.getTime()])); }
    static now() { return now.getTime(); }
}
const nodes = new Map();
const node = (id) => {
    if (!nodes.has(id)) nodes.set(id, { textContent: "", innerHTML: "", className: "", title: "" });
    return nodes.get(id);
};
const context = vm.createContext({
    Date: FixedDate,
    localStorage: { getItem: () => null },
    document: { getElementById: node }
});
vm.runInContext(`${core.slice(0, initAt)}
this.calendar = { calendarResults, renderCalendar, state };`, context);
const { calendarResults, renderCalendar, state } = context.calendar;
state.fees = { win: 0.5, wdo: 0, cripto: 0 };
const trade = (date, pnl, extra = {}) => ({ date, pnl, fees: 0, symbol: "OTHER", ...extra });
state.trades = [
    trade(new Date(2026, 9, 8, 9), 100, { symbol: "WIN", qty: 2 }), // 99 after configured fees
    trade(new Date(2026, 9, 8, 10), -40, { fees: 2 }), // -42 after explicit fees
    trade(new Date(2026, 9, 8, 23), 50, { r: null, rPending: true, source: "broker_csv" }),
    trade(new Date(2026, 9, 2), 20), // inclusive start of the last seven calendar days
    trade(new Date(2026, 9, 1, 23, 59, 59), 30), // outside seven, inside thirty
    trade(new Date(2026, 8, 9), 40), // inclusive start of thirty days, previous month
    trade(new Date(2026, 8, 8, 23, 59, 59), 50), // just outside thirty
    trade(new Date(2026, 9, 9), 999), // future day excluded from rolling totals
    trade(new Date(2026, 9, 8), 9999, { source: "robo_smc" }),
    trade("invalid", 9999),
    trade(new Date(2026, 9, 8), "invalid"),
    trade(new Date(2026, 9, 7), 0.1),
    trade(new Date(2026, 9, 7), 0.2),
    trade(new Date(2026, 9, 6), 10),
    trade(new Date(2026, 9, 6), -10),
    trade(new Date(2026, 9, 5), -200)
];
state.calMonth = new Date(2026, 9, 1);
const results = calendarResults(state.trades, state.calMonth, now);
assert.equal(results.dayMap[8].cents, 10700, "Daily P&L includes fees and trades with R pending");
assert.equal(results.dayMap[8].count, 3);
assert.equal(results.dayMap[7].cents, 30, "Decimal money accumulates exactly in cents");
assert.equal(results.dayMap[6].cents, 0, "A breakeven trading day remains present");
assert.equal(results.last7, -72.7);
assert.equal(results.last30, -2.7);

renderCalendar();
const html = node("calendarGrid").innerHTML;
assert.match(html, /class="cal-pnl">R\$\s*107,00<\/span>/);
assert.match(html, /class="cal-cell loss-1"[^>]+05\/10\/2026/);
assert.match(html, /06\/10\/2026: R\$\s*0,00 líquido · 2 trades/);
assert.match(html, /04\/10\/2026: sem operações/);
assert.equal(node("calLast7").className, "cal-period-value negative");
assert.match(node("calLast7").textContent, /-R\$\s*72,70/);
assert.match(node("calLast30").title, /09\/09\/2026 a 08\/10\/2026/);
assert.equal(node("calRange7").textContent, "02/10 a 08/10");
assert.equal(node("calRange30").textContent, "09/09 a 08/10");
assert.equal(node("calFutureNotice").hidden, false);
assert.match(node("calFutureNotice").textContent, /1 trade com data futura/);
assert.match(html, /aria-current="date"/);
assert.match(node("calMonthSummary").textContent, /956,30 líquido · 7 dias operados/);
assert.equal((html.match(/class="cal-day"/g) || []).length, 31);

state.calMonth = new Date(2026, 8, 1);
renderCalendar();
assert.match(node("calMonthSummary").textContent, /90,00 líquido · 2 dias operados/);
assert.match(node("calLast7").textContent, /-R\$\s*72,70/, "Month navigation keeps the rolling period current");

// The rolling window crosses the year boundary using local dates.
const january = new Date(2027, 0, 3, 12);
const yearResults = calendarResults([
    trade(new Date(2026, 11, 28), 100),
    trade(new Date(2026, 11, 27, 23, 59), 200)
], new Date(2027, 0, 1), january);
assert.equal(yearResults.last7, 100);
assert.equal(yearResults.last30, 300);

state.trades = [];
renderCalendar();
assert.match(node("calLast7").textContent, /R\$\s*0,00/);
assert.equal(node("calLast7").className.trim(), "cal-period-value");
assert.equal(node("calMonthSummary").textContent, "Mês sem operações");
assert.equal(node("calFutureNotice").hidden, true);
console.log("Calendar: daily net BRL, rolling periods, boundaries, month navigation and empty state passed.");
