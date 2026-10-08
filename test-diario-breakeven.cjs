const fs = require("node:fs");
const vm = require("node:vm");
const assert = require("node:assert/strict");
process.env.TZ = "America/Sao_Paulo";
const core = fs.readFileSync(`${__dirname}/diario-core.js`, "utf8");
const initAt = core.indexOf("\nBacktests.init();");
const nodes = new Map(), storage = new Map(), rows = new Map();
const node = id => {
    if (!nodes.has(id)) nodes.set(id, {value:"",files:[],disabled:false,hidden:false,innerHTML:"",textContent:"",
        classList:{add(){},remove(){}},querySelectorAll:()=>[],removeAttribute(){}});
    return nodes.get(id);
};
const client = {from(){return {
    async upsert(row){rows.set(row.id,JSON.parse(JSON.stringify(row)));return {error:null};},
    select(){return {eq(){return this;},async order(){return {data:[...rows.values()],error:null};}};}
};}};
const context = vm.createContext({Date,URL,URLSearchParams,console,client,
    crypto:{randomUUID:()=>"be-trade"},setTimeout:()=>1,clearTimeout(){},alert(message){throw new Error(message);},
    window:{location:{search:""}},document:{getElementById:node},
    localStorage:{getItem:key=>storage.get(key)||null,setItem:(key,value)=>storage.set(key,value)}
});
vm.runInContext(`${core.slice(0,initAt)}
this.api={state,openModal,computeTradeMath,recomputeFromInputs,saveFromForm,loadCloudTrades,computeStats,tradeOutcome,tradeChartData,tradeChartBarClass,tradeChartTooltipHtml,renderRBadge,renderTrades,renderTagStats,renderKPIs,
 configure:()=>{supabaseClient=client;currentUser={id:'user-a'};currentSession={user:currentUser};}};
renderAll=()=>{};updateCloudUi=()=>{};`,context);
const api=context.api;
const make=(id,r,status,extra={})=>({id,r,status,pnl:r*100,fees:10,date:"2026-10-08T16:00:00Z",dateLocal:"2026-10-08T13:00",symbol:"WIN",side:"long",tags:["POI"],...extra});
const fields={fDate:"2026-10-08T13:00",fSymbol:"WIN",fSide:"long",fSetup:"POI",fInitQty:"2",fStopMoney:"100",fTargetMoney:"300",fStatus:"breakeven",fManualR:"7"};

