const assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm');
const A=require('./diario-profit-analysis.js');
const D=require('./diario-profit-desk.js');
const header='Ativo;Abertura;Fechamento;Tempo Operação;Qtd Compra;Qtd Venda;Lado;Preço Compra;Preço Venda;Preço de Mercado;Médio;Res. Intervalo Bruto;Res. Intervalo (%);Res. Operação;Res. Operação (%);TET;Comissões;Total';
function row({symbol='WINZ26',open='15/10/2026 09:00:00',close='15/10/2026 09:10:00',qty=1,side='C',pnl='100,00',fee='0,00',total='999.999,99'}={}){
 return [symbol,open,close,'10min',qty,qty,side,'200.000,00','200.010,00','200.100,00','Não',pnl,'50',pnl,'50','9d',fee,total].join(';');
}
const csv=rows=>'\uFEFFConta: TESTE-1\r\nTitular: Não deve ser armazenado\r\n\r\n'+header+'\r\n'+rows.join('\r\n');
const parse=rows=>A.parseCSV(csv(rows)).trades;
let cases=0;function test(name,fn){fn();cases++;console.log('OK '+name);}
test('Brazilian amounts, thousands, negatives and strict invalid values',()=>{
 assert.equal(A.numberBR('R$ 1.234,56'),1234.56);assert.equal(A.numberBR('(34,50)'),-34.5);
 assert.equal(A.numberBR(' - '),null);assert.equal(A.numberBR('12abc'),null);assert.equal(A.numberBR('1,2,3'),null);
});
test('Real dates, seconds and no timezone conversion',()=>{
 assert.equal(A.dateBR('15/10/2026 09:01:02').iso,'2026-10-15T09:01:02');
 for(const x of ['31/02/2026 09:00:00','15/10/2026 24:00:00','32/10/2026 00:00:00'])assert.equal(A.dateBR(x),null);
 assert.equal(A.validDay('2026-02-31'),false);assert.equal(A.nextWeekday('2026-10-16'),'2026-10-19');
});
test('Uses operation result, subtracts commission once, ignores cumulative Total and TET',()=>{
 const p=A.parseCSV(csv([row({pnl:'1.234,56',fee:'-4,56'}),row({open:'15/10/2026 09:10:02',close:'15/10/2026 09:12:00',pnl:'-30,00',fee:'2,00'})]));
 assert.equal(p.trades[0].netCents,123000);assert.equal(p.trades[1].netCents,-3200);
 assert.equal(A.analyzeDay(p.trades,'2026-10-15').pnl,119800);
 assert.equal(A.analyzeDay(p.trades,'2026-10-15').entryInfo[p.trades[1].id].gap,2);
 assert.doesNotMatch(JSON.stringify(p),/Não deve ser armazenado/);
});
test('Quoted semicolon CSV, preamble and commas as alternate delimiter',()=>{
 const raw=csv([row({symbol:'"WIN;TESTE"'})]);assert.equal(A.parseCSV(raw).trades[0].symbol,'WIN;TESTE');
 const cells=row().split(';');const comma=header.split(';').map(c=>'"'+c+'"').join(',')+'\n'+cells.map(c=>'"'+c+'"').join(',');
 assert.equal(A.parseCSV(comma).trades[0].netCents,10000);
 assert.throws(()=>A.parseCSV(csv([row()])+'\n"abc'),/aspas/);
});
test('Rejects bad rows, skips open trades and does not treat invalid as zero',()=>{
 const p=A.parseCSV(csv([row(),row({open:'31/02/2026 10:00:00'}),row({pnl:'não numérico'}),row({close:' - '})]));
 assert.equal(p.trades.length,1);assert.equal(p.rejected.length,2);assert.equal(p.openCount,1);
 assert.throws(()=>A.parseCSV('Ativo;Abertura;Fechamento\nA;B;C'),/Coluna/);
});
test('Duplicate detection and corrections do not double financial totals',()=>{
 const p=A.parseCSV(csv([row(),row()]));assert.equal(p.duplicates,1);
 const first=A.mergeTrades([],p.trades);assert.equal(first.added,1);
 assert.equal(A.mergeTrades(first.trades,p.trades).duplicates,1);
 const corrected=parse([row({pnl:'50,00'})]),m=A.mergeTrades(first.trades,corrected);
 assert.equal(m.updated,1);assert.equal(m.trades.length,1);assert.equal(m.trades[0].netCents,5000);
});
test('Pause is close-to-open; simultaneous positions do not see future losses',()=>{
 const ts=parse([row({symbol:'WDOX26',close:'15/10/2026 12:00:00',pnl:'-100,00'}),row({open:'15/10/2026 09:05:00',close:'15/10/2026 09:15:00',pnl:'-50,00'}),row({open:'15/10/2026 09:15:02',close:'15/10/2026 09:20:00',side:'V',pnl:'80,00'})]);
 const a=A.analyzeDay(ts,'2026-10-15');
 assert.equal(a.afterLoss.length,1);assert.equal(a.revenge.length,1);
 const second=ts.find(t=>t.open.includes('09:05'));assert.equal(a.entryInfo[second.id].gap,null);
 assert.equal(a.overlaps.length,2);
});
test('Same-second entry and exit cannot use their own result as past information',()=>{
 const ts=parse([row({open:'15/10/2026 09:00:00',close:'15/10/2026 09:00:00',pnl:'-50,00'})]);
 const a=A.analyzeDay(ts,'2026-10-15');assert.equal(a.afterLoss.length,0);assert.equal(a.revenge.length,0);
});
test('Quick reentry alone never asserts revenge',()=>{
 const ts=parse([row({pnl:'100,00'}),row({open:'15/10/2026 09:10:01',close:'15/10/2026 09:20:00',side:'V'})]);
 const a=A.analyzeDay(ts,'2026-10-15');assert.equal(a.rapid.length,1);assert.equal(a.revenge.length,0);
});
test('Loss chains reset on breakeven; stop causes must be reviewed explicitly',()=>{
 const ts=parse([row({pnl:'-10,00'}),row({open:'15/10/2026 09:11:00',close:'15/10/2026 09:20:00',pnl:'0'}),row({open:'15/10/2026 09:21:00',close:'15/10/2026 09:30:00',pnl:'-10,00'})]);
 const a=A.analyzeDay(ts,'2026-10-15');assert.equal(a.maxStreak,1);assert.equal(a.maxStopStreak,0);
 const notes=Object.fromEntries(ts.slice(0,2).map(t=>[t.id,{exit:'stop'}]));assert.equal(A.analyzeDay(ts,'2026-10-15',{},notes).maxStopStreak,2);
});
test('Realized loss limit only flags entries after the threshold was known',()=>{
 const ts=parse([row({pnl:'-100,00'}),row({open:'15/10/2026 09:05:00',close:'15/10/2026 09:11:00',pnl:'50,00'}),row({open:'15/10/2026 09:12:00',close:'15/10/2026 09:30:00'})]);
 const a=A.analyzeDay(ts,'2026-10-15',{lossLimit:100});assert.equal(a.afterLimit.length,1);assert.equal(a.afterLimit[0].open,'2026-10-15T09:12:00');
});
test('Daily results reset; cross-day trade closes on the correct day',()=>{
 const ts=parse([row({open:'14/10/2026 17:00:00',close:'15/10/2026 10:00:00',pnl:'100,00'})]);
 assert.equal(A.analyzeDay(ts,'2026-10-14').pnl,0);assert.equal(A.analyzeDay(ts,'2026-10-14').entries.length,1);
 assert.equal(A.analyzeDay(ts,'2026-10-15').pnl,10000);assert.equal(A.analyzeDay(ts,'2026-10-15').entries.length,0);
});
test('Afternoon giveback and peak drawdown are separate measures',()=>{
 const ts=parse([row({pnl:'300,00'}),row({open:'15/10/2026 14:00:00',close:'15/10/2026 14:10:00',pnl:'-400,00'})]);
 const a=A.analyzeDay(ts,'2026-10-15');assert.equal(a.morning,30000);assert.equal(a.afternoon,-40000);
 assert.equal(a.afternoonGiveback,30000);assert.equal(a.giveback,40000);assert.ok(a.givebackPct>100);assert.equal(a.pnl,-10000);
});
test('Profitable result is not a substitute for rule adherence',()=>{
 const ts=parse([row(),row({open:'15/10/2026 09:10:01',close:'15/10/2026 09:11:00'})]);
 const a=A.analyzeDay(ts,'2026-10-15',{maxTrades:1});assert.ok(a.pnl>0);assert.equal(a.score,60);
});
test('Bad rules and invalid backup trade identities are rejected',()=>{
 assert.throws(()=>A.rules({maxTrades:0}),/Regra/);assert.throws(()=>A.rules({endTime:'25:00'}),/Horário/);
 const t=parse([row()])[0];assert.equal(A.validateTrade(t),true);assert.equal(A.validateTrade({...t,netCents:0}),false);
 assert.equal(A.validateTrade({...t,day:'2026-10-16'}),false);assert.equal(A.validateTrade({...t,id:'fake'}),false);
});
test('UI backup validation preserves reviews, plans and rules and rejects arbitrary data',()=>{
 const ctx={ProfitAnalysis:A,ProfitDesk:D,ProfitJournal:require('./diario-profit-journal.js'),ProfitSupervision:require('./diario-profit-supervision.js')};vm.createContext(ctx);vm.runInContext(fs.readFileSync(__dirname+'/diario-profit.js','utf8')+'\nthis.P=ProfitTrades;',ctx);
 const ts=parse([row()]);const source={version:1,trades:ts,accounts:{'account:TESTE-1':{settings:A.DEFAULTS,reviews:{'2026-10-15':{rules:A.DEFAULTS,good:'Pausa respeitada',contexts:{revenge:'planned'}}},plans:{'2026-10-16':{from:'2026-10-15',rules:{...A.DEFAULTS,maxTrades:4},items:['count','focus'],focus:'Rever checklist'}},annotations:{[ts[0].id]:{exit:'stop',note:'Confirmado'}}}},imports:[]};
 const result=ctx.P.validateBackup(source);assert.equal(result.accounts['account:TESTE-1'].plans['2026-10-16'].rules.maxTrades,4);
 assert.equal(result.accounts['account:TESTE-1'].reviews['2026-10-15'].good,'Pausa respeitada');
 assert.throws(()=>ctx.P.validateBackup({...source,trades:[{...ts[0],netCents:0}]}),/Backup/);
 assert.throws(()=>ctx.P.validateBackup({...source,version:999}),/Backup/);
});

