const fs=require('node:fs'),vm=require('node:vm'),assert=require('node:assert/strict');
const A=require('./diario-profit-analysis.js'),D=require('./diario-profit-desk.js'),S=require('./diario-profit-supervision.js'),J=require('./diario-profit-journal.js');
const rootKey='diarioProfit_v1_guest';
const fixture=()=>({version:1,trades:[],imports:[],journalLinks:{},accounts:{'account:__diary__':{settings:{...A.DEFAULTS,maxTrades:3},
    reviews:{'2026-10-20':{before:'Ansiedade antes',after:'Mais calmo depois',good:'Respeitei o stop',trigger:'Entrada antecipada <img src=x onerror=alert(1)>',lesson:'Esperar confirmação',desk:{thought:'Preciso entrar agora',alternative:'Esperar o reteste',action:'Pausar',proof:'Anotar o sinal',completed:false}}},
    plans:{'2026-10-21':{from:'2026-10-20',items:['pause'],focus:'Pausa de 10 minutos',contract:{priority:'pause',trigger:'Após stop',proof:'Registrar pausa'}}},
    preparations:{'2026-10-20':{setups:'POI confirmado',exceptions:'Nenhuma',trigger:'Pressa',response:'Pausar',sleep:'rested',tension:'3',urge:'2',riskCents:10000}},annotations:{}}}});