(async()=>{
    api.configure();
    api.state.fees.win=5;
    const original=make("be-trade",0,"open",{initQty:2,qty:2,stopMoney:100,targetMoney:300,createdAt:"2026-10-08T16:00:00Z"});
    api.state.trades=[original];
    api.openModal(original);
    Object.entries(fields).forEach(([id,value])=>node(id).value=value);
    api.state.editPartials=[];
    const m=api.computeTradeMath();
    assert.equal(m.finalR,0);
    assert.equal(m.pnlFinal,0);
    assert.equal(m.pnl,0);
    assert.equal(m.totalR,0);
    api.recomputeFromInputs();
    assert.equal(node("fManualR").disabled,true,"Old manual R is ignored for break-even");
    assert.equal(node("breakevenHint").hidden,false);
    assert.match(node("partialSummary").innerHTML,/Empate \/ 0x0/);
    await api.saveFromForm();
    assert.equal(rows.get("be-trade").payload.status,"breakeven");
    assert.equal(rows.get("be-trade").payload.r,0);
    assert.equal(rows.get("be-trade").payload.pnl,0);
    await api.loadCloudTrades();
    const restored=api.state.trades[0];
    assert.equal(api.tradeOutcome(restored),"be");
    api.openModal(restored);
    assert.equal(node("fStatus").value,"breakeven","The selected closure survives cloud reload and editing");
    assert.match(api.renderRBadge(restored),/Empate · 0R/);
    const s=api.computeStats(api.state.trades);
    assert.equal(s.wins,0);
    assert.equal(s.losses,0,"Fees never turn a break-even result into a stop");
    assert.equal(s.bes,1);
    assert.equal(s.rCount,1);
    assert.equal(s.openCount,0);
    assert.equal(s.pnlTotal,-10,"Configured fees remain in financial results");
    assert.equal(s.rTotal,0);
    assert.equal(s.maxDD,0);
    assert.equal(s.bestWinStreak,0);
    assert.equal(s.bestLossStreak,0);
    const bar=api.tradeChartData([restored],"2026-10").bars[0];
    assert.equal(bar.cents,-1000);
    assert.equal(api.tradeChartBarClass(bar),"hour-breakeven","Fee-only losses are neutral in the chart");
    assert.match(api.tradeChartTooltipHtml(bar),/Empate \/ 0x0 · taxas incluídas no líquido/);
    const daily=api.tradeChartData([restored],"2026-10",null,new Date("2026-10-09T12:00:00Z")).bars[0];
    assert.equal(daily.kind,"day");
    assert.equal(api.tradeChartBarClass(daily),"hour-breakeven");

    const fixtures=[make("win",2,"target"),make("loss",-1,"stop"),restored,make("open",0,"open"),make("open-partial",1,"open"),make("pending",null,"manual",{rPending:true})];
    const mixed=api.computeStats(fixtures);
    assert.deepEqual([mixed.wins,mixed.losses,mixed.bes,mixed.openCount,mixed.pendingR],[1,1,1,2,1]);
    assert.equal(mixed.winrate,50,"Winrate excludes break-even, open and unknown results");
    assert.equal(mixed.rTotal,1);
    assert.equal(mixed.expectancy,1/3,"A completed 0R counts toward expectancy");
    assert.equal(mixed.avgWin,2);
    assert.equal(mixed.avgLoss,-1);
    assert.equal(mixed.pf,2);
    assert.equal(mixed.currentStreak,0,"A break-even resets winning/losing streaks");
    assert.match(api.renderRBadge(fixtures[3]),/Em aberto/);
    assert.equal(api.tradeChartBarClass(api.tradeChartData([fixtures[3]],"2026-10").bars[0]),"hour-open");
    assert.equal(api.tradeOutcome(make("legacy-zero",0,undefined)),"be","Existing manual zero results still count as break-even");

    api.state.trades=fixtures;
    node("filterResult").value="be";
    api.renderTrades();
    assert.match(node("tradesTable").innerHTML,/data-edit="be-trade"/);
    assert.doesNotMatch(node("tradesTable").innerHTML,/data-edit="open|data-edit="win|data-edit="loss/);
    node("filterResult").value="open";
    api.renderTrades();
    assert.match(node("tradesTable").innerHTML,/data-edit="open"/);
    assert.match(node("tradesTable").innerHTML,/data-edit="open-partial"/);
    assert.doesNotMatch(node("tradesTable").innerHTML,/data-edit="be-trade"/);
    api.renderTagStats();
    assert.match(node("tagStats").innerHTML,/3 · \+1R/);
    api.renderKPIs();
    assert.match(node("kpiGrid").innerHTML,/1W \/ 1L \/ 1BE \/ 2 em aberto/);

    // Only the remaining position exits at entry; realized partials are never erased.
    Object.entries(fields).forEach(([id,value])=>node(id).value=value);
    api.state.editPartials=[{qty:1,r:2}];
    const partial=api.computeTradeMath();
    assert.equal(partial.qtyRemaining,1);
    assert.equal(partial.pnlFinal,0);
    assert.equal(partial.pnlPartials,100);
    assert.equal(partial.pnl,100);
    assert.equal(partial.totalR,1);
    assert.equal(api.tradeOutcome(make("partial",partial.totalR,"breakeven")),"win","Result classification uses the full trade, including partials");
    api.state.editPartials=[{qty:1,r:-1}];
    assert.equal(api.computeTradeMath().totalR,-.5,"A previous losing partial also remains in the total");
    node("fStatus").value="stop";
    api.state.editPartials=[];
    assert.equal(api.computeTradeMath().totalR,-1,"Stop still realizes the original risk");
    node("fStatus").value="target";
    assert.equal(api.computeTradeMath().totalR,3);
    console.log("PASS: 0x0 closure, cloud reload, neutral fees, closed-only results, winrate/expectancy/streaks, filters, legacy zeros, and preserved partials.");
})().catch(error=>{console.error(error);process.exitCode=1;});
