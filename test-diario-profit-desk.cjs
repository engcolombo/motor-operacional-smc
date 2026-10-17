const assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm');
const A=require('./diario-profit-analysis.js'),D=require('./diario-profit-desk.js');
function trade({day='2026-10-15',open='09:00:00',close='09:10:00',pnl=20000,qty=1,side='C',symbol='WINZ26'}={}){
 const t={account:'QA',symbol,open:day+'T'+open,close:day+'T'+close,day,side,buy:qty,sell:qty,qty,grossCents:pnl,feeCents:0,netCents:pnl,averaged:false};
 t.id=JSON.stringify([t.account,t.symbol,t.open,t.close,t.side]);return t;
}
const full={riskCents:10000,targetCents:20000,plannedQty:1,entryQty:1,execution:'simple',newSetup:'yes',setupEvidence:'Estrutura e gatilho do meu plano',stopBasis:'structure',stopChange:'unchanged'};
const report=(trades,extra={})=>D.report({trades,day:'2026-10-15',...extra});
let count=0;function test(name,fn){fn();count++;console.log('OK '+name);}
test('Confirmed policy upgrades legacy settings once without resetting unrelated risk controls',()=>{
 const r=A.confirmedRules({quickMinutes:5,pauseMinutes:3,minTargetR:1,allowEarlyException:false,maxTrades:4,configured:true});
 assert.equal(r.quickMinutes,10);assert.equal(r.pauseMinutes,10);assert.equal(r.minTargetR,2);assert.equal(r.allowEarlyException,true);assert.equal(r.maxTrades,4);
 assert.equal(A.confirmedRules({...r,quickMinutes:15}).quickMinutes,15);
 assert.equal(A.rules({...r,pauseMinutes:2}).pauseMinutes,10,'Loss pause cannot bypass general interval');
});
test('No data and incomplete evidence never produce a full approval',()=>{
 assert.equal(report([]).status,'empty');
 const t=trade(),r=report([t]);assert.equal(r.status,'pending');assert.equal(r.coverage.complete,0);
 assert.equal(r.coverage.risk,0);assert.ok(r.chapters.find(x=>x.id==='payoff').facts.includes('0/1'));
});
test('Losing day with fully reviewed compliant execution is distinguished from bad process',()=>{
 const t=trade({pnl:-10000}),r=report([t],{annotations:{[t.id]:full}});
 assert.equal(r.status,'consistent');assert.equal(r.coverage.complete,1);
 assert.match(r.resultReading,/não é, por si, falha/);
});
test('Afternoon giveback alone does not become a behavioral violation',()=>{
 const first=trade(),second=trade({open:'14:00:00',close:'14:10:00',pnl:-10000});
 const r=report([first,second],{annotations:{[first.id]:full,[second.id]:full}});
 assert.equal(r.a.afternoonGiveback,10000);assert.equal(r.status,'consistent');
 assert.equal(r.chapters.find(x=>x.id==='gains').level,'review');assert.equal(r.flaggedCount,0);
});
test('Winning trades do not erase violations and overlapping flags do not multiply money',()=>{
 const first=trade({pnl:20000}),second=trade({open:'09:10:02',close:'09:20:00',pnl:30000});
 const r=report([first,second],{annotations:{[first.id]:full,[second.id]:{...full,newSetup:'no'}}});
 assert.equal(r.status,'correction');assert.equal(r.flaggedCount,1);assert.equal(r.flaggedPnl,30000);
 assert.match(r.resultReading,/lucro não valida/);
});
test('A failed reference limit is not labelled a confirmed control breach',()=>{
 const t1=trade({pnl:-10000}),t2=trade({open:'09:25:00',close:'09:35:00',pnl:20000});
 const inputs={settings:{...A.DEFAULTS,maxLosses:1,configured:false},annotations:{[t1.id]:full,[t2.id]:full}};
 assert.equal(report([t1,t2],inputs).status,'correction');
 assert.equal(report([t1,t2],{...inputs,settings:{...inputs.settings,configured:true}}).status,'intervention');
});
test('Reported stop removal or confirmed extra entry contracts triggers process intervention',()=>{
 const t=trade(),r=report([t],{annotations:{[t.id]:{...full,stopChange:'removed'}}});
 assert.equal(r.status,'intervention');assert.equal(r.priority.id,'risk');
 const big=trade({qty:2});assert.equal(report([big],{annotations:{[big.id]:{...full,entryQty:2}}}).status,'intervention');
});
test('Chronology never attributes a later loss to an earlier entry',()=>{
 const slow=trade({close:'12:00:00',pnl:-30000,symbol:'WDOX26'});
 const early=trade({open:'09:05:00',close:'09:07:00',pnl:-10000});
 const next=trade({open:'09:07:02',close:'09:15:00',pnl:20000,side:'V'});
 const r=report([slow,early,next]);
 const e=r.episodes.find(x=>x.id===next.id);
 assert.ok(e);assert.match(e.trigger,/09:07:00/);assert.doesNotMatch(e.trigger,/12:00:00/);
 assert.equal(r.a.entryInfo[next.id].realizedBefore,-10000);
});
test('Historical report ignores future sessions for recurrence and signature',()=>{
 const t=trade(),past=trade({day:'2026-10-14'}),future=trade({day:'2026-10-16'});
 const a=report([past,t]),b=report([past,t,future]);
 assert.equal(a.historyCount,2);assert.equal(b.historyCount,2);assert.equal(a.signature,b.signature);
});
test('Recurrence reports imported days and requires enough observations for comparisons',()=>{
 const ts=[];for(let i=1;i<=8;i++){const day='2026-10-'+String(i).padStart(2,'0');ts.push(trade({day}),trade({day,open:'09:10:01',close:'09:20:00'}));}
 const r=D.report({trades:ts,day:'2026-10-08'});
 assert.equal(r.recurrence.find(x=>x.id==='spacing').days,8);
 assert.equal(r.recurrence.find(x=>x.id==='spacing').streak,8);assert.ok(r.trend);assert.equal(r.trend.deltaPoints,0);
 assert.equal(D.report({trades:ts,day:'2026-10-03'}).trend,null);
});
test('Debrief completion becomes stale when facts, review or agreed next plan changes',()=>{
 const t=trade(),base=report([t]);
 const reviews={'2026-10-15':{desk:{completed:true,signature:base.signature,moment:'Fato'}}};
 assert.equal(report([t],{reviews}).reviewed,true);
 assert.equal(report([{...t,grossCents:19900,netCents:19900}],{reviews}).stale,true);
 assert.equal(report([t],{reviews:{'2026-10-15':{...reviews['2026-10-15'],trigger:'Novo contexto'}}}).stale,true);
 const plans={'2026-10-16':{from:'2026-10-15',rules:A.DEFAULTS,items:['spacing'],focus:'Aguardar 10 minutos'}};
 assert.equal(report([t],{reviews,plans}).stale,true);
});
test('Review notes never become inferred clinical labels',()=>{
 const t=trade(),r=report([t],{reviews:{'2026-10-15':{urge:'8',trigger:'Queria recuperar'}},annotations:{[t.id]:{emotion:'revenge'}}});
 const chapter=r.chapters.find(x=>x.id==='self');
 assert.match(chapter.facts,/8\/10/);assert.match(chapter.facts,/relato/);
 assert.match(chapter.alternatives,/Não atribuímos personalidade/);
});
test('Backup preserves a completed desk debrief and rejects invalid shapes',()=>{
 const ctx={ProfitAnalysis:A,ProfitDesk:D,ProfitJournal:require('./diario-profit-journal.js'),ProfitSupervision:require('./diario-profit-supervision.js')};vm.createContext(ctx);vm.runInContext(fs.readFileSync(__dirname+'/diario-profit.js','utf8')+'\nthis.P=ProfitTrades;',ctx);
 const t=trade(),r=report([t]);
 const backup={version:1,trades:[t],accounts:{'account:QA':{settings:A.DEFAULTS,annotations:{},plans:{},reviews:{'2026-10-15':{rules:A.DEFAULTS,desk:{moment:'<img src=x>',action:'Aguardar 10 minutos',completed:true,signature:r.signature}}}}},imports:[]};
 const restored=ctx.P.validateBackup(backup);
 const rm=restored.accounts['account:QA'];
 assert.equal(D.report({trades:restored.trades,day:t.day,settings:rm.settings,reviews:rm.reviews,annotations:rm.annotations,plans:rm.plans}).reviewed,true,'Backup normalization must not invalidate an unchanged debrief');
 assert.equal(restored.accounts['account:QA'].reviews['2026-10-15'].desk.completed,true);
 assert.equal(restored.accounts['account:QA'].reviews['2026-10-15'].desk.moment,'<img src=x>');
 assert.throws(()=>D.debrief([]),/inválido/);
});
if(process.argv[2])test('Real Profit report produces evidence-backed findings for October 15',()=>{
 const buf=fs.readFileSync(process.argv[2]);let text;try{text=new TextDecoder('utf-8',{fatal:true}).decode(buf);}catch{text=new TextDecoder('windows-1252').decode(buf);}
 const ts=A.parseCSV(text).trades,r=report(ts);
 assert.equal(r.a.pnl,-33200);assert.equal(r.a.rules.quickMinutes,10);assert.equal(r.a.rules.pauseMinutes,10);
 assert.equal(r.historyCount,5);assert.equal(r.coverage.risk,0);assert.equal(r.a.maxStreak,9);
 assert.equal(r.a.smc.below.length,0,'No made-up risk metrics from CSV alone');
 assert.equal(r.a.morning,31100);assert.equal(r.a.afternoon,-64300);assert.ok(r.episodes.length);
});
console.log(count+' desk review checks passed.');
