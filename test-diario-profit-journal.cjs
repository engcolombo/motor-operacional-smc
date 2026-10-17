const assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm');
process.env.TZ='America/Sao_Paulo';
const A=require('./diario-profit-analysis.js'),D=require('./diario-profit-desk.js'),J=require('./diario-profit-journal.js'),S=require('./diario-profit-supervision.js');
function profit({day='2026-10-15',open='09:00:00',close='09:10:00',pnl=20000,symbol='WINZ26',account='QA',side='C'}={}){
 const t={account,symbol,open:day+'T'+open,close:day+'T'+close,day,side,buy:1,sell:1,qty:1,grossCents:pnl,feeCents:0,netCents:pnl,averaged:false};
 t.id=JSON.stringify([account,symbol,t.open,t.close,side]);return t;
}
function diary(v={}){return {id:'d1',dateLocal:'2026-10-15T09:00',symbol:'WIN',side:'long',status:'target',pnl:190,r:1.9,stopMoney:100,targetMoney:200,initQty:1,setup:'POI',notes:'Estrutura, invalidação e gatilho registrados',...v};}
const report=(ps,ds,more={})=>J.report({profit:ps,diary:ds,day:'2026-10-15',...more});
let count=0;function test(name,fn){fn();count++;console.log('OK '+name);}
test('Matching count/category ignores monetary cents and symbol expiry',()=>{
 const r=report([profit()],[diary({pnl:155.37})]);assert.equal(r.status,'compatible');assert.equal(r.groups[0].diary,1);
});
test('Fewer diary records is a serious fault even when the Profit result is positive',()=>{
 const r=report([profit()],[]);assert.equal(r.status,'missing');assert.equal(r.missing,1);
 const d=D.report({trades:[profit()],day:'2026-10-15',journal:r});assert.equal(d.status,'intervention');assert.equal(d.priority.id,'documentation');
 assert.doesNotMatch(r.feedback,/você operou sem racional/i);
});
test('More records are permitted but a different asset cannot cover a missing trade',()=>{
 assert.equal(report([profit()],[diary(),diary({id:'d2'})]).status,'compatible');
 const r=report([profit()],[diary({symbol:'WDO'}),diary({id:'d2',symbol:'WDO'})]);assert.equal(r.status,'missing');assert.equal(r.missing,1);
});
test('Equal total with an incompatible target/stop distribution remains serious',()=>{
 const r=report([profit(),profit({open:'10:00:00',close:'10:10:00'})],[diary(),diary({id:'d2',dateLocal:'2026-10-15T10:00',status:'stop',pnl:-100})]);
 assert.equal(r.status,'mismatch');assert.equal(r.missing,0);assert.equal(r.outcomeGap,1);
});
test('Open records count as documentation but cannot certify the exit outcome',()=>{
 const r=report([profit()],[diary({status:'open',pnl:0})]);assert.equal(r.missing,0);assert.equal(r.status,'pending');
});
test('Partial profits with a final stop remain pending until the Profit exit is reviewed',()=>{
 const p=profit(),d=diary({status:'stop',pnl:50}),links={[p.id]:{diaryId:'d1'}};
 assert.equal(report([p],[d],{links}).status,'pending');
 assert.equal(report([p],[d],{links,annotations:{[p.id]:{exit:'stop'}}}).status,'compatible');
});
test('Gross zero is not turned into a stop by fees',()=>{
 const p={...profit({pnl:0}),feeCents:100,netCents:-100};
 assert.equal(report([p],[diary({status:'breakeven',pnl:0})]).status,'compatible');
});
test('Reconciliation uses opening day, including overnight executions',()=>{
 const p=profit();p.day='2026-10-16';p.close='2026-10-16T09:10:00';
 assert.equal(report([p],[diary()]).profitCount,1);
 assert.equal(J.report({profit:[p],diary:[diary()],day:'2026-10-16'}).profitCount,0);
});
test('Imported automatic text is not treated as rationale',()=>{
 const d=diary({source:'broker_csv',notes:'Importado da corretora. P&L bruto R$ 10; taxa auto aplicada conforme config (win). Preencha stop/risco para calcular o R.'});
 assert.equal(report([],[d]).withoutRationale,1);
 assert.equal(report([],[{...d,notes:d.notes+' Estrutura revisada no gráfico.'}]).withoutRationale,0);
});
test('Duplicate identities and invalid dates do not fabricate sufficient coverage',()=>{
 assert.equal(report([profit()],[diary(),diary()]).status,'pending');
 assert.equal(report([profit()],[diary({dateLocal:'2026-02-30T09:00'})]).status,'pending');
 assert.equal(J.normalize([diary({source:'robo_smc'})]).items.length,0);
});
test('Time suggestions remain unconfirmed and ambiguous candidates are not guessed',()=>{
 const p=profit(),r=report([p],[diary()]);assert.equal(r.rows[0].suggestion,'d1');assert.equal(r.linked,0);
 assert.equal(report([p],[diary(),diary({id:'d2'})]).rows[0].suggestion,'');
});
test('One diary row cannot cover two Profit accounts',()=>{
 const a=profit(),b=profit({account:'QB'}),r=report([a,b],[diary()],{links:{[a.id]:{diaryId:'d1'},[b.id]:{diaryId:'d1'}}});
 assert.equal(r.status,'missing');assert.equal(r.linked,1);assert.equal(r.rows.filter(x=>x.stale).length,1);
});
test('Confirmed links enrich only missing fields and never certify structure or new setup',()=>{
 const p=profit(),links={[p.id]:{diaryId:'d1'}};
 assert.equal(J.enrich([p],[diary()],{},{}).annotations[p.id],undefined);
 const n=J.enrich([p],[diary()],links,{[p.id]:{riskCents:15000}}).annotations[p.id];
 assert.equal(n.riskCents,15000);assert.equal(n.targetCents,20000);assert.equal(n.exit,'target');
 assert.equal(n.newSetup,'unknown');assert.equal(n.stopBasis,'unknown');assert.equal(n.plannedQty,null);
});
test('Conflicting or deleted links do not silently feed the analysis',()=>{
 const p=profit(),links={[p.id]:{diaryId:'d1'}};
 const d=diary({status:'stop',pnl:-100});
 assert.equal(J.enrich([p],[d],links,{}).annotations[p.id],undefined);
 assert.equal(report([p],[],{links}).rows[0].stale,true);
});
test('Diary-only mode supplies context without claiming broker completeness',()=>{
 const r=report([],[diary({mistakes:['Pressa']})]);assert.equal(r.status,'journal-only');assert.equal(r.diaryCount,1);assert.equal(r.mistakes[0][0],'Pressa');
});
test('Unavailable data cannot trigger a documentation accusation',()=>{
 const r=report([profit()],[],{ready:false,reason:'Aguarde a conta atual'});assert.equal(r.status,'unavailable');
 const d=D.report({trades:[profit()],day:'2026-10-15',journal:r});assert.notEqual(d.status,'intervention');
});
test('Diary edits invalidate a completed desk review even without a count change',()=>{
 const p=profit(),r=report([p],[diary()]),input={trades:[p],day:'2026-10-15',journal:r};
 const d=D.report(input),reviews={'2026-10-15':{desk:{completed:true,signature:d.signature}}};
 assert.equal(D.report({...input,reviews}).reviewed,true);
 assert.equal(D.report({...input,reviews,journal:report([p],[diary({notes:'Outro contexto'})])}).stale,true);
});
test('Backups keep unique links and diary-only reviews without copying diary transactions',()=>{
 const ctx={ProfitAnalysis:A,ProfitDesk:D,ProfitSupervision:S,ProfitJournal:J};vm.createContext(ctx);
 vm.runInContext(fs.readFileSync(__dirname+'/diario-profit.js','utf8')+'\nthis.P=ProfitTrades;',ctx);
 const p=profit(),backup={version:1,trades:[p],accounts:{'account:__diary__':{reviews:{'2026-10-15':{good:'Rotina registrada'}}}},journalLinks:{[p.id]:{diaryId:'d1',confirmedAt:'now'}},imports:[]};
 const restored=ctx.P.validateBackup(backup);assert.equal(restored.journalLinks[p.id].diaryId,'d1');assert.equal(restored.accounts['account:__diary__'].reviews['2026-10-15'].good,'Rotina registrada');
 const q=profit({account:'QB'});backup.trades.push(q);backup.journalLinks[q.id]={diaryId:'d1'};assert.throws(()=>ctx.P.validateBackup(backup),/duplicado/);
});
test('Core adapter respects civil dates and waits for the correct logged-in diary',()=>{
 const code=fs.readFileSync(__dirname+'/diario-core.js','utf8'),end=code.indexOf('\nBacktests.init();');
 const ctx={console,Date,Intl,localStorage:{getItem:()=>null},window:{},document:{getElementById:()=>null}};
 vm.createContext(ctx);vm.runInContext(code.slice(0,end)+'\nthis.api={state,snapshot:psychologyDiarySnapshot,user:id=>{currentUser=id?{id}:null;},loaded:id=>{psychologyLoadedUser=id;},busy:x=>{cloudBusy=x;}};',ctx);
 ctx.api.state.trades=[diary(),{...diary({id:'robot'}),source:'robo_smc'}];assert.equal(ctx.api.snapshot().rows.length,1);
 assert.equal(ctx.api.snapshot().rows[0].openLocal,'2026-10-15T09:00');
 ctx.api.user('A');assert.equal(ctx.api.snapshot().ready,false);ctx.api.loaded('A');assert.equal(ctx.api.snapshot().ready,true);
 ctx.api.user('B');assert.equal(ctx.api.snapshot().ready,false);ctx.api.user(null);assert.equal(ctx.api.snapshot().ready,false);
 ctx.api.loaded(null);ctx.api.busy(true);assert.equal(ctx.api.snapshot().ready,false);
});
console.log(count+' journal reconciliation checks passed.');
