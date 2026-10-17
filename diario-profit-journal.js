/* Journal/Profit reconciliation. No monetary equality or inferred intent. */
(function(root,factory){
 if(typeof module==='object'&&module.exports)module.exports=factory(require('./diario-profit-analysis.js'));
 else root.ProfitJournal=factory(root.ProfitAnalysis);
})(typeof globalThis!=='undefined'?globalThis:this,function(A){
 'use strict';
 const text=v=>typeof v==='string'?v.trim().slice(0,4000):'';
 const finite=v=>v!==null&&v!==undefined&&v!==''&&Number.isFinite(Number(v))?Number(v):null;
 const cents=v=>{const n=finite(v);return n===null?null:Math.round(n*100);};
 const family=v=>{const s=text(v).toUpperCase().replace(/^[A-Z0-9_]+:/,'').replace(/\.P$/,'');return /^(WIN|WDO)(?:[FGHJKMNQUVXZ](?:\d{2}|\d{4})|FUT|\$[DN]?)?$/.test(s)?s.slice(0,3):s;};
 const category=n=>n===null?'unknown':n>0?'win':n<0?'loss':'zero';
 function normalize(rows=[]){
  const seen=new Set(),items=[],invalid=[],duplicates=[];
  for(const t of rows){
   if(!t||t.source==='robo_smc')continue;
   const id=String(t.id||''),local=text(t.openLocal||t.dateLocal);
   if(!id||!A.validDay(local.slice(0,10))||!/^T\d{2}:\d{2}/.test(local.slice(10))||!text(t.symbol)){invalid.push(id||'sem-id');continue;}
   if(seen.has(id)){duplicates.push(id);continue;}seen.add(id);
   const open=local.slice(0,16)+':00';
   if(!A.dateBR(open.slice(8,10)+'/'+open.slice(5,7)+'/'+open.slice(0,4)+' '+open.slice(11))){invalid.push(id);continue;}
   const pnl=cents(t.pnl),risk=cents(t.stopMoney??t.riskMoney),target=cents(t.targetMoney);
   const status=['open','stop','target','breakeven','manual'].includes(t.status)?t.status:'unknown';
   const declared=status==='stop'?'loss':status==='target'?'win':status==='breakeven'?'zero':null;
   const gross=category(pnl===null?finite(t.r):pnl),mixed=declared!==null&&gross!=='unknown'&&gross!==declared;
   const outcome=status==='open'?'open':mixed?'mixed':declared||gross;
   const notes=text(t.notes).replace(/^Importado da corretora\.[\s\S]*?Preencha stop\/risco para calcular o R\.\s*/,'').trim();
   items.push({id,open,day:open.slice(0,10),symbol:text(t.symbol).toUpperCase(),family:family(t.symbol),
    side:['long','buy','C'].includes(t.side)?'C':['short','sell','V'].includes(t.side)?'V':'',
    outcome,declared,gross,status,pnl,riskCents:risk>0?risk:null,targetCents:target>0?target:null,
    qty:finite(t.initQty??t.qty),partials:Array.isArray(t.partials)&&t.partials.length>0,
    setup:text(t.setup),notes,hasRationale:!!text(t.setup)&&!!notes,
    mistakes:Array.isArray(t.mistakes)?t.mistakes.map(text).filter(Boolean):[],
    tags:Array.isArray(t.tags)?t.tags.map(text).filter(Boolean):[],source:text(t.source),
    registeredLocal:text(t.registeredLocal),hasAttachment:!!t.attachment});
  }
  return {items,invalid,duplicates};
 }
 const profitCategory=(t,n)=>n?.exit==='stop'?'loss':n?.exit==='target'?'win':n?.exit==='breakeven'?'zero':category(t.grossCents);
 function report({profit=[],diary=[],links={},annotations={},day,ready=true,reason='',requireLinks=false}){
  const normalized=normalize(diary),all=normalized.items,profitById=new Map(profit.map(t=>[t.id,t])),diaryById=new Map(all.map(t=>[t.id,t]));
  const ps=profit.filter(t=>t.open.slice(0,10)===day),allDay=all.filter(t=>t.day===day);
  const used=new Map(),validLinks=new Map(),stale=[];
  for(const [pid,link] of Object.entries(links)){
   const p=profitById.get(pid),d=diaryById.get(link.diaryId);
   if(!p||!d||d.day!==p.open.slice(0,10)||d.family!==family(p.symbol)||used.has(d.id)){stale.push(pid);continue;}
   used.set(d.id,pid);validLinks.set(pid,d);
  }
  const ds=requireLinks?allDay.filter(d=>used.has(d.id)):allDay;
  const families=[...new Set(ps.map(t=>family(t.symbol)))].sort();
  const groups=families.map(symbol=>{
   const pp=ps.filter(t=>family(t.symbol)===symbol),dd=ds.filter(t=>t.family===symbol);
   const pcounts={win:0,loss:0,zero:0},dcounts={win:0,loss:0,zero:0,unknown:0};
   pp.forEach(t=>pcounts[profitCategory(t,annotations[t.id])]++);
   dd.forEach(t=>{const n=annotations[used.get(t.id)],outcome=t.outcome==='mixed'&&['stop','target','breakeven'].includes(n?.exit)?t.declared:t.outcome;dcounts[['win','loss','zero'].includes(outcome)?outcome:'unknown']++;});
   const shortages=['win','loss','zero'].reduce((n,k)=>n+Math.max(0,pcounts[k]-dcounts[k]),0);
   return {symbol,profit:pp.length,diary:dd.length,missing:Math.max(0,pp.length-dd.length),pcounts,dcounts,
    outcomeGap:Math.max(0,shortages-dcounts.unknown),pending:shortages>0&&shortages<=dcounts.unknown};
  });
  const rows=ps.map(p=>{
   const d=validLinks.get(p.id),pc=profitCategory(p,annotations[p.id]);
   const dc=d?.outcome==='mixed'&&annotations[p.id]?.exit&&annotations[p.id].exit!=='unknown'&&annotations[p.id].exit!=='manual'?d.declared:d?.outcome;
   const mismatch=!!d&&(['win','loss','zero'].includes(dc)&&dc!==pc||!!d.side&&d.side!==p.side);
   const candidates=allDay.filter(x=>x.family===family(p.symbol)&&(!used.has(x.id)||used.get(x.id)===p.id));
   const near=candidates.filter(x=>(!x.side||x.side===p.side)&&Math.abs(Date.parse(x.open+'Z')-Date.parse(p.open+'Z'))<=120000);
   const unique=near.length===1&&ps.filter(other=>family(other.symbol)===near[0].family&&(!near[0].side||other.side===near[0].side)&&Math.abs(Date.parse(near[0].open+'Z')-Date.parse(other.open+'Z'))<=120000).length===1;
   return {profit:p,diary:d||null,outcome:pc,mismatch,candidates,suggestion:!d&&unique?near[0].id:'',
    stale:stale.includes(p.id),linked:!!d};
  });
  const missing=groups.reduce((n,g)=>n+g.missing,0),mismatches=rows.filter(x=>x.mismatch).length;
  const outcomeGap=groups.reduce((n,g)=>n+g.outcomeGap,0);
  const unresolved=groups.some(g=>g.pending)||rows.some(x=>x.stale);
  const damaged=normalized.invalid.length>0||normalized.duplicates.length>0;
  const status=!ready?'unavailable':!ps.length?'journal-only':damaged?'pending':missing?'missing':outcomeGap||mismatches?'mismatch':unresolved?'pending':'compatible';
  const labels={unavailable:'Aguardando o diário correto', 'journal-only':'Diário disponível · sem exportação para conferir',pending:'Conciliação pendente',missing:'Falha grave: existem operações sem registro suficiente',mismatch:'Divergência séria entre execução e diário',compatible:'Contagem e distribuição compatíveis'};
  const feedback=status==='missing'?'Pelo seu plano, o diário nunca pode ter menos operações que a exportação. Faltam pelo menos '+missing+' registros no recorte de data e ativo. O fechamento da sessão está incompleto: localize cada execução e registre seu contexto. Sem registro, o racional não pode ser auditado. Não invente uma justificativa retrospectiva.':
   status==='mismatch'?'A contagem total não resolve esta divergência. Há resultados ou lados incompatíveis com a exportação. Confira alvos, stops, breakeven, parciais e os vínculos. Corrija o registro com base no que ocorreu, sem reescrever o trade para melhorar o histórico.':
   status==='compatible'?'O mínimo de registros e a distribuição de resultados foram atendidos. Isso não comprova, sozinho, um racional para cada operação. Confira os vínculos e o conteúdo das justificativas.':
   status==='pending'?'Há registros abertos, resultados mistos, dados inválidos ou vínculos que precisam de revisão. Pendência não será tratada como aprovação nem como prova de operação sem racional.':
   status==='unavailable'?reason||'Carregue o diário deste perfil antes de concluir a conferência.':
   'Os registros do diário já alimentam a revisão de contexto. Sem a exportação, não é possível certificar que todas as execuções foram registradas.';
  const mistakes={};ds.forEach(t=>[...new Set(t.mistakes)].forEach(m=>mistakes[m]=(mistakes[m]||0)+1));
  const linked=rows.filter(x=>x.diary),rationale=linked.filter(x=>x.diary.hasRationale).length;
  return {day,ready,status,title:labels[status],feedback,groups,rows,diary:ds,profitCount:ps.length,diaryCount:ds.length,
   missing,outcomeGap,mismatches,linked:linked.length,rationale,withoutRationale:ds.filter(t=>!t.hasRationale).length,
   outcomes:{win:ds.filter(t=>t.outcome==='win').length,loss:ds.filter(t=>t.outcome==='loss').length,zero:ds.filter(t=>t.outcome==='zero').length,
    open:ds.filter(t=>t.outcome==='open').length,pending:ds.filter(t=>['unknown','mixed'].includes(t.outcome)).length},
   mistakes:Object.entries(mistakes).sort((a,b)=>b[1]-a[1]),invalid:normalized.invalid.length,duplicates:normalized.duplicates.length,
   signature:JSON.stringify([day,ready,status,normalized.invalid,normalized.duplicates,ps.map(t=>[t.id,t.grossCents,annotations[t.id]?.exit||'unknown']),ds,rows.map(x=>[x.profit.id,x.diary?.id||'',x.mismatch])])};
 }
 function enrich(profit,diary,links,annotations={}){
  const result={...annotations},details=[];
  const days=[...new Set(profit.filter(t=>links[t.id]).map(t=>t.open.slice(0,10)))];
  for(const day of days){
   const r=report({profit,diary,links,annotations,day});
   for(const row of r.rows){
    const d=row.diary;if(!d||row.mismatch||d.status==='open')continue;
    const original=A.annotation(annotations[row.profit.id]),n={...original},fields=[];
    for(const k of ['riskCents','targetCents'])if((row.profit.currency||'BRL')==='BRL'&&n[k]===null&&d[k]!==null){n[k]=d[k];fields.push(k);}
    if(n.entryQty===null&&Number.isFinite(d.qty)&&d.qty>0){n.entryQty=d.qty;fields.push('entryQty');}
    if(!n.setupName&&d.setup){n.setupName=d.setup;fields.push('setupName');}
    if(!n.setupEvidence&&d.notes){n.setupEvidence=d.notes;fields.push('setupEvidence');}
    if(n.exit==='unknown'&&['stop','target','breakeven'].includes(d.status)){n.exit=d.status;fields.push('exit');}
    result[row.profit.id]=n;details.push({profitId:row.profit.id,diaryId:d.id,fields});
   }
  }
  return {annotations:result,details};
 }
 return {family,normalize,report,enrich};
});
