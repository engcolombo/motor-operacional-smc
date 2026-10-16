/* A local, evidence-based desk review. It does not diagnose or send orders. */
(function(root,factory){
    if(typeof module==='object'&&module.exports)module.exports=factory(require('./diario-profit-analysis.js'));
    else root.ProfitDesk=factory(root.ProfitAnalysis);
})(typeof globalThis!=='undefined'?globalThis:this,function(A){
    'use strict';
    const cash=c=>(c/100).toLocaleString('pt-BR',{style:'currency',currency:'BRL'});
    const percent=(n,d)=>d?Math.round(n/d*100)+'%':'sem base';
    const clock=t=>t.slice(11,19);
    const date=d=>d.slice(8,10)+'/'+d.slice(5,7)+'/'+d.slice(0,4);
    const clean=v=>typeof v==='string'?v.slice(0,4000):'';
    const FRAME='desk-1';
    function debrief(input={}){
        if(!input||typeof input!=='object'||Array.isArray(input))throw Error('Debrief da mesa inválido.');
        const out={};
        for(const k of ['moment','thought','feeling','choice','alternative','action','proof','updated','signature'])out[k]=clean(input[k]);
        out.completed=input.completed===true;
        return out;
    }
    // Change detection only, not a security signature or clinical assessment.
    function fingerprint(value){
        const s=JSON.stringify(value);let h=2166136261;
        for(let i=0;i<s.length;i++){h^=s.charCodeAt(i);h=Math.imul(h,16777619);}
        return FRAME+':'+s.length+':'+(h>>>0).toString(16);
    }
    function report(input){
        const {trades,day,annotations={},reviews={},plans={},settings={}}=input;
        const rulesAt=d=>A.confirmedRules(plans[d]?.rules||reviews[d]?.rules||input.preparations?.[d]?.rules||settings);
        const a=A.analyzeDay(trades,day,rulesAt(day),annotations),s=a.smc,r=a.rules,review=reviews[day]||{};
        const timing=a.timingChecks.filter(c=>!c.pass),smcFails=s.checks.filter(c=>c.pass===false);
        const all=[...new Map([...a.entries,...a.closed].map(t=>[t.id,t])).values()];
        const rows=all.map(t=>({trade:t,...A.smcTrade(t,annotations[t.id],r)}));
        const coverage={
            total:rows.length,risk:rows.filter(x=>x.riskCents!==null).length,
            setup:rows.filter(x=>x.checks.setup!==null).length,
            contracts:rows.filter(x=>x.checks.contracts!==null).length,
            stop:rows.filter(x=>x.checks.stop!==null).length,
            target:rows.filter(x=>x.checks.rr!==null).length
        };
        coverage.complete=rows.filter(x=>x.riskCents!==null&&['setup','rr','contracts','stop'].every(k=>x.checks[k]!==null)&&x.checks.exitR!==null).length;
        const criticalStops=rows.filter(x=>['widened','removed'].includes(x.note.stopChange));
        const quantityExcess=rows.filter(x=>x.qtyMismatch&&x.actualQty>x.note.plannedQty);
        const prep=input.preparations?.[day];
        const budgetReviewed=rows.filter(x=>x.trade.open.slice(0,10)===day&&x.riskCents!==null);
        const budgetExcess=prep?.riskCents?budgetReviewed.filter(x=>x.riskCents>prep.riskCents):[];
        const budgetConfirmed=!!(prep?.updated&&a.entries.length&&prep.updated<a.entries[0].open);
        const budgetBreaches=budgetConfirmed?budgetExcess:[];
        const violations=new Set(budgetBreaches.map(x=>x.trade.id));
        [...a.rapid,...a.afterLoss,...a.afterStreak,...a.afterLimit,...a.afterHours].forEach(t=>violations.add(t.id));
        if(a.entries.length>r.maxTrades)a.entries.slice(r.maxTrades).forEach(t=>violations.add(t.id));
        rows.filter(x=>Object.values(x.checks).some(v=>v===false)).forEach(x=>violations.add(x.trade.id));
        const flagged=all.filter(t=>violations.has(t.id));
        // Financial sum only on the selected day's closed trades; never an estimate of avoidable loss.
        const flaggedClosed=a.closed.filter(t=>violations.has(t.id));
        const flaggedPnl=flaggedClosed.reduce((n,t)=>n+t.netCents,0);
        const critical=!!((r.configured&&(a.afterLimit.length||a.afterStreak.length))||criticalStops.length||quantityExcess.length||budgetBreaches.length);
        const incomplete=coverage.complete<coverage.total;
        const status=!all.length?'empty':critical?'intervention':timing.length||smcFails.length?'correction':incomplete?'pending':'consistent';
        const statusTitles={empty:'Sem sessão para avaliar',intervention:'Quebra de controle: correção obrigatória',correction:'Execução fora do plano: revisão obrigatória',pending:'Conclusão pendente: falta evidência do processo',consistent:'Execução consistente nos critérios revisados'};
        const opening={
            empty:'Importe operações antes de solicitar um parecer.',
            intervention:'A prioridade desta sessão é restabelecer o controle do processo. Os limites ou a gestão de risco foram ultrapassados em critérios verificáveis. Um resultado favorável não muda esse registro. O próximo compromisso deve corrigir a decisão que permitiu continuar fora do plano.',
            correction:'O histórico contém decisões incompatíveis com o plano SMC declarado. A cobrança é sobre essas decisões, não sobre sua capacidade como pessoa. Escolha o primeiro desvio que abriu espaço para os seguintes e transforme-o em uma regra verificável.',
            pending:'Os dados temporais não mostram quebra nas regras avaliadas, mas ainda falta documentar a qualidade das entradas e da gestão. Ausência de informação não será tratada como disciplina comprovada. Complete a revisão antes de tirar uma conclusão sobre a sessão.',
            consistent:a.pnl<0?'A sessão teve resultado negativo, mas os critérios revisados foram respeitados. Não mude o método apenas para eliminar o desconforto de uma perda. Preserve o que foi executado conforme o plano e acompanhe a repetição desse processo.':'Nos dados disponíveis, a sessão respeitou os critérios revisados. O próximo objetivo é repetir a execução, sem transformar o resultado em autorização para antecipar entradas ou alterar risco.'
        }[status];
        const resultReading=a.pnl>0&&violations.size?'O lucro não valida as '+violations.size+' operações sinalizadas fora do plano. Repetir uma decisão porque ela deu certo financeiramente pode manter o desvio no processo.':
            a.pnl<0&&!violations.size&&!incomplete?'A perda financeira não é, por si, falha de disciplina. A revisão desta sessão sustenta a execução nos critérios disponíveis.':
            'Resultado financeiro e qualidade de execução são avaliados separadamente. As operações sinalizadas fecharam '+cash(flaggedPnl)+' neste dia; esse valor não demonstra quanto foi causado pelo comportamento nem quanto seria evitado.';
        const entryMap=new Map(a.entries.map(t=>[t.id,t]));
        const episodes=flagged.filter(t=>entryMap.has(t.id)).map(t=>{
            const info=a.entryInfo[t.id],previous=a.closed.find(x=>x.id===info?.previous),x=A.smcTrade(t,annotations[t.id],r);
            const facts=[...(info?.tags||[]),...x.tags];
            const weight=(a.afterLimit.some(x=>x.id===t.id)?8:0)+(a.afterStreak.some(x=>x.id===t.id)?6:0)+(criticalStops.some(x=>x.trade.id===t.id)?8:0)+(a.revenge.some(x=>x.id===t.id)?4:0)+facts.length;
            return {id:t.id,weight,at:t.open,symbol:t.symbol,facts,
                trigger:previous?'Às '+clock(previous.close)+', a operação anterior encerrada em '+previous.symbol+' realizou '+cash(previous.netCents)+'.':'Nenhum fechamento anterior do mesmo dia disponível como gatilho.',
                decision:'Às '+clock(t.open)+', houve nova entrada '+(t.side==='C'?'comprada':'vendida')+' em '+t.symbol+(info?.gap!==null&&info?.gap!==undefined?', após '+(info.gap<60?Math.round(info.gap)+' s':(info.gap/60).toFixed(1)+' min'):'')+'.',
                context:info?'Resultado realizado conhecido antes da entrada: '+cash(info.realizedBefore)+'. Sequência de perdas conhecida: '+info.lossStreakBefore+'.':'',
                outcome:t.day===day?'Essa operação encerrou em '+cash(t.netCents)+'. O desfecho não confirma a intenção na entrada.':'Operação encerrada em outro dia; seu resultado não é somado à sessão selecionada.',
                question:x.note.newSetup==='no'?'Você registrou que não havia novo setup. O que autorizou a entrada naquele momento?':previous?.netCents<0?'Essa entrada passaria pelo mesmo checklist se a perda anterior não existisse?':'Qual estrutura e qual gatilho justificavam uma nova entrada sem depender do resultado anterior?',
                report:x.note.note||''
            };
        }).sort((x,y)=>y.weight-x.weight||x.at.localeCompare(y.at)).slice(0,4).sort((x,y)=>x.at.localeCompare(y.at));
        const chapters=[];
        const chapter=(id,title,level,facts,hypothesis,alternatives,demand,proof,items)=>chapters.push({id,title,level,facts,hypothesis,alternatives,demand,proof,items});
        chapter('rhythm','Seleção de oportunidades e capacidade de esperar',a.rapid.length||s.noSetup.length?'deviation':'review',
            a.entries.length+' entradas; '+a.rapid.length+' abaixo de '+r.quickMinutes+' min ('+percent(a.rapid.length,a.entries.length)+'); '+s.noSetup.length+' sem novo setup, conforme sua revisão.',
            a.rapid.length?'O ritmo é compatível com ação reativa e merece investigar impaciência, FOMO ou necessidade de estar operando. O CSV não escolhe entre essas explicações.':'O intervalo observado não demonstra, sozinho, que os setups eram válidos. A qualidade da espera depende também da estrutura registrada.',
            'Um setup independente pode ter surgido rapidamente; ainda assim, o intervalo contraria o critério que você definiu. Se quiser mudar esse critério, revise o plano para sessões futuras, sem usar o lucro do trade como justificativa retroativa.',
            'Aguardar pelo menos '+r.quickMinutes+' minutos e registrar uma nova estrutura, invalidação e gatilho antes da próxima entrada.',
            'Nenhuma entrada abaixo do intervalo; evidência de novo setup preenchida em todas as operações.',['spacing','setup']);
        chapter('loss','Aceitação da perda e interrupção da sequência',r.configured&&(a.afterStreak.length||a.afterLimit.length)?'critical':a.afterStreak.length||a.afterLimit.length||a.afterLoss.length||a.revenge.length?'deviation':'review',
            a.maxStreak+' perdas seguidas; '+a.afterLoss.length+' entradas antes da pausa de '+r.pauseMinutes+' min; '+a.afterStreak.length+' entradas após o limite de sequência; '+a.afterLimit.length+' após o limite financeiro.',
            a.revenge.length?'Há '+a.revenge.length+' reentradas rápidas após perda com reversão ou volume maior. Isso sustenta investigar recuperação impulsiva; não comprova vingança.':'Verifique se o desconforto de perder alterou sua seleção. Perder repetidamente não prova, por si, descontrole.',
            'Aumento do volume agregado pode vir de parciais ou adições; a intenção e a quantidade inicial exigem revisão. A sequência considera apenas resultados conhecidos antes da entrada.',
            'Cumprir a pausa após perda e encerrar novas entradas quando o limite definido for atingido, sem abrir uma exceção para “recuperar”.',
            'Zero novas entradas após os limites e zero reentradas antes da pausa.',['pause','streak',...(r.lossLimit>0?['limit']:[])]);
        chapter('payoff','Assimetria planejada e tolerância a sustentar o plano',s.below.length||s.lowTarget.length?'deviation':s.riskKnown<a.closed.length?'pending':'review',
            s.riskKnown+'/'+a.closed.length+' fechamentos com risco inicial; '+s.lowTarget.length+' alvos planejados abaixo de '+r.minTargetR+'R; '+s.below.length+' ganhos abaixo dessa referência sem exceção documentada; '+s.exceptions.length+' exceções documentadas.',
            s.below.length?'Uma saída curta pode buscar alívio imediato do medo de devolver. Confirme isso pelo pensamento no momento da saída; também pode haver outra explicação operacional.':'Sem o risco inicial não é possível avaliar se um ganho foi curto em R. Não transforme o prejuízo realizado em risco “planejado” depois do fato.',
            'Parcial prevista, quantidade menor, slippage ou exceção documentada podem explicar o resultado. Um ganho bruto de 2R não vira saída antecipada apenas pelas comissões.',
            'Registrar o risco inicial e o alvo antes da operação. Justificar saídas positivas abaixo de '+r.minTargetR+'R somente por uma exceção que já fazia parte do plano.',
            'Risco e alvo documentados em todas as operações; nenhum ganho abaixo da referência sem exceção permitida e registrada.',['rr','exitR']);
        chapter('risk','Integridade de contratos e stop estrutural',criticalStops.length||quantityExcess.length||budgetBreaches.length?'critical':s.contracts.length||s.stop.length?'deviation':coverage.contracts<coverage.total||coverage.stop<coverage.total?'pending':'review',
            coverage.contracts+'/'+coverage.total+' quantidades revisadas; '+s.contracts.length+' divergências de contratos; '+s.stop.length+' desvios de stop relatados; '+s.loss.length+' perdas maiores que 1R.'+(prep?.riskCents?' Risco máximo preparado: '+cash(prep.riskCents)+'; '+budgetExcess.length+' acima desse teto em '+budgetReviewed.length+' riscos iniciais informados. '+(budgetConfirmed?'Preparação anterior à primeira entrada.':'Preparação retrospectiva: essa comparação não comprova quebra de um limite prévio.') :''),
            criticalStops.length?'Afastar ou remover o stop fora do plano, conforme seu relato, pode ser uma tentativa de adiar a aceitação da invalidação. A motivação precisa ser confirmada por você.':'Investigue se tamanho e stop foram escolhidos pela estrutura e pelo plano, ou para ajustar o desconforto com o resultado.',
            'Perda acima de 1R também pode decorrer da execução ou de slippage. O relatório não prova alteração do stop. O volume do CSV não equivale automaticamente à quantidade inicial.',
            (prep?.riskCents?'Conferir o risco inicial com o teto de '+cash(prep.riskCents)+' registrado na preparação. ':'')+'Conferir contratos e risco total antes da ordem; manter o stop na invalidação definida e documentar qualquer alteração autorizada pelo plano.',
            (prep?.riskCents?'Nenhuma entrada acima do teto preparado; risco inicial informado em todas as operações. ':'')+'Quantidade inicial confirmada igual à planejada; zero alteração de stop fora do plano.',['contracts','stop']);
        chapter('gains','Devolução de lucro e mudança de critério durante o dia',a.afternoonGiveback>0&&a.entries.some(t=>t.open.slice(11,16)>=r.afternoon&&violations.has(t.id))?'deviation':'review',
            'Manhã: '+cash(a.morning)+'; tarde: '+cash(a.afternoon)+'; pico realizado: '+cash(a.peak)+'; devolução do pico: '+cash(a.giveback)+(a.peak>0?' ('+Math.round(a.givebackPct)+'%)':'')+'.',
            a.afternoonGiveback>0?'Investigue se o lucro passou a funcionar como permissão para relaxar a seleção, ou se a tentativa de preservar um saldo mudou suas decisões. Devolução, sozinha, não confirma nenhuma dessas causas.':'Um pico de lucro não é uma previsão do fechamento. A avaliação deve verificar se os critérios continuaram iguais, sem exigir um resultado financeiro específico.',
            'Uma sequência regular de perdas pode devolver lucro mesmo com execução correta. É necessário comparar os setups, intervalos, contratos e stops da tarde com os da manhã.',
            'Manter o mesmo checklist e os limites definidos ao longo do dia. Registrar a mudança de pensamento quando surgir a ideia de “usar o lucro” ou “fechar positivo a qualquer custo”.',
            'Revisão dos trades posteriores ao pico e ausência de flexibilização das regras após ganhos.',['setup','spacing','time']);
        const emotionNames={calm:'calma',fomo:'medo de perder movimento',revenge:'vontade de recuperar',fear:'medo de devolver',euphoria:'euforia',impatience:'impaciência'};
        const emotions=Object.entries(s.emotions).map(([k,n])=>n+' relato(s) de '+emotionNames[k]).join('; ');
        const urge=review.urge!==undefined&&review.urge!==''?Number(review.urge):null;
        chapter('self','Consciência do gatilho e responsabilidade pela resposta','review',
            (emotions||'Nenhum estado emocional registrado por operação.')+(urge!==null&&Number.isFinite(urge)?' Urgência de recuperar relatada no dia: '+urge+'/10.':'')+(review.trigger?' Gatilho descrito: '+review.trigger:''),
            'Emoção e ação precisam ser separadas: sentir medo, frustração ou urgência não equivale a descumprir o plano. O ponto de trabalho é o que você fez depois de perceber o estado.',
            'Os relatos são retrospectivos e podem não explicar toda a sessão. Não atribuímos personalidade, transtorno ou intenção a horários e resultados.',
            'Reconstruir um episódio: fato externo, pensamento, sensação percebida, decisão tomada e alternativa que respeitaria o plano.',
            'Debrief com episódio específico, ação substituta e evidência que permitirá cobrar o cumprimento.',['focus']);
        const historyDays=A.dates(trades).filter(d=>d<=day).slice(-10);
        const history=historyDays.map(d=>A.analyzeDay(trades,d,rulesAt(d),annotations)).filter(x=>x.entries.length);
        const definitions=[
            ['spacing','Entradas consecutivas',x=>x.rapid.length>0],
            ['loss','Continuidade após limites',x=>x.afterStreak.length>0||x.afterLimit.length>0],
            ['rr','Ganho abaixo do alvo sem exceção',x=>x.smc.below.length>0],
            ['stop','Stop fora do plano relatado',x=>x.smc.stop.length>0],
            ['contracts','Contratos divergentes confirmados',x=>x.smc.contracts.length>0]
        ];
        const recurrence=definitions.map(([id,label,test])=>{
            let streak=0;for(let i=history.length-1;i>=0&&test(history[i]);i--)streak++;
            return {id,label,days:history.filter(test).length,total:history.length,streak};
        });
        const current=history.slice(-5),previous=history.slice(-10,-5);
        const rate=xs=>{const n=xs.reduce((n,x)=>n+x.entries.length,0);return n?xs.reduce((n,x)=>n+x.rapid.length,0)/n:null;};
        const currentRate=rate(current),previousRate=rate(previous);
        const trend=current.length>=3&&previous.length>=3?{current:currentRate,previous:previousRate,deltaPoints:Math.round((currentRate-previousRate)*100),currentDays:current.length,previousDays:previous.length}:null;
        const previousPlans=history.filter(x=>x.day<day&&plans[x.day]).map(x=>{
            const p=plans[x.day],map=new Map(x.checks.map(c=>[c.id,c]));
            return {day:x.day,items:p.items.filter(id=>id!=='focus').map(id=>map.get(id)).filter(Boolean)};
        });
        const commitments={failed:previousPlans.reduce((n,x)=>n+x.items.filter(c=>c.pass===false).length,0),pending:previousPlans.reduce((n,x)=>n+x.items.filter(c=>c.pass===null&&c.applicable!==false).length,0),met:previousPlans.reduce((n,x)=>n+x.items.filter(c=>c.pass===true).length,0),days:previousPlans.length};
        const priority=chapters.find(c=>c.level==='critical')||chapters.find(c=>c.level==='deviation')||chapters.find(c=>c.level==='pending')||chapters[0];
        priority.primary=priority.id==='risk'?(budgetBreaches.length?'focus':criticalStops.length?'stop':'contracts'):priority.items[0];
        const pendingSteps=[
            ...(coverage.complete<coverage.total?[{id:'evidence',label:'Completar a revisão SMC das '+(coverage.total-coverage.complete)+' operações com evidência incompleta.'}]:[]),
            {id:'episode',label:'Registrar no debrief uma decisão específica e sua alternativa dentro do plano.'},
            {id:'commitment',label:'Salvar um compromisso para o próximo pregão com ação e critério verificável.'}
        ];
        const signature=fingerprint([day,r,input.preparations?.[day]||null,all.map(t=>[t.id,t.grossCents,t.feeCents,t.qty,A.annotation(annotations[t.id])]),{before:clean(review.before),after:clean(review.after),urge:clean(review.urge),trigger:clean(review.trigger),lesson:clean(review.lesson)},recurrence,commitments,Object.entries(plans).filter(([target,p])=>target>day&&p.from===day).map(([target,p])=>[target,p.rules,p.items,p.focus,p.contract?.priority||'',p.contract?.trigger||'',p.contract?.proof||''])]);
        const saved=debrief(review.desk||{});
        const stale=saved.completed&&saved.signature!==signature;
        const strengths=[];
        if(a.timingChecks.find(c=>c.id==='time')?.pass)strengths.push('As entradas respeitaram o horário limite configurado.');
        if(!a.afterStreak.length&&!a.afterLimit.length)strengths.push('Não foram identificadas novas entradas após os limites de sequência ou perda.');
        if(s.exceptions.length)strengths.push(s.exceptions.length+' exceção(ões) abaixo do alvo foram documentadas.');
        if(coverage.complete)strengths.push(coverage.complete+' operação(ões) têm evidências de setup, risco, alvo, contratos e stop suficientes para avaliação.');
        return {day,a,status,title:statusTitles[status],opening,resultReading,coverage,chapters,priority,episodes,flaggedCount:flagged.length,flaggedPnl,recurrence,historyCount:history.length,trend,commitments,pendingSteps,signature,saved,stale,reviewed:saved.completed&&!stale,strengths};
    }
    return {report,debrief,fingerprint};
});
