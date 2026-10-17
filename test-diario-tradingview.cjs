const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm');
const A=require('./diario-profit-analysis'),J=require('./diario-profit-journal');
const header='Símbolo,Número da negociação,Tipo,Data e hora,ID da ordem,Sinal,Preço,Tamanho (qtd),Tamanho (valor),L&P líquido USD,Retorno %,Comissão USD,L&P acumulado USD,L&P acumulado %';
const row=(id,kind,time,qty=.01,pnl=-1.94,fee=0,symbol='BINANCE:BTCUSDT.P')=>[symbol,id,kind,'"'+time+'"','order','signal','80000',qty,800,pnl,0,fee,-999,0].join(',');
const pair=(id,open,close,qty=.01,pnl=-1.94,fee=0)=>[row(id,'Saída short',close,qty,pnl,fee),row(id,'Entrada short',open,qty,pnl,fee)];
const sample=[header,...pair(1,'15 de out. de 2026, 02:55','15 de out. de 2026, 03:11'),...pair(2,'15 de out. de 2026, 03:17','15 de out. de 2026, 09:48',.06,-2.82),...pair(3,'16 de out. de 2026, 16:13','Abertura',1,0)].join('\n');
test('Pairs entries and exits once; open position never becomes a closed breakeven',()=>{
 const p=A.parseTradingView(sample);assert.equal(p.trades.length,2);assert.equal(p.openCount,1);assert.equal(p.rejected.length,0);
 assert.deepEqual(p.trades.map(t=>t.qty),[.01,.06]);assert.equal(p.trades.reduce((s,t)=>s+t.netCents,0),-476);
 assert.ok(p.trades.every(t=>A.validateTrade(t)&&t.currency==='USD'&&t.simulation));
 const d=A.analyzeDay(p.trades,'2026-10-15');assert.equal(d.rapid.length,1);assert.equal(d.entryInfo[p.trades[1].id].gap,360);
 assert.equal(d.maxStreak,2);assert.equal(d.maxStopStreak,0);
});
test('Fees are not subtracted from exported net again; value and accumulated columns ignored',()=>{
 const p=A.parseTradingView([header,...pair(1,'15 de out. de 2026, 02:55','15 de out. de 2026, 03:11',.001,3.75,.25)].join('\n'));
 assert.equal(p.trades[0].netCents,375);assert.equal(p.trades[0].feeCents,25);assert.equal(p.trades[0].grossCents,400);
 assert.equal(A.smcTrade(p.trades[0],{riskCents:200}).realizedR,2);
});
test('Reimports, order reversal and duplicated lines do not multiply trades',()=>{
 const p=A.parseTradingView(sample);assert.equal(A.mergeTrades(p.trades,p.trades).added,0);
 const reversed=[header,...sample.split('\n').slice(1).reverse()].join('\n');assert.deepEqual(A.parseTradingView(reversed).trades,p.trades);
 const dup=A.parseTradingView(sample+'\n'+sample.split('\n')[1]);assert.equal(dup.duplicates,1);assert.equal(dup.trades.length,2);
 const corrected=A.parseTradingView(sample.replaceAll('-1.94','-2.00'));assert.equal(A.mergeTrades(p.trades,corrected.trades).updated,1);
});
test('Bad dates, numbers and missing or ambiguous pairs are visible instead of fabricated',()=>{
 for(const text of [sample.replaceAll('02:55','25:55'),sample.replaceAll(',0.01,',',bad,'),sample.replaceAll('Saída short','Saída long')]){
  try {const p=A.parseTradingView(text);assert.ok(p.rejected.length>0);}catch(e){assert.match(e.message,/Nenhuma operação/);}
 }
 const ambiguous=sample+'\n'+row(1,'Entrada short','15 de out. de 2026, 02:56');assert.equal(A.parseTradingView(ambiguous).trades.length,1);
 assert.throws(()=>A.parseTradingView('Símbolo,Preço\nBTCUSDT,100'),/Cabeçalho/);
 assert.throws(()=>A.parseTradingView(sample.replaceAll('USD','BRL')),/Cabeçalho/);
 assert.equal(A.dateTradingView('31 de fev. de 2026, 12:00'),null);
 assert.equal(A.dateTradingView('1 de mar. de 2026, 12:01:02').iso,'2026-03-01T12:01:02');
});
test('Fractional plan sizes are accepted, while invalid risk and amounts remain rejected',()=>{
 assert.equal(A.annotation({plannedQty:.01,entryQty:.06}).plannedQty,.01);
 assert.throws(()=>A.annotation({riskCents:1.5}),/inválido/);assert.throws(()=>A.annotation({entryQty:Infinity}),/inválido/);
 const t=A.parseTradingView(sample).trades[0];assert.equal(A.smcTrade(t,{plannedQty:.02,entryQty:.01}).qtyMismatch,true);
});
test('Paper rows require explicit journal links and never convert BRL initial risk to USD',()=>{
 const p=A.parseTradingView(sample),t=p.trades[0],d={id:'d1',dateLocal:t.open,symbol:'BTCUSDT',side:'short',status:'stop',pnl:-20,stopMoney:100,targetMoney:200,qty:.01,setup:'POI',notes:'Invalidação e gatilho'};
 let r=J.report({profit:p.trades,diary:[d],day:t.day,requireLinks:true});
 assert.equal(r.missing,2);assert.equal(r.rows[0].candidates.length,1);
 const links={[t.id]:{diaryId:d.id}};r=J.report({profit:p.trades,diary:[d],links,day:t.day,requireLinks:true});assert.equal(r.missing,1);
 const n=J.enrich(p.trades,[d],links,{}).annotations[t.id];assert.equal(n.riskCents,null);assert.equal(n.targetCents,null);assert.equal(n.entryQty,.01);assert.equal(n.setupName,'POI');
 assert.equal(J.family('BMFBOVESPA:WINZ2026'),'WIN');assert.equal(J.family('BINANCE:BTCUSDT.P'),'BTCUSDT');
});
test('Backup preserves simulation, fractional quantities and USD; incompatible currency rejected',()=>{
 const ctx={ProfitAnalysis:A,ProfitJournal:J,ProfitDesk:require('./diario-profit-desk'),ProfitSupervision:require('./diario-profit-supervision')};
 vm.createContext(ctx);vm.runInContext(fs.readFileSync(__dirname+'/diario-profit.js','utf8')+'\nthis.P=ProfitTrades',ctx);
 const p=A.parseTradingView(sample),key='account:'+p.account;
 const b={version:1,trades:p.trades,accounts:{[key]:{settings:A.DEFAULTS,annotations:{[p.trades[0].id]:{entryQty:.01}},reviews:{},plans:{}}},imports:[]};
 const saved=ctx.P.validateBackup(b);assert.equal(saved.trades[0].currency,'USD');assert.equal(saved.accounts[key].annotations[p.trades[0].id].entryQty,.01);
 assert.equal(A.validateTrade({...p.trades[0],currency:'BRL'}),false);assert.equal(A.validateTrade({...p.trades[0],simulation:false}),false);
});
if(process.argv[2])test('Actual reference export has two closed trades, one open and -4.76 USD',()=>{
 const p=A.parseTradingView(fs.readFileSync(process.argv[2],'utf8'));assert.equal(p.trades.length,2);assert.equal(p.openCount,1);assert.equal(p.trades.reduce((n,t)=>n+t.netCents,0),-476);assert.equal(p.rejected.length,0);
});
