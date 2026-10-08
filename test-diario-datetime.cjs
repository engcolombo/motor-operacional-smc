const fs = require("node:fs");
const vm = require("node:vm");
const assert = require("node:assert/strict");
process.env.TZ = "America/Sao_Paulo";
const core = fs.readFileSync(`${__dirname}/diario-core.js`, "utf8");
const initAt = core.indexOf("\nBacktests.init();");
const now = new Date("2026-10-08T16:23:00.000Z");
class FixedDate extends Date {
    constructor(...args) { super(...(args.length ? args : [now.getTime()])); }
    static now() { return now.getTime(); }
}
const storage = new Map(), nodes = new Map();
const node = id => {
    if (!nodes.has(id)) nodes.set(id, {
        value:"", files:[], disabled:false, textContent:"", innerHTML:"",
        classList:{add(){},remove(){}}, querySelectorAll:()=>[], removeAttribute(){}
    });
    return nodes.get(id);
};
let cloudRows = [], writes = 0;
const client = { from() { return {
    async upsert(row) { writes++; cloudRows = JSON.parse(JSON.stringify([row])); return {error:null}; },
    select() { return { eq() { return this; }, async order() { return {data:JSON.parse(JSON.stringify(cloudRows)),error:null}; } }; }
}; } };
const context = vm.createContext({
    Date:FixedDate, console, URL, URLSearchParams, crypto:{randomUUID:()=>"typed-time-trade"},
    window:{location:{search:""}}, setTimeout:()=>1, clearTimeout(){}, alert(){},
    document:{getElementById:node,querySelectorAll:()=>[]},
    localStorage:{getItem:key=>storage.get(key)||null,setItem:(key,value)=>storage.set(key,value)}
});
vm.runInContext(`${core.slice(0,initAt)}
this.api={state,openModal,saveFromForm,loadCloudTrades,fmtDate,tradeDisplayDate,calendarResults,parseDateTimeLocal,
  restore:()=>{state.trades=loadTrades();},
  configure:()=>{supabaseClient=client;currentUser={id:'user-a'};currentSession={user:currentUser};}};
renderAll=()=>{};updateCloudUi=()=>{};`,Object.assign(context,{client}));
const api = context.api;

(async()=>{
    api.configure();
    api.openModal();
    assert.equal(node("fDate").value,"2026-10-08T13:23");
    node("fSymbol").value="WIN";
    node("fInitQty").value="1";
    node("fStopMoney").value="100";
    node("fTargetMoney").value="200";
    node("fStatus").value="target";
    await api.saveFromForm();
    assert.equal(writes,1);
    assert.equal(cloudRows[0].payload.dateLocal,"2026-10-08T13:23","The exact form value is stored without a timezone conversion");
    assert.equal(cloudRows[0].payload.dateTimeZone,"America/Sao_Paulo");
    assert.equal(cloudRows[0].trade_timestamp,"2026-10-08T16:23:00.000Z","The UTC index still represents the correct instant");
    assert.equal(api.fmtDate(api.state.trades[0]),"08/10/2026 13:23");

    await api.loadCloudTrades();
    api.restore();
    assert.equal(api.fmtDate(api.state.trades[0]),"08/10/2026 13:23","Cloud and local reload preserve the typed time");
    api.openModal(api.state.trades[0]);
    assert.equal(node("fDate").value,"2026-10-08T13:23");
    for(let edit=0;edit<5;edit++) {
        await api.saveFromForm();
        api.openModal(api.state.trades[0]);
        assert.equal(node("fDate").value,"2026-10-08T13:23");
        assert.equal(api.state.trades[0].date,"2026-10-08T16:23:00.000Z");
    }

    // Viewing the record on another device must not reinterpret the original wall clock time.
    process.env.TZ="Pacific/Honolulu";
    await api.loadCloudTrades();
    assert.equal(api.fmtDate(api.state.trades[0]),"08/10/2026 13:23");
    api.openModal(api.state.trades[0]);
    assert.equal(node("fDate").value,"2026-10-08T13:23");
    await api.saveFromForm();
    assert.equal(api.state.trades[0].date,"2026-10-08T16:23:00.000Z","An unchanged date retains its original UTC instant and timezone");
    assert.equal(api.state.trades[0].dateTimeZone,"America/Sao_Paulo");
    assert.equal(api.tradeDisplayDate(api.state.trades[0]).getHours(),13);
    const results=api.calendarResults(api.state.trades,new Date(2026,9,1),new Date(2026,9,8,13));
    assert.equal(results.dayMap[8].cents,20000);
    assert.equal(results.last7,200);

    // A deliberate change to the field is saved as the user's new choice.
    process.env.TZ="America/Sao_Paulo";
    api.openModal(api.state.trades[0]);
    node("fDate").value="2026-10-08T23:59";
    await api.saveFromForm();
    assert.equal(api.state.trades[0].date,"2026-10-09T02:59:00.000Z");
    assert.equal(api.state.trades[0].dateLocal,"2026-10-08T23:59");
    assert.equal(api.fmtDate(api.state.trades[0]),"08/10/2026 23:59");
    assert.equal(api.calendarResults(api.state.trades,new Date(2026,9,1),new Date(2026,9,8,13)).dayMap[8].cents,20000);

    assert.equal(api.parseDateTimeLocal("2026-02-30T13:23"),null);
    assert.equal(api.parseDateTimeLocal("2026-10-08T24:00"),null);
    assert.equal(api.parseDateTimeLocal("invalid"),null);
    api.openModal(api.state.trades[0]);
    node("fDate").value="";
    const before=writes;
    await api.saveFromForm();
    assert.equal(writes,before,"An invalid date never silently falls back to another hour");
    assert.equal(api.fmtDate(null),"-");
    assert.equal(api.fmtDate({date:"2026-10-08T16:23:00Z"}),"08/10/2026 13:23","Legacy UTC records remain readable");
    console.log("PASS: 13:23 stays 13:23 through new-trade save, Supabase/local reload, five edits, another timezone, calendar, and midnight.");
})().catch(error=>{console.error(error);process.exitCode=1;});
