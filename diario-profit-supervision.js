/* Supervision: descriptive comparisons and accountable routines, calculated locally. */
(function(root,factory){
    if(typeof module==='object'&&module.exports)module.exports=factory(require('./diario-profit-analysis.js'));
    else root.ProfitSupervision=factory(root.ProfitAnalysis);
})(typeof globalThis!=='undefined'?globalThis:this,function(A){
    'use strict';
    const text=v=>typeof v==='string'?v.trim().slice(0,4000):'';
    const enumValue=(v,values)=>values.includes(v)?v:'';
    const PRIORITIES=['spacing','count','pause','streak','time','limit','setup','rr','exitR','contracts','stop','focus'];
    function shape(v){if(!v||typeof v!=='object'||Array.isArray(v))throw Error('Registro de acompanhamento inválido.');}
    function preparation(v={}){
        shape(v);const out={};
        for(const k of ['setups','exceptions','trigger','response','created','updated'])out[k]=text(v[k]);
        out.sleep=enumValue(v.sleep,['rested','regular','poor']);
        for(const k of ['tension','urge'])out[k]=enumValue(String(v[k]??''),Array.from({length:11},(_,i)=>String(i)));
        out.riskCents=v.riskCents===null||v.riskCents===undefined||v.riskCents===''?null:Number(v.riskCents);
        if(out.riskCents!==null&&(!Number.isSafeInteger(out.riskCents)||out.riskCents<=0||out.riskCents>10000000000))throw Error('Informe um risco máximo por operação positivo, em reais.');
        out.rules=A.confirmedRules(v.rules||{});
        return out;
    }
    function contract(v={}){
        shape(v);return {priority:enumValue(v.priority,PRIORITIES),trigger:text(v.trigger),proof:text(v.proof),evidence:text(v.evidence),
            noticed:enumValue(v.noticed,['before','after','not','none']),
            barrier:enumValue(v.barrier,['unclear','impractical','late','notused','other','none']),barrierNote:text(v.barrierNote)};
    }
    function rulesAt(input,day){
        return A.confirmedRules(input.plans?.[day]?.rules||input.reviews?.[day]?.rules||input.preparations?.[day]?.rules||input.settings||{});
    }
    function prepStatus(value,day,trades){
        if(!value)return {kind:'missing',label:'Preparação não registrada'};
        const p=preparation(value);
        const complete=p.setups&&p.exceptions&&p.trigger&&p.response&&p.sleep&&p.tension!==''&&p.urge!==''&&p.riskCents!==null;
        if(!complete)return {kind:'incomplete',label:'Preparação incompleta'};
        const first=trades.filter(t=>t.open.slice(0,10)===day).sort((a,b)=>a.open.localeCompare(b.open))[0];
        if(!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}$/.test(p.updated))return {kind:'unknown',label:'Horário de registro não disponível'};
        if(first)return p.updated<first.open?{kind:'before',label:'Registrada antes da primeira entrada'}:{kind:'after',label:'Registro ou alteração após a primeira entrada'};
        return {kind:'waiting',label:'Salva · aguardando operações para conferir o horário'};
    }
    function planResult(plan,a){
        if(!plan)return {state:'missing',label:'Sem compromisso'};
        const c=contract(plan.contract||{});
        if(!a.entries.length&&!a.closed.length)return {state:'waiting',label:'Aguarda importação'};
        if(!c.priority)return {state:'pending',label:'Compromisso anterior sem prioridade definida'};
        if(['spacing','count','pause','streak','time','limit'].includes(c.priority)&&!a.entries.length)return {state:'na',label:'Sem entrada aplicável'};
        if(c.priority==='focus')return {state:'reported',label:'Ação pessoal · depende do relato'};
        const check=a.checks.find(x=>x.id===c.priority);
        if(!check||check.pass===null)return {state:check?.applicable===false?'na':'pending',label:check?.applicable===false?'Sem operação aplicável':'Evidência pendente'};
        return {state:check.pass?'met':'failed',label:check.pass?'Critério prioritário cumprido':'Critério prioritário descumprido',detail:check.detail};
    }
    const sum=xs=>xs.reduce((n,x)=>n+x,0),rate=(n,d)=>d?n/d:null;
    function stats(rows){
        const rs=rows.filter(x=>x.smc.realizedR!==null);
        const field=k=>{const known=rows.filter(x=>x.smc.checks[k]!==null);return {known:known.length,failed:known.filter(x=>x.smc.checks[k]===false).length};};
        return {n:rows.length,pnl:sum(rows.map(x=>x.t.netCents)),meanNet:rows.length?sum(rows.map(x=>x.t.netCents))/rows.length:null,
            winRate:rate(rows.filter(x=>x.t.netCents>0).length,rows.length),riskKnown:rs.length,meanR:rs.length?sum(rs.map(x=>x.smc.realizedR))/rs.length:null,
            setup:field('setup'),contracts:field('contracts'),stop:field('stop')};
    }
    function shift(day,n){const d=new Date(day+'T12:00:00Z');d.setUTCDate(d.getUTCDate()+n);return d.toISOString().slice(0,10);}
    function weekStart(day){const d=new Date(day+'T12:00:00Z');return shift(day,-((d.getUTCDay()+6)%7));}
    function report(input){
        const {trades,day,annotations={},plans={},preparations={},asset=''}=input;
        if(!A.validDay(day))throw Error('Data de acompanhamento inválida.');
        const past=trades.filter(t=>t.day<=day&&t.open.slice(0,10)<=day);
        const days=A.dates(past).filter(d=>d<=day);
        const analysisMap=new Map(days.map(d=>[d,A.analyzeDay(past,d,rulesAt(input,d),annotations)]));
        const byId=new Map(past.map(t=>[t.id,t]));
        const windowDays=days.slice(-20),windowSet=new Set(windowDays);
        const rows=past.filter(t=>windowSet.has(t.open.slice(0,10))&&(!asset||t.symbol===asset)).map(t=>{
            const d=t.open.slice(0,10),a=analysisMap.get(d);
            return {t,info:a?.entryInfo[t.id],rules:rulesAt(input,d),smc:A.smcTrade(t,annotations[t.id],rulesAt(input,d))};
        });
        const pairs=[];
        function pair(id,title,leftLabel,rightLabel,choose,note){
            const groups=[[],[]];let excluded=0;
            for(const row of rows){const g=choose(row);if(g===null)excluded++;else groups[g].push(row);}
            const left=stats(groups[0]),right=stats(groups[1]);
            pairs.push({id,title,leftLabel,rightLabel,left,right,excluded,small:left.n<10||right.n<10,note});
        }
        pair('spacing','Intervalo entre operações','Abaixo do intervalo','Intervalo respeitado',
            x=>x.info?.gap==null?null:x.info.gap<x.rules.quickMinutes*60?0:1,
            'Usa o intervalo do plano de cada dia. Entradas sem fechamento anterior conhecido ficam fora dos dois grupos.');
        pair('loss','Seleção depois de perder','Após perda','Após ganho ou zero',
            x=>!x.info?.previous?null:byId.get(x.info.previous)?.netCents<0?0:1,
            'Considera apenas o último fechamento conhecido antes da entrada; a primeira operação do dia fica fora.');
        pair('session','Execução ao longo do pregão','Entradas da manhã','Entradas da tarde',
            x=>x.t.open.slice(11,16)<x.rules.afternoon?0:1,
            'Agrupa pelo horário de entrada. O resultado completo de cada operação pode fechar em outro período.');
        const reviewedRisk=rows.filter(x=>x.smc.realizedR!==null);
        const rr={total:rows.length,known:reviewedRisk.length,below:rows.filter(x=>x.smc.belowTarget&&!x.smc.exception).length,
            exceptions:rows.filter(x=>x.smc.exception).length,contracts:stats(rows).contracts,
            positive:rows.filter(x=>x.t.grossCents>0).length,positiveKnown:rows.filter(x=>x.t.grossCents>0&&x.smc.realizedR!==null).length};
        function weekly(start,end){
            const reports=days.filter(d=>d>=start&&d<=end).map(d=>analysisMap.get(d));
            const entries=reports.flatMap(a=>a.entries),closed=reports.flatMap(a=>a.closed);
            const unique=[...new Map([...entries,...closed].map(t=>[t.id,t])).values()];
            const smc=unique.map(t=>A.smcTrade(t,annotations[t.id],rulesAt(input,t.open.slice(0,10))));
            const known=smc.filter(x=>x.riskCents!==null&&['setup','rr','contracts','stop'].every(k=>x.checks[k]!==null));
            const planRows=Object.entries(plans).filter(([d])=>d>=start&&d<=end).map(([d,p])=>{
                const a=analysisMap.get(d)||A.analyzeDay(past,d,rulesAt(input,d),annotations);
                return {day:d,plan:p,result:planResult(p,a)};
            });
            const preps=reports.filter(a=>a.entries.length).map(a=>prepStatus(preparations[a.day],a.day,past));
            return {start,end,days:reports.length,entries:entries.length,rapid:reports.reduce((n,a)=>n+a.rapid.length,0),
                rapidRate:rate(reports.reduce((n,a)=>n+a.rapid.length,0),entries.length),operations:unique.length,
                reviewed:known.length,reviewRate:rate(known.length,unique.length),prepBefore:preps.filter(x=>x.kind==='before').length,prepTotal:preps.length,
                plans:planRows,met:planRows.filter(x=>x.result.state==='met').length,failed:planRows.filter(x=>x.result.state==='failed').length,
                pending:planRows.filter(x=>['pending','waiting'].includes(x.result.state)).length,
                notApplicable:planRows.filter(x=>x.result.state==='na').length,personal:planRows.filter(x=>x.result.state==='reported').length,
                reportedUsed:planRows.filter(x=>x.plan.reflection==='yes').length,
                withEvidence:planRows.filter(x=>contract(x.plan.contract||{}).evidence).length};
        }
        const start=weekStart(day),current=weekly(start,day),previous=weekly(shift(start,-7),shift(start,-1));
        const pastPlans=Object.entries(plans).filter(([d])=>d<=day&&days.includes(d)).sort(([a],[b])=>a.localeCompare(b)).slice(-10);
        const barriers={};
        for(const [,p] of pastPlans){const c=contract(p.contract||{});if(c.barrier&&c.barrier!=='none')barriers[c.barrier]=(barriers[c.barrier]||0)+1;}
        const failed=pastPlans.filter(([d,p])=>planResult(p,analysisMap.get(d)).state==='failed');
        const prompts=failed.length>=2?[
            'As ações combinadas estão alterando sua execução ou apenas reaparecendo no diário?',
            'A regra estava clara e era executável? Você percebeu o gatilho antes da ordem?',
            'Qual mudança concreta tornará a resposta combinada mais fácil de executar na próxima sessão?'
        ]:['Qual conduta foi repetida com evidência nesta semana?','Qual decisão precisa de uma ação substituta mais específica?'];
        return {pairs,rr,windowDays,assets:[...new Set(past.map(t=>t.symbol))].sort(),current,previous,barriers,prompts,
            comparable:current.days>=3&&previous.days>=3,failedRecent:failed.length,
            ruleVariants:new Set(windowDays.map(d=>JSON.stringify(rulesAt(input,d)))).size};
    }
    return {preparation,contract,prepStatus,planResult,report,PRIORITIES,rulesAt};
});
