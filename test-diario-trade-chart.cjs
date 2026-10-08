const fs = require("node:fs");
const vm = require("node:vm");
const assert = require("node:assert/strict");
process.env.TZ = "America/Sao_Paulo";
const core = fs.readFileSync(`${__dirname}/diario-core.js`, "utf8");
const initAt = core.indexOf("\nBacktests.init();");
let clock = "2026-10-08T16:30:00Z";
class TestDate extends Date {
    constructor(...args) { super(...(args.length ? args : [clock])); }
    static now() { return new Date(clock).getTime(); }
}
const nodes = new Map();
const node = id => {
    if (!nodes.has(id)) nodes.set(id, {
        innerHTML: "", textContent: "", style: {}, attributes: {}, parentElement: { clientWidth: 620 },
        setAttribute(name, value) { this.attributes[name] = value; }
    });
    return nodes.get(id);
};
const context = vm.createContext({ Date: TestDate, clearTimeout() {}, localStorage: { getItem: () => null }, document: { getElementById: node } });
vm.runInContext(`${core.slice(0, initAt)}\nthis.api={state,tradeChartData,tradeChartTooltipHtml,drawHour};`, context);
const { state, tradeChartData, tradeChartTooltipHtml, drawHour } = context.api;
const trade = (id, dateLocal, r, extra = {}) => ({ id, date: "2026-10-08T16:23:00Z", dateLocal, r, symbol: "WIN", setup: "POI", tags: ["liquidez"], pnl: r * 100, fees: 10, ...extra });
const plain = text => text.replace(/\u00a0/g, " ");
state.trades = [
    trade("today-win", "2026-10-08T09:23", 3),
    trade("today-loss", "2026-10-08T09:23", -1, { setup: "Order block", tags: ["reteste", "FOMO"] }),
    trade("today-zero", "2026-10-08T11:23", 0, {pnl:10}),
    trade("today-pending", "2026-10-08T13:23", null, { rPending: true, pnl:100 }),
    trade("yesterday-win", "2026-10-07T09:01", 2),
    trade("yesterday-loss", "2026-10-07T10:02", -1, { setup: "Trap", tags: ["reversão"] }),
    trade("september", "2026-09-30T11:00", -5),
    trade("future", "2026-10-09T11:00", 1),
    trade("robot", "2026-10-08T09:23", 999, { source: "robo_smc" }),
    { date: "invalid", r: -10 },
    trade("invalid-value", "2026-10-08T09:23", 1, {pnl:"invalid"})
];
const originals = JSON.stringify(state.trades);
const data = tradeChartData(state.trades, "2026-10");
assert.equal(data.bars.length, 6, "Yesterday consolidates; every current and future trade keeps its own bar");
assert.equal(data.rows.length, 7);
assert.equal(data.cents, 44000, "Month sums net financial results including trades with unknown R");
assert.equal(data.invalid, 2);
assert.equal(data.bars[0].kind, "day");
assert.equal(data.bars[0].cents, 8000);
assert.equal(data.bars[0].rows.length, 2);
assert.equal(data.bars[1].rows[0].trade.id, "today-win");
assert.equal(data.bars[2].rows[0].trade.id, "today-loss", "Trades sharing the same minute remain distinct");
assert.equal(data.bars[2].cents, -11000);
assert.equal(data.bars[4].cents, 9000, "A pending R never hides a known financial result");
assert.equal(JSON.stringify(state.trades), originals, "Consolidation never rewrites records");

