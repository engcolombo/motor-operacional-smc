const fs = require("node:fs");
const vm = require("node:vm");
const assert = require("node:assert/strict");
process.env.TZ = "America/Sao_Paulo";
const core = fs.readFileSync(`${__dirname}/diario-core.js`, "utf8");
const initAt = core.indexOf("\nBacktests.init();");
const nodes = new Map();
const node = id => {
    if (!nodes.has(id)) nodes.set(id, {
        innerHTML:"", textContent:"", style:{}, attributes:{}, parentElement:{clientWidth:620},
        setAttribute(name,value) { this.attributes[name]=value; }
    });
    return nodes.get(id);
};
const context=vm.createContext({Date,localStorage:{getItem:()=>null},document:{getElementById:node}});
vm.runInContext(`${core.slice(0,initAt)}
this.api={state,hourResults,drawHour};`,context);
const {state,hourResults,drawHour}=context.api;
const trade=(hour,r,extra={})=>({date:`2026-10-08T${String(hour+3).padStart(2,"0")}:00:00Z`,
    dateLocal:`2026-10-08T${String(hour).padStart(2,"0")}:00`,r,...extra});
state.trades=[
    trade(9,3),trade(9,-1),trade(10,2),trade(11,0),trade(13,-.15),
    trade(9,null,{rPending:true}),trade(9,999,{source:"robo_smc"}),
    {date:"invalid",r:-10},trade(9,"invalid")
];
const result=hourResults(state.trades);
assert.deepEqual(JSON.parse(JSON.stringify(result.hours)),[
    {hour:9,gains:3,losses:-1,breakeven:0,count:2},
    {hour:10,gains:2,losses:0,breakeven:0,count:1},
    {hour:11,gains:0,losses:0,breakeven:1,count:1},
    {hour:13,gains:0,losses:-.15,breakeven:0,count:1}
]);
assert.equal(result.pendingR,1);
assert.equal(result.invalid,2);
drawHour();
const chart=node("hourChart");
const nine=chart.innerHTML.match(/<g[^>]+data-hour="9"[\s\S]*?<\/g>/)[0];
assert.match(nine,/<rect class="hour-bar hour-gain"/);
assert.match(nine,/<rect class="hour-bar hour-loss"/);
assert.match(nine,/>\+3R<\/text>/);
assert.match(nine,/>-1R<\/text>/,"A loss remains visible even when gains in the same hour are larger");
assert.match(nine,/saldo \+2R/,"The combined balance is available without replacing the loss bar");
assert.equal((chart.innerHTML.match(/<rect class="hour-bar hour-loss"/g)||[]).length,2);
assert.match(chart.innerHTML,/<circle class="hour-breakeven"/);
assert.doesNotMatch(chart.innerHTML,/data-hour="0"/,"Inactive hours never create false green bars");
assert.match(chart.attributes["aria-label"],/perdas -1R/);
assert.match(node("hourHint").textContent,/1 trade\(s\) com R pendente/);
assert.match(node("hourHint").textContent,/2 trade\(s\) com data ou R inválido/);

state.trades=[trade(9,-1),trade(9,1)];
drawHour();
assert.equal((chart.innerHTML.match(/<rect class="hour-bar/g)||[]).length,2,"An exact zero net balance still shows both gain and loss bars");
state.trades=[trade(9,0)];
drawHour();
assert.doesNotMatch(chart.innerHTML,/<rect class="hour-bar/);
assert.match(chart.innerHTML,/<circle class="hour-breakeven"/);

state.trades=Array.from({length:24},(_,hour)=>trade(hour,hour%2?-1:1));
drawHour();
assert.equal(chart.style.minWidth,"1900px");
assert.match(chart.innerHTML,/>00h<\/text>/);
assert.match(chart.innerHTML,/>23h<\/text>/);
assert.match(node("hourHint").textContent,/Deslize/);
assert.doesNotMatch(chart.innerHTML,/NaN|Infinity/);

state.trades=[trade(9,null,{rPending:true})];
drawHour();
assert.match(chart.innerHTML,/Preencha o R/);
assert.doesNotMatch(chart.innerHTML,/<rect/);
assert.equal(chart.style.minWidth,"0px");
console.log("PASS: hourly gains and losses stay separate, zero net trades remain visible, hours are preserved, and dense/empty charts remain readable.");
