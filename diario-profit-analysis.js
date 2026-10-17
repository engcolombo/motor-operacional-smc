/* Profit CSV analysis. Pure functions; all money is kept in integer centavos. */
(function (root, factory) {
    if (typeof module === 'object' && module.exports) module.exports = factory();
    else root.ProfitAnalysis = factory();
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {
    'use strict';
    const DEFAULTS = Object.freeze({maxTrades:8, quickMinutes:10, deskPolicy:1, minTargetR:2, allowEarlyException:true, pauseMinutes:10, maxLosses:3, afternoon:'13:00', endTime:'18:00', givebackPct:50, lossLimit:0, configured:false});
    const normalize = s => String(s || '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').trim().toLowerCase().replace(/\s+/g, ' ');
    const sum = xs => xs.reduce((a,b)=>a+b,0);
    function numberBR(value) {
        let s=String(value ?? '').trim().replace(/^R\$\s*/, '').replace(/\s/g,'');
        if (!s || s==='-') return null;
        let negative=false;
        if (/^\(.*\)$/.test(s)) { negative=true;s=s.slice(1,-1); }
        if (!/^[+-]?(?:\d{1,3}(?:\.\d{3})+|\d+)(?:,\d+)?$/.test(s)) return null;
        const n=Number(s.replace(/\./g,'').replace(',','.'))*(negative?-1:1);
        return Number.isFinite(n) ? n : null;
    }
    function dateBR(value) {
        const m=String(value||'').trim().match(/^(\d{2})\/(\d{2})\/(\d{4})\s+(\d{2}):(\d{2})(?::(\d{2}))?$/);
        if(!m) return null;
        const [d,mo,y,h,mi,s]=[+m[1],+m[2],+m[3],+m[4],+m[5],+(m[6]||0)];
        const ms=Date.UTC(y,mo-1,d,h,mi,s), t=new Date(ms);
        if(y<2000||y>2200||t.getUTCFullYear()!==y||t.getUTCMonth()!==mo-1||t.getUTCDate()!==d||h>23||mi>59||s>59) return null;
        return {ms,iso:t.toISOString().slice(0,19),day:t.toISOString().slice(0,10)};
    }
    function validDay(day) { return /^\d{4}-\d{2}-\d{2}$/.test(day) && dateBR(day.slice(8)+'/'+day.slice(5,7)+'/'+day.slice(0,4)+' 00:00:00')!==null; }
    function csvRows(text, delimiter) {
        const rows=[];let row=[],field='',quoted=false,line=1,start=1;
        for(let i=0;i<text.length;i++){
            const c=text[i];
            if(c==='"'){
                if(quoted&&text[i+1]==='"'){field+='"';i++;}
                else if(quoted || field.trim()==='') quoted=!quoted;
                else field+=c;
            } else if(c===delimiter&&!quoted){row.push(field);field='';}
            else if((c==='\n'||c==='\r')&&!quoted){
                if(c==='\r'&&text[i+1]==='\n')i++;
                row.push(field);if(row.some(x=>x.trim()))rows.push({cells:row,line:start});
                row=[];field='';line++;start=line;
            } else {field+=c;if(c==='\n')line++;}
        }
        if(quoted)throw new Error('CSV com aspas não fechadas. Exporte o arquivo novamente.');
        row.push(field);if(row.some(x=>x.trim()))rows.push({cells:row,line:start});
        return rows;
    }
    function identity(t) { return JSON.stringify([t.account,t.symbol,t.open,t.close,t.side]); }
    function parseCSV(text) {
        text=String(text).replace(/^\uFEFF/,'');
        const headerLine=text.split(/\r?\n/).find(l=>/ativo/i.test(l)&&/abertura/i.test(l)&&/fechamento/i.test(l));
        if(!headerLine)throw new Error('Cabeçalho do Profit não encontrado. Exporte o relatório de operações em CSV.');
        const delimiter=headerLine.includes(';')?';':headerLine.includes('\t')?'\t':',';
        const rows=csvRows(text,delimiter);
        const hi=rows.findIndex(r=>r.cells.some(c=>normalize(c)==='ativo')&&r.cells.some(c=>normalize(c)==='abertura'));
        if(hi<0)throw new Error('Cabeçalho inválido.');
        const headers=rows[hi].cells.map(normalize);
        const idx=name=>headers.indexOf(name);
        for(const name of ['ativo','abertura','fechamento','qtd compra','qtd venda','lado','res. operacao']){
            if(idx(name)<0)throw new Error('Coluna obrigatória ausente: '+name+'.');
        }
        const meta=rows.slice(0,hi).map(r=>r.cells.join(':')).join('\n');
        const accountMatch=meta.match(/(?:^|\n)\s*Conta\s*:\s*([^\n]+)/i);
        const account=accountMatch?accountMatch[1].replace(/:+$/,'').trim().slice(0,120):'sem-conta';
        const warnings=[], rejected=[], trades=[], seen=new Map();
        let openCount=0, duplicates=0;
        if(account==='sem-conta')warnings.push('Conta ausente no cabeçalho: as operações ficarão no grupo “Sem conta”.');
        const hasFees=idx('comissoes')>=0;
        if(!hasFees)warnings.push('Sem coluna Comissões: o resultado não desconta custos ausentes.');
        for(const row of rows.slice(hi+1)){
            const get=name=>String(row.cells[idx(name)]??'').trim();
            if(normalize(get('ativo')).startsWith('total') || normalize(get('ativo'))==='ativo')continue;
            const symbol=get('ativo'), open=dateBR(get('abertura')), close=dateBR(get('fechamento'));
            if(!get('fechamento')||get('fechamento')==='-'||/abert/i.test(get('fechamento'))){openCount++;continue;}
            const gross=numberBR(get('res. operacao')), buy=numberBR(get('qtd compra')), sell=numberBR(get('qtd venda'));
            const feeText=hasFees?get('comissoes'):'0', fees=numberBR(feeText);
            const side=get('lado').toUpperCase();
            if(!symbol||symbol.length>40||!open||!close||close.ms<open.ms||gross===null||buy===null||sell===null||buy<0||sell<0||Math.max(buy,sell)<=0||!['C','V'].includes(side)||(fees===null&&!['','-'].includes(feeText))){
                rejected.push({line:row.line,reason:'Ativo, datas, lado, quantidade ou valor inválido.'});continue;
            }
            const grossCents=Math.round(gross*100), feeCents=Math.round(Math.abs(fees||0)*100);
            if(!Number.isSafeInteger(grossCents)||!Number.isSafeInteger(feeCents)){rejected.push({line:row.line,reason:'Valor fora do intervalo permitido.'});continue;}
            const t={account,symbol,open:open.iso,close:close.iso,day:close.day,side,buy,sell,qty:Math.max(buy,sell),grossCents,feeCents,netCents:grossCents-feeCents,averaged:normalize(get('medio'))==='sim'};
            t.id=identity(t);
            if(seen.has(t.id)){
                const existing=seen.get(t.id);
                if(JSON.stringify(existing)!==JSON.stringify(t))rejected.push({line:row.line,reason:'Operação repetida com valores diferentes no mesmo arquivo.'});
                else duplicates++;
                continue;
            }
            seen.set(t.id,t);trades.push(t);
        }
        if(!trades.length)throw new Error('Nenhuma operação fechada válida encontrada. '+openCount+' aberta(s), '+rejected.length+' linha(s) inválida(s).');
        return {account,trades:trades.sort((a,b)=>a.close.localeCompare(b.close)||a.open.localeCompare(b.open)),warnings,rejected,openCount,duplicates,hasFees};
    }

    function numberDecimal(value) {
        const s=String(value??'').trim();
        if(!/^[+-]?\d+(?:\.\d+)?$/.test(s))return null;
        const n=Number(s);return Number.isFinite(n)?n:null;
    }
    function dateTradingView(value) {
        const s=normalize(value),m=s.match(/^(\d{1,2}) de ([a-z]+)\.? de (\d{4}),?\s+(\d{2}):(\d{2})(?::(\d{2}))?$/);
        if(!m)return null;
        const month=['jan','fev','mar','abr','mai','jun','jul','ago','set','out','nov','dez'].indexOf(m[2].slice(0,3))+1;
        if(!month)return null;
        return dateBR(m[1].padStart(2,'0')+'/'+String(month).padStart(2,'0')+'/'+m[3]+' '+m[4]+':'+m[5]+':'+(m[6]||'00'));
    }
    function parseTradingView(text) {
        const rows=csvRows(String(text).replace(/^\uFEFF/,''),',');
        const headers=rows[0]?.cells.map(normalize)||[],idx=n=>headers.indexOf(n);
        for(const name of ['simbolo','numero da negociacao','tipo','data e hora','tamanho (qtd)','l&p liquido usd','comissao usd'])
            if(idx(name)<0)throw Error('Cabeçalho TradingView inválido: falta '+name+'. Use o CSV Histórico de negociação do Paper Trading em USD.');
        const groups=new Map(),trades=[],rejected=[],warnings=[
            'Paper Trading · simulação · USD. Histórico e limites separados do Profit; não há conversão para reais.',
            'Entrada e saída são agrupadas por símbolo e número da negociação. L&P líquido e Comissão são lidos uma vez, na saída. Bruto = líquido + comissão informada. Acumulados e Tamanho (valor) não são somados nem representam risco inicial.',
            'Horários preservados como exportados, sem conversão de fuso. Posições abertas não participam das métricas de operações encerradas.'
        ];
        let openCount=0,duplicates=0;
        const account='tradingview:paper:USD';
        for(const row of rows.slice(1)){
            const get=n=>String(row.cells[idx(n)]??'').trim();
            const symbol=get('simbolo'),number=get('numero da negociacao'),type=normalize(get('tipo'));
            const m=type.match(/^(entrada|saida) (long|short)$/);
            if(row.cells.length!==headers.length||!symbol||symbol.length>40||!/^\d+$/.test(number)||!m){
                rejected.push({line:row.line,reason:'Linha inválida: símbolo, número da negociação, tipo ou colunas.'});continue;
            }
            const key=JSON.stringify([symbol,number]);
            if(!groups.has(key))groups.set(key,{symbol,number,rows:[]});
            const g=groups.get(key);
            if(g.rows.some(x=>JSON.stringify(x.row.cells)===JSON.stringify(row.cells))){duplicates++;continue;}
            g.rows.push({row,get,kind:m[1],side:m[2]==='long'?'C':'V'});
        }
        const seen=new Set();
        for(const g of groups.values()){
            const entries=g.rows.filter(x=>x.kind==='entrada'),exits=g.rows.filter(x=>x.kind==='saida');
            const reject=reason=>rejected.push({line:g.rows[0].row.line,reason:'Negociação '+g.number+': '+reason});
            if(entries.length!==1||exits.length>1){reject('pares ambíguos ou parciais não suportadas; confira o relatório.');continue;}
            const e=entries[0],x=exits[0],open=dateTradingView(e.get('data e hora')),qty=numberDecimal(e.get('tamanho (qtd)'));
            if(!open||qty===null||qty<=0){reject('entrada com data ou quantidade inválida.');continue;}
            if(!x||normalize(x.get('data e hora'))==='abertura'){openCount++;continue;}
            const close=dateTradingView(x.get('data e hora')),exitQty=numberDecimal(x.get('tamanho (qtd)'));
            const net=numberDecimal(x.get('l&p liquido usd')),fee=numberDecimal(x.get('comissao usd'));
            if(!close||close.ms<open.ms||x.side!==e.side||exitQty!==qty||net===null||fee===null){
                reject('saída, quantidade, lado ou valores inconsistentes; confira o par entrada/saída.');continue;
            }
            const netCents=Math.round(net*100),feeCents=Math.round(Math.abs(fee)*100),grossCents=netCents+feeCents;
            const t={account,source:'tradingview',simulation:true,currency:'USD',symbol:g.symbol,open:open.iso,close:close.iso,day:close.day,side:e.side,buy:qty,sell:qty,qty,grossCents,feeCents,netCents,averaged:false};
            t.id=identity(t);
            if(!validateTrade(t)){reject('valores fora do intervalo permitido.');continue;}
            if(seen.has(t.id)){reject('mais de uma negociação com a mesma identidade; não importada para evitar duplicidade.');continue;}
            seen.add(t.id);trades.push(t);
        }
        if(!trades.length)throw Error('Nenhuma operação encerrada válida no TradingView. '+openCount+' aberta(s), '+rejected.length+' grupo(s)/linha(s) inválido(s).');
        return {account,source:'tradingview',currency:'USD',trades:trades.sort((a,b)=>a.close.localeCompare(b.close)||a.open.localeCompare(b.open)),warnings,rejected,openCount,duplicates,hasFees:true};
    }

    function mergeTrades(existing,incoming) {
        const map=new Map(existing.map(t=>[t.id,t]));let added=0,updated=0,duplicates=0;
        for(const t of incoming){
            const old=map.get(t.id);
            if(!old)added++;
            else if(JSON.stringify(old)===JSON.stringify(t)){duplicates++;continue;}
            else updated++;
            map.set(t.id,t);
        }
        return {trades:[...map.values()].sort((a,b)=>a.close.localeCompare(b.close)||a.open.localeCompare(b.open)),added,updated,duplicates};
    }
    function rules(input={}) {
        const r={...DEFAULTS,...input};
        for(const [key,min,max] of [['maxTrades',1,1000],['quickMinutes',0,240],['pauseMinutes',0,240],['maxLosses',1,100],['givebackPct',1,100],['lossLimit',0,100000000],['minTargetR',0.1,20]]){
            const n=Number(r[key]);
            if(!Number.isFinite(n)||n<min||n>max||(['maxTrades','maxLosses'].includes(key)&&!Number.isInteger(n)))throw new Error('Regra inválida: '+key);
            r[key]=n;
        }
        for(const key of ['afternoon','endTime'])if(!/^([01]\d|2[0-3]):[0-5]\d$/.test(r[key]))throw new Error('Horário inválido: '+key);
        r.configured=!!r.configured;
        r.pauseMinutes=Math.max(r.pauseMinutes,r.quickMinutes);
        r.allowEarlyException=r.allowEarlyException===true||r.allowEarlyException==="true";
        return r;
    }

    // One-time application of the trader-confirmed 10 min / 2R policy.
    function confirmedRules(input={}) {
        const r=rules(input);
        if(input.deskPolicy!==1){r.quickMinutes=10;r.pauseMinutes=Math.max(10,r.pauseMinutes);r.minTargetR=2;r.allowEarlyException=true;}
        r.deskPolicy=1;return r;
    }
    const SMC_CHECKS=['setup','rr','exitR','contracts','stop'];
    const SMC_SIGNALS=['smcSetup','smcTarget','smcExit','smcContracts','smcStop','smcLoss'];
    function annotation(input={}) {
        if(!input||typeof input!=='object'||Array.isArray(input))throw new Error('Revisão SMC inválida.');
        const out={};
        for(const k of ['riskCents','targetCents','plannedQty','entryQty']){
            const v=input[k];
            if(v===null||v===undefined||v===''){out[k]=null;continue;}
            if(typeof v!=='number'||!Number.isFinite(v)||(k.endsWith('Cents')&&!Number.isSafeInteger(v))||v<=0||v>(k.endsWith('Cents')?10000000000:1000000))throw new Error('Valor inválido na revisão: '+k);
            out[k]=v;
        }
        const enums={exit:['unknown','stop','target','manual','breakeven'],execution:['unknown','simple','scaled'],newSetup:['unknown','yes','no'],stopBasis:['unknown','structure','arbitrary'],stopChange:['unknown','unchanged','planned','tightened','widened','removed'],earlyReason:['unknown','planned','fear','recover','manual'],emotion:['unknown','calm','fomo','revenge','fear','euphoria','impatience']};
        for(const [k,values] of Object.entries(enums))out[k]=values.includes(input[k])?input[k]:'unknown';
        for(const k of ['note','setupName','setupEvidence','exception','stopReason'])out[k]=typeof input[k]==='string'?input[k].slice(0,k==='setupName'?200:4000):'';
        return out;
    }
    function smcTrade(t,input={},config={}) {
        const n=annotation(input),r=rules(config),risk=n.riskCents;
        const realizedR=risk?t.grossCents/risk:null,netR=risk?t.netCents/risk:null;
        const plannedR=risk&&n.targetCents?n.targetCents/risk:null;
        const actualQty=n.entryQty??(n.execution==='simple'&&t.buy===t.sell?t.qty:null);
        const quantityConflict=n.execution==='simple'&&(t.buy!==t.sell||(n.entryQty!==null&&n.entryQty!==t.qty));
        const qtyMismatch=!quantityConflict&&actualQty!==null&&n.plannedQty!==null?actualQty!==n.plannedQty:null;
        const belowTarget=realizedR!==null&&t.grossCents>0&&t.grossCents+0.000001<risk*r.minTargetR;
        const exception=belowTarget&&r.allowEarlyException&&n.earlyReason==='planned'&&n.exception.trim().length>=3;
        const stopIssue=n.stopBasis==='arbitrary'||['tightened','widened','removed'].includes(n.stopChange);
        const lossOverRisk=risk!==null&&t.grossCents < -risk;
        const checks={
            setup:n.newSetup==='no'?false:n.newSetup==='yes'&&n.setupEvidence.trim().length>=3?true:null,
            rr:plannedR===null?null:n.targetCents+0.000001>=risk*r.minTargetR,
            exitR:t.grossCents<=0?true:realizedR===null?null:!belowTarget||exception,
            contracts:qtyMismatch===null?null:!qtyMismatch,
            stop:stopIssue?false:n.stopBasis==='structure'&&(n.stopChange==='unchanged'||(n.stopChange==='planned'&&n.stopReason.trim().length>=3))?true:null
        };
        const tags=[];
        if(checks.setup===false)tags.push('Sem novo setup');
        if(checks.rr===false)tags.push('Alvo planejado < '+r.minTargetR+'R');
        if(belowTarget)tags.push(exception?'Exceção abaixo de '+r.minTargetR+'R':'Ganho < '+r.minTargetR+'R');
        if(qtyMismatch)tags.push('Contratos fora do plano');
        if(quantityConflict)tags.push('Conferir quantidade');
        if(stopIssue)tags.push('Stop fora do plano');
        if(lossOverRisk)tags.push('Perda > 1R · investigar');
        return {note:n,riskCents:risk,realizedR,netR,plannedR,actualQty,qtyMismatch,quantityConflict,belowTarget,exception,stopIssue,lossOverRisk,checks,tags};
    }
    function smcSummary(closed,entries,annotations,r) {
        const rows=closed.map(t=>({trade:t,...smcTrade(t,annotations[t.id],r)}));
        const entryRows=entries.map(t=>({trade:t,...smcTrade(t,annotations[t.id],r)}));
        const labels={setup:'Registrar um novo setup SMC válido antes de cada entrada',rr:'Planejar alvo mínimo de '+r.minTargetR+'R com o risco inicial',exitR:'Respeitar '+r.minTargetR+'R nas saídas positivas'+(r.allowEarlyException?' ou registrar exceção prevista':''),contracts:'Executar a quantidade de contratos planejada',stop:'Usar stop estrutural e só alterá-lo conforme o plano'};
        const checks=SMC_CHECKS.map(id=>{
            // Exit management is evaluated on closing day, even for overnight trades.
            const relevant=id==='exitR'?rows.filter(x=>x.trade.grossCents>0):entryRows;
            const failed=relevant.filter(x=>x.checks[id]===false).length;
            const pending=relevant.filter(x=>x.checks[id]===null).length;
            return {id,label:labels[id],smc:true,applicable:relevant.length>0,pass:!relevant.length?null:failed?false:pending?null:true,failed,pending,detail:relevant.length?failed+' desvios · '+pending+' revisões pendentes · '+relevant.length+' operações avaliáveis':'Sem operações aplicáveis neste dia'};
        });
        const emotions={};for(const x of entryRows){const e=x.note.emotion;if(e!=='unknown')emotions[e]=(emotions[e]||0)+1;}
        return {emotions,rows,entryRows,checks,riskKnown:rows.filter(x=>x.realizedR!==null).length,below:rows.filter(x=>x.belowTarget&&!x.exception),exceptions:rows.filter(x=>x.exception),lowTarget:entryRows.filter(x=>x.checks.rr===false),contracts:entryRows.filter(x=>x.qtyMismatch),stop:entryRows.filter(x=>x.stopIssue),loss:rows.filter(x=>x.lossOverRisk),noSetup:entryRows.filter(x=>x.checks.setup===false)};
    }
    function coaching(a) {
        const list=[],s=a.smc;
        const add=(title,evidence,question,action,items)=>list.push({title,evidence,question,action,items});
        if(a.rapid.length||s.noSetup.length||s.emotions.fomo||s.emotions.impatience)add('Esperar a estrutura, não buscar atividade',a.rapid.length+' entradas próximas e '+s.noSetup.length+' entradas sem novo setup confirmado; '+((s.emotions.fomo||0)+(s.emotions.impatience||0))+' relatos de medo de perder o movimento ou impaciência.','Havia um novo contexto e gatilho SMC, ou eu queria continuar operando?','Se eu sentir urgência de reentrar, vou cumprir a pausa e registrar a nova estrutura, a invalidação e o gatilho do meu setup antes de enviar a ordem.',['spacing','setup']);
        if(s.lowTarget.length||s.below.length||s.emotions.fear)add('Proteger a relação entre risco e alvo',s.lowTarget.length+' alvos planejados e '+s.below.length+' ganhos sem exceção abaixo de '+a.rules.minTargetR+'R; '+(s.emotions.fear||0)+' relatos de medo de devolver ganho.','O alvo já nasceu curto, ou antecipei a saída por medo de devolver? Houve parcial prevista?','Antes de entrar, vou registrar o risco inicial total e um alvo de pelo menos '+a.rules.minTargetR+'R. Se quiser sair antes, vou conferir se a exceção estava prevista no plano e registrar o motivo.',['rr','exitR']);
        if(s.contracts.length)add('Separar tamanho da posição de emoção',s.contracts.length+' divergências entre quantidade planejada e quantidade de entrada confirmada.','A quantidade mudou por um critério do plano ou por pressa, euforia ou vontade de recuperar?','Antes de confirmar a ordem, vou comparar os contratos e o risco total com o plano; se estiverem diferentes, vou corrigir a ordem antes de enviá-la.',['contracts']);
        if(s.stop.length||s.loss.length)add('Respeitar a invalidação da ideia',s.stop.length+' desvios de stop relatados e '+s.loss.length+' perdas acima de 1R.','O stop correspondia à invalidação estrutural? Se a perda excedeu 1R, houve slippage, execução diferente, mais contratos ou alteração do stop?','Vou registrar a invalidação e o stop inicial. Só vou alterar o stop por um critério já previsto e registrar qual foi; não vou ampliar o risco para evitar aceitar uma perda.',['stop','contracts']);
        if(a.revenge.length||s.emotions.revenge)add('Interromper a tentativa de recuperar',a.revenge.length+' reentradas após perda com reversão ou volume maior; '+(s.emotions.revenge||0)+' relatos de vontade de recuperar.','Eu aceitaria essa mesma entrada se a operação anterior tivesse dado lucro?','Depois de uma perda, vou cumprir minha pausa e só retornar após conferir um novo setup independente da vontade de recuperar.',['pause','setup']);
        if(s.emotions.euphoria)add('Conferir o plano mesmo com confiança',s.emotions.euphoria+' relatos de euforia ou excesso de confiança.','A confiança veio de um setup válido ou do resultado recente?','Mesmo depois de ganhar, vou conferir setup, contratos e risco inicial antes da próxima ordem, sem antecipar a entrada.',['setup','contracts']);
        if(!list.length)add('Repetir acertos e completar a evidência do processo',s.riskKnown+' de '+a.closed.length+' operações com risco inicial registrado.','Consigo explicar o setup, o risco, os contratos e o motivo da saída de cada operação?','Vou registrar setup, risco inicial, alvo, contratos e critério do stop de cada operação para revisar minha execução com dados.',['setup','rr','contracts','stop']);
        return list;
    }

    const ms = iso => Date.parse(iso+'Z'); // Wall-clock values only; no browser timezone conversion.
    function analyzeDay(all,day,input={},annotations={}) {
        const r=rules(input), closed=all.filter(t=>t.day===day).sort((a,b)=>a.close.localeCompare(b.close)||a.open.localeCompare(b.open));
        const entries=all.filter(t=>t.open.slice(0,10)===day).sort((a,b)=>a.open.localeCompare(b.open)||a.close.localeCompare(b.close));
        const todayClosed=closed;
        let pnl=0,peak=0,peakTime=null,maxDrawdown=0,streak=0,maxStreak=0,stopStreak=0,maxStopStreak=0;
        const curve=[{time:day+'T00:00:00',value:0}];
        for(const t of closed){
            pnl+=t.netCents;
            if(pnl>peak){peak=pnl;peakTime=t.close;}
            maxDrawdown=Math.max(maxDrawdown,peak-pnl);
            streak=t.netCents<0?streak+1:0;maxStreak=Math.max(maxStreak,streak);
            stopStreak=annotations[t.id]?.exit==='stop'?stopStreak+1:0;maxStopStreak=Math.max(maxStopStreak,stopStreak);
            curve.push({time:t.close,value:pnl});
        }
        const rapid=[], afterLoss=[], revenge=[], increased=[], afterStreak=[], afterLimit=[], afterHours=[], overlaps=[];
        const entryInfo={};
        let ci=0,last=null,closedPnl=0,knownStreak=0,lossStopReached=false,limitReached=false,latestAsset=new Map();
        const active=[];
        for(const t of entries){
            while(ci<todayClosed.length && todayClosed[ci].close<=t.open){
                const c=todayClosed[ci];
                // Same-second entry/exit is not evidence available before that entry.
                if(c.open>=t.open)break;
                ci++;last=c;closedPnl+=c.netCents;knownStreak=c.netCents<0?knownStreak+1:0;
                if(knownStreak>=r.maxLosses)lossStopReached=true;
                if(r.lossLimit>0&&closedPnl<=-Math.round(r.lossLimit*100))limitReached=true;
                latestAsset.set(c.symbol,c);
            }
            const gap=last?(ms(t.open)-ms(last.close))/1000:null;
            const prevAsset=latestAsset.get(t.symbol), bigger=!!prevAsset&&prevAsset.netCents<0&&t.qty>prevAsset.qty;
            const sameAssetLoss=last&&last.symbol===t.symbol&&last.netCents<0;
            const quick=gap!==null&&gap>=0&&gap<r.quickMinutes*60;
            const lossQuick=last&&last.netCents<0&&gap<r.pauseMinutes*60;
            const reversal=!!sameAssetLoss&&last.side!==t.side;
            // A CSV cannot reveal intention or true peak exposure; volume is only a proxy.
            const suspected=!!lossQuick&&(bigger||reversal);
            const tags=[];
            if(quick){rapid.push(t);tags.push('Entrada próxima');}
            if(lossQuick){afterLoss.push(t);tags.push('Pausa após perda');}
            if(suspected){revenge.push(t);tags.push('Possível recuperação impulsiva');}
            if(bigger){increased.push(t);tags.push('Volume maior após perda');}
            if(lossStopReached){afterStreak.push(t);tags.push('Após limite de perdas');}
            if(limitReached){afterLimit.push(t);tags.push('Após limite financeiro');}
            if(t.open.slice(11,16)>r.endTime){afterHours.push(t);tags.push('Após horário limite');}
            while(active.length&&active[0].close<=t.open)active.shift();
            if(active.length){overlaps.push(t);tags.push('Posições simultâneas');}
            active.push(t);active.sort((a,b)=>a.close.localeCompare(b.close));
            entryInfo[t.id]={gap,previous:last?.id||null,realizedBefore:closedPnl,lossStreakBefore:knownStreak,tags};
        }
        const morning=sum(closed.filter(t=>t.close.slice(11,16)<r.afternoon).map(t=>t.netCents));
        const afternoon=sum(closed.filter(t=>t.close.slice(11,16)>=r.afternoon).map(t=>t.netCents));
        const giveback=Math.max(0,peak-pnl),givebackPct=peak>0?giveback/peak*100:0;
        const afternoonGiveback=morning>0&&afternoon<0?Math.min(morning,-afternoon):0;
        const checks=[
            {id:'spacing',label:'Evitar entradas consecutivas: aguardar ao menos '+r.quickMinutes+' min e um novo setup',pass:rapid.length===0,detail:rapid.length+' entradas próximas, incompatíveis com o ritmo declarado do plano SMC'},
            {id:'count',label:'Respeitar até '+r.maxTrades+' entradas no dia',pass:entries.length<=r.maxTrades,detail:entries.length+' entradas'},
            {id:'pause',label:'Pausar '+r.pauseMinutes+' min após uma perda',pass:afterLoss.length===0,detail:afterLoss.length+' reentradas antes da pausa'},
            {id:'streak',label:'Encerrar após '+r.maxLosses+' perdas consecutivas',pass:afterStreak.length===0,detail:afterStreak.length+' entradas após o limite'},
            {id:'time',label:'Não abrir trades após '+r.endTime,pass:afterHours.length===0,detail:afterHours.length+' entradas após o horário'}
        ];
        if(r.lossLimit>0)checks.push({id:'limit',label:'Encerrar ao atingir perda de '+(all[0]?.currency==='USD'?'US$ ':'R$ ')+r.lossLimit.toLocaleString('pt-BR'),pass:afterLimit.length===0,detail:afterLimit.length+' entradas após o limite'});
        const alerts=[];
        const add=(id,title,detail,count,kind='attention')=>alerts.push({id,title,detail,count,kind});
        if(rapid.length)add('rapid','Entradas consecutivas fora do ritmo SMC',rapid.length+' entradas a menos de '+r.quickMinutes+' min do último fechamento. Seu plano não prevê trades consecutivos: investigue antecipação, impaciência ou recuperação e registre o novo setup.',rapid.length);
        if(afterLoss.length)add('pause','Pausa curta após perda',afterLoss.length+' entradas antes de completar '+r.pauseMinutes+' min após uma perda já encerrada.',afterLoss.length);
        if(revenge.length)add('revenge','Possível trade de vingança',revenge.length+' reentradas rápidas após perda com inversão no mesmo ativo ou aumento do volume. Confirme a intenção na revisão.',revenge.length);
        if(entries.length>r.maxTrades)add('overtrading','Volume de operações acima do plano',entries.length+' entradas para uma referência de '+r.maxTrades+'. Frequência isolada não confirma overtrading.',entries.length-r.maxTrades);
        if(maxStreak>=r.maxLosses)add('streak','Sequência de perdas',maxStreak+' resultados negativos consecutivos. '+afterStreak.length+' entradas ocorreram após atingir o limite.',maxStreak);
        if(maxStopStreak>=2)add('stops','Stops confirmados na revisão',maxStopStreak+' saídas consecutivas marcadas por você como stop.',maxStopStreak);
        if(afternoonGiveback>0)add('afternoon','Lucro da manhã devolvido à tarde','A manhã terminou positiva e a tarde teve resultado negativo. '+Math.round(afternoonGiveback/morning*100)+'% do lucro da manhã foi devolvido.',afternoonGiveback);
        if(peak>0&&givebackPct>=r.givebackPct)add('giveback','Devolução a partir do pico',Math.round(givebackPct)+'% do pico de lucro realizado foi devolvido até o fechamento. Valores acima de 100% indicam que o dia virou negativo.',giveback);
        if(increased.length)add('size','Volume maior após perda',increased.length+' operações com quantidade negociada maior que a última perda no mesmo ativo. Quantidade agregada não revela o lote máximo simultâneo.',increased.length);
        if(afterHours.length)add('hours','Operações após o horário',afterHours.length+' entradas depois de '+r.endTime+'.',afterHours.length);
        if(afterLimit.length)add('limit','Continuidade após limite financeiro',afterLimit.length+' entradas depois que o resultado realizado atingiu o limite de perda.',afterLimit.length);
        const timingChecks=[...checks],smc=smcSummary(closed,entries,annotations,r);
        checks.push(...smc.checks);
        if(smc.noSetup.length)add('smcSetup','Entrada sem novo setup SMC',smc.noSetup.length+' operações marcadas por você como sem novo setup. Revise antecipação ou entrada fora do método.',smc.noSetup.length);
        if(smc.lowTarget.length)add('smcTarget','Alvo planejado abaixo de '+r.minTargetR+'R',smc.lowTarget.length+' operações já tinham relação alvo/risco menor que a referência do seu plano.',smc.lowTarget.length);
        if(smc.below.length)add('smcExit','Ganho abaixo de '+r.minTargetR+'R: investigar execução',smc.below.length+' ganhos brutos ficaram abaixo da referência, sem exceção prevista e documentada. Revise saída antecipada, parciais, contratos e stop; o resultado isolado não identifica a causa.',smc.below.length);
        if(smc.contracts.length)add('smcContracts','Discrepância de contratos confirmada',smc.contracts.length+' entradas com quantidade confirmada diferente da planejada. Volume agregado do CSV só é usado quando você confirma execução simples.',smc.contracts.length);
        if(smc.stop.length)add('smcStop','Stop fora do plano na revisão',smc.stop.length+' operações com stop sem base estrutural ou alteração fora do plano informada por você.',smc.stop.length);
        if(smc.loss.length)add('smcLoss','Perda superior ao risco inicial',smc.loss.length+' perdas brutas excederam 1R informado. Investigue slippage, execução, contratos ou stop; não confirma alteração do stop.',smc.loss.length);
        return {smc,timingChecks,day,rules:r,closed,entries,pnl,peak,peakTime,maxDrawdown,maxStreak,maxStopStreak,curve,rapid,afterLoss,revenge,increased,afterStreak,afterLimit,afterHours,overlaps,entryInfo,morning,afternoon,giveback,givebackPct,afternoonGiveback,checks,alerts,score:entries.length?Math.round(timingChecks.filter(c=>c.pass).length/timingChecks.length*100):null,wins:closed.filter(t=>t.netCents>0).length,losses:closed.filter(t=>t.netCents<0).length,breakeven:closed.filter(t=>t.netCents===0).length};
    }
    function dates(trades) { return [...new Set(trades.flatMap(t=>[t.day,t.open.slice(0,10)]))].sort(); }
    function nextWeekday(day) {
        const d=new Date(day+'T12:00:00Z');do{d.setUTCDate(d.getUTCDate()+1);}while([0,6].includes(d.getUTCDay()));
        return d.toISOString().slice(0,10);
    }
    function validateTrade(t) {
        if(t?.source==='tradingview'?(t.account!=='tradingview:paper:USD'||t.currency!=='USD'||t.simulation!==true):(t?.account==='tradingview:paper:USD'||(t?.source&&t.source!=='profit')||(t?.currency&&t.currency!=='BRL')))return false;
        if(!t||typeof t.account!=='string'||!t.account||t.account.length>120||typeof t.symbol!=='string'||!t.symbol||t.symbol.length>40||!['C','V'].includes(t.side))return false;
        if(![t.open,t.close].every(x=>typeof x==='string'&&/^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d$/.test(x)&&dateBR(x.slice(8,10)+'/'+x.slice(5,7)+'/'+x.slice(0,4)+' '+x.slice(11))))return false;
        return t.close>=t.open&&t.day===t.close.slice(0,10)&&t.id===identity(t)&&[t.buy,t.sell,t.qty].every(x=>typeof x==='number'&&Number.isFinite(x)&&x>=0)&&t.qty===Math.max(t.buy,t.sell)&&t.qty>0&&[t.grossCents,t.feeCents,t.netCents].every(Number.isSafeInteger)&&t.feeCents>=0&&t.netCents===t.grossCents-t.feeCents;
    }
    return {confirmedRules,DEFAULTS,SMC_CHECKS,SMC_SIGNALS,annotation,smcTrade,coaching,numberBR,dateBR,validDay,parseCSV,parseTradingView,dateTradingView,mergeTrades,rules,analyzeDay,dates,nextWeekday,validateTrade};
});