drawHour();
const chart = node("hourChart");
assert.equal((chart.innerHTML.match(/<rect class="hour-bar/g) || []).length, 6);
assert.match(chart.innerHTML, /class="hour-bar hour-loss"/);
assert.match(plain(chart.innerHTML), />-R\$ 110,00<\/text>/, "The net loss remains visible beside the gain at the same time");
assert.match(plain(chart.innerHTML), />R\$ 290,00<\/text>/);
assert.match(chart.innerHTML, /class="hour-bar hour-breakeven"/);
assert.doesNotMatch(chart.innerHTML, /hour-pending|R pendente|\dR/);
assert.match(chart.innerHTML, /Order block\. Tags: reteste, FOMO/);
assert.match(node("hourHint").textContent, /Valores após taxas/);
assert.match(plain(node("tradeChartPeriod").textContent), /outubro de 2026 · 7 trades · R\$ 440,00/);
assert.equal(node("tradeChartBack").hidden, true);

state.chartDay = "2026-10-07";
drawHour();
assert.equal((chart.innerHTML.match(/data-chart-kind="trade"/g) || []).length, 2);
assert.match(chart.innerHTML, /class="hour-bar hour-loss"/);
assert.match(chart.innerHTML, />09:01<\/text>/);
assert.match(chart.innerHTML, />10:02<\/text>/);
assert.equal(node("tradeChartBack").hidden, false);
assert.match(plain(node("tradeChartPeriod").textContent), /07\/10\/2026 · 2 trades · R\$ 80,00/);
const html = tradeChartTooltipHtml(data.bars[0]);
assert.equal((html.match(/class="trade-tooltip-trade"/g) || []).length, 2);
assert.match(html, /POI<\/div>\s*<div class="trade-tooltip-tags"><span>liquidez<\/span>/);
assert.match(html, /Trap<\/div>\s*<div class="trade-tooltip-tags"><span>reversão<\/span>/);
assert.match(html, /data-chart-open/);
assert.match(plain(html), /R\$ 80,00 líquido/);
assert.match(plain(html), /-R\$ 110,00/);
assert.doesNotMatch(html, /\dR|R pendente/);
const escaped = tradeChartTooltipHtml({ ...data.bars[1], rows: [{ ...data.bars[1].rows[0], trade: { ...data.bars[1].rows[0].trade, setup: '<img src=x onerror="alert(1)">', tags: ["<script>alert(1)</script>"] } }] });
assert.doesNotMatch(escaped, /<img|<script>/);
assert.match(escaped, /&lt;img/);
assert.match(escaped, /&lt;script&gt;/);
assert.doesNotMatch(tradeChartTooltipHtml(data.bars[2]), /liquidez/, "Each tooltip contains only its own grouped setup and tags");

state.chartMonth = "2026-09";
state.chartDay = null;
drawHour();
assert.equal((chart.innerHTML.match(/<rect class="hour-bar/g) || []).length, 1);
assert.match(plain(chart.innerHTML), />-R\$ 510,00<\/text>/);
assert.doesNotMatch(chart.innerHTML, /Order block/);
state.chartMonth = "2026-08";
drawHour();
assert.match(chart.innerHTML, /Sem trades neste mês/);
assert.equal(chart.style.minWidth, "0px");
assert.equal(tradeChartData(state.trades, "2026-09", "2026-10-08").day, null);

state.chartMonth = "2026-10";
clock = "2026-10-09T03:00:01Z";
drawHour();
const rolled = tradeChartData(state.trades, state.chartMonth);
assert.equal(rolled.bars.length, 3, "At local midnight yesterday becomes one daily bar");
assert.equal(rolled.bars[1].rows.length, 4);
assert.equal(rolled.bars[1].cents, 27000);
assert.match(plain(chart.innerHTML), />R\$ 270,00<\/text>/);
assert.equal(tradeChartData(state.trades, "2026-10", "2026-10-08").bars.length, 4, "Consolidated day can always be expanded again");
assert.equal(JSON.stringify(state.trades), originals);

clock = "2026-10-08T16:30:00Z";
state.trades = Array.from({ length: 24 }, (_, hour) => trade(`dense-${hour}`, `2026-10-08T${String(hour).padStart(2, "0")}:23`, hour % 2 ? -1 : 1));
drawHour();
assert.ok(parseFloat(chart.style.minWidth) > chart.parentElement.clientWidth, "Dense money labels scroll instead of overlapping");
assert.match(chart.innerHTML, />00:23<\/text>/);
assert.match(chart.innerHTML, />23:23<\/text>/);
assert.match(node("hourHint").textContent, /Deslize/);
assert.doesNotMatch(chart.innerHTML, /NaN|Infinity/);
state.trades = [trade("pending", "2026-10-08T09:23", null, { rPending: true, pnl:130 })];
drawHour();
assert.match(plain(chart.innerHTML), />R\$ 120,00<\/text>/);
assert.match(plain(node("tradeChartPeriod").textContent), /R\$ 120,00/);

state.trades = [trade("fees-loss", "2026-10-08T09:23", 1, {pnl:3, fees:5})];
drawHour();
assert.match(chart.innerHTML, /class="hour-bar hour-loss"/, "A gross winner whose fees exceed P&L is a net loss");
assert.match(plain(chart.innerHTML), />-R\$ 2,00<\/text>/);
const unknownR = tradeChartData([trade("unknown-r", "2026-10-08T09:23", "invalid", {pnl:80})], "2026-10");
assert.equal(unknownR.cents, 7000, "Currency chart does not depend on a valid R");
assert.equal(unknownR.invalid, 0);
const rounding = tradeChartData([trade("round-1", "2026-10-07T09:23", 1, {pnl:.1,fees:0}), trade("round-2", "2026-10-07T10:23", 1, {pnl:.2,fees:0})], "2026-10");
assert.equal(rounding.bars[0].cents, 30, "Financial sums use integer cents");
state.fees.win = 2;
const configuredFees = tradeChartData([trade("configured-fees", "2026-10-08T09:23", 1, {pnl:10,fees:0,qty:3})], "2026-10");
assert.equal(configuredFees.cents, 400, "Configured fees match the rest of the journal");
state.fees.win = 0;

const boundary = [trade("old-year", "2025-12-31T23:59", -1), trade("new-year", "2026-01-01T00:00", 2)];
const january = tradeChartData(boundary, "2026-01", null, new Date("2026-01-01T03:01:00Z"));
assert.equal(january.bars.length, 1);
assert.equal(january.bars[0].kind, "trade");
assert.equal(january.bars[0].rows[0].local, "2026-01-01T00:00");
console.log("PASS: net BRL bars, manual/configured fees, integer-cent totals, unknown R, daily drilldown, month filter, civil dates, and dense/empty charts.");
