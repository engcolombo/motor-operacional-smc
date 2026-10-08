const fs = require("node:fs");
const vm = require("node:vm");
const assert = require("node:assert/strict");
process.env.TZ = "America/Sao_Paulo";
const core = fs.readFileSync(`${__dirname}/diario-core.js`, "utf8");
const initAt = core.indexOf("\nBacktests.init();");
const clone = (value) => JSON.parse(JSON.stringify(value));
const rows = [
    { id:"shifted", created_at:"2026-10-08T15:00:00Z", payload:{
        id:"shifted", date:"2026-10-09T05:12:34.567Z", pnl:507, symbol:"WIN", fees:0,
        notes:"Preserve this", partials:[{qty:1,r:2}], attachment:{path:"user-a/shifted/chart.png"}
    } },
    { id:"shifted-twice", payload:{ date:"2026-10-10T16:06:00Z", createdAt:"2026-10-08T16:00:00Z", pnl:-10, fees:1 } },
    { id:"correct-night", payload:{ date:"2026-10-09T01:12:00Z", createdAt:"2026-10-08T15:00:00Z", pnl:4 } },
    { id:"robot", payload:{ date:"2026-10-09T15:00:00Z", source:"robo_smc", pnl:999 } },
    { id:"later-created", created_at:"2026-10-08T16:11:00Z", payload:{ date:"2026-10-09T15:00:00Z", pnl:100 } },
    { id:"invalid", payload:{ date:"invalid" } }
];

function setup({ failWrite = false, failBackup = false, switchAccount = false, search = "?corrigir-datas=2026-10-08" } = {}) {
    const storage = new Map();
    const nodes = new Map();
    const calls = [];
    let remote = clone(rows), api;
    const node = (id) => {
        if (!nodes.has(id)) nodes.set(id, { hidden:true, textContent:"", classList:{ add(){}, remove(){} } });
        return nodes.get(id);
    };
    const window = { location:{search,href:`https://example.test/diario-pro-plus.html${search}`}, history:{
        replaceState(_state,_title,url) { window.location.href=url; window.location.search=new URL(url).search; }
    } };
    const client = { from(table) {
        assert.equal(table,"trades_pro");
        return {
            select() { return { eq(key,id) { assert.equal(key,"user_id"); assert.equal(id,"user-a"); return this; },
                async order() { return { data:clone(remote), error:null }; } }; },
            async upsert(changes) {
                assert.ok([...storage.keys()].some(key=>key.includes("DateRepair")), "Backup must exist before the cloud write");
                calls.push(clone(changes));
                if (failWrite) return {error:{message:"offline"}};
                remote = remote.map(row=>changes.find(next=>next.id===row.id) || row);
                if (switchAccount) api.configure(client,{id:"user-b"});
                return {error:null};
            }
        };
    } };
    const context = vm.createContext({
        Date, URL, URLSearchParams, window, console,
        document:{getElementById:node,querySelectorAll:()=>[]},
        setTimeout:()=>1, clearTimeout(){}, alert(){},
        localStorage:{ getItem:key=>storage.get(key)||null, setItem(key,value){
            if (failBackup && key.includes("DateRepair")) throw new Error("storage full");
            storage.set(key,value);
        } }
    });
    vm.runInContext(`${core.slice(0,initAt)}
        this.api={state,planRegisteredDateRepair,dateRepairRequested,loadCloudTrades,repairRegisteredTradeDates,calendarResults,
            configure:(client,user)=>{supabaseClient=client;currentUser=user;currentSession={user};}};
        renderAll=()=>{};updateCloudUi=()=>{};`,context);
    api = context.api;
    api.configure(client,{id:"user-a"});
    api.state.trades = clone(rows.map(row=>({...row.payload,id:row.id})));
    api.state.fees={win:0,wdo:0,cripto:0};
    return {api,storage,node,calls,window};
}

(async()=>{
    const normal=setup({search:""});
    assert.equal(normal.api.dateRepairRequested(),false);
    await normal.api.loadCloudTrades();
    assert.equal(normal.calls.length,0,"Normal visits never repair dates automatically");

    const success=setup();
    const plan=clone(success.api.planRegisteredDateRepair(rows));
    assert.deepEqual(plan.map(row=>row.id),["shifted","shifted-twice"]);
    assert.equal(plan[0].payload.date,"2026-10-08T05:12:34.567Z");
    assert.equal(plan[1].payload.date,"2026-10-08T16:06:00.000Z");
    assert.deepEqual(rows[0].payload.attachment,plan[0].payload.attachment);
    assert.equal(plan[0].payload.dateCorrection.originalDate,rows[0].payload.date);
    await success.api.loadCloudTrades();
    assert.equal(success.calls.length,1,"Cloud changes are sent as one atomic batch");
    assert.equal(success.calls[0].length,2);
    success.calls[0].forEach(row=>{
        assert.equal(row.user_id,"user-a");
        assert.equal(row.trade_timestamp,row.payload.date);
    });
    const repaired=success.api.state.trades.find(trade=>trade.id==="shifted");
    const {date,dateCorrection,...rest}=clone(repaired);
    const {date:oldDate,...original}=rows[0].payload;
    assert.deepEqual(rest,original,"Amounts, notes, partial exits and attachments stay unchanged");
    assert.equal(success.api.state.view,"calendar");
    assert.equal(success.window.location.search,"");
    assert.match(success.node("dateRepairStatus").textContent,/2 trade\(s\) corrigido/);
    const backup=[...success.storage.entries()].find(([key])=>key.includes("DateRepair"));
    assert.deepEqual(JSON.parse(backup[1]).rows,rows);
    const totals=success.api.calendarResults(success.api.state.trades,new Date(2026,9,1),new Date(2026,9,8,13));
    assert.equal(totals.last7,500);
    assert.equal(totals.last30,500);
    assert.equal(success.api.planRegisteredDateRepair(success.calls[0]).length,0,"Repeating the repair is idempotent");

    const offline=setup({failWrite:true});
    await offline.api.loadCloudTrades();
    assert.equal(offline.api.state.trades[0].date,oldDate);
    assert.equal(offline.api.dateRepairRequested(),true,"Failed writes remain retryable");
    assert.match(offline.node("dateRepairStatus").textContent,/Correção pendente: offline/);

    const noBackup=setup({failBackup:true});
    await noBackup.api.loadCloudTrades();
    assert.equal(noBackup.calls.length,0,"No data is changed when the backup fails");
    assert.equal(noBackup.api.dateRepairRequested(),true);

    const changedAccount=setup({switchAccount:true});
    await changedAccount.api.loadCloudTrades();
    assert.equal(changedAccount.api.state.trades[0].date,oldDate,"A switched account never receives another user's corrected local data");
    assert.match(changedAccount.node("dateRepairStatus").textContent,/conta mudou/);
    console.log("PASS: repair is opt-in, backed up, idempotent, atomic, scoped to existing trades and account; amounts and attachments preserved.");
})().catch(error=>{console.error(error);process.exitCode=1;});