test('SMC: unknown initial risk remains pending, never reconstructed from PnL',()=>{
 const t=parse([row({pnl:'-100,00'})])[0],x=A.smcTrade(t);
 assert.equal(x.realizedR,null);assert.equal(x.plannedR,null);assert.equal(x.checks.rr,null);assert.equal(x.stopIssue,false);
 const a=A.analyzeDay([t],'2026-10-15');
 assert.equal(a.smc.riskKnown,0);assert.equal(a.smc.below.length,0);assert.equal(a.smc.stop.length,0);
 assert.equal(a.checks.find(c=>c.id==='contracts').pass,null);
});
test('SMC: gross 2R is achieved even when commissions reduce net R',()=>{
 const t=parse([row({pnl:'200,00',fee:'10,00'})])[0],x=A.smcTrade(t,{riskCents:10000,targetCents:20000});
 assert.equal(x.realizedR,2);assert.equal(x.netR,1.9);assert.equal(x.belowTarget,false);assert.equal(x.checks.rr,true);assert.equal(x.checks.exitR,true);
 const below=A.smcTrade({...t,grossCents:19999,netCents:18999},{riskCents:10000});
 assert.equal(below.belowTarget,true);
});
test('SMC: planned RR, realized RR and stop cause are independent',()=>{
 const t=parse([row({pnl:'200,00'})])[0],x=A.smcTrade(t,{riskCents:10000,targetCents:15000});
 assert.equal(x.plannedR,1.5);assert.equal(x.checks.rr,false);assert.equal(x.checks.exitR,true);assert.equal(x.checks.stop,null);
 const early=A.smcTrade({...t,grossCents:5000,netCents:5000},{riskCents:10000,targetCents:20000});
 assert.equal(early.checks.exitR,false);assert.equal(early.qtyMismatch,null);assert.equal(early.stopIssue,false);
});
test('SMC: only documented permitted exceptions excuse a positive result below 2R',()=>{
 const t=parse([row({pnl:'100,00'})])[0],n={riskCents:10000,earlyReason:'planned',exception:'Parcial prevista ao invalidar o contexto'};
 assert.equal(A.smcTrade(t,n).exception,true);
 assert.equal(A.smcTrade(t,{...n,exception:''}).exception,false);
 assert.equal(A.smcTrade(t,n,{allowEarlyException:false}).exception,false);
 assert.equal(A.smcTrade(t,{...n,earlyReason:'fear'}).exception,false);
});
test('SMC: quantity discrepancy needs confirmed entry quantity or simple execution',()=>{
 const t=parse([row({qty:3})])[0];
 assert.equal(A.smcTrade(t,{plannedQty:1}).qtyMismatch,null);
 assert.equal(A.smcTrade(t,{plannedQty:1,execution:'scaled'}).qtyMismatch,null);
 assert.equal(A.smcTrade(t,{plannedQty:1,entryQty:1,execution:'scaled'}).qtyMismatch,false);
 assert.equal(A.smcTrade(t,{plannedQty:1,execution:'simple'}).qtyMismatch,true);
 assert.equal(A.smcTrade(t,{plannedQty:3,entryQty:1,execution:'simple'}).quantityConflict,true);
 assert.equal(A.smcTrade(t,{plannedQty:3,entryQty:1,execution:'simple'}).checks.contracts,null);
});
test('SMC: structural stop and planned movement need explicit review evidence',()=>{
 const t=parse([row()])[0];
 assert.equal(A.smcTrade(t,{stopBasis:'structure',stopChange:'unchanged'}).checks.stop,true);
 assert.equal(A.smcTrade(t,{stopBasis:'structure',stopChange:'planned'}).checks.stop,null);
 assert.equal(A.smcTrade(t,{stopBasis:'structure',stopChange:'planned',stopReason:'Trailing previsto depois da confirmação'}).checks.stop,true);
 for(const stopChange of ['widened','tightened','removed'])assert.equal(A.smcTrade(t,{stopChange}).checks.stop,false);
 assert.equal(A.smcTrade(t,{stopBasis:'arbitrary'}).checks.stop,false);
});
test('SMC: a loss exceeding 1R triggers investigation but does not invent a moved stop',()=>{
 const t=parse([row({pnl:'-110,00'})])[0],x=A.smcTrade(t,{riskCents:10000});
 assert.equal(x.lossOverRisk,true);assert.equal(x.stopIssue,false);assert.equal(x.checks.exitR,true);
});
test('SMC: repeated winning entries still violate spacing and prompts become measurable actions',()=>{
 const ts=parse([row(),row({open:'15/10/2026 09:10:01',close:'15/10/2026 09:20:00'})]),a=A.analyzeDay(ts,'2026-10-15');
 assert.equal(a.checks.find(c=>c.id==='spacing').pass,false);
 assert.equal(a.revenge.length,0);
 assert.ok(A.coaching(a).some(t=>t.items.includes('spacing')&&t.items.includes('setup')));
 assert.equal(A.smcTrade(ts[0],{newSetup:'yes'}).checks.setup,null);
 assert.equal(A.smcTrade(ts[0],{newSetup:'yes',setupEvidence:'Retorno ao POI com gatilho definido'}).checks.setup,true);
});
test('SMC: plans stay pending until entry risk, target, setup, contracts and stop are reviewed',()=>{
 const t=parse([row({pnl:'200,00'})])[0],note={riskCents:10000,targetCents:20000,plannedQty:1,entryQty:1,execution:'simple',newSetup:'yes',setupEvidence:'Setup do plano confirmado',stopBasis:'structure',stopChange:'unchanged'};
 const before=A.analyzeDay([t],t.day);assert.ok(before.smc.checks.every(c=>c.pass===null));
 const after=A.analyzeDay([t],t.day,{}, {[t.id]:note});assert.ok(after.smc.checks.every(c=>c.pass===true));
 const reported=A.analyzeDay([t],t.day,{}, {[t.id]:{...note,emotion:'fear'}});assert.equal(reported.smc.emotions.fear,1);assert.equal(reported.smc.below.length,0);assert.ok(A.coaching(reported).some(c=>c.evidence.includes('1 relatos de medo')));
});
test('SMC: legacy and new backups preserve compatible review fields without assuming missing data',()=>{
 const ctx={ProfitAnalysis:A,ProfitDesk:D,ProfitJournal:require('./diario-profit-journal.js'),ProfitSupervision:require('./diario-profit-supervision.js')};vm.createContext(ctx);vm.runInContext(fs.readFileSync(__dirname+'/diario-profit.js','utf8')+'\nthis.P=ProfitTrades;',ctx);
 const t=parse([row()])[0],note={riskCents:10000,targetCents:20000,plannedQty:1,entryQty:1,execution:'simple',newSetup:'yes',setupEvidence:'<img src=x>',stopBasis:'structure',stopChange:'planned',stopReason:'Regra documentada',emotion:'fomo'};
 const original={version:1,trades:[t],accounts:{'account:TESTE-1':{settings:{maxTrades:8,quickMinutes:2},reviews:{},plans:{'2026-10-16':{from:'2026-10-15',rules:A.DEFAULTS,items:['spacing','rr','exitR','contracts','stop','setup'],focus:'Meu plano'}},annotations:{[t.id]:note}}},imports:[]};
 const b=ctx.P.validateBackup(original),n=b.accounts['account:TESTE-1'].annotations[t.id];
 assert.equal(n.riskCents,10000);assert.equal(n.emotion,'fomo');assert.equal(n.setupEvidence,'<img src=x>');
 assert.equal(b.accounts['account:TESTE-1'].settings.minTargetR,2);assert.equal(b.accounts['account:TESTE-1'].settings.quickMinutes,10,'Applies trader-confirmed interval to legacy profiles');
 assert.throws(()=>A.annotation({riskCents:-1}),/inválido/);assert.equal(A.annotation({plannedQty:1.5}).plannedQty,1.5);
 assert.equal(A.annotation({exit:'stop',note:'Legado'}).riskCents,null);
});

if(process.argv[2])test('User Profit export reconciles all 76 trades and five daily totals',()=>{
 const bytes=fs.readFileSync(process.argv[2]);let text;try{text=new TextDecoder('utf-8',{fatal:true}).decode(bytes);}catch{text=new TextDecoder('windows-1252').decode(bytes);}
 const p=A.parseCSV(text);assert.equal(p.trades.length,76);assert.equal(p.rejected.length,0);
 assert.equal(p.trades.reduce((s,t)=>s+t.netCents,0),-135900);
 const days=A.dates(p.trades);assert.deepEqual(days,['2026-10-01','2026-10-02','2026-10-05','2026-10-06','2026-10-15']);
 assert.deepEqual(days.map(d=>A.analyzeDay(p.trades,d).pnl),[34500,-46500,-26900,-63800,-33200]);
 const latest=A.analyzeDay(p.trades,days.at(-1));assert.equal(latest.morning,31100);assert.equal(latest.afternoon,-64300);assert.equal(latest.maxStreak,9);
 assert.equal(A.mergeTrades(p.trades,p.trades).added,0);assert.equal(A.mergeTrades(p.trades,p.trades).duplicates,76);
});
console.log(cases+' Profit checks passed.');
