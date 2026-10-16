const assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm');
const A=require('./diario-profit-analysis.js'),D=require('./diario-profit-desk.js'),S=require('./diario-profit-supervision.js');
function trade({day='2026-10-15',open='09:00:00',close='09:10:00',pnl=20000,qty=1,symbol='WINZ26'}={}){
 const t={account:'QA',symbol,open:day+'T'+open,close:day+'T'+close,day,side:'C',buy:qty,sell:qty,qty,grossCents:pnl,feeCents:0,netCents:pnl,averaged:false};
 t.id=JSON.stringify([t.account,t.symbol,t.open,t.close,t.side]);return t;
}
const full={riskCents:10000,targetCents:20000,plannedQty:1,entryQty:1,execution:'simple',newSetup:'yes',setupEvidence:'Estrutura e gatilho',stopBasis:'structure',stopChange:'unchanged'};
const prep={setups:'Estrutura, invalidação e gatilho',exceptions:'Nenhuma',trigger:'Urgência',response:'Aguardar o intervalo e revisar o setup',sleep:'rested',tension:'2',urge:'0',riskCents:10000,created:'2026-10-15T08:00:00',updated:'2026-10-15T08:00:00',rules:A.DEFAULTS};
const plan={from:'2026-10-14',rules:A.DEFAULTS,items:['spacing','focus'],focus:'Aguardar 10 minutos',reflection:'yes',contract:{priority:'spacing',trigger:'Após uma perda',proof:'Zero entradas abaixo de 10 minutos',noticed:'before',barrier:'notused',evidence:'Percebi a urgência, mas entrei antes do intervalo'}};
const report=(trades,more={})=>S.report({trades,day:'2026-10-15',...more});
let n=0;function test(title,fn){fn();n++;console.log('OK '+title);}
test('Preparation distinguishes prospective, retrospective, missing and incomplete records',()=>{
 const t=trade();assert.equal(S.prepStatus(null,t.day,[t]).kind,'missing');
 assert.equal(S.prepStatus(prep,t.day,[t]).kind,'before');
 assert.equal(S.prepStatus({...prep,updated:'2026-10-15T09:00:00'},t.day,[t]).kind,'after');
 assert.equal(S.prepStatus({...prep,setups:''},t.day,[t]).kind,'incomplete');
 assert.equal(S.prepStatus(prep,t.day,[]).kind,'waiting');
 assert.equal(S.prepStatus({...prep,updated:''},t.day,[t]).kind,'unknown');
});
test('Preparation validates money and preserves declared rule snapshots',()=>{
 assert.throws(()=>S.preparation({...prep,riskCents:-1}));
 assert.throws(()=>S.preparation({...prep,riskCents:1.2}));
 assert.throws(()=>S.preparation([]));
 const p=S.preparation({...prep,rules:{...A.DEFAULTS,maxTrades:3}});
 assert.equal(p.rules.maxTrades,3);assert.equal(S.rulesAt({preparations:{'2026-10-15':p}},'2026-10-15').maxTrades,3);
 assert.equal(S.rulesAt({preparations:{'2026-10-15':p},plans:{'2026-10-15':plan}},'2026-10-15').maxTrades,A.DEFAULTS.maxTrades);
});
test('Spacing groups use close-to-open intervals and exclude unknown first entries',()=>{
 const ts=[trade(),trade({open:'09:15:00',close:'09:20:00',pnl:-10000}),trade({open:'09:30:00',close:'09:40:00'})];
 const p=report(ts).pairs.find(x=>x.id==='spacing');
 assert.equal(p.left.n,1);assert.equal(p.right.n,1);assert.equal(p.excluded,1);
 assert.equal(p.left.pnl,-10000);assert.equal(p.right.meanNet,20000);assert.equal(p.small,true);
});
test('Loss comparisons use only prior known closures, including simultaneous positions',()=>{
 const slow=trade({close:'12:00:00',pnl:-90000,symbol:'WDOX26'}),fast=trade({open:'09:05:00',close:'09:10:00',pnl:20000}),next=trade({open:'09:11:00',close:'09:20:00'});
 const p=report([slow,fast,next]).pairs.find(x=>x.id==='loss');
 assert.equal(p.left.n,0);assert.equal(p.right.n,1);assert.equal(p.excluded,2);
});
test('Session comparison groups by entry time rather than closure time',()=>{
 const t=trade({open:'12:55:00',close:'14:10:00'}),p=report([t]).pairs.find(x=>x.id==='session');
 assert.equal(p.left.n,1);assert.equal(p.right.n,0);
});
test('Missing risk is excluded from R averages and low-R conclusions',()=>{
 const first=trade(),second=trade({open:'14:00:00',close:'14:10:00',pnl:10000});
 const r=report([first,second],{annotations:{[second.id]:full}});
 assert.equal(r.rr.known,1);assert.equal(r.rr.below,1);assert.equal(r.rr.positiveKnown,1);
 assert.equal(r.pairs.find(x=>x.id==='session').left.meanR,null);
 assert.equal(r.pairs.find(x=>x.id==='session').right.meanR,1);
});
test('Asset filter does not change weekly all-asset supervision',()=>{
 const ts=[trade(),trade({symbol:'WDOX26',open:'14:00:00',close:'14:10:00'})],r=report(ts,{asset:'WINZ26'});
 assert.equal(r.rr.total,1);assert.equal(r.current.entries,2);
});
test('Historical insights exclude future results, future plans and future barriers',()=>{
 const t=trade(),future=trade({day:'2026-10-16'});
 const a=report([t]),b=report([t,future],{plans:{'2026-10-16':plan}});
 assert.deepEqual(a.pairs,b.pairs);assert.deepEqual(a.current,b.current);assert.equal(b.failedRecent,0);assert.deepEqual(b.barriers,{});
});
test('Calendar weeks respect Monday boundary and missing days are not fabricated',()=>{
 const r=report([trade({day:'2026-10-09'}),trade({day:'2026-10-12'}),trade()]);
 assert.equal(r.current.start,'2026-10-12');assert.equal(r.current.days,2);assert.equal(r.previous.days,1);assert.equal(r.comparable,false);
});
test('Personal success reports never override an observed priority violation',()=>{
 const ts=[trade(),trade({open:'09:11:00',close:'09:20:00'})],a=A.analyzeDay(ts,'2026-10-15');
 assert.equal(S.planResult(plan,a).state,'failed');
 const r=report(ts,{plans:{'2026-10-15':plan}});
 assert.equal(r.current.failed,1);assert.equal(r.current.reportedUsed,1);assert.equal(r.current.withEvidence,1);assert.equal(r.barriers.notused,1);
});
test('Unknown, personal, inapplicable and absent-session priorities stay distinct',()=>{
 const a=A.analyzeDay([trade({pnl:-10000})],'2026-10-15');
 const p=id=>({...plan,contract:{priority:id}});
 assert.equal(S.planResult(p('stop'),a).state,'pending');
 assert.equal(S.planResult(p('exitR'),a).state,'na');
 assert.equal(S.planResult(p('focus'),a).state,'reported');
 assert.equal(S.planResult(p('spacing'),A.analyzeDay([],'2026-10-15')).state,'waiting');
 const overnight={...trade(),open:'2026-10-14T17:00:00'};
 assert.equal(S.planResult(p('spacing'),A.analyzeDay([overnight],'2026-10-15')).state,'na');
});
test('Repeated failed commitments trigger questions about feasibility and use',()=>{
 const ts=[],plans={};for(const day of ['2026-10-14','2026-10-15']){ts.push(trade({day}),trade({day,open:'09:11:00',close:'09:20:00'}));plans[day]=plan;}
 const r=report(ts,{plans});assert.equal(r.failedRecent,2);assert.match(r.prompts.join(' '),/executável/);
});
test('Backup preserves future preparations, priority and evidence without fabricating old fields',()=>{
 const ctx={ProfitAnalysis:A,ProfitDesk:D,ProfitSupervision:S};vm.createContext(ctx);vm.runInContext(fs.readFileSync(__dirname+'/diario-profit.js','utf8')+'\nthis.P=ProfitTrades;',ctx);
 const backup={version:1,trades:[trade()],accounts:{'account:QA':{settings:A.DEFAULTS,reviews:{},annotations:{},plans:{'2026-10-15':plan},preparations:{'2026-10-19':S.preparation(prep)}}},imports:[]};
 const m=ctx.P.validateBackup(backup).accounts['account:QA'];
 assert.equal(m.preparations['2026-10-19'].riskCents,10000);assert.equal(m.plans['2026-10-15'].contract.evidence,plan.contract.evidence);
 delete backup.accounts['account:QA'].preparations;delete backup.accounts['account:QA'].plans['2026-10-15'].contract;
 const old=ctx.P.validateBackup(backup).accounts['account:QA'];assert.equal(Object.keys(old.preparations).length,0);assert.equal(old.plans['2026-10-15'].contract.priority,'');
});
test('A risk cap registered before trading is enforced without inventing a retrospective breach',()=>{
 const t=trade({pnl:40000}),p=S.preparation(prep),annotations={[t.id]:{...full,riskCents:20000,targetCents:40000}};
 const input={trades:[t],day:t.day,preparations:{[t.day]:p},annotations};
 const d=D.report(input);assert.equal(d.status,'intervention');assert.equal(d.flaggedCount,1);assert.equal(d.priority.id,'risk');
 const retrospective=D.report({...input,preparations:{[t.day]:{...p,updated:'2026-10-15T18:00:00'}}});
 assert.equal(retrospective.status,'consistent');assert.match(retrospective.chapters.find(x=>x.id==='risk').facts,/retrospectiva/);
});
test('Preparation and agreed priority changes require a new desk review',()=>{
 const t=trade(),p=S.preparation(prep),input={trades:[t],day:t.day,preparations:{[t.day]:p}};
 const d=D.report(input),reviews={[t.day]:{desk:{completed:true,signature:d.signature}}};
 assert.equal(D.report({...input,reviews}).reviewed,true);
 assert.equal(D.report({...input,reviews,preparations:{[t.day]:{...p,response:'Uma nova ação'}}}).stale,true);
});
if(process.argv[2])test('Real CSV retains reconciliation across comparison groups and pending risk',()=>{
 const b=fs.readFileSync(process.argv[2]);let text;try{text=new TextDecoder('utf-8',{fatal:true}).decode(b);}catch{text=new TextDecoder('windows-1252').decode(b);}
 const r=report(A.parseCSV(text).trades),session=r.pairs.find(x=>x.id==='session');
 assert.equal(r.rr.total,76);assert.equal(session.left.pnl+session.right.pnl,-135900);assert.equal(r.rr.known,0);
});
console.log(n+' supervision checks passed.');
