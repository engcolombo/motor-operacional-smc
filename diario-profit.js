/* Trades Profit: browser-local records, isolated by diary login and broker account. */
const ProfitTrades = (() => {
    'use strict';
    const A=ProfitAnalysis, D=ProfitDesk, $=id=>document.getElementById(id), STORAGE='diarioProfit_v1_';
    const esc=v=>String(v??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
    const money=c=>(c/100).toLocaleString('pt-BR',{style:'currency',currency:'BRL'});
    const date=d=>d?d.slice(8,10)+'/'+d.slice(5,7)+'/'+d.slice(0,4):'—';
    const time=d=>d.slice(11,19);
    const tone=n=>n>0?'pf-positive':n<0?'pf-negative':'';
    const blank=()=>({version:1,trades:[],accounts:{},imports:[]});
    const accountKey=a=>'account:'+a;
    const masked=a=>a==='sem-conta'?'Sem conta':'Conta ••• '+a.slice(-4);
    let owner=null, data=blank(), account='', day='', tab='desk', ready=true, mounted=false, stage=null, busy=false, generation=0;
    let status='',statusError=false,planDrafts={};
    const localOwner=()=>typeof currentUser!=='undefined'&&currentUser?.id?currentUser.id:'guest';
    const meta=()=>data.accounts[accountKey(account)]||{settings:{...A.DEFAULTS},reviews:{},plans:{},annotations:{}};
    const trades=()=>data.trades.filter(t=>t.account===account);
    const dayRules=d=>A.confirmedRules(meta().plans[d]?.rules||meta().reviews[d]?.rules||meta().settings);
    const analysis=d=>A.analyzeDay(trades(),d,dayRules(d),meta().annotations);
    function announce(message,error=false){status=message;statusError=error;if($('pfStatus')){$('pfStatus').textContent=message;$('pfStatus').classList.toggle('pf-error',error);}}
    function commit(next){
        if(!ready){announce('O armazenamento precisa ser recuperado antes de salvar. Exporte o conteúdo atual e restaure um backup válido.',true);return false;}
        try{localStorage.setItem(STORAGE+owner,JSON.stringify(next));data=next;return true;}
        catch(e){announce('Não foi possível salvar neste navegador. Libere espaço ou exporte um backup; seus dados anteriores foram preservados.',true);return false;}
    }
    function changeAccount(mutator){
        const next=JSON.parse(JSON.stringify(data)),k=accountKey(account);
        next.accounts[k] ||= {settings:{...A.DEFAULTS},reviews:{},plans:{},annotations:{}};
        mutator(next.accounts[k]);return commit(next);
    }
    function validateBackup(value){
        if(!value||value.version!==1||!Array.isArray(value.trades)||value.trades.length>50000||!value.trades.every(A.validateTrade)||new Set(value.trades.map(t=>t.id)).size!==value.trades.length)throw new Error('Backup Profit inválido ou versão incompatível.');
        const clean=blank();clean.trades=value.trades.map(t=>({...t}));
        if(!value.accounts||typeof value.accounts!=='object'||Array.isArray(value.accounts))throw new Error('Configurações ausentes no backup.');
        const allowedKeys=new Set(clean.trades.map(t=>accountKey(t.account)));
        const text=v=>typeof v==='string'?v.slice(0,4000):'';
        for(const [k,m] of Object.entries(value.accounts)){
            if(!allowedKeys.has(k)||!m||typeof m!=='object')throw new Error('Conta inválida no backup.');
            const cm={settings:A.confirmedRules(m.settings),reviews:{},plans:{},annotations:{}};
            for(const [d,r] of Object.entries(m.reviews||{})){
                if(!A.validDay(d)||!r||typeof r!=='object')throw new Error('Revisão inválida.');
                cm.reviews[d]={rules:A.confirmedRules(r.rules),desk:D.debrief(r.desk||{}),before:text(r.before),after:text(r.after),energy:text(r.energy),urge:text(r.urge),setup:text(r.setup),good:text(r.good),trigger:text(r.trigger),lesson:text(r.lesson),updated:text(r.updated),contexts:{}};
                for(const [id,val] of Object.entries(r.contexts||{}))if(['rapid','pause','revenge','overtrading','streak','stops','afternoon','giveback','size','hours','limit',...A.SMC_SIGNALS].includes(id)&&['pending','confirmed','planned'].includes(val))cm.reviews[d].contexts[id]=val;
            }
            for(const [d,p] of Object.entries(m.plans||{})){
                if(!A.validDay(d)||!p||!A.validDay(p.from)||!Array.isArray(p.items)||!p.items.every(x=>['count','pause','streak','time','limit','spacing','focus',...A.SMC_CHECKS].includes(x)))throw new Error('Plano inválido.');
                cm.plans[d]={from:p.from,rules:A.confirmedRules(p.rules),items:[...new Set(p.items)],focus:text(p.focus),created:text(p.created),reflection:['yes','partial','no'].includes(p.reflection)?p.reflection:''};
            }
            for(const [id,n] of Object.entries(m.annotations||{})){
                if(!clean.trades.some(t=>t.id===id&&accountKey(t.account)===k)||!n)continue;
                cm.annotations[id]=A.annotation(n);
            }
            clean.accounts[k]=cm;
        }
        clean.imports=Array.isArray(value.imports)?value.imports.slice(-30).map(x=>({name:text(x.name),at:text(x.at),count:Number(x.count)||0})): [];
        return clean;
    }
    function authChanged(){
        const nextOwner=localOwner();if(nextOwner===owner)return;
        owner=nextOwner;generation++;stage=null;busy=false;planDrafts={};status='';statusError=false;ready=true;
        try{const raw=localStorage.getItem(STORAGE+owner);data=raw?validateBackup(JSON.parse(raw)):blank();}
        catch(e){data=blank();ready=false;status='Não foi possível ler os dados Profit salvos. O conteúdo original foi preservado. Use Backup para recuperá-lo.';statusError=true;}
        account=[...new Set(data.trades.map(t=>t.account))][0]||'';day=A.dates(trades()).at(-1)||'';
        if(mounted)render(true);
    }
    function init(){
        document.querySelector('.main').insertAdjacentHTML('beforeend','<section class="view" id="view-profit" aria-label="Trades Profit"></section>');
        mounted=true;
        $('view-profit').addEventListener('click',click);
        $('view-profit').addEventListener('change',change);
        $('view-profit').addEventListener('input',input);
        $('view-profit').addEventListener('submit',submit);
        authChanged();
    }
    function selectOptions(items,value){return items.map(([v,label])=>'<option value="'+esc(v)+'"'+(String(value)===String(v)?' selected':'')+'>'+esc(label)+'</option>').join('');}
    function chart(points,label,percent=false){
        if(points.length<2)return '<p class="pf-muted">Importe mais um pregão para acompanhar a evolução.</p>';
        const vals=points.map(p=>p.value),min=percent?0:Math.min(0,...vals),max=percent?100:Math.max(0,...vals),range=max-min||1;
        const x=i=>36+i*(688/(points.length-1)),y=v=>132-(v-min)/range*102;
        return '<svg class="pf-chart" viewBox="0 0 760 178" role="img" aria-label="'+esc(label)+'"><title>'+esc(label)+'</title>'+
            [min,(min+max)/2,max].map(v=>'<line x1="36" x2="724" y1="'+y(v)+'" y2="'+y(v)+'" class="pf-gridline"/><text x="36" y="'+(y(v)-6)+'">'+esc(percent?Math.round(v)+'%':money(Math.round(v)))+'</text>').join('')+
            '<polyline points="'+points.map((p,i)=>x(i)+','+y(p.value)).join(' ')+'" fill="none" class="pf-curve"/>'+
            points.map((p,i)=>'<circle cx="'+x(i)+'" cy="'+y(p.value)+'" r="3"><title>'+esc(p.label+': '+(percent?p.value+'%':money(p.value)))+'</title></circle>').join('')+
            '<text x="36" y="164">'+esc(points[0].label)+'</text><text x="724" y="164" text-anchor="end">'+esc(points.at(-1).label)+'</text></svg>';
    }
    function settingsMarkup(){
        const r=A.confirmedRules(meta().settings);
        return '<details class="pf-card pf-settings"><summary>Regras do meu plano <span class="pf-muted">'+(r.configured?'Personalizadas':'Referências iniciais · ajuste ao seu método')+'</span></summary>'+
        '<form id="pfRules" class="pf-rule-grid">'+
        [['maxTrades','Máximo de entradas/dia',1,1000,1],['quickMinutes','Intervalo mínimo SMC (min)',0,240,0.5],['minTargetR','Alvo mínimo do plano (R)',0.1,20,0.1],['pauseMinutes','Pausa após perda (min)',0,240,0.5],['maxLosses','Encerrar após perdas seguidas',1,100,1],['givebackPct','Alerta de devolução do pico (%)',1,100,1],['lossLimit','Limite de perda realizado (R$) · 0 desativa',0,100000000,0.01]].map(([k,l,min,max,step])=>'<label>'+l+'<input name="'+k+'" type="number" min="'+min+'" max="'+max+'" step="'+step+'" value="'+r[k]+'" required></label>').join('')+
        '<label>Início da tarde<input name="afternoon" type="time" value="'+r.afternoon+'" required></label><label>Última entrada permitida<input name="endTime" type="time" value="'+r.endTime+'" required></label>'+
        '<label>Saída positiva abaixo do alvo<select name="allowEarlyException">'+selectOptions([['true','Somente com exceção prevista e justificada'],['false','Sempre sinalizar como desvio']],String(r.allowEarlyException))+'</select></label><div class="pf-rule-footer"><p class="pf-muted">Defina limites coerentes com seu método. Revisões e compromissos já salvos conservam as regras usadas naquele dia. O CSV não informa o risco planejado.</p><button class="btn btn-primary" type="submit">Salvar regras</button></div></form></details>';
    }
    function headerMarkup(){
        return '<div class="pf-toolbar"><div><span class="pf-eyebrow">PROCESSO · DISCIPLINA · EVOLUÇÃO</span><h2>Consistência, um pregão por vez.</h2><p class="pf-muted">Transforme o histórico do Profit em decisões mais conscientes.</p></div>'+
        '<div class="pf-buttons"><button class="btn btn-primary" data-action="import">Importar CSV do Profit</button><button class="btn btn-ghost" data-action="backup">Backup</button><button class="btn btn-ghost" data-action="restore">Restaurar</button></div></div>'+
        '<input id="pfCSV" type="file" accept=".csv,.txt,text/csv" hidden><input id="pfBackup" type="file" accept=".json,application/json" hidden>'+
        '<div class="pf-storage"><span class="pf-dot"></span>Salvo neste navegador · '+(owner==='guest'?'perfil local sem login':'perfil do seu login')+' · não sincroniza com o Supabase <span>Faça backup para trocar de dispositivo.</span></div>'+
        '<p id="pfStatus" class="pf-status'+(statusError?' pf-error':'')+'" role="status" aria-live="polite">'+esc(status)+'</p>';
    }
    function previewMarkup(){
        if(!stage)return '';
        const result=A.mergeTrades(data.trades,stage.parsed.trades),p=stage.parsed;
        return '<section class="pf-card pf-import-preview"><div class="pf-section-title"><div><span class="pf-eyebrow">CONFERIR IMPORTAÇÃO</span><h3>'+esc(stage.name)+'</h3></div><button class="btn btn-ghost" data-action="cancel-import">Cancelar</button></div>'+
        '<p>'+esc(masked(p.account))+' · '+p.trades.length+' operações fechadas · '+date(p.trades[0].day)+' a '+date(p.trades.at(-1).day)+'</p>'+
        '<div class="pf-import-numbers"><span><strong>'+result.added+'</strong> novas</span><span><strong>'+(result.duplicates+p.duplicates)+'</strong> repetidas ignoradas</span><span><strong>'+result.updated+'</strong> atualizações</span><span><strong>'+p.openCount+'</strong> abertas ignoradas</span><span><strong>'+p.rejected.length+'</strong> linhas inválidas</span></div>'+
        '<p class="pf-muted">Resultado = Res. Operação − valor absoluto de Comissões. “Total” e “TET” não são usados nos cálculos. Exportações sobrepostas não duplicam operações.</p>'+
        p.warnings.map(w=>'<p class="pf-warning">'+esc(w)+'</p>').join('')+
        (p.rejected.length?'<details><summary>Ver linhas não importadas</summary><ul>'+p.rejected.slice(0,100).map(r=>'<li>Linha '+r.line+': '+esc(r.reason)+'</li>').join('')+'</ul></details>':'')+
        (result.updated?'<p class="pf-warning">As '+result.updated+' operações identificadas pelos mesmos horários, ativo e lado terão seus valores atualizados.</p>':'')+
        '<button class="btn btn-primary" data-action="confirm-import"'+(!ready?' disabled':'')+'>Importar e analisar</button></section>';
    }
    function emptyMarkup(){
        return '<div class="pf-empty pf-card"><div class="pf-empty-mark" aria-hidden="true">↗</div><span class="pf-eyebrow">SEU HISTÓRICO É O PONTO DE PARTIDA</span><h3>O resultado mostra o que aconteceu.<br>A revisão ajuda a entender como.</h3><p>Importe o relatório de operações do Profit com Abertura, Fechamento e Res. Operação. A cada novo arquivo, o histórico se completa sem repetir trades.</p><button class="btn btn-primary" data-action="import">Escolher exportação do Profit</button><div class="pf-empty-topics"><span>01 · Ritmo e pausas</span><span>02 · Reação às perdas</span><span>03 · Compromissos para amanhã</span></div></div>';
    }
    function alertMarkup(a,m){
        if(!a.alerts.length)return '<div class="pf-good"><strong>Nenhum sinal pelas regras atuais.</strong><p>Revise também a qualidade dos setups. Ausência de alertas não garante disciplina.</p></div>';
        return a.alerts.map(x=>'<article class="pf-signal"><div><span class="pf-signal-mark" aria-hidden="true"></span><h4>'+esc(x.title)+'</h4></div><p>'+esc(x.detail)+'</p><label class="pf-context">Minha leitura<select data-context="'+x.id+'">'+selectOptions([['pending','Ainda vou revisar'],['confirmed','Reconheço esse padrão'],['planned','Fazia parte do meu plano']],m.reviews[day]?.contexts?.[x.id]||'pending')+'</select></label></article>').join('');
    }
    function reviewMarkup(m){
        const r=m.reviews[day]||{};
        return '<section class="pf-card"><div class="pf-section-title"><h3>Revisão consciente</h3><span class="pf-badge">Salva ao preencher</span></div><p class="pf-muted">Dê contexto aos números. Reconhecer o comportamento ajuda a escolher uma ação concreta.</p>'+
        '<form id="pfReview"><div class="pf-form-grid">'+
        ['before','after'].map((k,i)=>'<label>Estado '+(i?'depois':'antes')+' do pregão<select data-review="'+k+'">'+selectOptions([['','Não informado'],['calm','Calmo e presente'],['anxious','Ansioso'],['frustrated','Frustrado'],['euphoric','Eufórico'],['tired','Cansado']],r[k]||'')+'</select></label>').join('')+
        '<label>Energia<select data-review="energy">'+selectOptions([['','Não informada'],['1','1 · Muito baixa'],['2','2 · Baixa'],['3','3 · Regular'],['4','4 · Boa'],['5','5 · Alta']],r.energy||'')+'</select></label>'+
        '<label>Vontade de recuperar perda<select data-review="urge">'+selectOptions([['','Não informada'],...Array.from({length:11},(_,i)=>[String(i),i+' / 10'])],r.urge??'')+'</select></label></div>'+
        '<label>Executei somente setups do meu plano?<select data-review="setup">'+selectOptions([['','Ainda não avaliei'],['yes','Sim'],['partial','Parcialmente'],['no','Não']],r.setup||'')+'</select></label>'+
        [['good','O que fiz bem e quero repetir','Ex.: respeitei a pausa mesmo após perder.'],['trigger','Qual foi o gatilho do meu principal erro?','Situação → pensamento → emoção → ação.'],['lesson','Qual ação substitui esse erro?','Ex.: se sentir urgência de recuperar, sair da tela e rever meu checklist.']].map(([k,l,p])=>'<label>'+l+'<textarea data-review="'+k+'" maxlength="4000" rows="3" placeholder="'+p+'">'+esc(r[k]||'')+'</textarea></label>').join('')+
        '<p class="pf-muted" id="pfReviewSaved">'+(r.updated?'Revisão salva neste navegador.':'Preencha para iniciar sua revisão.')+'</p></form></section>';
    }
    function planMarkup(a,m){
        const planChecks=A.analyzeDay(trades(),day,m.settings,m.annotations).checks;
        const draft=planDrafts[account+'|'+day]||{},target=draft.target||A.nextWeekday(day), existing=m.plans[target], chosen=draft.items||existing?.items||planChecks.filter(c=>c.pass===false).map(c=>c.id);
        const focus=draft.focus??existing?.focus??'';
        return '<section class="pf-card"><span class="pf-eyebrow">INTENÇÃO EM AÇÃO</span><h3>Meu compromisso para o próximo pregão</h3><p class="pf-muted">Escolha poucas ações observáveis. Ritmo e limites são conferidos pelo CSV; setup, R, contratos e stop dependem também da revisão SMC das operações.</p>'+
        '<form id="pfPlan"><label>Data do próximo pregão<input id="pfPlanDate" type="date" value="'+target+'" min="'+A.nextWeekday(day)+'" required></label><p class="pf-small pf-muted">Sugestão pula fins de semana. Ajuste para feriados ou dias sem operar.</p>'+
        '<div class="pf-promises">'+planChecks.map(c=>'<label><input type="checkbox" name="promise" value="'+c.id+'"'+(chosen.includes(c.id)?' checked':'')+'><span>'+esc(c.label)+'</span></label>').join('')+'</div>'+
        '<label>Se eu perceber meu gatilho, então vou…<textarea id="pfFocus" rows="3" maxlength="4000" placeholder="Escreva uma ação específica que depende de você.">'+esc(focus)+'</textarea></label>'+
        '<button class="btn btn-primary" type="submit">Salvar compromisso</button><p class="pf-muted" id="pfPlanSaved">'+(existing?'Existe um compromisso salvo para '+date(target)+'.':'O resultado financeiro não é uma promessa de processo.')+'</p></form></section>';
    }
    function dueMarkup(a,m){
        const p=m.plans[day];if(!p)return '<div class="pf-note">Nenhum compromisso anterior para este dia. Use a revisão para preparar o próximo pregão.</div>';
        const checks=new Map(A.analyzeDay(trades(),day,p.rules,m.annotations).checks.map(c=>[c.id,c]));
        return '<section class="pf-card pf-due"><span class="pf-eyebrow">COMBINADO EM '+date(p.from)+'</span><h3>Compromissos para hoje</h3>'+
        p.items.filter(id=>id!=='focus').map(id=>{const c=checks.get(id);return c?checkRow(c,!a.entries.length&&!a.closed.length):'';}).join('')+
        (p.focus?'<p class="pf-quote">'+esc(p.focus)+'</p><label>Consegui cumprir minha ação pessoal?<select id="pfReflection">'+selectOptions([['','Ainda não avaliei'],['yes','Sim'],['partial','Parcialmente'],['no','Não']],p.reflection||'')+'</select></label>':'')+'</section>';
    }
    function tableMarkup(a,m){
        const rows=[...new Map([...a.closed,...a.entries].map(t=>[t.id,t])).values()].sort((x,y)=>x.open.localeCompare(y.open));
        return '<details class="pf-card pf-table-card"><summary>Operações e evidências <span class="pf-muted">'+rows.length+' registros · ordenados pela abertura</span></summary><p class="pf-muted">Resultado no dia do fechamento; frequência no dia da abertura. A pausa considera o último fechamento conhecido do dia. Perda não significa necessariamente stop.</p><div class="pf-table-scroll"><table><thead><tr><th>Ativo / lado</th><th>Abertura</th><th>Fechamento</th><th>Qtd. negociada</th><th>Pausa</th><th>Resultado</th><th>Evidências / revisão</th></tr></thead><tbody>'+
        rows.map(t=>{const n=m.annotations[t.id]||{},info=a.entryInfo[t.id],gap=info?.gap,smc=A.smcTrade(t,n,a.rules);return '<tr><td><strong>'+esc(t.symbol)+'</strong><small>'+(t.side==='C'?'Compra':'Venda')+'</small></td><td>'+time(t.open)+'<small>'+date(t.open)+'</small></td><td>'+time(t.close)+'<small>'+date(t.close)+'</small></td><td>'+t.qty.toLocaleString('pt-BR')+(t.averaged?'<small>Com preço médio</small>':'')+'</td><td>'+(gap==null?'—':gap<60?Math.round(gap)+' s':(gap/60).toFixed(1)+' min')+'</td><td class="'+tone(t.netCents)+'">'+money(t.netCents)+'<small>'+esc(rformat(smc.realizedR))+' bruto</small></td><td><button class="btn btn-ghost" data-edit-smc="'+esc(t.id)+'">Revisão SMC</button><div class="pf-tags">'+[...(info?.tags||[]),...smc.tags].map(s=>'<span>'+esc(s)+'</span>').join('')+'</div><details><summary>Revisar operação</summary><label>Motivo de saída<select data-trade="'+esc(t.id)+'" data-field="exit">'+selectOptions([['unknown','Não informado pelo CSV'],['stop','Stop confirmado por mim'],['target','Alvo'],['manual','Saída manual'],['breakeven','Breakeven']],n.exit||'unknown')+'</select></label><label>Contexto do trade<textarea rows="2" maxlength="4000" data-trade="'+esc(t.id)+'" data-field="note">'+esc(n.note||'')+'</textarea></label></details></td></tr>';}).join('')+'</tbody></table></div></details>';
    }

    const emotionLabel={calm:'calma / plano',fomo:'medo de perder movimento',revenge:'vontade de recuperar',fear:'medo de devolver ganho',euphoria:'euforia',impatience:'impaciência'};
    const emotionText=s=>Object.entries(s.emotions).map(([k,n])=>n+' × '+emotionLabel[k]).join(' · ')||'Ainda não informados';
    const rformat=v=>v===null?'R pendente':(v>0?'+':'')+v.toLocaleString('pt-BR',{maximumFractionDigits:2})+'R';
    function checkRow(c,noEntries=false){
        const pending=c.pass===null,word=noEntries?'Sem operações':c.applicable===false?'Não aplicável':pending?'Pendente':c.pass?'Cumprido':'Rever';
        return '<div class="pf-due-row"><span class="'+(noEntries||pending?'pf-muted':c.pass?'pf-positive':'pf-negative')+'">'+word+'</span><div>'+esc(c.label)+'<small>'+esc(c.detail)+'</small></div></div>';
    }
    function smcMarkup(a){
        const s=a.smc,missing=s.rows.find(x=>x.realizedR===null),first=missing?.trade||a.closed[0]||a.entries[0];
        return '<section class="pf-card pf-smc"><div class="pf-section-title"><div><span class="pf-eyebrow">MEU MÉTODO · SMC</span><h3>Qualidade da execução, além do resultado</h3></div><span class="pf-badge">Alvo de referência: '+a.rules.minTargetR+'R</span></div>'+
        '<p class="pf-muted">Seu método pede um novo setup, sem entradas consecutivas. A análise de risco compara a execução com o plano original de cada operação.</p>'+
        '<div class="pf-smc-metrics"><div><span>Risco inicial registrado</span><strong>'+s.riskKnown+'<small> / '+a.closed.length+'</small></strong></div><div><span>Ganhos abaixo do alvo, sem exceção</span><strong>'+s.below.length+'<small> / '+s.rows.filter(x=>x.trade.grossCents>0&&x.realizedR!==null).length+' com R</small></strong></div><div><span>Contratos divergentes</span><strong>'+s.contracts.length+'<small> / '+s.entryRows.filter(x=>x.checks.contracts!==null).length+' conferidos</small></strong></div><div><span>Stop fora do plano relatado</span><strong>'+s.stop.length+'<small> / '+s.entryRows.filter(x=>x.checks.stop!==null).length+' conferidos</small></strong></div></div>'+
        '<p class="pf-small pf-muted">'+s.exceptions.length+' saída(s) abaixo do alvo com exceção prevista e justificada. Sem o risco inicial, não há classificação em R. Custos não transformam um ganho bruto de 2R em saída antecipada.</p>'+
        '<p class="pf-small pf-muted"><strong>Relatos emocionais da sessão:</strong> '+esc(emotionText(s))+'. São relatos seus, não inferências do CSV.</p><details><summary>Conferir critérios SMC <span class="pf-muted">Pendências não são acertos nem falhas</span></summary>'+s.checks.map(c=>checkRow(c)).join('')+'</details>'+
        (first?'<button class="btn btn-primary" data-edit-smc="'+esc(first.id)+'">Revisar plano de uma operação</button>':'')+'</section>';
    }
    function coachMarkup(a){
        const tips=A.coaching(a);
        return '<section class="pf-card pf-coaching"><span class="pf-eyebrow">EVIDÊNCIA → REFLEXÃO → AÇÃO</span><h3>Treino comportamental do próximo pregão</h3><p class="pf-muted">Hipóteses para você investigar. A causa emocional só é confirmada com seu relato e o contexto do trade.</p>'+
        tips.map((tip,i)=>'<details'+(i===0?' open':'')+'><summary>'+esc(tip.title)+'</summary><p>'+esc(tip.evidence)+'</p><p class="pf-coach-question">'+esc(tip.question)+'</p><p class="pf-quote">'+esc(tip.action)+'</p><button class="btn btn-ghost" data-adopt-coach="'+i+'">Levar ao próximo pregão</button></details>').join('')+'</section>';
    }
    function smcEvolutionMarkup(reports){
        return '<section class="pf-card pf-table-card"><h3>Evolução da execução SMC</h3><p class="pf-muted">Compare desvios junto com a cobertura das revisões. Zero desvios com risco pendente não comprova execução correta. R usa o risco inicial total informado por você.</p><div class="pf-table-scroll"><table><thead><tr><th>Pregão</th><th>R conhecido</th><th>R bruto médio*</th><th>Alvo planejado curto</th><th>Ganho abaixo do alvo**</th><th>Contratos divergentes</th><th>Stop fora do plano</th><th>Sem novo setup</th><th>Relatos emocionais</th></tr></thead><tbody>'+
        reports.slice().reverse().map(a=>{const s=a.smc,known=s.rows.filter(x=>x.realizedR!==null);return '<tr><td><button class="pf-link" data-day="'+a.day+'">'+date(a.day)+'</button></td><td>'+s.riskKnown+'/'+a.closed.length+'</td><td>'+rformat(known.length?known.reduce((n,x)=>n+x.realizedR,0)/known.length:null)+'</td><td>'+s.lowTarget.length+'</td><td>'+s.below.length+'</td><td>'+s.contracts.length+'</td><td>'+s.stop.length+'</td><td>'+s.noSetup.length+'</td><td>'+esc(emotionText(s))+'</td></tr>';}).join('')+'</tbody></table></div><p class="pf-small pf-muted">* Média apenas das operações com risco registrado. ** Sem exceção prevista e justificada; usa o alvo de referência salvo em cada dia. As contagens de alvo, contratos, stop e setup seguem a data da entrada; R realizado segue a data do fechamento.</p></section>';
    }
    function openSMC(id){
        const t=trades().find(x=>x.id===id);if(!t)return;
        const n=A.annotation(meta().annotations[id]),dialog=$('pfSMCDialog');
        const field=(name,label,options)=>'<label>'+label+'<select name="'+name+'">'+selectOptions(options,n[name])+'</select></label>';
        const cash=(name,label)=>'<label>'+label+'<input name="'+name+'" inputmode="decimal" autocomplete="off" value="'+(n[name]===null?'':esc((n[name]/100).toLocaleString('pt-BR',{minimumFractionDigits:2,maximumFractionDigits:2})))+'" placeholder="Não informado"></label>';
        const qty=(name,label)=>'<label>'+label+'<input name="'+name+'" type="number" min="1" max="1000000" step="1" value="'+(n[name]??'')+'" placeholder="Não informado"></label>';
        dialog.innerHTML='<form id="pfSMCForm" data-id="'+esc(id)+'"><div class="pf-section-title"><div><span class="pf-eyebrow">REVISÃO POR OPERAÇÃO</span><h3 id="pfSMCTitle">'+esc(t.symbol)+' · '+date(t.open)+' '+time(t.open)+'</h3></div><button class="btn btn-ghost" type="button" data-action="close-smc" aria-label="Fechar revisão SMC">Fechar</button></div>'+
        '<p class="pf-note">Informe o plano original. Não use o prejuízo ocorrido como substituto do risco inicial. Este é um relato de revisão; o CSV não comprova quando o plano foi definido.</p>'+
        '<fieldset><legend>1. Setup e intenção</legend><div class="pf-form-grid">'+
        field('newSetup','Havia um novo setup independente?',[['unknown','Ainda não conferi'],['yes','Sim, novo setup do meu plano'],['no','Não, reentrei sem novo setup']])+
        field('emotion','O que influenciou minha decisão?',[['unknown','Ainda não identifiquei'],['calm','Calma / execução do plano'],['fomo','Medo de perder o movimento'],['revenge','Vontade de recuperar'],['fear','Medo de devolver o ganho'],['euphoria','Euforia / excesso de confiança'],['impatience','Impaciência / vontade de operar']])+
        '</div><label>Nome do setup<input name="setupName" maxlength="200" value="'+esc(n.setupName)+'" placeholder="Ex.: retorno ao POI com confirmação"></label><label>Qual estrutura, invalidação e gatilho justificaram a entrada?<textarea name="setupEvidence" rows="2" maxlength="4000">'+esc(n.setupEvidence)+'</textarea></label></fieldset>'+
        '<fieldset><legend>2. Risco, alvo e contratos</legend><div class="pf-form-grid">'+cash('riskCents','Risco inicial total da posição (R$ = 1R)')+cash('targetCents','Alvo financeiro planejado total (R$)')+qty('plannedQty','Contratos planejados na entrada')+qty('entryQty','Contratos efetivos na entrada (confirmados)')+
        field('execution','Como a operação foi executada?',[['unknown','Não conferi a composição'],['simple','Uma entrada e uma saída, sem parciais'],['scaled','Parciais, adições ou execução escalonada']])+
        field('earlyReason','Motivo de saída positiva abaixo do alvo',[['unknown','Não se aplica / não investiguei'],['planned','Exceção já prevista no plano'],['fear','Medo de devolver o ganho'],['recover','Queria recuperar / garantir algum lucro'],['manual','Outra decisão fora do plano']])+'</div>'+
        '<p class="pf-small pf-muted">CSV: '+t.qty+' contratos negociados no agregado. Só usamos esse número como quantidade de entrada se você confirmar execução simples. Em parciais/adições, confira a quantidade inicial no histórico de ordens.</p>'+
        '<label>Qual exceção previa sair abaixo do alvo, e qual evidência a ativou?<textarea name="exception" rows="2" maxlength="4000">'+esc(n.exception)+'</textarea></label></fieldset>'+
        '<fieldset><legend>3. Invalidação e gestão do stop</legend><div class="pf-form-grid">'+
        field('stopBasis','Onde estava o stop inicial?',[['unknown','Não conferi no gráfico'],['structure','Na invalidação estrutural do meu plano'],['arbitrary','Sem base estrutural / mal posicionado']])+
        field('stopChange','O stop foi alterado?',[['unknown','Não conferi no histórico'],['unchanged','Mantido no lugar planejado'],['planned','Alterado por regra prevista no plano'],['tightened','Encurtado fora do plano'],['widened','Afastado fora do plano'],['removed','Removido fora do plano']])+
        field('exit','Motivo de saída',[['unknown','Não informado'],['stop','Stop confirmado por mim'],['target','Alvo'],['manual','Saída manual'],['breakeven','Breakeven']])+'</div>'+
        '<label>Se alterou pelo plano, qual regra autorizava e qual foi o gatilho?<textarea name="stopReason" rows="2" maxlength="4000">'+esc(n.stopReason)+'</textarea></label>'+
        '<label>Minha leitura e ação de melhoria<textarea name="note" rows="3" maxlength="4000">'+esc(n.note)+'</textarea></label></fieldset>'+
        '<div id="pfSMCPreview" class="pf-note" aria-live="polite"></div><p id="pfSMCError" class="pf-error" role="alert"></p><div class="pf-dialog-actions"><button class="btn btn-ghost" type="button" data-action="close-smc">Cancelar</button><button class="btn btn-primary" type="submit">Salvar revisão SMC</button></div></form>';
        dialog.showModal();previewSMC();
    }
    function readSMCForm(){
        const form=$('pfSMCForm'),values=Object.fromEntries(new FormData(form).entries());
        for(const k of ['riskCents','targetCents']){
            const raw=values[k].trim(),v=raw?A.numberBR(raw):null;
            if(raw&&(v===null||v<=0||!/^[+-]?(?:\d{1,3}(?:\.\d{3})+|\d+)(?:,\d{1,2})?$/.test(raw)))throw new Error('Informe risco e alvo positivos em reais, com vírgula e até duas casas decimais.');
            values[k]=v===null?null:Math.round(v*100);
        }
        for(const k of ['plannedQty','entryQty'])values[k]=values[k].trim()?Number(values[k]):null;
        return A.annotation(values);
    }
    function previewSMC(){
        const f=$('pfSMCForm');if(!f)return;
        try{
            const n=readSMCForm(),t=trades().find(x=>x.id===f.dataset.id),x=A.smcTrade(t,n,dayRules(day));
            $('pfSMCPreview').textContent='R bruto realizado: '+rformat(x.realizedR)+' · R líquido: '+rformat(x.netR)+' · Alvo planejado: '+rformat(x.plannedR)+'. '+(x.quantityConflict?'Quantidade incompatível com execução simples; confira os contratos.':x.tags.join(' · ')||'Nenhum desvio identificado nos dados preenchidos; confira as pendências.');
            $('pfSMCError').textContent='';
        }catch(e){$('pfSMCPreview').textContent='Prévia aguardando valores válidos.';$('pfSMCError').textContent=e.message;}
    }

    function dayMarkup(a,m){
        return '<div class="pf-kpis"><article class="pf-card"><span>Disciplina de ritmo e limites</span><strong>'+(a.score===null?'—':a.score+'<small>/100</small>')+'</strong><p>'+(a.rules.configured?'Regras personalizadas':'Referência inicial · personalize as regras')+'</p></article>'+
        '<article class="pf-card"><span>Resultado realizado</span><strong class="'+tone(a.pnl)+'">'+money(a.pnl)+'</strong><p>'+a.wins+' ganhos · '+a.losses+' perdas · '+a.breakeven+' no zero</p></article>'+
        '<article class="pf-card"><span>Ritmo da sessão</span><strong>'+a.entries.length+'<small> entradas</small></strong><p>'+a.afterLoss.length+' sem a pausa após perda</p></article>'+
        '<article class="pf-card"><span>Maior sequência de perdas</span><strong>'+a.maxStreak+'<small> seguidas</small></strong><p>'+a.maxStopStreak+' stops consecutivos confirmados por você</p></article></div>'+
        dueMarkup(a,m)+smcMarkup(a)+
        '<div class="pf-columns"><div class="pf-stack"><section class="pf-card"><div class="pf-section-title"><h3>O caminho do resultado</h3><span class="pf-badge">Por fechamento</span></div>'+chart(a.curve.map((p,i)=>({value:p.value,label:i===0?'Início':time(p.time)})),'Resultado realizado de '+date(day))+
        '<div class="pf-stat-row"><div><span>Pico realizado</span><strong>'+money(a.peak)+'</strong></div><div><span>Devolução do pico</span><strong>'+money(a.giveback)+(a.peak>0?' <small>('+Math.round(a.givebackPct)+'%)</small>':'')+'</strong></div><div><span>Manhã / tarde</span><strong><span class="'+tone(a.morning)+'">'+money(a.morning)+'</span> / <span class="'+tone(a.afternoon)+'">'+money(a.afternoon)+'</span></strong></div></div>'+
        '<p class="pf-small pf-muted">Tarde a partir de '+a.rules.afternoon+'. A curva mostra resultados realizados; não inclui flutuação de posições abertas.</p></section>'+
        '<section class="pf-card"><div class="pf-section-title"><div><h3>Padrões para investigar</h3><p class="pf-muted">O número é uma evidência. A intenção precisa da sua revisão.</p></div><span class="pf-badge">'+a.alerts.length+' sinais</span></div>'+alertMarkup(a,m)+'</section>'+
        '<details class="pf-card"><summary>Como a nota de ritmo é calculada</summary><p class="pf-muted">As regras de ritmo abaixo têm o mesmo peso. Setup, alvo, contratos e stop são avaliados separadamente no painel SMC, com pendências explícitas. A nota não mede saúde mental nem competência profissional.</p>'+
        a.timingChecks.map(c=>'<div class="pf-due-row"><span class="'+(c.pass?'pf-positive':'pf-negative')+'">'+(c.pass?'Dentro':'Rever')+'</span><div>'+esc(c.label)+'<small>'+esc(c.detail)+'</small></div></div>').join('')+
        '<p class="pf-small pf-muted">Limites de perda e sequência usam resultados já encerrados antes de cada entrada. O módulo avalia o histórico importado; não bloqueia ordens no Profit.</p></details></div>'+
        '<div class="pf-stack">'+coachMarkup(a)+reviewMarkup(m)+planMarkup(a,m)+'</div></div>'+tableMarkup(a,m);
    }
    function evolutionMarkup(days,m){
        const reports=days.map(analysis),active=reports.filter(a=>a.entries.length),last=active.slice(-5),before=active.slice(-10,-5);
        const avg=xs=>xs.length?Math.round(xs.reduce((n,x)=>n+x.score,0)/xs.length):null;
        const rate=xs=>{const n=xs.reduce((n,x)=>n+x.entries.length,0);return n?Math.round(xs.reduce((n,x)=>n+x.afterLoss.length,0)/n*100):0;};
        const score=avg(last),previous=avg(before),enough=last.length>=2&&before.length>=2;
        const counts=new Map();reports.forEach(a=>a.alerts.forEach(x=>counts.set(x.id,{title:x.title,count:(counts.get(x.id)?.count||0)+1})));
        let fulfilled=0,evaluated=0,pending=0,reviewPending=0;
        for(const [d,p] of Object.entries(m.plans)){
            if(!days.includes(d)||!analysis(d).entries.length){pending++;continue;}
            const checks=new Map(A.analyzeDay(trades(),d,p.rules,m.annotations).checks.map(c=>[c.id,c]));
            p.items.filter(id=>id!=='focus').forEach(id=>{const c=checks.get(id);if(c){if(c.pass===null){if(c.applicable!==false)reviewPending++;}else{evaluated++;if(c.pass)fulfilled++;}}});
        }
        return '<div class="pf-kpis"><article class="pf-card"><span>Pregões importados</span><strong>'+days.length+'</strong><p>'+Object.keys(m.reviews).filter(d=>days.includes(d)).length+' com revisão iniciada</p></article><article class="pf-card"><span>Ritmo e limites · últimos '+last.length+' dias</span><strong>'+(score??'—')+'<small>/100</small></strong><p>'+(enough?(score-previous>=0?'+':'')+(score-previous)+' pontos vs. '+before.length+' dias anteriores':'Comparação disponível com ao menos 7 pregões')+'</p></article><article class="pf-card"><span>Entradas sem pausa após perda</span><strong>'+rate(last)+'<small>%</small></strong><p>'+(enough?rate(before)+'% no grupo anterior':'Proporção nos últimos pregões')+'</p></article><article class="pf-card"><span>Compromissos observáveis cumpridos</span><strong>'+fulfilled+'<small>/'+evaluated+'</small></strong><p>'+reviewPending+' critérios pendentes de revisão · '+pending+' plano(s) aguardando operações do dia</p></article></div>'+
        '<section class="pf-card"><div class="pf-section-title"><h3>Evolução do ritmo e dos limites</h3><span class="pf-muted">Processo independente do lucro</span></div>'+chart(active.map(a=>({value:a.score,label:date(a.day)})),'Aderência às regras por pregão',true)+'<p class="pf-muted">Cada dia usa suas regras salvas; dias ainda sem revisão usam as regras atuais. Mudanças no plano podem afetar a comparação. Só são avaliadas as operações importadas.</p></section>'+
        smcEvolutionMarkup(reports)+'<div class="pf-columns"><section class="pf-card"><h3>Padrões recorrentes</h3>'+([...counts.values()].sort((a,b)=>b.count-a.count).map(x=>'<div class="pf-pattern-row"><span>'+esc(x.title)+'</span><div class="pf-bar"><i style="width:'+Math.round(x.count/days.length*100)+'%"></i></div><strong>'+x.count+' dias</strong></div>').join('')||'<p class="pf-muted">Nenhum sinal nas regras atuais.</p>')+'</section>'+
        '<section class="pf-card"><h3>Compromissos agendados</h3>'+ (Object.entries(m.plans).sort(([a],[b])=>b.localeCompare(a)).map(([d,p])=>'<div class="pf-plan-history"><strong>'+date(d)+'</strong><span>'+p.items.filter(x=>x!=='focus').length+' regras · '+(days.includes(d)?'histórico disponível':'aguarda importação')+'</span><p>'+esc(p.focus||'Foco nas regras selecionadas.')+'</p></div>').join('')||'<p class="pf-muted">Crie seu primeiro compromisso na revisão diária.</p>')+'</section></div>'+
        '<section class="pf-card pf-table-card"><h3>Histórico dia a dia</h3><div class="pf-table-scroll"><table><thead><tr><th>Pregão</th><th>Resultado</th><th>Ritmo e limites</th><th>Entradas</th><th>Sem pausa após perda</th><th>Perdas seguidas</th><th>Devolução à tarde</th><th>Revisão</th></tr></thead><tbody>'+
        reports.slice().reverse().map(a=>'<tr><td><button class="pf-link" data-day="'+a.day+'">'+date(a.day)+'</button></td><td class="'+tone(a.pnl)+'">'+money(a.pnl)+'</td><td>'+(a.score===null?'—':a.score+'%')+'</td><td>'+a.entries.length+'</td><td>'+a.afterLoss.length+'</td><td>'+a.maxStreak+'</td><td>'+money(a.afternoonGiveback)+'</td><td>'+(m.reviews[a.day]?'Iniciada':'Pendente')+'</td></tr>').join('')+'</tbody></table></div></section>';
    }

    const deskReport=()=>D.report({trades:trades(),day,settings:meta().settings,annotations:meta().annotations,reviews:meta().reviews,plans:meta().plans});
    function deskMarkup(m){
        const d=deskReport(),a=d.a,rv=d.saved;
        const badge=d.reviewed?'Debrief concluído':d.stale?'Dados mudaram · reconferir':'Debrief pendente';
        const levels={critical:'Quebra de controle relatada ou limite confirmado',deviation:'Desvio a revisar',pending:'Evidência incompleta',review:'Verificação de processo'};
        const nextPlans=Object.entries(m.plans).filter(([target,p])=>target>day&&p.from===day);
        return '<section class="pf-card pf-desk-verdict pf-desk-'+d.status+'"><div class="pf-section-title"><div><span class="pf-eyebrow">MESA · REUNIÃO DE FECHAMENTO · '+date(day)+'</span><h2>'+esc(d.title)+'</h2></div><span class="pf-badge" id="pfDeskBadge">'+badge+'</span></div>'+
        '<p class="pf-desk-lead">'+esc(d.opening)+'</p><p class="pf-desk-result">'+esc(d.resultReading)+'</p>'+
        '<div class="pf-desk-numbers"><div><span>Operações sinalizadas</span><strong>'+d.flaggedCount+'<small> / '+d.coverage.total+'</small></strong></div><div><span>Revisão SMC suficiente</span><strong>'+d.coverage.complete+'<small> / '+d.coverage.total+'</small></strong></div><div><span>Resultado da sessão</span><strong class="'+tone(a.pnl)+'">'+money(a.pnl)+'</strong></div></div>'+
        (!a.rules.configured?'<p class="pf-small pf-muted">Intervalo de 10 min e referência de 2R confirmados no seu plano. Os demais limites ainda são referências iniciais; revise-os em “Regras do meu plano”.</p>':'')+
        '<p class="pf-small pf-muted">Parecer de processo calculado localmente por regras e relatos. Não é avaliação clínica nem autorização ou bloqueio de ordens no Profit.</p></section>'+
        '<div class="pf-desk-columns"><div class="pf-stack"><section class="pf-card"><span class="pf-eyebrow">ANÁLISE DA SESSÃO</span><h3>O que a mesa está cobrando</h3>'+
        d.chapters.map((c,i)=>'<details class="pf-desk-chapter"'+(c.id===d.priority.id?' open':'')+'><summary><span class="pf-desk-index">'+String(i+1).padStart(2,'0')+'</span>'+esc(c.title)+'<span class="pf-badge">'+levels[c.level]+'</span></summary>'+
        '<div class="pf-desk-evidence"><span>O que está documentado</span><p>'+esc(c.facts)+'</p></div><div class="pf-desk-hypothesis"><span>Hipótese para investigar</span><p>'+esc(c.hypothesis)+'</p></div>'+
        '<p class="pf-small pf-muted">'+esc(c.alternatives)+'</p><div class="pf-desk-demand"><span>Cobrança para o próximo pregão</span><p>'+esc(c.demand)+'</p><small><strong>Como comprovar:</strong> '+esc(c.proof)+'</small></div></details>').join('')+'</section>'+
        '<section class="pf-card"><div class="pf-section-title"><div><span class="pf-eyebrow">RECONSTRUÇÃO DE DECISÕES</span><h3>Episódios que exigem explicação</h3></div><span class="pf-badge">Até 4 episódios prioritários</span></div>'+
        (d.episodes.length?d.episodes.map((x,i)=>'<article class="pf-desk-episode"><div class="pf-section-title"><h4>'+String(i+1).padStart(2,'0')+' · '+esc(x.symbol)+' · '+time(x.at)+'</h4><button class="pf-link" data-edit-smc="'+esc(x.id)+'">Revisar trade</button></div>'+
        '<p><strong>Antes da entrada.</strong> '+esc(x.trigger)+' '+esc(x.context)+'</p><p><strong>Decisão.</strong> '+esc(x.decision)+'</p><div class="pf-tags">'+x.facts.map(f=>'<span>'+esc(f)+'</span>').join('')+'</div><p><strong>Desfecho observado.</strong> '+esc(x.outcome)+'</p><p class="pf-coach-question">'+esc(x.question)+'</p>'+
        (x.report?'<p class="pf-quote"><strong>Seu relato:</strong> '+esc(x.report)+'</p>':'')+
        '<button class="btn btn-ghost" data-desk-episode="'+i+'">Usar este episódio no debrief</button></article>').join(''):'<p class="pf-muted">Nenhuma entrada sinalizada nesses critérios. Complete as revisões pendentes para sustentar a conclusão.</p>')+'</section>'+
        '<section class="pf-card"><h3>Reincidência e evolução observável</h3><p class="pf-muted">Até '+d.historyCount+' pregões importados, somente até '+date(day)+'. Ausência de sinal com revisão pendente não comprova melhora.</p>'+
        d.recurrence.map(x=>'<div class="pf-pattern-row"><span>'+esc(x.label)+'</span><div class="pf-bar"><i style="width:'+(x.total?Math.round(x.days/x.total*100):0)+'%"></i></div><strong>'+x.days+'/'+x.total+' dias</strong></div>'+(x.streak>1?'<p class="pf-small pf-negative">Repetido nos últimos '+x.streak+' pregões importados.</p>':'')).join('')+
        '<p class="pf-note">'+(d.trend?'Entradas consecutivas: '+Math.round(d.trend.current*100)+'% das entradas nos últimos '+d.trend.currentDays+' dias, contra '+Math.round(d.trend.previous*100)+'% nos '+d.trend.previousDays+' anteriores. Variação: '+(d.trend.deltaPoints>0?'+':'')+d.trend.deltaPoints+' pontos percentuais. Isso descreve frequência; não prova a causa emocional.':'Amostra inicial: a comparação entre grupos aparece com pelo menos 3 pregões em cada grupo. Ainda não há base para afirmar tendência.')+'</p>'+
        '<p class="pf-small pf-muted">Nos '+d.commitments.days+' dias anteriores com compromissos: '+d.commitments.met+' critérios cumpridos, '+d.commitments.failed+' descumpridos e '+d.commitments.pending+' pendentes de evidência.</p></section>'+
        '<section class="pf-card"><h3>Condutas que merecem ser mantidas</h3>'+(d.strengths.length?'<ul>'+d.strengths.map(x=>'<li>'+esc(x)+'</li>').join('')+'</ul>':'<p class="pf-muted">A documentação atual ainda não permite destacar uma conduta positiva verificável.</p>')+'</section></div>'+
        '<div class="pf-stack"><section class="pf-card pf-desk-priority"><span class="pf-eyebrow">PRIORIDADE DA PRÓXIMA SESSÃO</span><h3>'+esc(d.priority.title)+'</h3><p>'+esc(d.priority.demand)+'</p><p class="pf-quote">'+esc(d.priority.proof)+'</p><button class="btn btn-primary" data-action="desk-plan">Preparar compromisso cobrado</button><p class="pf-small pf-muted">O diário cobra uma ação que pode ser verificada, não uma promessa de lucro.</p></section>'+
        '<section class="pf-card"><h3>Fechamento responsável da sessão</h3><ol>'+d.pendingSteps.map(x=>'<li>'+esc(x.label)+'</li>').join('')+'</ol><p class="pf-small pf-muted">Concluir o debrief registra sua revisão. Não muda um desvio para “cumprido” nem elimina as pendências do parecer.</p></section>'+
        '<section class="pf-card"><span class="pf-eyebrow">SUA RESPOSTA À MESA</span><h3>Debrief: explique a decisão e a correção</h3>'+
        (d.stale?'<p class="pf-warning">Os dados ou o plano mudaram desde a conclusão. Releia o parecer e conclua novamente após conferir.</p>':'')+
        '<form id="pfDeskForm">'+[
            ['moment','Qual foi o momento exato em que sua decisão saiu do plano?','Horário, trade e fato externo. Se não houve desvio, descreva uma decisão bem executada.'],
            ['thought','Qual pensamento apareceu naquele instante?','Escreva a frase que passou pela sua cabeça, sem explicar pelo resultado posterior.'],
            ['feeling','Que emoção ou sensação você percebeu?','Seu relato, sem tentar adivinhar o que deveria ter sentido.'],
            ['choice','O que você decidiu fazer, e qual regra usou ou deixou de cumprir?','Assuma a decisão específica; evite atribuir toda a explicação ao mercado.'],
            ['alternative','Qual decisão alternativa respeitaria seu plano?','O que faria naquele mesmo momento, com a informação disponível na época?'],
            ['action','Qual será sua resposta concreta ao mesmo gatilho amanhã?','Se acontecer X, farei Y antes de enviar a próxima ordem.'],
            ['proof','Que evidência permitirá cobrar o cumprimento?','Ex.: nenhum intervalo abaixo de 10 min; setup e risco registrados em todas as entradas.']
        ].map(([k,label,placeholder])=>'<label>'+label+'<textarea name="'+k+'" rows="3" maxlength="4000" placeholder="'+placeholder+'">'+esc(rv[k])+'</textarea></label>').join('')+
        '<p class="pf-small pf-muted" id="pfDeskSaved">'+(d.reviewed?'Debrief concluído e compatível com os dados atuais.':rv.updated?'Rascunho salvo neste navegador.':'O rascunho é salvo ao preencher.')+'</p>'+
        '<label class="pf-desk-ack"><input id="pfDeskAck" type="checkbox"><span>Conferi os fatos, distingui minhas hipóteses e defini uma ação verificável.</span></label>'+
        '<p class="pf-small pf-muted" id="pfDeskPlanHint">'+(nextPlans.length?'Compromisso salvo para '+nextPlans.map(([target])=>date(target)).join(', ')+'.':'Salve abaixo o compromisso do próximo pregão antes de concluir o debrief.')+'</p>'+
        '<p id="pfDeskError" class="pf-error" role="alert"></p><button class="btn btn-primary" type="submit">Concluir debrief</button></form></section>'+
        planMarkup(a,m)+'</div></div>';
    }
    function saveDeskDraft(){
        const form=$('pfDeskForm');if(!form)return false;
        const values=Object.fromEntries(new FormData(form).entries()),draft=D.debrief({...values,updated:new Date().toISOString(),completed:false,signature:''});
        const ok=changeAccount(m=>{m.reviews[day]||={rules:{...dayRules(day)},contexts:{}};m.reviews[day].desk=draft;});
        if(ok){$('pfDeskSaved').textContent='Rascunho salvo. Confira e conclua após revisar.';$('pfDeskBadge').textContent='Debrief em rascunho';}
        else $('pfDeskError').textContent='Não foi possível salvar o rascunho. Mantenha esta tela aberta e faça um backup.';
        return ok;
    }

    function render(force=false){
        if(!mounted||(!force&&$('pfCSV')))return; // Resizes must not replace focused forms.
        const days=A.dates(trades()),m=meta();if(day&&!days.includes(day))day=days.at(-1)||'';
        const accounts=[...new Set(data.trades.map(t=>t.account))];
        let body=headerMarkup()+previewMarkup();
        if(!days.length)body+=emptyMarkup();
        else {
            body+='<div class="pf-filters"><label>Conta do Profit<select id="pfAccount">'+selectOptions(accounts.map(a=>[a,masked(a)]),account)+'</select></label><label>Pregão<select id="pfDay">'+selectOptions(days.slice().reverse().map(d=>[d,date(d)]),day)+'</select></label><div class="pf-tabs" role="group" aria-label="Visão Profit"><button data-tab="desk" aria-pressed="'+(tab==='desk')+'" class="'+(tab==='desk'?'active':'')+'">Mesa</button><button data-tab="day" aria-pressed="'+(tab==='day')+'" class="'+(tab==='day'?'active':'')+'">Revisão diária</button><button data-tab="evolution" aria-pressed="'+(tab==='evolution')+'" class="'+(tab==='evolution'?'active':'')+'">Evolução</button></div></div>'+settingsMarkup();
            body+='<p class="pf-note">Plano SMC declarado: esperar um novo setup e buscar o alvo mínimo definido no plano (referência inicial de 2R). Entradas consecutivas são um sinal de desvio do método. Risco, contratos de entrada e gestão do stop precisam da sua revisão; os números não revelam a intenção.</p>';
            if(trades().every(t=>t.feeCents===0))body+='<p class="pf-small pf-muted">Comissões zeradas no histórico importado. Custos não exportados pelo Profit não entram no resultado.</p>';
            body+=tab==='desk'?deskMarkup(m):tab==='day'?dayMarkup(analysis(day),m):evolutionMarkup(days,m);
            body+='<details class="pf-card pf-method"><summary>Importação e critérios de leitura</summary><p>Datas e horários são mantidos como exportados pelo Profit, sem conversão de fuso. O resultado diário considera o fechamento. Entradas, pausas e limites consideram a abertura e apenas perdas já conhecidas naquele instante.</p><p>Res. Operação é o resultado bruto por operação. Descontamos o valor absoluto de Comissões, quando presente. A coluna Total é acumulada e não é somada. TET não é usado como intervalo. Qtd Compra/Venda é volume agregado, não risco ou exposição máxima.</p><p>Uma operação é identificada por conta, ativo, abertura, fechamento e lado. Reimportações idênticas são ignoradas; valores corrigidos são mostrados antes da atualização. Alterar os horários no arquivo gera outra identidade. Operações abertas e linhas inválidas não entram na análise.</p><p>O resultado descreve apenas os arquivos importados. Não infere motivo de saída, intenção, stop planejado nem lucro potencial. Acompanhamento comportamental não garante desempenho financeiro.</p>'+
            '<h4>Últimas importações neste perfil</h4>'+data.imports.slice(-5).reverse().map(x=>'<p>'+esc(x.name)+' · '+x.count+' registros · '+esc(x.at.slice(0,10))+'</p>').join('')+'</details>';
        }
        $('view-profit').innerHTML=body+'<dialog id="pfSMCDialog" aria-labelledby="pfSMCTitle"></dialog>';
    }
    async function readFile(file,isBackup=false){
        if(!file)return;
        if(file.size>(isBackup?20:10)*1024*1024){announce('Arquivo maior que o limite de '+(isBackup?20:10)+' MB.',true);return;}
        const token=++generation,who=owner;busy=true;announce('Lendo '+file.name+'…');
        try{
            const buffer=await file.arrayBuffer();if(token!==generation||owner!==who)return;
            let text;
            const bytes=new Uint8Array(buffer);
            if(bytes[0]===255&&bytes[1]===254)text=new TextDecoder('utf-16le').decode(buffer);
            else if(bytes[0]===254&&bytes[1]===255)text=new TextDecoder('utf-16be').decode(buffer);
            else {try{text=new TextDecoder('utf-8',{fatal:true}).decode(buffer);}catch{text=new TextDecoder('windows-1252').decode(buffer);}}
            if(isBackup){
                const restored=validateBackup(JSON.parse(text));
                if(!confirm('Restaurar este backup substitui somente os dados Trades Profit deste perfil no navegador. Deseja continuar?'))return;
                const previous=ready;ready=true;
                if(commit(restored)){account=[...new Set(data.trades.map(t=>t.account))][0]||'';day=A.dates(trades()).at(-1)||'';stage=null;planDrafts={};announce('Backup restaurado.');render(true);}
                else ready=previous;
            } else {
                const parsed=A.parseCSV(text);if(data.trades.length+parsed.trades.length>100000||A.mergeTrades(data.trades,parsed.trades).trades.length>50000)throw new Error('Limite de 50 mil operações neste perfil.');
                stage={name:file.name,parsed};announce('Confira os dados antes de importar.');render(true);
            }
        }catch(e){announce('Não foi possível importar: '+e.message,true);}
        finally{if(token===generation)busy=false;}
    }
    function download(){
        let content=JSON.stringify(data,null,2);
        if(!ready){try{content=localStorage.getItem(STORAGE+owner)||'';}catch{announce('O navegador bloqueou a leitura do backup.',true);return;}}
        const url=URL.createObjectURL(new Blob([content],{type:'application/json'})),a=document.createElement('a');
        a.href=url;a.download='trades-profit-backup-'+new Date().toISOString().slice(0,10)+'.json';a.click();setTimeout(()=>URL.revokeObjectURL(url),1000);
        announce('Backup gerado com trades, revisões, regras e compromissos deste perfil.');
    }
    function click(e){
        const b=e.target.closest('button');if(!b)return;
        if(b.dataset.deskEpisode!==undefined){const x=deskReport().episodes[Number(b.dataset.deskEpisode)];if(x&&$('pfDeskForm')){$('pfDeskForm').elements.moment.value=x.trigger+' '+x.decision;saveDeskDraft();$('pfDeskForm').scrollIntoView({behavior:'smooth',block:'start'});$('pfDeskForm').elements.thought.focus();}return;}
        if(b.dataset.action==='desk-plan'){const p=deskReport().priority;if($('pfPlan')){$('pfFocus').value=p.demand+' Verificação: '+p.proof;$('pfPlan').querySelectorAll('input[name="promise"]').forEach(x=>x.checked=p.items.includes(x.value));rememberDraft();$('pfPlan').scrollIntoView({behavior:'smooth',block:'center'});$('pfFocus').focus();announce('Compromisso preparado. Revise e salve para confirmar.');}return;}
        if(b.dataset.editSmc){openSMC(b.dataset.editSmc);return;}
        if(b.dataset.adoptCoach!==undefined){const tip=A.coaching(analysis(day))[Number(b.dataset.adoptCoach)];if(tip&&$('pfPlan')){$('pfFocus').value=tip.action;$('pfPlan').querySelectorAll('input[name="promise"]').forEach(x=>x.checked=tip.items.includes(x.value));rememberDraft();$('pfPlan').scrollIntoView({behavior:'smooth',block:'center'});$('pfFocus').focus();announce('Sugestão colocada no compromisso. Revise e salve para confirmar.');}return;}
        if(b.dataset.action==='close-smc'){$('pfSMCDialog').close();return;}
        if(b.dataset.tab){tab=b.dataset.tab;render(true);return;}
        if(b.dataset.day){day=b.dataset.day;tab='day';render(true);return;}
        const action=b.dataset.action;
        if(action==='import')$('pfCSV').click();
        if(action==='restore')$('pfBackup').click();
        if(action==='backup')download();
        if(action==='cancel-import'){stage=null;render(true);}
        if(action==='confirm-import'&&stage){
            const merged=A.mergeTrades(data.trades,stage.parsed.trades),next=JSON.parse(JSON.stringify(data));
            next.trades=merged.trades;const k=accountKey(stage.parsed.account);
            next.accounts[k]||={settings:{...A.DEFAULTS},reviews:{},plans:{},annotations:{}};
            next.imports=[...next.imports,{name:stage.name,at:new Date().toISOString(),count:stage.parsed.trades.length}].slice(-30);
            if(commit(next)){account=stage.parsed.account;day=A.dates(trades()).at(-1);stage=null;announce(merged.added+' novas operações, '+merged.updated+' atualizações e '+merged.duplicates+' repetidas ignoradas.');render(true);}
        }
    }
    function saveReview(key,value){
        if(!account||!day)return;
        const ok=changeAccount(m=>{
            m.reviews[day]||={rules:{...dayRules(day)},contexts:{}};
            if(key.startsWith('context:'))m.reviews[day].contexts[key.slice(8)]=value;
            else m.reviews[day][key]=String(value).slice(0,4000);
            m.reviews[day].updated=new Date().toISOString();
        });
        if(ok&&$('pfReviewSaved'))$('pfReviewSaved').textContent='Revisão salva neste navegador.';
    }
    function rememberDraft(){
        if(!$('pfPlan'))return;
        planDrafts[account+'|'+day]={target:$('pfPlanDate').value,focus:$('pfFocus').value,items:[...$('pfPlan').querySelectorAll('input[name="promise"]:checked')].map(x=>x.value)};
    }
    function input(e){
        if(e.target.closest('#pfDeskForm')){if(e.target.name)saveDeskDraft();return;}
        if(e.target.closest('#pfSMCForm')){previewSMC();return;}
        if(e.target.dataset.review)saveReview(e.target.dataset.review,e.target.value);
        if(e.target.dataset.field==='note')saveAnnotation(e.target);
        if(e.target.closest('#pfPlan'))rememberDraft();
    }
    function saveAnnotation(target){
        const id=target.dataset.trade,field=target.dataset.field;if(!trades().some(t=>t.id===id))return;
        if(changeAccount(m=>{m.annotations[id]||={exit:'unknown',note:''};m.annotations[id][field]=target.value.slice(0,4000);})){
            if(field==='exit'){announce('Motivo de saída salvo. As sequências de stops foram atualizadas.');render(true);}
        }
    }
    function change(e){
        if(e.target.closest('#pfSMCForm')){previewSMC();return;}
        const t=e.target;
        if(t.id==='pfCSV'){readFile(t.files[0]);t.value='';}
        else if(t.id==='pfBackup'){readFile(t.files[0],true);t.value='';}
        else if(t.id==='pfAccount'){account=t.value;day=A.dates(trades()).at(-1)||'';render(true);}
        else if(t.id==='pfDay'){day=t.value;render(true);}
        else if(t.dataset.context)saveReview('context:'+t.dataset.context,t.value);
        else if(t.dataset.review)saveReview(t.dataset.review,t.value);
        else if(t.dataset.field)saveAnnotation(t);
        else if(t.id==='pfReflection'){if(changeAccount(m=>m.plans[day].reflection=t.value))announce('Avaliação do compromisso salva.');}
        else if(t.closest('#pfPlan')){
            if(t.id==='pfPlanDate'){
                const p=meta().plans[t.value];
                if(p){planDrafts[account+'|'+day]={target:t.value,focus:p.focus,items:p.items};render(true);return;}
            }
            rememberDraft();
        }
    }
    function submit(e){
        e.preventDefault();
        if(e.target.id==='pfDeskForm'){
            const values=Object.fromEntries(new FormData(e.target).entries());
            const required=['moment','thought','choice','alternative','action','proof'];
            if(required.some(k=>!String(values[k]||'').trim())){$('pfDeskError').textContent='Complete o episódio, pensamento, decisão, alternativa, ação e evidência de cumprimento.';return;}
            if(!$('pfDeskAck').checked){$('pfDeskError').textContent='Confirme que você conferiu os fatos antes de concluir.';return;}
            if(!Object.entries(meta().plans).some(([target,p])=>target>day&&p.from===day)){$('pfDeskError').textContent='Salve o compromisso para o próximo pregão antes de concluir o debrief.';return;}
            const d=deskReport(),record=D.debrief({...values,completed:true,signature:d.signature,updated:new Date().toISOString()});
            if(changeAccount(m=>{m.reviews[day]||={rules:{...dayRules(day)},contexts:{}};m.reviews[day].desk=record;})){announce('Debrief concluído. Os desvios e as pendências do parecer continuam registrados.');render(true);}else $('pfDeskError').textContent='Não foi possível salvar a conclusão. Tente novamente antes de sair.';return;
        }
        if(e.target.id==='pfSMCForm'){
            try{const id=e.target.dataset.id,n=readSMCForm(),t=trades().find(x=>x.id===id);if(!t)throw new Error('Operação não encontrada neste perfil.');if(A.smcTrade(t,n,dayRules(day)).quantityConflict)throw new Error('A quantidade confirmada não corresponde ao CSV para execução simples. Confira os valores ou marque execução escalonada.');const tableOpen=$('view-profit').querySelector('details.pf-table-card')?.open;if(changeAccount(m=>m.annotations[id]=n)){$('pfSMCDialog').close();announce('Revisão SMC salva. R, contratos, stop e compromissos foram recalculados.');render(true);const table=$('view-profit').querySelector('details.pf-table-card');if(table&&tableOpen)table.open=true;}else $('pfSMCError').textContent='Não foi possível salvar. Seus campos continuam disponíveis nesta janela.';}catch(err){$('pfSMCError').textContent=err.message;}return;
        }
        if(e.target.id==='pfRules'){
            try{
                const entries=Object.fromEntries(new FormData(e.target).entries()),r=A.rules({...meta().settings,...entries,configured:true});
                if(changeAccount(m=>m.settings=r)){announce('Regras salvas. Dias já revisados e planos existentes mantêm suas referências.');render(true);}
            }catch(err){announce(err.message,true);}
        }
        if(e.target.id==='pfPlan'){
            rememberDraft();const d=planDrafts[account+'|'+day],items=[...d.items];
            if(!A.validDay(d.target)||d.target<=day){announce('Escolha uma data posterior ao pregão revisado.',true);return;}
            if(d.focus.trim())items.push('focus');
            if(!items.length){announce('Escolha uma regra ou descreva uma ação concreta.',true);return;}
            if(meta().plans[d.target]&&!confirm('Já existe um compromisso para '+date(d.target)+'. Substituir pelo plano exibido?'))return;
            if(changeAccount(m=>m.plans[d.target]={from:day,rules:{...meta().settings},items,focus:d.focus.trim(),created:new Date().toISOString(),reflection:''})){
                announce('Compromisso salvo para '+date(d.target)+'. Importe esse pregão para conferir o cumprimento.');
                $('pfPlanSaved').textContent='Compromisso salvo para '+date(d.target)+'.';
                if($('pfDeskPlanHint')){$('pfDeskPlanHint').textContent='Compromisso salvo para '+date(d.target)+'.';const report=deskReport();if(report.stale)$('pfDeskBadge').textContent='Plano mudou · reconferir';}
            }
        }
    }
    return {init,render,authChanged,validateBackup};
})();