function boot(storage=new Map()){
    const nodes=new Map(),alerts=[];let seq=0,quota=false,cloudFails=false;
    const node=id=>{if(!nodes.has(id))nodes.set(id,{hidden:false,disabled:false,value:'',innerHTML:'',textContent:'',classList:{toggle(){},remove(){}},querySelectorAll:()=>[],setAttribute(){}});return nodes.get(id);};
    const context=vm.createContext({console,Date,Intl,URLSearchParams,ProfitAnalysis:A,ProfitDesk:D,ProfitSupervision:S,ProfitJournal:J,
        document:{getElementById:node},window:{location:{search:''}},requestAnimationFrame(){},crypto:{randomUUID:()=>`cycle-${++seq}`},alert:m=>alerts.push(m),
        localStorage:{getItem:k=>storage.get(k)||null,setItem(k,v){if(quota&&k.endsWith('_cycle_pending'))throw Error('quota');storage.set(k,v);},removeItem:k=>storage.delete(k)},
        cloud:{from:()=>({upsert:async()=>({error:cloudFails?{message:'offline'}:null})})}});
    const core=fs.readFileSync(__dirname+'/diario-core.js','utf8');
    vm.runInContext(fs.readFileSync(__dirname+'/diario-profit.js','utf8')+'\n'+fs.readFileSync(__dirname+'/diario-archives.js','utf8')+'\n'+core.slice(0,core.indexOf('\nBacktests.init();'))+`
        renderAll=()=>{};hideTradeChartTooltip=()=>{};loadCloudTrades=()=>{};toast=()=>{};
        this.api={state,P:ProfitTrades,C:DiaryArchives,snapshot:psychologyDiarySnapshot,saveTrades,
            login(id){currentUser=id?{id}:null;currentSession=id?{}:null;supabaseClient=cloud;psychologyLoadedUser=id;}};
    `,context);
    const api=context.api;api.login(null);api.P.authChanged();
    return {api,storage,alerts,quota:v=>quota=v,offline:v=>cloudFails=v};
}
const trade={id:'d1',symbol:'WIN',date:'2026-10-20T12:00:00Z',dateLocal:'2026-10-20T09:00',pnl:100,r:1,qty:1,notes:'Justificativa'};
(async()=>{
    const storage=new Map([[rootKey,JSON.stringify(fixture())],['diarioBacktests_v1_guest','backtests unchanged']]);
    const b=boot(storage),{api:a}=b;
    a.state.trades=[{...trade},{id:'robot',source:'robo_smc',pnl:999}];a.state.fees={win:5,wdo:2,cripto:1};
    const id=await a.C.archive('Plano antigo');
    const root=JSON.parse(storage.get(rootKey));
    assert.deepEqual(root.accounts,{},'New cycle has no old psychological reviews, plans or preparation');
    assert.equal(root.archivedCycles[id].data.accounts['account:__diary__'].reviews['2026-10-20'].before,'Ansiedade antes');
    assert.equal(a.snapshot().rows.length,0,'Psychology current cycle sees no archived trades');
    assert.equal(a.P.cycleReportHTML('active'),'');
    assert.equal(a.state.fees.win,5,'Fee configuration preserved');
    assert.equal(a.state.trades[1].pnl,999,'Robot preserved');
    assert.equal(storage.get('diarioBacktests_v1_guest'),'backtests unchanged');
    a.C.select(id);a.P.authChanged();assert.equal(a.snapshot().rows.length,1);
    const report=a.P.cycleReportHTML(id);
    for(const text of ['Ansiedade antes','Mais calmo depois','Respeitei o stop','Esperar confirmação','Preciso entrar agora','Pausa de 10 minutos','POI confirmado'])assert.ok(report.includes(text),text);
    assert.ok(!report.includes('<img src=x'));assert.ok(report.includes('&lt;img'));
    assert.ok(a.C.reportHTML([trade],'Plano antigo',new Map(),report).includes('Psicologia · revisão e evolução'));
    assert.equal(a.P.validateBackup(root).archivedCycles[id].data.accounts['account:__diary__'].plans['2026-10-21'].focus,'Pausa de 10 minutos');
    a.state.trades.push({...trade,id:'new'});a.C.select('active');
    assert.equal(a.snapshot().rows.length,1,'Same-date new cycle does not include old manual record');
    // Simulate a new review for the same day. It must remain in its own cycle.
    const withNew=JSON.parse(storage.get(rootKey));withNew.accounts=fixture().accounts;withNew.accounts['account:__diary__'].reviews['2026-10-20'].before='Novo ciclo, outra revisão';storage.set(rootKey,JSON.stringify(withNew));
    assert.ok(a.P.cycleReportHTML('active').includes('Novo ciclo, outra revisão'));
    assert.ok(!a.P.cycleReportHTML(id).includes('Novo ciclo, outra revisão'));
    const before=JSON.stringify(a.state.trades),saved=storage.get(rootKey);
    await assert.rejects(a.C.restore(id),/registros diferentes/);
    assert.equal(JSON.stringify(a.state.trades),before);assert.equal(storage.get(rootKey),saved,'Restore conflict never overwrites psychology');
    delete withNew.accounts['account:__diary__'];storage.set(rootKey,JSON.stringify(withNew));
    await a.C.restore(id);
    assert.equal(JSON.parse(storage.get(rootKey)).accounts['account:__diary__'].reviews['2026-10-20'].before,'Ansiedade antes');
    assert.equal(a.snapshot().rows.length,2);
    // Psychology-only history must be archivable, visible and reportable.
    a.state.trades=[];const only=await a.C.archive('Só psicologia');
    assert.ok(a.C.groups().some(c=>c.id===only));assert.ok(a.P.cycleReportHTML(only).includes('Ansiedade antes'));
    await a.C.restore(only);assert.ok(a.P.hasActiveCycle());
    b.quota(true);await assert.rejects(a.C.archive('Sem espaço'),/quota/);b.quota(false);
    assert.ok(a.P.hasActiveCycle(),'Quota failure retains active psychology');
    // Recovery after interruption between saving trade metadata and finalizing local psychology.
    a.state.trades=[{...trade}];
    a.P.prepareCycle('archive',{id:'interrupted',name:'Interrompido',createdAt:'2026-10-23'},['d1']);
    a.state.trades[0].archive={id:'interrupted',name:'Interrompido'};a.saveTrades();
    const reloaded=boot(storage);reloaded.api.P.authChanged();
    assert.equal(reloaded.api.P.hasActiveCycle(),false);
    assert.ok(reloaded.api.P.cycleReportHTML('interrupted').includes('Ansiedade antes'));
    assert.equal(storage.has(rootKey+'_cycle_pending'),false);
    // Account changes and failed remote saves preserve local psychology.
    storage.set('diarioProfit_v1_owner',JSON.stringify(fixture()));
    a.login('owner');a.state.trades=[{...trade}];a.state.archiveView='active';b.offline(true);
    const original=storage.get('diarioProfit_v1_owner');
    await assert.rejects(a.C.archive('Falha nuvem'),/offline/);
    assert.equal(storage.get('diarioProfit_v1_owner'),original);
    assert.equal(storage.has('diarioProfit_v1_owner_cycle_pending'),false);
    assert.equal(a.state.trades[0].archive,undefined);
    const parsed=A.parseCSV('Conta: QA\nAtivo;Abertura;Fechamento;Qtd Compra;Qtd Venda;Lado;Res. Operação;Comissões\nWINZ26;20/10/2026 09:00:00;20/10/2026 09:05:00;1;1;C;100,00;0,00');
    const imported={version:1,trades:parsed.trades,accounts:{'account:QA':{settings:A.DEFAULTS,reviews:{},plans:{},annotations:{},preparations:{}}},imports:[],journalLinks:{}};
    const exportTest=boot(new Map([[rootKey,JSON.stringify(imported)]]));
    const importedReport=exportTest.api.P.cycleReportHTML('active');
    assert.ok(importedReport.includes('Leitura das execuções importadas'));
    assert.ok(importedReport.includes('1 entradas · 1 operações fechadas'));
    console.log('PASS: psychological cycle reset, scoped diary evidence, notes/preparation/plans/debrief in PDF, same-day isolation, safe restore conflicts, backups, fees/robot/backtests unchanged, psychology-only cycles, quota/cloud failure and interrupted-transaction recovery.');
})().catch(e=>{console.error(e);process.exitCode=1;});
