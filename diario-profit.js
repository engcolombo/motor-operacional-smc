/* Trades Profit: browser-local records, isolated by diary login and broker account. */
const ProfitTrades = (() => {
    'use strict';
    const A=ProfitAnalysis, D=ProfitDesk, S=ProfitSupervision, J=ProfitJournal, $=id=>document.getElementById(id), STORAGE='diarioProfit_v1_';
    const esc=v=>String(v??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
    const isTV=()=>account==='tradingview:paper:USD';
    const currency=()=>isTV()?'USD':'BRL';
    const sourceName=()=>isTV()?'TradingView':'Profit';
    const money=(c,unit=currency())=>(c/100).toLocaleString('pt-BR',{style:'currency',currency:unit});
    const date=d=>d?d.slice(8,10)+'/'+d.slice(5,7)+'/'+d.slice(0,4):'—';
    const time=d=>d.slice(11,19);
    const tone=n=>n>0?'pf-positive':n<0?'pf-negative':'';
    const blank=()=>({version:1,trades:[],accounts:{},imports:[],journalLinks:{}});
    const accountKey=a=>'account:'+a;
    const masked=a=>a==='tradingview:paper:USD'?'TradingView · Paper Trading · USD':a==='__diary__'?'Diário · sem CSV':a==='sem-conta'?'Sem conta':'Conta ••• '+a.slice(-4);
    let owner=null, data=blank(), account='', day='', tab='mentor', ready=true, mounted=false, stage=null, busy=false, generation=0;
    let status='',statusError=false,planDrafts={},prepDay='',insightAsset='',lastDiarySignature='';
    let cycleScope='active';
    let mentorKey='',mentorModel='',mentorQuestion='',mentorBusy=false,mentorStatus='',mentorController=null,mentorToken=0,mentorUnsaved=null;
    let mentorAccount=null,mentorAccountState={saved:false,busy:false,message:''};
    const selectedCycle=()=>typeof state!=='undefined' ? state.archiveView||'active' : 'active';
    const cycleLocked=()=>selectedCycle()!=='active'||(typeof DiaryArchives!=='undefined'&&DiaryArchives.busy);
    const localOwner=()=>typeof currentUser!=='undefined'&&currentUser?.id?currentUser.id:'guest';
    const meta=()=>data.accounts[accountKey(account)]||{settings:{...A.DEFAULTS},reviews:{},plans:{},annotations:{},preparations:{}};
    const trades=()=>data.trades.filter(t=>t.account===account);
    const dayRules=d=>A.confirmedRules(meta().plans[d]?.rules||meta().reviews[d]?.rules||meta().preparations?.[d]?.rules||meta().settings);

    const diarySnapshot=()=>typeof psychologyDiarySnapshot==='function'?psychologyDiarySnapshot():{ready:false,rows:[],source:'Diário indisponível',reason:'Abra esta aba dentro do Diário Pro+ para carregar os registros.'};
    const availableDays=()=>[...new Set([...A.dates(trades()),...J.normalize(diarySnapshot().rows).items.map(t=>t.day),...Object.keys(meta().reviews||{}),...Object.keys(meta().preparations||{}),...Object.keys(meta().plans||{}),...Object.keys(meta().aiReviews||{})])].sort();
    const journalRows=s=>{
        const otherIds=new Set(data.trades.filter(t=>(t.source==='tradingview')!==isTV()).map(t=>t.id));
        const excluded=new Set(Object.entries(data.journalLinks).filter(([id])=>otherIds.has(id)).map(([,link])=>link.diaryId));
        return s.rows.filter(t=>!excluded.has(String(t.id)));
    };
    const journalReport=()=>{
        const s=diarySnapshot(),annotations=Object.assign({},...Object.values(data.accounts).map(m=>m.annotations||{}));
        return J.report({profit:data.trades.filter(t=>(t.source==='tradingview')===isTV()),diary:journalRows(s),links:data.journalLinks,annotations,day,ready:s.ready,reason:s.reason,requireLinks:isTV()});
    };
    const effectiveAnnotations=()=>{
        const s=diarySnapshot();
        return s.ready?J.enrich(trades(),journalRows(s),data.journalLinks,meta().annotations).annotations:meta().annotations;
    };

    const analysis=d=>A.analyzeDay(trades(),d,dayRules(d),effectiveAnnotations());
    function announce(message,error=false){status=message;statusError=error;if($('pfStatus')){$('pfStatus').textContent=message;$('pfStatus').classList.toggle('pf-error',error);}}
    function commit(next){
        if(cycleLocked()){announce('Selecione o ciclo atual para registrar ou importar dados psicológicos.',true);return false;}
        if(!ready){announce('O armazenamento precisa ser recuperado antes de salvar. Exporte o conteúdo atual e restaure um backup válido.',true);return false;}
        try{localStorage.setItem(STORAGE+owner,JSON.stringify(next));data=next;return true;}
        catch(e){announce('Não foi possível salvar neste navegador. Libere espaço ou exporte um backup; seus dados anteriores foram preservados.',true);return false;}
    }
    function changeAccount(mutator){
        const next=JSON.parse(JSON.stringify(data)),k=accountKey(account);
        next.accounts[k] ||= {settings:{...A.DEFAULTS},reviews:{},plans:{},annotations:{},preparations:{}};
        mutator(next.accounts[k]);return commit(next);
    }
    function validateBackup(value,nested=false){
        if(!value||value.version!==1||!Array.isArray(value.trades)||value.trades.length>50000||!value.trades.every(A.validateTrade)||new Set(value.trades.map(t=>t.id)).size!==value.trades.length)throw new Error('Backup Profit inválido ou versão incompatível.');
        const clean=blank();clean.trades=value.trades.map(t=>({...t}));
        if(!value.accounts||typeof value.accounts!=='object'||Array.isArray(value.accounts))throw new Error('Configurações ausentes no backup.');
        const allowedKeys=new Set([...clean.trades.map(t=>accountKey(t.account)),accountKey('__diary__')]);
        const text=v=>typeof v==='string'?v.slice(0,4000):'';
        for(const [k,m] of Object.entries(value.accounts)){
            if(!allowedKeys.has(k)||!m||typeof m!=='object')throw new Error('Conta inválida no backup.');
            const cm={settings:A.confirmedRules(m.settings),reviews:{},plans:{},annotations:{},preparations:{}};
            for(const [d,p] of Object.entries(m.preparations||{})){
                if(!A.validDay(d))throw Error('Data de preparação inválida.');
                cm.preparations[d]=S.preparation(p);
            }
            for(const [d,r] of Object.entries(m.reviews||{})){
                if(!A.validDay(d)||!r||typeof r!=='object')throw new Error('Revisão inválida.');
                cm.reviews[d]={rules:A.confirmedRules(r.rules),desk:D.debrief(r.desk||{}),before:text(r.before),after:text(r.after),energy:text(r.energy),urge:text(r.urge),setup:text(r.setup),good:text(r.good),trigger:text(r.trigger),lesson:text(r.lesson),updated:text(r.updated),contexts:{}};
                for(const [id,val] of Object.entries(r.contexts||{}))if(['rapid','pause','revenge','overtrading','streak','stops','afternoon','giveback','size','hours','limit',...A.SMC_SIGNALS].includes(id)&&['pending','confirmed','planned'].includes(val))cm.reviews[d].contexts[id]=val;
            }
            for(const [d,p] of Object.entries(m.plans||{})){
                if(!A.validDay(d)||!p||!A.validDay(p.from)||!Array.isArray(p.items)||!p.items.every(x=>['count','pause','streak','time','limit','spacing','focus',...A.SMC_CHECKS].includes(x)))throw new Error('Plano inválido.');
                cm.plans[d]={from:p.from,rules:A.confirmedRules(p.rules),items:[...new Set(p.items)],focus:text(p.focus),created:text(p.created),reflection:['yes','partial','no'].includes(p.reflection)?p.reflection:'',contract:S.contract(p.contract||{})};
            }
            for(const [id,n] of Object.entries(m.annotations||{})){
                if(!clean.trades.some(t=>t.id===id&&accountKey(t.account)===k)||!n)continue;
                cm.annotations[id]=A.annotation(n);
            }
            if(m.aiReviews){
                cm.aiReviews={};
                for(const [d,r] of Object.entries(m.aiReviews)){
                    if(!A.validDay(d)||typeof DiaryMentor==='undefined')throw Error('Atualize a página para restaurar análises de IA.');
                    cm.aiReviews[d]=DiaryMentor.validateSaved(r);
                    if(cm.aiReviews[d].packet.day!==d)throw Error('Data da análise de IA incompatível.');
                }
            }
            clean.accounts[k]=cm;
        }
        const linkedDiary=new Set();
        for(const [pid,link] of Object.entries(value.journalLinks||{})){
            if(!clean.trades.some(t=>t.id===pid)||!link||typeof link.diaryId!=='string'||!link.diaryId||link.diaryId.length>200||linkedDiary.has(link.diaryId))throw Error('Vínculo Diário × execução inválido ou duplicado.');
            linkedDiary.add(link.diaryId);clean.journalLinks[pid]={diaryId:link.diaryId,confirmedAt:text(link.confirmedAt)};
        }
        clean.imports=Array.isArray(value.imports)?value.imports.slice(-30).map(x=>({name:text(x.name),at:text(x.at),count:Number(x.count)||0})): [];
        if(value.archivedCycles){
            if(nested||typeof value.archivedCycles!=='object'||Array.isArray(value.archivedCycles))throw Error('Arquivos psicológicos inválidos.');
            clean.archivedCycles={};
            for(const [id,c] of Object.entries(value.archivedCycles)){
                if(!id||['__proto__','constructor','prototype'].includes(id)||!c||typeof c.name!=='string')throw Error('Ciclo psicológico inválido.');
                clean.archivedCycles[id]={name:text(c.name),createdAt:text(c.createdAt),data:validateBackup(c.data,true)};
            }
        }
        return clean;
    }
    function authChanged(){
        mentorAccount?.sync();
        if(typeof DiaryArchives!=='undefined'&&DiaryArchives.busy)return;
        const nextOwner=localOwner(),nextScope=selectedCycle();
        const pendingKey=STORAGE+nextOwner+'_cycle_pending';
        if(localStorage.getItem(pendingKey)){
            if(!diarySnapshot().ready)return;
            try{
                const pending=JSON.parse(localStorage.getItem(pendingKey));
                const matches=pending.ids.every(id=>{
                    const t=state.trades.find(t=>t.id===id);
                    return t&&(pending.kind==='archive'?t.archive?.id===pending.id:!t.archive?.id);
                });
                if(matches)localStorage.setItem(STORAGE+nextOwner,JSON.stringify(validateBackup(pending.after)));
                localStorage.removeItem(pendingKey);owner=null;
            }catch(e){ready=false;announce('Psicologia aguardando recuperação do ciclo: '+e.message,true);return;}
        }
        if(nextOwner===owner&&nextScope===cycleScope)return;
        cancelMentor(nextOwner!==owner);
        cycleScope=nextScope;
        owner=nextOwner;prepDay='';insightAsset='';generation++;stage=null;busy=false;planDrafts={};status='';statusError=false;ready=true;
        try{const root=readCycleRoot();data=cycleScope==='active'?root:cycleScope==='all'?blank():root.archivedCycles?.[cycleScope]?.data||blank();}
        catch(e){data=blank();ready=false;status='Não foi possível ler os dados Profit salvos. O conteúdo original foi preservado. Use Backup para recuperá-lo.';statusError=true;}
        account=[...new Set(data.trades.map(t=>t.account))][0]||'';day=availableDays().at(-1)||'';
        if(mounted)render(true);
    }
    function init(){
        if(typeof DiaryMentorAccount!=='undefined')mentorAccount=DiaryMentorAccount.create({
            getClient:()=>typeof supabaseClient!=='undefined'?supabaseClient:null,
            getUser:()=>typeof currentUser!=='undefined'?currentUser?.id||null:null,
            onChange:s=>{mentorAccountState=s;if(!s.busy){mentorKey=s.key;mentorModel=s.model;}if(mounted)render(true);}
        });
        if(typeof window!=='undefined'){
            window.addEventListener?.('pagehide',()=>{cancelMentor(true);mentorAccount?.clear();});
            window.addEventListener?.('pageshow',event=>{if(event.persisted)mentorAccount?.sync();});
        }
        document.querySelector('.main').insertAdjacentHTML('beforeend','<section class="view" id="view-profit" aria-label="Psicologia · revisão diária e evolução"></section>');
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
        [['maxTrades','Máximo de entradas/dia',1,1000,1],['quickMinutes','Intervalo mínimo SMC (min)',0,240,0.5],['minTargetR','Alvo mínimo do plano (R)',0.1,20,0.1],['pauseMinutes','Pausa após perda (min)',0,240,0.5],['maxLosses','Encerrar após perdas seguidas',1,100,1],['givebackPct','Alerta de devolução do pico (%)',1,100,1],['lossLimit','Limite de perda realizado ('+currency()+') · 0 desativa',0,100000000,0.01]].map(([k,l,min,max,step])=>'<label>'+l+'<input name="'+k+'" type="number" min="'+min+'" max="'+max+'" step="'+step+'" value="'+r[k]+'" required></label>').join('')+
        '<label>Início da tarde<input name="afternoon" type="time" value="'+r.afternoon+'" required></label><label>Última entrada permitida<input name="endTime" type="time" value="'+r.endTime+'" required></label>'+
        '<label>Saída positiva abaixo do alvo<select name="allowEarlyException">'+selectOptions([['true','Somente com exceção prevista e justificada'],['false','Sempre sinalizar como desvio']],String(r.allowEarlyException))+'</select></label><div class="pf-rule-footer"><p class="pf-muted">Defina limites coerentes com seu método. Revisões e compromissos já salvos conservam as regras usadas naquele dia. O CSV não informa o risco planejado.</p><button class="btn btn-primary" type="submit">Salvar regras</button></div></form></details>';
    }
    function headerMarkup(){
        return '<details class="pf-data-tools"><summary>Importar dados e gerenciar backups</summary><div class="pf-toolbar">'+
        '<div class="pf-buttons"><button class="btn btn-primary" data-action="import">Importar CSV do Profit</button><button class="btn btn-ghost" data-action="import-tv">Importar CSV do TradingView</button><button class="btn btn-ghost" data-action="backup">Backup</button><button class="btn btn-ghost" data-action="restore">Restaurar</button></div></div>'+
        '<input id="pfCSV" type="file" accept=".csv,.txt,text/csv" hidden><input id="pfTVCSV" type="file" accept=".csv,text/csv" hidden><input id="pfBackup" type="file" accept=".json,application/json" hidden>'+
        '<div class="pf-storage"><span class="pf-dot"></span>Análises e CSV salvos neste navegador · '+(owner==='guest'?'perfil local sem login':'perfil do seu login')+' · não sincroniza com o Supabase <span>Faça backup para trocar de dispositivo.</span></div>'+
        '</details><p id="pfStatus" class="pf-status'+(statusError?' pf-error':'')+'" role="status" aria-live="polite">'+esc(status)+'</p>';
    }
    function previewMarkup(){
        if(!stage)return '';
        const result=A.mergeTrades(data.trades,stage.parsed.trades),p=stage.parsed;
        return '<section class="pf-card pf-import-preview"><div class="pf-section-title"><div><span class="pf-eyebrow">CONFERIR IMPORTAÇÃO</span><h3>'+esc(stage.name)+'</h3></div><button class="btn btn-ghost" data-action="cancel-import">Cancelar</button></div>'+
        '<p>'+esc(masked(p.account))+' · '+p.trades.length+' operações fechadas · '+date(p.trades[0].day)+' a '+date(p.trades.at(-1).day)+'</p>'+
        '<div class="pf-import-numbers"><span><strong>'+result.added+'</strong> novas</span><span><strong>'+(result.duplicates+p.duplicates)+'</strong> repetidas ignoradas</span><span><strong>'+result.updated+'</strong> atualizações</span><span><strong>'+p.openCount+'</strong> abertas ignoradas</span><span><strong>'+p.rejected.length+'</strong> linhas inválidas</span></div>'+
        '<p class="pf-muted">'+(p.source==='tradingview'?'L&P líquido da saída, contado uma vez por negociação, em USD. Posições abertas ficam fora da análise.':'Resultado = Res. Operação − valor absoluto de Comissões. “Total” e “TET” não são usados nos cálculos.')+' Exportações sobrepostas não duplicam operações.</p>'+
        p.warnings.map(w=>'<p class="pf-warning">'+esc(w)+'</p>').join('')+
        (p.rejected.length?'<details><summary>Ver linhas não importadas</summary><ul>'+p.rejected.slice(0,100).map(r=>'<li>Linha '+r.line+': '+esc(r.reason)+'</li>').join('')+'</ul></details>':'')+
        (result.updated?'<p class="pf-warning">As '+result.updated+' operações identificadas pelos mesmos horários, ativo e lado terão seus valores atualizados.</p>':'')+
        '<button class="btn btn-primary" data-action="confirm-import"'+(!ready?' disabled':'')+'>Importar e analisar</button></section>';
    }
    function emptyMarkup(){
        return '<div class="pf-empty pf-card"><div class="pf-empty-mark" aria-hidden="true">↗</div><span class="pf-eyebrow">SEU HISTÓRICO É O PONTO DE PARTIDA</span><h3>O resultado mostra o que aconteceu.<br>A revisão ajuda a entender como.</h3><p>Importe o relatório de operações do Profit ou o Histórico de negociação do Paper Trading do TradingView. A cada novo arquivo, o histórico se completa sem repetir trades.</p><button class="btn btn-primary" data-action="import">Escolher exportação do Profit</button><div class="pf-empty-topics"><span>01 · Ritmo e pausas</span><span>02 · Reação às perdas</span><span>03 · Compromissos para amanhã</span></div></div>';
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
        const draft=planDrafts[account+'|'+day]||{},target=draft.target||A.nextWeekday(day), existing=m.plans[target], chosen=draft.items||existing?.items||deskReport().priority.items;
        const focus=draft.focus??existing?.focus??'';
        const priority=deskReport().priority,contract=S.contract(draft.contract||existing?.contract||{priority:priority.primary||priority.items[0]||'focus',trigger:'Quando eu considerar uma nova entrada ou alterar a gestão',proof:priority.proof});
        return '<section class="pf-card"><span class="pf-eyebrow">INTENÇÃO EM AÇÃO</span><h3>Meu compromisso para o próximo pregão</h3><p class="pf-muted">Escolha poucas ações observáveis. Ritmo e limites são conferidos pelo CSV; setup, R, contratos e stop dependem também da revisão SMC das operações.</p>'+
        '<form id="pfPlan"><label>Data do próximo pregão<input id="pfPlanDate" type="date" value="'+target+'" min="'+A.nextWeekday(day)+'" required></label><p class="pf-small pf-muted">Sugestão pula fins de semana. Ajuste para feriados ou dias sem operar.</p>'+
        '<div class="pf-promises">'+planChecks.map(c=>'<label><input type="checkbox" name="promise" value="'+c.id+'"'+(chosen.includes(c.id)?' checked':'')+'><span>'+esc(c.label)+'</span></label>').join('')+'</div>'+
        '<label>Uma prioridade principal<select id="pfPriority">'+selectOptions([...planChecks.map(c=>[c.id,c.label]),['focus','Ação pessoal · conferida pelo meu relato']],contract.priority)+'</select></label>'+
        '<label>Qual situação deve acionar a resposta?<textarea id="pfTrigger" rows="2" maxlength="4000">'+esc(contract.trigger)+'</textarea></label>'+
        '<label>Se eu perceber meu gatilho, então vou…<textarea id="pfFocus" rows="3" maxlength="4000" placeholder="Escreva uma ação específica que depende de você.">'+esc(focus)+'</textarea></label>'+
        '<label>Qual evidência permitirá conferir a mudança?<textarea id="pfProof" rows="2" maxlength="4000">'+esc(contract.proof)+'</textarea></label>'+
        '<p class="pf-small pf-muted">A prioridade é a cobrança principal; as demais regras dão suporte. O critério escolhido é conferido separadamente do seu relato pessoal.</p>'+
        '<button class="btn btn-primary" type="submit">Salvar compromisso</button><p class="pf-muted" id="pfPlanSaved">'+(existing?'Existe um compromisso salvo para '+date(target)+'.':'O resultado financeiro não é uma promessa de processo.')+'</p></form></section>';
    }
    function dueMarkup(a,m){
        const p=m.plans[day];if(!p)return '<div class="pf-note">Nenhum compromisso anterior para este dia. Use a revisão para preparar o próximo pregão.</div>';
        const checks=new Map(A.analyzeDay(trades(),day,p.rules,m.annotations).checks.map(c=>[c.id,c]));
        return '<section class="pf-card pf-due"><span class="pf-eyebrow">COMBINADO EM '+date(p.from)+'</span><h3>Compromissos para hoje</h3>'+
        p.items.filter(id=>id!=='focus').map(id=>{const c=checks.get(id);return c?checkRow(c,!a.entries.length&&!a.closed.length):'';}).join('')+
        (p.focus?'<p class="pf-quote">'+esc(p.focus)+'</p><label>Consegui cumprir minha ação pessoal?<select id="pfReflection">'+selectOptions([['','Ainda não avaliei'],['yes','Sim'],['partial','Parcialmente'],['no','Não']],p.reflection||'')+'</select></label>':'')+followupMarkup(p,a)+'</section>';
    }
    function tableMarkup(a,m){
        const rows=[...new Map([...a.closed,...a.entries].map(t=>[t.id,t])).values()].sort((x,y)=>x.open.localeCompare(y.open));
        return '<details class="pf-card pf-table-card"><summary>Operações e evidências <span class="pf-muted">'+rows.length+' registros · ordenados pela abertura</span></summary><p class="pf-muted">Resultado no dia do fechamento; frequência no dia da abertura. A pausa considera o último fechamento conhecido do dia. Perda não significa necessariamente stop.</p><div class="pf-table-scroll"><table><thead><tr><th>Ativo / lado</th><th>Abertura</th><th>Fechamento</th><th>Qtd. negociada</th><th>Pausa</th><th>Resultado</th><th>Evidências / revisão</th></tr></thead><tbody>'+
        rows.map(t=>{const n=m.annotations[t.id]||{},info=a.entryInfo[t.id],gap=info?.gap,smc=A.smcTrade(t,n,a.rules);return '<tr><td><strong>'+esc(t.symbol)+'</strong><small>'+(t.side==='C'?'Compra':'Venda')+'</small></td><td>'+time(t.open)+'<small>'+date(t.open)+'</small></td><td>'+time(t.close)+'<small>'+date(t.close)+'</small></td><td>'+t.qty.toLocaleString('pt-BR',{maximumFractionDigits:12})+(t.averaged?'<small>Com preço médio</small>':'')+'</td><td>'+(gap==null?'—':gap<60?Math.round(gap)+' s':(gap/60).toFixed(1)+' min')+'</td><td class="'+tone(t.netCents)+'">'+money(t.netCents)+'<small>'+esc(rformat(smc.realizedR))+' bruto</small></td><td><button class="btn btn-ghost" data-edit-smc="'+esc(t.id)+'">Revisão SMC</button><div class="pf-tags">'+[...(info?.tags||[]),...smc.tags].map(s=>'<span>'+esc(s)+'</span>').join('')+'</div><details><summary>Revisar operação</summary><label>Motivo de saída<select data-trade="'+esc(t.id)+'" data-field="exit">'+selectOptions([['unknown','Não informado pelo CSV'],['stop','Stop confirmado por mim'],['target','Alvo'],['manual','Saída manual'],['breakeven','Breakeven']],n.exit||'unknown')+'</select></label><label>Contexto do trade<textarea rows="2" maxlength="4000" data-trade="'+esc(t.id)+'" data-field="note">'+esc(n.note||'')+'</textarea></label></details></td></tr>';}).join('')+'</tbody></table></div></details>';
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
        const n=A.annotation(effectiveAnnotations()[id]),dialog=$('pfSMCDialog');
        const field=(name,label,options)=>'<label>'+label+'<select name="'+name+'">'+selectOptions(options,n[name])+'</select></label>';
        const cash=(name,label)=>'<label>'+label+'<input name="'+name+'" inputmode="decimal" autocomplete="off" value="'+(n[name]===null?'':esc((n[name]/100).toLocaleString('pt-BR',{minimumFractionDigits:2,maximumFractionDigits:2})))+'" placeholder="Não informado"></label>';
        const qty=(name,label)=>'<label>'+label+'<input name="'+name+'" type="number" min="0" max="1000000" step="any" value="'+(n[name]??'')+'" placeholder="Não informado"></label>';
        dialog.innerHTML='<form id="pfSMCForm" data-id="'+esc(id)+'"><div class="pf-section-title"><div><span class="pf-eyebrow">REVISÃO POR OPERAÇÃO</span><h3 id="pfSMCTitle">'+esc(t.symbol)+' · '+date(t.open)+' '+time(t.open)+'</h3></div><button class="btn btn-ghost" type="button" data-action="close-smc" aria-label="Fechar revisão SMC">Fechar</button></div>'+
        (data.journalLinks[id]?'<p class="pf-note">Há um registro do diário vinculado. Campos ausentes podem aparecer preenchidos com esses dados; confira o plano original antes de salvar. Isso não confirma automaticamente novo setup ou stop estrutural.</p>':'')+
        '<p class="pf-note">Informe o plano original. Não use o prejuízo ocorrido como substituto do risco inicial. Este é um relato de revisão; o CSV não comprova quando o plano foi definido.</p>'+
        '<fieldset><legend>1. Setup e intenção</legend><div class="pf-form-grid">'+
        field('newSetup','Havia um novo setup independente?',[['unknown','Ainda não conferi'],['yes','Sim, novo setup do meu plano'],['no','Não, reentrei sem novo setup']])+
        field('emotion','O que influenciou minha decisão?',[['unknown','Ainda não identifiquei'],['calm','Calma / execução do plano'],['fomo','Medo de perder o movimento'],['revenge','Vontade de recuperar'],['fear','Medo de devolver o ganho'],['euphoria','Euforia / excesso de confiança'],['impatience','Impaciência / vontade de operar']])+
        '</div><label>Nome do setup<input name="setupName" maxlength="200" value="'+esc(n.setupName)+'" placeholder="Ex.: retorno ao POI com confirmação"></label><label>Qual estrutura, invalidação e gatilho justificaram a entrada?<textarea name="setupEvidence" rows="2" maxlength="4000">'+esc(n.setupEvidence)+'</textarea></label></fieldset>'+
        '<fieldset><legend>2. Risco, alvo e contratos</legend><div class="pf-form-grid">'+cash('riskCents','Risco inicial total da posição ('+currency()+' = 1R)')+cash('targetCents','Alvo financeiro planejado total ('+currency()+')')+qty('plannedQty','Quantidade planejada na entrada')+qty('entryQty','Quantidade efetiva na entrada (confirmada)')+
        field('execution','Como a operação foi executada?',[['unknown','Não conferi a composição'],['simple','Uma entrada e uma saída, sem parciais'],['scaled','Parciais, adições ou execução escalonada']])+
        field('earlyReason','Motivo de saída positiva abaixo do alvo',[['unknown','Não se aplica / não investiguei'],['planned','Exceção já prevista no plano'],['fear','Medo de devolver o ganho'],['recover','Queria recuperar / garantir algum lucro'],['manual','Outra decisão fora do plano']])+'</div>'+
        '<p class="pf-small pf-muted">CSV: '+t.qty+' unidades negociadas no agregado. Só usamos esse número como quantidade de entrada se você confirmar execução simples. Em parciais/adições, confira a quantidade inicial no histórico de ordens.</p>'+
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
        '<p class="pf-small pf-muted">Limites de perda e sequência usam resultados já encerrados antes de cada entrada. O módulo avalia o histórico importado; não bloqueia ordens na plataforma.</p></details></div>'+
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

    const deskReport=()=>D.report({trades:trades(),day,settings:meta().settings,annotations:effectiveAnnotations(),reviews:meta().reviews,plans:meta().plans,preparations:meta().preparations||{},journal:journalReport()});
    function deskMarkup(m){
        const d=deskReport(),a=d.a,rv=d.saved;
        if(!a.entries.length&&!a.closed.length)return journalMarkup(true)+reviewMarkup(m)+planMarkup(a,m);
        const badge=d.reviewed?'Debrief concluído':d.stale?'Dados mudaram · reconferir':'Debrief pendente';
        const levels={critical:'Quebra de controle relatada ou limite confirmado',deviation:'Desvio a revisar',pending:'Evidência incompleta',review:'Verificação de processo'};
        const nextPlans=Object.entries(m.plans).filter(([target,p])=>target>day&&p.from===day);
        return journalMarkup(false)+dailyGuideMarkup(d,m)+'<section class="pf-card pf-desk-verdict pf-desk-'+d.status+'"><div class="pf-section-title"><div><span class="pf-eyebrow">MESA · REUNIÃO DE FECHAMENTO · '+date(day)+'</span><h2>'+esc(d.title)+'</h2></div><span class="pf-badge" id="pfDeskBadge">'+badge+'</span></div>'+
        '<p class="pf-desk-lead">'+esc(d.opening)+'</p><p class="pf-desk-result">'+esc(d.resultReading)+'</p>'+
        '<div class="pf-desk-numbers"><div><span>Operações sinalizadas</span><strong>'+d.flaggedCount+'<small> / '+d.coverage.total+'</small></strong></div><div><span>Revisão SMC suficiente</span><strong>'+d.coverage.complete+'<small> / '+d.coverage.total+'</small></strong></div><div><span>Resultado da sessão</span><strong class="'+tone(a.pnl)+'">'+money(a.pnl)+'</strong></div></div>'+
        (!a.rules.configured?'<p class="pf-small pf-muted">Intervalo de 10 min e referência de 2R confirmados no seu plano. Os demais limites ainda são referências iniciais; revise-os em “Regras do meu plano”.</p>':'')+
        '<p class="pf-small pf-muted">Parecer de processo calculado localmente por regras e relatos. Não é avaliação clínica nem autorização ou bloqueio de ordens na plataforma.</p></section>'+
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


    const localStamp=()=>{const d=new Date(),pad=n=>String(n).padStart(2,'0');return d.getFullYear()+'-'+pad(d.getMonth()+1)+'-'+pad(d.getDate())+'T'+pad(d.getHours())+':'+pad(d.getMinutes())+':'+pad(d.getSeconds());};
    const supervisionInput=()=>({trades:trades(),day,settings:meta().settings,reviews:meta().reviews,plans:meta().plans,annotations:effectiveAnnotations(),preparations:meta().preparations||{},asset:insightAsset});
    function preparationMarkup(m){
        prepDay=prepDay||localStamp().slice(0,10);
        const p=m.preparations?.[prepDay],v=S.preparation(p||{}),plan=m.plans[prepDay],c=S.contract(plan?.contract||{}),r=dayRules(prepDay);
        const state=S.prepStatus(p,prepDay,trades()),locked=!!p&&trades().some(t=>t.open.slice(0,10)===prepDay);
        const known=trades().filter(t=>t.open.slice(0,10)===prepDay).map(t=>A.smcTrade(t,m.annotations[t.id],r)).filter(x=>x.riskCents!==null);
        const excess=p?.riskCents?known.filter(x=>x.riskCents>p.riskCents).length:0;
        return '<section class="pf-card pf-preparation"><span class="pf-eyebrow">ANTES DA PRIMEIRA ORDEM</span><h2>Preparação do pregão</h2><p class="pf-muted">Defina o que pretende executar e sua resposta ao principal gatilho. É possível preparar uma data futura antes de importar as operações.</p>'+
            '<label>Data da preparação<input type="date" id="pfPrepDate" value="'+prepDay+'"></label><p class="pf-note" id="pfPrepState">'+esc(state.label)+'. Horários locais do navegador; registros feitos depois não comprovam planejamento prévio.</p>'+
            (plan?'<div class="pf-quote"><strong>Compromisso trazido da revisão de '+date(plan.from)+'</strong><p>'+esc(plan.focus)+'</p><p>Gatilho: '+esc(c.trigger||'não registrado')+'<br>Como conferir: '+esc(c.proof||'não registrado')+'</p></div>':'<p class="pf-muted">Ainda não há compromisso anterior para esta data. Defina uma resposta específica abaixo.</p>')+
            '<p class="pf-small pf-muted">Regras de referência para esta sessão: intervalo '+r.quickMinutes+' min; alvo '+r.minTargetR+'R; até '+r.maxTrades+' entradas; pausa após perda '+r.pauseMinutes+' min; sequência máxima '+r.maxLosses+' perdas; última entrada '+r.endTime+'. '+(r.configured?'Limites personalizados.':'Revise os limites iniciais em “Regras do meu plano”.')+'</p>'+
            (p?'<p class="pf-small">Conferência posterior: '+known.length+' operações com risco inicial informado; '+excess+' acima do teto por operação registrado. O risco do CSV não é estimado.</p>':'')+
            '<form id="pfPrepForm" novalidate><fieldset'+(locked?' disabled':'')+'><div class="pf-form-grid"><label>Como dormi?<select name="sleep">'+selectOptions([['','Não informado'],['rested','Descansado'],['regular','Regular'],['poor','Mal descansado']],v.sleep)+'</select></label>'+
            ['tension','urge'].map((k,i)=>'<label>'+(i?'Vontade de recuperar dinheiro':'Tensão percebida')+'<select name="'+k+'">'+selectOptions([['','Não informada'],...Array.from({length:11},(_,n)=>[String(n),n+' / 10'])],v[k])+'</select></label>').join('')+
            '<label>Risco máximo planejado por operação ('+currency()+')<input name="riskCents" inputmode="decimal" placeholder="Defina no seu plano" value="'+(v.riskCents===null?'':esc((v.riskCents/100).toFixed(2).replace('.',',')))+'"></label></div>'+
            [['setups','Quais setups e condições autorizam uma entrada?','Estrutura, contexto, invalidação e gatilho.'],['exceptions','Quais exceções permitem uma saída positiva abaixo do alvo?','Descreva as regras previstas. Se não há exceções, registre “Nenhuma”.'],['trigger','Qual gatilho exige atenção hoje?','Ex.: vontade de recuperar após uma perda.'],['response','Se esse gatilho aparecer, o que farei antes da próxima ordem?','Ação observável e coerente com seu plano.']].map(([k,label,placeholder])=>'<label>'+label+'<textarea name="'+k+'" rows="3" maxlength="4000" placeholder="'+placeholder+'">'+esc(p?v[k]:k==='trigger'?c.trigger:k==='response'?plan?.focus||'':v[k])+'</textarea></label>').join('')+
            '<p class="pf-small pf-muted">Esses relatos dão contexto à revisão. Nenhuma resposta recebe diagnóstico ou autorização automática para operar.</p><p id="pfPrepError" role="alert" class="pf-error"></p><button type="submit" class="btn btn-primary">Salvar preparação</button></fieldset>'+(locked?'<p class="pf-note">Esta preparação foi preservada porque o pregão já tem entradas importadas. Registre a correção no debrief e prepare a mudança para a próxima sessão.</p>':'')+'</form></section>';
    }
    function followupMarkup(p,a){
        const c=S.contract(p.contract||{}),result=S.planResult(p,a);
        return '<div class="pf-followup"><h4>'+esc(result.label)+'</h4><p class="pf-small pf-muted">'+esc(result.detail||'Critério observável e relato da ação pessoal são avaliados separadamente.')+'</p>'+
            '<p><strong>Gatilho combinado:</strong> '+esc(c.trigger||'Não registrado no plano anterior.')+'<br><strong>Prova esperada:</strong> '+esc(c.proof||'Não registrada no plano anterior.')+'</p>'+
            '<div class="pf-form-grid"><label>Quando percebi o gatilho?<select data-followup="noticed">'+selectOptions([['','Ainda não revisei'],['before','Antes da decisão'],['after','Depois da decisão'],['not','Não percebi no momento'],['none','O gatilho não ocorreu']],c.noticed)+'</select></label>'+
            '<label>O que dificultou a resposta combinada?<select data-followup="barrier">'+selectOptions([['','Ainda não revisei'],['none','Sem dificuldade relatada'],['unclear','Regra pouco clara'],['impractical','Ação difícil de executar'],['late','Percebi tarde'],['notused','Percebi, mas não usei a ação'],['other','Outro motivo']],c.barrier)+'</select></label></div>'+
            '<label>Qual episódio comprova o que você conseguiu fazer?<textarea data-followup="evidence" rows="3" maxlength="4000" placeholder="Horário, operação e ação executada. Seu relato será identificado como relato.">'+esc(c.evidence)+'</textarea></label>'+
            '<label>O que precisa mudar para a ação funcionar melhor?<textarea data-followup="barrierNote" rows="2" maxlength="4000">'+esc(c.barrierNote)+'</textarea></label><p class="pf-small pf-muted">Relatos salvos ao preencher. Marcar que cumpriu a ação não apaga um descumprimento observado.</p></div>';
    }
    function dailyGuideMarkup(d,m){
        const p=m.plans[day],c=S.contract(p?.contract||{}),prep=m.preparations?.[day];
        const decision=p?(c.priority?d.a.checks.find(x=>x.id===c.priority)?.label||'Executar a ação pessoal combinada':'Revisar o compromisso anterior'):d.priority.title;
        return '<section class="pf-card pf-daily-guide"><span class="pf-eyebrow">TRÊS RESPOSTAS PARA AGIR</span><div class="pf-guide-grid">'+
            '<div><h3>Qual decisão melhorar?</h3><p>'+esc(decision)+'</p></div><div><h3>O que fazer no gatilho?</h3><p>'+esc(p?.focus||d.priority.demand)+'</p></div><div><h3>Como comprovar?</h3><p>'+esc(c.proof||(p?'Registre uma evidência específica no compromisso.':d.priority.proof))+'</p></div></div>'+
            '<p class="pf-small pf-muted">'+esc(S.prepStatus(m.preparations?.[day],day,trades()).label)+'. A cobrança descreve o processo; não exige uma promessa de lucro.</p>'+
            (prep?'<details><summary>Confrontar a execução com minha preparação</summary><p><strong>Condições previstas:</strong> '+esc(prep.setups)+'</p><p><strong>Gatilho e resposta:</strong> '+esc(prep.trigger)+' → '+esc(prep.response)+'</p><p><strong>Estado relatado:</strong> tensão '+esc(prep.tension)+'/10; urgência '+esc(prep.urge)+'/10.</p><p><strong>Teto por operação:</strong> '+money(prep.riskCents||0)+'. Compare com o risco inicial de cada entrada; risco ausente continua pendente.</p></details>':'')+'</section>'+dueMarkup(d.a,m);
    }
    function insightsMarkup(){
        const r=S.report(supervisionInput()),pct=n=>n===null?'—':Math.round(n*100)+'%',avg=n=>n===null?'—':money(Math.round(n)),rv=n=>n===null?'—':n.toFixed(2).replace('.',',')+'R';
        const line=(label,a,b)=>'<tr><th scope="row">'+label+'</th><td>'+a+'</td><td>'+b+'</td></tr>';
        const coverage=x=>x.failed+' desvios / '+x.known+' revisadas';
        const current=r.current,previous=r.previous;
        const barrierNames={unclear:'Regra pouco clara',impractical:'Ação difícil de executar',late:'Gatilho percebido tarde',notused:'Ação não utilizada',other:'Outro motivo'};
        return '<section class="pf-card"><span class="pf-eyebrow">SEU HISTÓRICO COMO EVIDÊNCIA</span><h2>Insights e acompanhamento semanal</h2><p class="pf-muted">Comparações exploratórias dos últimos '+r.windowDays.length+' pregões importados até '+date(day)+'. Só entram operações já encerradas até a data selecionada.</p>'+
            '<label>Ativo nas comparações<select id="pfInsightAsset">'+selectOptions([['','Todos os ativos'],...r.assets.map(x=>[x,x])],insightAsset)+'</select></label>'+
            '<p class="pf-note">Diferenças entre grupos não demonstram causa nem lucro recuperável. Ativo, quantidade, contexto, plano e cobertura das revisões podem mudar. Menos de 10 operações em qualquer grupo recebe aviso de amostra pequena; isso não é um teste de significância.</p>'+
            (r.ruleVariants>1?'<p class="pf-warning">Há '+r.ruleVariants+' conjuntos de regras no período. Cada operação usa o plano de seu dia; mudanças de critério afetam a comparação.</p>':'')+'</section>'+
            '<div class="pf-insight-grid">'+r.pairs.map(p=>'<section class="pf-card pf-comparison"><h3>'+esc(p.title)+'</h3>'+(p.small?'<p class="pf-warning">Amostra pequena: não concluir tendência.</p>':'')+
            '<div class="pf-table-scroll"><table><thead><tr><th>Indicador</th><th>'+esc(p.leftLabel)+'</th><th>'+esc(p.rightLabel)+'</th></tr></thead><tbody>'+
            line('Operações',p.left.n,p.right.n)+line('Resultado líquido',money(p.left.pnl),money(p.right.pnl))+line('Média líquida / operação',avg(p.left.meanNet),avg(p.right.meanNet))+
            line('Operações positivas',pct(p.left.winRate),pct(p.right.winRate))+line('R bruto médio conhecido',rv(p.left.meanR),rv(p.right.meanR))+
            line('Risco inicial informado',p.left.riskKnown+'/'+p.left.n,p.right.riskKnown+'/'+p.right.n)+
            line('Setup',coverage(p.left.setup),coverage(p.right.setup))+line('Contratos',coverage(p.left.contracts),coverage(p.right.contracts))+line('Stop',coverage(p.left.stop),coverage(p.right.stop))+
            '</tbody></table></div><p class="pf-small pf-muted">'+esc(p.note)+' '+p.excluded+' operações fora da comparação por falta de fechamento anterior.</p></section>').join('')+'</div>'+
            '<section class="pf-card"><h3>Alvo e dimensão da posição</h3><p>'+r.rr.positiveKnown+'/'+r.rr.positive+' ganhos com risco inicial conhecido; '+r.rr.below+' ganhos abaixo da referência sem exceção; '+r.rr.exceptions+' exceções documentadas.</p><p>'+r.rr.contracts.failed+' divergências de contratos em '+r.rr.contracts.known+' operações revisadas de '+r.rr.total+'.</p><p class="pf-small pf-muted">O cálculo de R usa o risco inicial informado, nunca o prejuízo posterior. Ganhos menores que 2R não provam, sozinhos, alteração de stop ou erro de quantidade.</p></section>'+
            '<section class="pf-card pf-weekly"><span class="pf-eyebrow">REUNIÃO SEMANAL · TODOS OS ATIVOS</span><h3>A reflexão está mudando a execução?</h3><p class="pf-muted">Semana atual até '+date(day)+' comparada à semana anterior. Dias sem arquivo importado não contam como dias disciplinados.</p>'+
            '<div class="pf-table-scroll"><table><thead><tr><th>Evidência</th><th>'+date(current.start)+' a '+date(current.end)+'</th><th>'+date(previous.start)+' a '+date(previous.end)+'</th></tr></thead><tbody>'+
            line('Pregões importados',current.days,previous.days)+line('Entradas consecutivas',current.rapid+'/'+current.entries+' · '+pct(current.rapidRate),previous.rapid+'/'+previous.entries+' · '+pct(previous.rapidRate))+
            line('Documentação SMC suficiente',current.reviewed+'/'+current.operations+' · '+pct(current.reviewRate),previous.reviewed+'/'+previous.operations+' · '+pct(previous.reviewRate))+
            line('Preparação antes da primeira entrada',current.prepBefore+'/'+current.prepTotal,previous.prepBefore+'/'+previous.prepTotal)+
            line('Prioridades cumpridas / descumpridas',current.met+' / '+current.failed,previous.met+' / '+previous.failed)+
            line('Prioridades pendentes / aguardando importação',current.pending,previous.pending)+
            line('Sem operação aplicável / prioridade pessoal',current.notApplicable+' / '+current.personal,previous.notApplicable+' / '+previous.personal)+
            line('Ação cumprida segundo seu relato',current.reportedUsed,previous.reportedUsed)+
            line('Planos com evidência relatada',current.withEvidence,previous.withEvidence)+
            '</tbody></table></div><p class="pf-note">'+(r.comparable?'Há pelo menos 3 pregões em cada semana. Compare também a cobertura das revisões e as regras; estes números não comprovam mudança psicológica.':'Amostra inicial: menos de 3 pregões em uma das semanas. A comparação é descritiva, sem conclusão de evolução.')+'</p>'+
            '<p class="pf-small pf-muted">Documentação suficiente significa risco, setup, alvo, contratos e stop informados; não significa critérios cumpridos. Ações pessoais e critérios sem operações aplicáveis não entram como cumprimento automático.</p>'+
            '<h3>O que está dificultando o compromisso?</h3>'+ (Object.keys(r.barriers).length?'<ul>'+Object.entries(r.barriers).map(([k,n])=>'<li>'+barrierNames[k]+': '+n+' relato(s).</li>').join('')+'</ul>':'<p class="pf-muted">Ainda não há dificuldades registradas no acompanhamento dos compromissos.</p>')+
            '<p class="pf-muted">'+r.failedRecent+' prioridades descumpridas nos últimos até 10 dias importados com plano.</p><ul>'+r.prompts.map(x=>'<li>'+esc(x)+'</li>').join('')+'</ul></section>';
    }


    function journalMarkup(full=false){
        const r=journalReport(),s=diarySnapshot(),labels={win:'Alvo / positivo',loss:'Stop / negativo',zero:'Zero / breakeven',open:'Em aberto',unknown:'Sem resultado',mixed:'Parciais / resultado misto'};
        const severe=['missing','mismatch'].includes(r.status);
        const reviewedRisk=r.diary.filter(t=>t.status!=='open'&&t.riskCents!==null&&t.pnl!==null),meanR=reviewedRisk.length?reviewedRisk.reduce((n,t)=>n+t.pnl/t.riskCents,0)/reviewedRisk.length:null;
        const lowTargets=r.diary.filter(t=>t.riskCents!==null&&t.targetCents!==null&&t.targetCents/t.riskCents<dayRules(day).minTargetR).length;
        const table='<div class="pf-table-scroll"><table><thead><tr><th>Família do ativo</th><th>'+sourceName()+'</th><th>Diário</th><th>Faltam registros</th><th>Alvo / positivo Exportação : Diário</th><th>Stop / negativo Exportação : Diário</th><th>Zero Exportação : Diário</th><th>Resultado pendente no diário</th></tr></thead><tbody>'+
            r.groups.map(g=>'<tr><th>'+esc(g.symbol)+'</th><td>'+g.profit+'</td><td>'+g.diary+'</td><td class="'+(g.missing?'pf-negative':'')+'">'+g.missing+'</td><td>'+g.pcounts.win+' : '+g.dcounts.win+'</td><td>'+g.pcounts.loss+' : '+g.dcounts.loss+'</td><td>'+g.pcounts.zero+' : '+g.dcounts.zero+'</td><td>'+g.dcounts.unknown+'</td></tr>').join('')+'</tbody></table></div>';
        let out='<section class="pf-card pf-reconciliation'+(severe?' pf-reconciliation-critical':'')+'"><span class="pf-eyebrow">AUDITORIA DO REGISTRO · '+date(day)+'</span><h2>'+esc(r.title)+'</h2><p>'+esc(r.feedback)+'</p>'+
            '<p class="pf-small pf-muted">'+esc(s.source)+'. Conferência por data de entrada e família de ativo, '+(isTV()?'somente registros vinculados manualmente a esta simulação. Vincule abaixo os trades do Paper Trading para confirmar a origem':'com todas as contas Profit deste perfil')+'. Registros de robô não entram. Mais trades no diário são permitidos; trades de outro ativo não cobrem uma falta.</p>'+
            (r.ready?'<div class="pf-guide-grid"><div><h3>Execuções no '+sourceName()+'</h3><strong>'+r.profitCount+'</strong></div><div><h3>Registros nos mesmos ativos</h3><strong>'+r.groups.reduce((n,g)=>n+g.diary,0)+'</strong></div><div><h3>Vínculos confirmados</h3><strong>'+r.linked+' / '+r.profitCount+'</strong></div></div>':'')+
            (r.invalid||r.duplicates?'<p class="pf-warning">'+r.invalid+' registros com data/ativo/identidade inválidos e '+r.duplicates+' identidades repetidas. Corrija-os antes de concluir a auditoria.</p>':'')+
            (r.ready&&r.groups.length?table:'')+
            '<p class="pf-note">Não exigimos igualdade de centavos. Comparamos a categoria do resultado: a exportação usa o resultado bruto (recomposto com a comissão informada no TradingView) enquanto o motivo de saída não foi revisado. Positivo não prova alvo e negativo não prova stop. Parciais, breakeven e saídas manuais precisam de contexto.</p>'+
            (!full?'<button class="btn btn-ghost" data-tab="journal">Conferir operações e racional</button>':'')+'</section>';
        if(!r.ready)return out;
        out+='<section class="pf-card pf-diary-context"><span class="pf-eyebrow">EVIDÊNCIAS DO DIÁRIO · SEM SOMAR À EXPORTAÇÃO</span><h3>O que você registrou sobre suas decisões</h3>'+
            '<p>'+r.diaryCount+' registros neste dia: '+r.outcomes.win+' positivos/alvos, '+r.outcomes.loss+' negativos/stops, '+r.outcomes.zero+' zerados, '+r.outcomes.open+' abertos e '+r.outcomes.pending+' com resultado misto ou pendente.</p>'+
            '<p>'+reviewedRisk.length+' operações encerradas com risco e resultado informados; R bruto médio conhecido: '+(meanR===null?'pendente':meanR.toFixed(2).replace('.',',')+'R')+'. '+lowTargets+' alvos registrados abaixo da referência de '+dayRules(day).minTargetR+'R: confira o plano e as exceções.</p>'+
            '<p class="pf-small pf-muted">O diário fornece contexto e risco. Sem horário de fechamento, não calculamos pausas entre seus registros. Uma operação vinculada continua sendo uma única execução.</p>'+
            '<p><strong>'+r.withoutRationale+' sem setup e justificativa completos.</strong> '+r.rationale+'/'+r.linked+' vínculos confirmados têm esses dois campos preenchidos. Quantidade suficiente não substitui documentação de qualidade.</p>'+
            '<p class="pf-small pf-muted">“Racional documentado” significa setup e texto explicativo presentes, não validação técnica da entrada. Texto automático de importação não conta. Os registros podem ser retrospectivos; não afirmamos que o racional existia antes da ordem.</p>'+
            (r.mistakes.length?'<h4>Erros que você relatou no diário</h4><ul>'+r.mistakes.slice(0,8).map(([m,n])=>'<li>'+esc(m)+' · '+n+' registro(s)</li>').join('')+'</ul>':'<p class="pf-muted">Nenhum erro foi explicitamente marcado no diário deste dia.</p>')+'</section>';
        if(!full)return out;
        out+='<section class="pf-card pf-journal-links"><h3>Relacionar execução e registro</h3><p class="pf-muted">Sugestões usam data, família do ativo, lado e horário próximo (até 2 minutos), sem comparar centavos. Confirme cada vínculo. Um registro só pode corresponder a uma execução, mesmo entre fontes ou contas diferentes.</p><p class="pf-note">Após confirmar, risco, alvo, quantidade de entrada, setup, justificativa e motivo de saída do diário podem preencher informações ausentes na análise. Valores financeiros do diário em reais não preenchem risco ou alvo em USD. Revisões SMC já preenchidas prevalecem. Não somamos resultados das duas fontes e não inferimos novo setup ou stop estrutural.</p>'+
            (r.rows.length?r.rows.map(x=>'<article class="pf-journal-pair" data-profit-row="'+esc(x.profit.id)+'"><div class="pf-section-title"><h4>'+esc(x.profit.symbol)+' · '+time(x.profit.open)+' · '+(x.profit.side==='C'?'Compra':'Venda')+'</h4><span class="pf-badge">'+esc(labels[x.outcome])+'</span></div>'+
            '<p class="pf-small pf-muted">'+esc(masked(x.profit.account))+' · resultado bruto '+money(x.profit.grossCents)+' · '+(x.diary?'Vínculo confirmado':x.suggestion?'Sugestão por horário; ainda não confirmada':'Sem vínculo confirmado')+'</p>'+
            (x.mismatch?'<p class="pf-error">O vínculo tem lado ou categoria de resultado divergente. Confira as duas fontes antes de concluir.</p>':'')+
            (x.stale?'<p class="pf-warning">O registro vinculado foi removido ou mudou de data/ativo. Confira novamente.</p>':'')+
            '<label>Registro correspondente no diário<select data-journal-choice>'+selectOptions([['','Selecione um registro'],...x.candidates.map(t=>[t.id,time(t.open)+' · '+t.symbol+' · '+labels[t.outcome]+' · '+(t.setup||'sem setup')])],x.diary?.id||x.suggestion)+'</select></label>'+
            '<div class="pf-buttons"><button class="btn btn-primary" data-journal-link="'+esc(x.profit.id)+'">Confirmar vínculo</button>'+
            (x.diary?'<button class="btn btn-ghost" data-diary-edit="'+esc(x.diary.id)+'">Revisar registro no diário</button>':'')+
            (data.journalLinks[x.profit.id]?'<button class="btn btn-ghost" data-journal-unlink="'+esc(x.profit.id)+'">Desvincular</button>':'')+'</div>'+
            (x.diary?'<p class="pf-small">'+(x.diary.hasRationale?'Setup e justificativa presentes.':'Registro com racional incompleto.')+' '+esc(x.diary.notes||'Sem justificativa escrita.')+'</p>':'')+'</article>').join(''):'<p class="pf-muted">Importe as execuções deste dia para conferir a cobertura das execuções. Os dados do diário já aparecem abaixo.</p>')+'</section>';
        out+='<section class="pf-card"><h3>Registros do diário neste pregão</h3>'+
            (r.diary.length?r.diary.map(t=>'<details class="pf-journal-record"><summary>'+time(t.open)+' · '+esc(t.symbol)+' · '+esc(t.setup||'Sem setup')+' · '+esc(labels[t.outcome])+'</summary><p>'+esc(t.notes||'Sem justificativa escrita.')+'</p><p class="pf-small pf-muted">Risco inicial registrado: '+(t.riskCents===null?'não informado':money(t.riskCents,'BRL'))+'; alvo: '+(t.targetCents===null?'não informado':money(t.targetCents,'BRL'))+'. '+(t.registeredLocal?'Criado em '+date(t.registeredLocal)+' '+t.registeredLocal.slice(11,16)+'.':'Horário de criação não disponível.')+'</p><button class="btn btn-ghost" data-diary-edit="'+esc(t.id)+'">Revisar no diário</button></details>').join(''):'<p class="pf-muted">Nenhum registro no diário para esta data.</p>')+'</section>';
        return out;
    }

    function render(force=false){
        if(!mounted)return;
        const snapshot=diarySnapshot(),signature=D.fingerprint(snapshot);
        if(!force&&$('pfCSV')&&signature===lastDiarySignature)return; // Preserve focused forms unless diary evidence changed.
        lastDiarySignature=signature;
        const accounts=[...new Set([...data.trades.map(t=>t.account),...Object.keys(data.accounts).map(k=>k.slice('account:'.length))])];
        if(!accounts.length&&snapshot.rows.length)accounts.push('__diary__');
        if(!accounts.includes(account))account=accounts[0]||'';
        const days=availableDays();if(!days.includes(day))day=days.at(-1)||'';
        const m={...meta(),annotations:effectiveAnnotations()};
        if(cycleScope==='all'){
            $('view-profit').innerHTML='<div class="pf-card"><h2>Psicologia por ciclo</h2><p>Selecione um ciclo em Meu histórico para consultar suas revisões, compromissos e evolução. O PDF do histórico completo reúne todos os ciclos.</p></div>';return;
        }
        let body=headerMarkup()+previewMarkup();
        if(cycleScope!=='active')body+='<p class="pf-note">Psicologia arquivada · consulta. Selecione Ciclo atual para novos registros.</p>';
        if(!days.length)body+=mentorMarkup();
        else {
            body+='<div class="pf-filters"><label>Fonte / conta de análise<select id="pfAccount">'+selectOptions(accounts.map(a=>[a,masked(a)]),account)+'</select></label><label>Pregão<select id="pfDay">'+selectOptions(days.slice().reverse().map(d=>[d,date(d)]),day)+'</select></label><div class="pf-tabs" role="group" aria-label="Visão Profit"><button data-tab="preparation" aria-pressed="'+(tab==='preparation')+'" class="'+(tab==='preparation'?'active':'')+'">Preparação</button><button data-tab="desk" aria-pressed="'+(tab==='desk')+'" class="'+(tab==='desk'?'active':'')+'">Mesa</button><button data-tab="journal" aria-pressed="'+(tab==='journal')+'" class="'+(tab==='journal'?'active':'')+'">Diário × execução</button><button data-tab="day" aria-pressed="'+(tab==='day')+'" class="'+(tab==='day'?'active':'')+'">Revisão diária</button><button data-tab="evolution" aria-pressed="'+(tab==='evolution')+'" class="'+(tab==='evolution'?'active':'')+'">Evolução</button><button data-tab="insights" aria-pressed="'+(tab==='insights')+'" class="'+(tab==='insights'?'active':'')+'">Insights</button></div></div>'+(tab==='mentor'?'<details class="pf-context-details"><summary>Plano e contexto dos dados</summary>':'')+settingsMarkup();
            body+='<p class="pf-note">Plano SMC declarado: esperar um novo setup e buscar o alvo mínimo definido no plano (referência inicial de 2R). Entradas consecutivas são um sinal de desvio do método. Risco, contratos de entrada e gestão do stop precisam da sua revisão; os números não revelam a intenção.</p>';
            if(isTV())body+='<p class="pf-note"><strong>TradingView · Paper Trading · simulação em USD.</strong> Use exportações de um único histórico simulado neste perfil. Não somamos este resultado ao Profit nem convertemos moedas. Revise risco, alvo e limites em USD. Para conciliar com o diário, confirme os vínculos das operações simuladas na aba Diário × execução; registros sem vínculo não cobrem a simulação.</p>';
            if(trades().every(t=>t.feeCents===0))body+='<p class="pf-small pf-muted">Comissões zeradas no histórico importado. Custos não exportados pela plataforma não entram no resultado.</p>';
            if(tab==='mentor')body+='</details>';
            body+=tab==='mentor'?mentorMarkup():tab==='journal'?journalMarkup(true):tab==='preparation'?preparationMarkup(m):tab==='insights'?insightsMarkup():tab==='desk'?deskMarkup(m):tab==='day'?dayMarkup(analysis(day),m):evolutionMarkup(days,m);
            body+='<details class="pf-card pf-method"><summary>Importação e critérios de leitura</summary><p>Datas e horários são mantidos como exportados pela plataforma, sem conversão de fuso. O resultado diário considera o fechamento. Entradas, pausas e limites consideram a abertura e apenas perdas já conhecidas naquele instante.</p><p>Res. Operação é o resultado bruto por operação. Descontamos o valor absoluto de Comissões, quando presente. A coluna Total é acumulada e não é somada. TET não é usado como intervalo. Qtd Compra/Venda é volume agregado, não risco ou exposição máxima.</p><p>TradingView: use Histórico de negociação do Paper Trading em USD. Agrupamos entrada/saída por símbolo e número; contamos L&amp;P líquido uma vez, na saída, sem descontar novamente a comissão. Bruto recomposto = líquido + comissão informada na saída. Tamanho (valor) é valor da posição, não risco inicial. Quantidades fracionárias são preservadas. Pares ambíguos ou com parciais incompatíveis são apresentados como inválidos. Exportações de posições ou outras moedas não são aceitas por este botão.</p><p>Uma operação é identificada por conta, ativo, abertura, fechamento e lado. Reimportações idênticas são ignoradas; valores corrigidos são mostrados antes da atualização. Alterar os horários no arquivo gera outra identidade. Operações abertas e linhas inválidas não entram na análise.</p><p>O resultado descreve apenas os arquivos importados. Não infere motivo de saída, intenção, stop planejado nem lucro potencial. Acompanhamento comportamental não garante desempenho financeiro.</p>'+
            '<h4>Últimas importações neste perfil</h4>'+data.imports.slice(-5).reverse().map(x=>'<p>'+esc(x.name)+' · '+x.count+' registros · '+esc(x.at.slice(0,10))+'</p>').join('')+'</details>';
        }
        body=body.replace('<button data-tab="preparation"','<button data-tab="mentor" aria-pressed="'+(tab==='mentor')+'" class="'+(tab==='mentor'?'active':'')+'">Mentor de execução</button><button data-tab="preparation"');
        $('view-profit').innerHTML=body+'<dialog id="pfSMCDialog" aria-labelledby="pfSMCTitle"></dialog>';
        if(cycleScope!=='active')$('view-profit').querySelectorAll('input,textarea,select:not(#pfAccount):not(#pfDay),form button,[data-action="import"],[data-action="import-tv"],[data-action="restore"]').forEach(el=>el.disabled=true);
    }
    async function readFile(file,isBackup=false,source='profit'){
        if(!file)return;
        if(cycleLocked()){announce('Importe ou restaure dados no ciclo atual.',true);return;}
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
                if(!confirm('Restaurar este backup substitui a Psicologia deste perfil, incluindo seus ciclos arquivados. Faça um backup antes. Deseja continuar?'))return;
                const previous=ready;ready=true;
                if(commit(restored)){account=[...new Set(data.trades.map(t=>t.account))][0]||'';day=availableDays().at(-1)||'';stage=null;planDrafts={};announce('Backup restaurado.');render(true);}
                else ready=previous;
            } else {
                const parsed=source==='tradingview'?A.parseTradingView(text):A.parseCSV(text);if(data.trades.length+parsed.trades.length>100000||A.mergeTrades(data.trades,parsed.trades).trades.length>50000)throw new Error('Limite de 50 mil operações neste perfil.');
                stage={name:file.name,parsed};announce('Confira os dados antes de importar.');render(true);
            }
        }catch(e){announce('Não foi possível importar: '+e.message,true);}
        finally{if(token===generation)busy=false;}
    }
    function download(){
        let content;
        try{content=ready?JSON.stringify(readCycleRoot(),null,2):localStorage.getItem(STORAGE+owner)||'';}
        catch{announce('O navegador bloqueou a leitura do backup.',true);return;}
        const url=URL.createObjectURL(new Blob([content],{type:'application/json'})),a=document.createElement('a');
        a.href=url;a.download='trades-profit-backup-'+new Date().toISOString().slice(0,10)+'.json';a.click();setTimeout(()=>URL.revokeObjectURL(url),1000);
        announce('Backup gerado com trades, revisões, regras e compromissos deste perfil.');
    }
    function click(e){
        const b=e.target.closest('button');if(!b)return;
        if(b.dataset.mentor){mentorAction(b.dataset.mentor);return;}
        if(b.dataset.diaryEdit){
            if(typeof openPsychologyDiaryTrade!=='function'||!openPsychologyDiaryTrade(b.dataset.diaryEdit))announce('Carregue o diário deste perfil para revisar esse registro.',true);
            return;
        }
        if(b.dataset.journalLink){
            const report=journalReport(),row=report.rows.find(x=>x.profit.id===b.dataset.journalLink);
            const diaryId=b.closest('.pf-journal-pair')?.querySelector('[data-journal-choice]')?.value;
            if(!report.ready||!row||!row.candidates.some(t=>t.id===diaryId)){announce('Selecione um registro válido do diário deste perfil.',true);return;}
            if(Object.entries(data.journalLinks).some(([pid,link])=>pid!==row.profit.id&&link.diaryId===diaryId)){announce('Esse registro já está vinculado a outra execução. Confira antes de reutilizá-lo.',true);return;}
            const next=JSON.parse(JSON.stringify(data));
            next.journalLinks[row.profit.id]={diaryId,confirmedAt:new Date().toISOString()};
            if(commit(next)){announce('Vínculo confirmado. Dados ausentes podem ser lidos do diário; nenhuma operação foi duplicada.');render(true);}return;
        }
        if(b.dataset.journalUnlink){
            const next=JSON.parse(JSON.stringify(data));delete next.journalLinks[b.dataset.journalUnlink];
            if(commit(next)){announce('Vínculo removido. Registros originais preservados.');render(true);}return;
        }
        if(b.dataset.deskEpisode!==undefined){const x=deskReport().episodes[Number(b.dataset.deskEpisode)];if(x&&$('pfDeskForm')){$('pfDeskForm').elements.moment.value=x.trigger+' '+x.decision;saveDeskDraft();$('pfDeskForm').scrollIntoView({behavior:'smooth',block:'start'});$('pfDeskForm').elements.thought.focus();}return;}
        if(b.dataset.action==='desk-plan'){const p=deskReport().priority;if($('pfPlan')){$('pfFocus').value=p.demand+' Verificação: '+p.proof;$('pfPlan').querySelectorAll('input[name="promise"]').forEach(x=>x.checked=p.items.includes(x.value));setContractProposal(p.items,p.proof,p.primary);rememberDraft();$('pfPlan').scrollIntoView({behavior:'smooth',block:'center'});$('pfFocus').focus();announce('Compromisso preparado. Revise e salve para confirmar.');}return;}
        if(b.dataset.editSmc){openSMC(b.dataset.editSmc);return;}
        if(b.dataset.adoptCoach!==undefined){const tip=A.coaching(analysis(day))[Number(b.dataset.adoptCoach)];if(tip&&$('pfPlan')){$('pfFocus').value=tip.action;$('pfPlan').querySelectorAll('input[name="promise"]').forEach(x=>x.checked=tip.items.includes(x.value));setContractProposal(tip.items,'Conferir '+tip.items.map(id=>analysis(day).checks.find(c=>c.id===id)?.label||id).join('; '));rememberDraft();$('pfPlan').scrollIntoView({behavior:'smooth',block:'center'});$('pfFocus').focus();announce('Sugestão colocada no compromisso. Revise e salve para confirmar.');}return;}
        if(b.dataset.action==='close-smc'){$('pfSMCDialog').close();return;}
        if(b.dataset.tab){tab=b.dataset.tab;render(true);return;}
        if(b.dataset.day){cancelMentor(false);day=b.dataset.day;tab='day';render(true);return;}
        const action=b.dataset.action;
        if(action==='import')$('pfCSV').click();
        if(action==='import-tv')$('pfTVCSV').click();
        if(action==='restore')$('pfBackup').click();
        if(action==='backup')download();
        if(action==='cancel-import'){stage=null;render(true);}
        if(action==='confirm-import'&&stage){
            const merged=A.mergeTrades(data.trades,stage.parsed.trades),next=JSON.parse(JSON.stringify(data));
            next.trades=merged.trades;const k=accountKey(stage.parsed.account);
            next.accounts[k]||={settings:{...A.DEFAULTS},reviews:{},plans:{},annotations:{},preparations:{}};
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
    function saveFollowup(target){
        if(!meta().plans[day]||!['noticed','barrier','evidence','barrierNote'].includes(target.dataset.followup))return;
        if(changeAccount(m=>{const p=m.plans[day];p.contract=S.contract({...p.contract,[target.dataset.followup]:target.value});}))announce('Acompanhamento salvo. O relato não altera a avaliação dos critérios.');
    }
    function setContractProposal(items,proof,primary){
        const priority=primary||(items.includes('stop')&&analysis(day).smc.stop.length?'stop':items[0]||'focus');
        $('pfPriority').value=priority;
        $('pfTrigger').value=priority==='pause'||priority==='streak'?'Após uma perda, quando surgir vontade de entrar novamente':'Quando eu considerar uma nova operação ou alterar sua gestão';
        $('pfProof').value=proof;
    }

    function rememberDraft(){
        if(!$('pfPlan'))return;
        planDrafts[account+'|'+day]={target:$('pfPlanDate').value,focus:$('pfFocus').value,contract:S.contract({priority:$('pfPriority').value,trigger:$('pfTrigger').value,proof:$('pfProof').value}),items:[...$('pfPlan').querySelectorAll('input[name="promise"]:checked')].map(x=>x.value)};
    }
    function input(e){
        if(e.target.id==='pfMentorQuestion'){mentorQuestion=e.target.value.slice(0,600);return;}
        if(e.target.dataset.followup){saveFollowup(e.target);return;}
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
        if(['pfAccount','pfDay'].includes(e.target.id))cancelMentor(false);
        if(e.target.closest('#pfSMCForm')){previewSMC();return;}
        const t=e.target;
        if(t.id==='pfCSV'){readFile(t.files[0]);t.value='';}
        else if(t.id==='pfTVCSV'){readFile(t.files[0],false,'tradingview');t.value='';}
        else if(t.id==='pfBackup'){readFile(t.files[0],true);t.value='';}
        else if(t.id==='pfAccount'){account=t.value;insightAsset='';prepDay='';day=availableDays().at(-1)||'';render(true);}
        else if(t.id==='pfDay'){day=t.value;render(true);}
        else if(t.id==='pfPrepDate'){if(A.validDay(t.value)){prepDay=t.value;render(true);}}
        else if(t.id==='pfInsightAsset'){insightAsset=t.value;render(true);}
        else if(t.dataset.followup)saveFollowup(t);
        else if(t.dataset.context)saveReview('context:'+t.dataset.context,t.value);
        else if(t.dataset.review)saveReview(t.dataset.review,t.value);
        else if(t.dataset.field)saveAnnotation(t);
        else if(t.id==='pfReflection'){if(changeAccount(m=>m.plans[day].reflection=t.value))announce('Avaliação do compromisso salva.');}
        else if(t.closest('#pfPlan')){
            if(t.id==='pfPlanDate'){
                const p=meta().plans[t.value];
                if(p){planDrafts[account+'|'+day]={target:t.value,focus:p.focus,items:p.items,contract:p.contract};render(true);return;}
            }
            rememberDraft();
        }
    }
    function submit(e){
        e.preventDefault();
        if(e.target.id==='pfPrepForm'){
            try{
                if(!A.validDay(prepDay))throw Error('Escolha uma data válida.');
                if(meta().preparations?.[prepDay]&&trades().some(t=>t.open.slice(0,10)===prepDay))throw Error('Preparação preservada: este pregão já tem entradas importadas. Registre mudanças no debrief e no próximo pregão.');
                const values=Object.fromEntries(new FormData(e.target).entries());
                const cents=values.riskCents.trim()?Math.round(A.numberBR(values.riskCents)*100):null;
                const stamp=localStamp(),old=meta().preparations?.[prepDay];
                const record=S.preparation({...values,riskCents:cents,rules:dayRules(prepDay),created:old?.created||stamp,updated:stamp});
                if(S.prepStatus(record,prepDay,[]).kind==='incomplete')throw Error('Preencha condições do setup, exceções, risco, estado percebido, gatilho e resposta antes de salvar.');
                if(changeAccount(m=>{m.preparations||={};m.preparations[prepDay]=record;})){announce('Preparação salva para '+date(prepDay)+'. O horário será comparado com a primeira entrada importada.');render(true);}
                else $('pfPrepError').textContent='Não foi possível salvar. Os campos continuam disponíveis.';
            }catch(err){$('pfPrepError').textContent=err.message;}return;
        }
        if(e.target.id==='pfDeskForm'){
            const values=Object.fromEntries(new FormData(e.target).entries());
            const required=['moment','thought','choice','alternative','action','proof'];
            if(required.some(k=>!String(values[k]||'').trim())){$('pfDeskError').textContent='Complete o episódio, pensamento, decisão, alternativa, ação e evidência de cumprimento.';return;}
            if(!$('pfDeskAck').checked){$('pfDeskError').textContent='Confirme que você conferiu os fatos antes de concluir.';return;}
            if(!Object.entries(meta().plans).some(([target,p])=>target>day&&p.from===day)){$('pfDeskError').textContent='Salve o compromisso para o próximo pregão antes de concluir o debrief.';return;}
            const reconciliation=journalReport();
            if(['missing','mismatch'].includes(reconciliation.status)){$('pfDeskError').textContent='Conciliação obrigatória: resolva a falta de registros ou a divergência em Diário × execução antes de concluir. Seu rascunho foi preservado.';return;}
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
            if(!d.contract.priority||!d.contract.trigger||!d.contract.proof||!d.focus.trim()){announce('Defina uma prioridade, um gatilho, uma ação e sua evidência de cumprimento.',true);return;}
            if(!items.includes(d.contract.priority))items.push(d.contract.priority);
            if(d.focus.trim()&&!items.includes('focus'))items.push('focus');
            if(!items.length){announce('Escolha uma regra ou descreva uma ação concreta.',true);return;}
            if(meta().plans[d.target]&&!confirm('Já existe um compromisso para '+date(d.target)+'. Substituir pelo plano exibido?'))return;
            if(changeAccount(m=>m.plans[d.target]={from:day,rules:{...meta().settings},items,focus:d.focus.trim(),created:new Date().toISOString(),reflection:'',contract:d.contract})){
                announce('Compromisso salvo para '+date(d.target)+'. Importe esse pregão para conferir o cumprimento.');
                $('pfPlanSaved').textContent='Compromisso salvo para '+date(d.target)+'.';
                if($('pfDeskPlanHint')){$('pfDeskPlanHint').textContent='Compromisso salvo para '+date(d.target)+'.';const report=deskReport();if(report.stale)$('pfDeskBadge').textContent='Plano mudou · reconferir';}
            }
        }
    }
    function cancelMentor(clearKey){
        mentorToken++;mentorController?.abort();mentorController=null;mentorBusy=false;
        mentorStatus='';mentorQuestion='';mentorUnsaved=null;
        if(clearKey){mentorKey='';mentorModel='';}
    }
    function mentorContext(question=mentorQuestion){
        if(typeof DiaryMentor==='undefined')throw Error('Atualize a página para carregar o Mentor.');
        const s=diarySnapshot();if(!ready||!s.ready)throw Error(s.reason||'Carregue os registros deste perfil antes de analisar.');
        const linked=new Set(trades().map(t=>data.journalLinks[t.id]?.diaryId).filter(Boolean));
        const diary=account==='__diary__'?s.rows:s.rows.filter(t=>linked.has(t.id));
        const journal=J.report({profit:trades(),diary,links:data.journalLinks,annotations:meta().annotations,day,ready:true,requireLinks:account!=='__diary__'});
        return DiaryMentor.buildContext({day,diary,executions:trades(),meta:meta(),annotations:effectiveAnnotations(),
            source:account==='__diary__'?'Diário manual (BRL)':isTV()?'TradingView Paper Trading (simulado, USD)':'Profit (BRL)',currency:currency(),reconciliation:journal,question});
    }
    function mentorAccountMarkup(){
        const s=mentorAccountState;
        let title='Entre na sua conta para conferir a chave no Supabase.',detail='',tone='';
        if(localOwner()!=='guest'){
            if(s.busy)title='Sincronizando a chave com o Supabase…';
            else if(s.status==='error'){title='Não foi possível confirmar a chave no Supabase.';detail='Use Recarregar da conta para tentar novamente.';tone='warning';}
            else if(s.status==='saved'){
                title='✓ Chave API salva no Supabase e sincronizada com sua conta.';
                detail='Confirmado em '+new Date(s.verifiedAt).toLocaleString('pt-BR')+'. Disponível ao entrar com o mesmo login em outro computador.';
                tone='success';
            }else if(s.status==='empty')title='Nenhuma chave API salva no Supabase para esta conta.';
            else title='Aguardando confirmação da chave no Supabase.';
        }
        return '<div id="pfMentorAccountStatus" class="mentor-account-status '+tone+'" role="status" aria-live="polite"><strong>'+esc(title)+'</strong>'+(detail?'<p>'+esc(detail)+'</p>':'')+'</div>';
    }
    function mentorMarkup(){
        if(typeof DiaryMentor==='undefined')return '<p class="pf-note">Atualize a página para carregar o Mentor de execução.</p>';
        let packet=null,reason='';try{packet=mentorContext();}catch(e){reason=e.message;}
        const saved=mentorUnsaved||meta().aiReviews?.[day];
        let stale=false;
        if(saved){try{stale=DiaryMentor.signature(mentorContext(saved.packet.question))!==saved.signature;}catch{stale=true;}}
        const c=packet?.coverage,readOnly=cycleScope!=='active';
        return '<section class="pf-card mentor-card"><h2>Análise do pregão</h2>'+
            mentorAccountMarkup()+
            (!c?'<p class="pf-note">'+esc(reason)+'</p>':'')+
            (readOnly?'<p class="pf-note">Ciclo arquivado: consulte a análise salva. Novas análises são feitas no ciclo atual.</p>':
            '<details class="mentor-config"'+(!mentorKey?' open':'')+'><summary>Minha chave Gemini · '+(mentorAccountState.saved?'salva na conta':mentorKey?'somente nesta aba':'não configurada')+'</summary><div class="mentor-config-grid"><label>Chave da API<input id="pfMentorKey" type="password" autocomplete="off" spellcheck="false" placeholder="Cole sua chave do Google AI Studio"></label></div><p class="pf-small pf-muted">Salve na sua conta para usar a mesma chave em outro computador após o login. Ela fica em uma configuração privada no Supabase e é carregada pelo navegador autenticado para chamar o Google. Não entra nos backups, PDFs ou código do site. Em computador compartilhado, saia da conta ao terminar.</p><div class="pf-buttons"><button class="btn btn-primary" data-mentor="save-key"'+(mentorBusy||mentorAccountState.busy||localOwner()==='guest'?' disabled':'')+'>Salvar na minha conta</button><button class="btn" data-mentor="connect"'+(mentorBusy||mentorAccountState.busy?' disabled':'')+'>Usar só nesta aba</button><button class="btn btn-ghost" data-mentor="reload-key"'+(mentorAccountState.busy||localOwner()==='guest'?' disabled':'')+'>Recarregar da conta</button><button class="btn btn-ghost" data-mentor="remove-key"'+(mentorBusy||mentorAccountState.busy||localOwner()==='guest'?' disabled':'')+'>Remover da conta</button><button class="btn btn-ghost" data-mentor="forget">Limpar desta aba</button></div><p class="pf-small" role="status">'+esc(mentorAccountState.message||(localOwner()==='guest'?'Entre em Conta e sincronização para salvar sua chave.':''))+'</p></details>'+
            '<label class="mentor-question">Foco da análise <span class="pf-muted">(opcional)</span><textarea id="pfMentorQuestion" rows="2" maxlength="600" placeholder="Ex.: entradas fora do plano depois de perder">'+esc(mentorQuestion)+'</textarea></label>'+
            '<div class="pf-buttons"><button class="btn btn-primary" data-mentor="analyze"'+(!packet||!mentorKey||mentorBusy?' disabled':'')+'>'+(mentorBusy?'Analisando…':'Analisar meu pregão')+'</button>'+(mentorBusy?'<button class="btn" data-mentor="cancel">Cancelar análise</button>':'')+'</div><p class="pf-small pf-muted">Envia os registros ao Google. As tentativas usam a cota da sua chave.</p>')+
            '<p id="pfMentorStatus" role="status" aria-live="polite">'+esc(mentorStatus)+'</p>'+
            (packet?'<details class="mentor-evidence mentor-input-details"><summary>Dados e critérios da análise · '+c.days+' pregões</summary><p>'+esc(c.from)+' a '+esc(c.to)+' · '+esc(packet.source)+'. '+c.documentedDiary+'/'+c.diaryRecords+' registros com racional; '+c.knownRisk+'/'+c.executions+' execuções com risco informado; '+c.rulesPassed+'/'+c.rulesEvaluated+' checagens dentro das regras; '+c.pendingChecks+' pendentes.</p><p>Detalhes limitados às primeiras 30 operações de cada fonte no dia. Imagens, email e números de conta não são incluídos automaticamente. Confira informações pessoais nos relatos.</p><p>Ordem automática: 3.8 Flash → 3 Flash → 3.5 Flash-Lite → 3.1 Flash-Lite → 2.5 Flash → Gemma 4 31B. Modelos indisponíveis são pulados; cada tentativa tem limite de 90 segundos. A IA pode interpretar errado; confira as evidências.</p><pre>'+esc(JSON.stringify(packet,null,2))+'</pre></details>':'')+
            (saved?(stale?'<p class="pf-warning">Os registros mudaram ou estão indisponíveis desde esta análise. Ela descreve o contexto salvo; gere outra antes de adotar novas ações.</p>':'')+
                (mentorUnsaved?'<p class="pf-warning">Esta análise ainda não foi salva. Libere espaço e tente novamente.</p><button class="btn" data-mentor="save">Tentar salvar análise</button>':'')+
                DiaryMentor.renderReport(saved)+(!readOnly&&!stale?'<button class="btn btn-primary" data-mentor="adopt">Preparar compromisso a partir da prioridade</button><p class="pf-small pf-muted">Você revisa e salva o compromisso. As regras de risco não são alteradas pela IA.</p>':''):
                '')+'</section>';
    }
    function mentorAction(action){
        if(['save-key','remove-key','reload-key'].includes(action)){
            if(!mentorAccount||mentorBusy||mentorAccountState.busy)return;
            if(action==='save-key'){
                const key=$('pfMentorKey')?.value.trim()||mentorKey,model=$('pfMentorModel')?.value.trim()||DiaryMentor.DEFAULT_MODEL;
                if($('pfMentorKey'))$('pfMentorKey').value='';
                mentorAccount.save({key,model});
            }else if(action==='remove-key')mentorAccount.remove();
            else mentorAccount.reload();
            return;
        }
        if(action==='cancel'){cancelMentor(false);mentorStatus='Análise cancelada. O histórico anterior foi preservado.';render(true);return;}
        if(action==='forget'){if(mentorAccountState.busy)return;cancelMentor(true);mentorStatus='Chave limpa desta aba. A chave salva na conta, se houver, permanece disponível no próximo login.';render(true);return;}
        if(cycleLocked())return;
        if(action==='connect'){
            if(mentorAccountState.busy)return;
            const key=$('pfMentorKey')?.value.trim()||mentorKey,model=$('pfMentorModel')?.value.trim()||DiaryMentor.DEFAULT_MODEL;
            if(key.length<20||key.length>300||/\s/.test(key)){mentorStatus='Cole uma chave válida do Google AI Studio.';}
            else if(!/^gemini-[a-z0-9.-]{2,70}$/.test(model)){mentorStatus='Confira o identificador do modelo Gemini.';}
            else{mentorKey=key;mentorModel=model;mentorStatus='Chave configurada somente nesta aba. A conexão será verificada ao analisar.';}
            if($('pfMentorKey'))$('pfMentorKey').value='';render(true);return;
        }
        if(action==='analyze'){runMentor();return;}
        if(action==='save'&&mentorUnsaved){
            if(changeAccount(m=>{m.aiReviews||={};m.aiReviews[day]=mentorUnsaved;})){mentorUnsaved=null;mentorStatus='Análise salva no ciclo atual.';render(true);}return;
        }
        if(action==='adopt'){
            const saved=mentorUnsaved||meta().aiReviews?.[day];if(!saved)return;
            try{if(DiaryMentor.signature(mentorContext(saved.packet.question))!==saved.signature)throw Error('Atualize a análise antes de preparar o compromisso.');}
            catch(e){mentorStatus=e.message;render(true);return;}
            const p=saved.report.priority;tab='desk';render(true);
            if($('pfPlan')){
                $('pfFocus').value=p.action;setContractProposal([p.rule,'focus'],p.metric,p.rule);$('pfTrigger').value=p.trigger;
                $('pfPlan').querySelectorAll('input[name="promise"]').forEach(x=>x.checked=[p.rule,'focus'].includes(x.value));
                rememberDraft();$('pfPlan').scrollIntoView({behavior:'smooth',block:'center'});
                announce('Prioridade da IA preparada. Confira o gatilho, a ação e a métrica antes de salvar.');
            }return;
        }
    }
    async function runMentor(){
        if(mentorBusy||!mentorKey||cycleLocked())return;
        let packet;try{packet=mentorContext($('pfMentorQuestion')?.value??mentorQuestion);}catch(e){mentorStatus=e.message;render(true);return;}
        mentorQuestion=packet.question;
        const signature=DiaryMentor.signature(packet),who=localOwner(),which=account,scope=cycleScope,when=day,token=++mentorToken;
        mentorBusy=true;mentorStatus='Lendo evidências e preparando seu treino…';mentorController=new AbortController();
        const controller=mentorController;render(true);
        try{
            const {report,model}=await DiaryMentor.analyzeWithFallback({key:mentorKey,packet,signal:controller.signal,onProgress:progress=>{
                if(token!==mentorToken)return;
                mentorStatus=progress.phase==='listing'?'Consultando modelos disponíveis…':'Analisando com '+progress.model+' · tentativa '+progress.attempt+'/'+progress.total;
                if($('pfMentorStatus'))$('pfMentorStatus').textContent=mentorStatus;
            }});
            if(token!==mentorToken||who!==localOwner()||which!==account||scope!==selectedCycle()||when!==day)return;
            if(signature!==DiaryMentor.signature(mentorContext(packet.question)))throw Error('Os registros mudaram durante a análise. O resultado foi descartado; analise novamente.');
            const saved=DiaryMentor.validateSaved({version:1,model,createdAt:new Date().toISOString(),signature,packet,report});
            if(changeAccount(m=>{m.aiReviews||={};m.aiReviews[day]=saved;})){mentorUnsaved=null;mentorStatus='Análise salva neste ciclo. Confira as evidências e prepare seu próximo compromisso.';}
            else{mentorUnsaved=saved;mentorStatus='A análise foi gerada, mas ainda não pôde ser salva no navegador.';}
        }catch(e){
            if(token===mentorToken)mentorStatus=controller.signal.aborted?'Análise cancelada.':e instanceof TypeError?'Não foi possível conectar ao Gemini. Confira sua conexão e as restrições da chave.':e.message;
        }finally{
            if(token===mentorToken){mentorBusy=false;mentorController=null;render(true);}
        }
    }
    function readCycleRoot(){
        const raw=localStorage.getItem(STORAGE+localOwner());
        return raw?validateBackup(JSON.parse(raw)):blank();
    }
    function hasCycleContent(value){
        return !!(value.trades.length||value.imports.length||Object.values(value.accounts).some(m=>
            ['reviews','plans','preparations','annotations','aiReviews'].some(k=>Object.keys(m[k]||{}).length)));
    }
    function cycleGroups(){
        try{return Object.entries(readCycleRoot().archivedCycles||{}).map(([id,c])=>({id,name:c.name,createdAt:c.createdAt,count:0,psychology:true}));}
        catch{return [];}
    }
    function hasActiveCycle(){try{return hasCycleContent(readCycleRoot());}catch{return false;}}
    function cycleReadiness(){
        if(mentorBusy)return 'Conclua ou cancele a análise do Mentor antes de arquivar.';
        if(mentorUnsaved)return 'Salve a análise pendente do Mentor antes de arquivar este ciclo.';
        if(busy||stage)return 'Conclua ou cancele a importação aberta na Psicologia antes de arquivar.';
        if(localStorage.getItem(STORAGE+localOwner()+'_cycle_pending'))return 'Psicologia aguardando a conclusão do ciclo. Atualize os dados da nuvem ou reabra o diário para recuperar.';
        try{readCycleRoot();return '';}catch(e){return 'Recupere o backup da Psicologia antes de arquivar: '+e.message;}
    }
    function prepareCycle(kind,meta,ids){
        const reason=cycleReadiness();if(reason)throw Error(reason);
        const key=STORAGE+localOwner(),root=readCycleRoot(),current=JSON.parse(JSON.stringify(root));
        delete current.archivedCycles;
        const archives={...(root.archivedCycles||{})};let after;
        if(kind==='archive'){
            archives[meta.id]={name:meta.name,createdAt:meta.createdAt,data:current};
            after={...blank(),archivedCycles:archives};
        }else{
            if(!archives[meta.id])return null;
            const previous=archives[meta.id].data;
            after=JSON.parse(JSON.stringify(current));
            const mergeMap=(left,right,label)=>{
                const merged={...left};
                for(const [id,value] of Object.entries(right||{})){
                    if(Object.hasOwn(merged,id)&&JSON.stringify(merged[id])!==JSON.stringify(value))throw Error(`Há registros diferentes em ${label} (${id}). O ciclo atual e o arquivo foram preservados. Consulte ou exporte ambos separadamente.`);
                    merged[id]=value;
                }
                return merged;
            };
            after.trades=Object.values(mergeMap(Object.fromEntries(after.trades.map(t=>[t.id,t])),Object.fromEntries(previous.trades.map(t=>[t.id,t])),'execuções psicológicas'));
            after.journalLinks=mergeMap(after.journalLinks,previous.journalLinks,'vínculos do diário');
            for(const [key,m] of Object.entries(previous.accounts)){
                if(!after.accounts[key]){after.accounts[key]=m;continue;}
                for(const field of ['reviews','plans','preparations','annotations','aiReviews'])after.accounts[key][field]=mergeMap(after.accounts[key][field],m[field],field);
            }
            after.imports=[...previous.imports,...after.imports];
            delete archives[meta.id];after.archivedCycles=archives;
        }
        after=validateBackup(after);
        const transaction={kind,id:meta.id,ids:[...ids],after,key};
        // Reserve the complete psychological history before any trade/cloud mutation.
        localStorage.setItem(key+'_cycle_pending',JSON.stringify(transaction));
        return transaction;
    }
    function completeCycle(transaction){
        if(!transaction)return;
        localStorage.setItem(transaction.key,JSON.stringify(transaction.after));
        localStorage.removeItem(transaction.key+'_cycle_pending');owner=null;
    }
    function cancelCycle(transaction){
        if(transaction)localStorage.removeItem(transaction.key+'_cycle_pending');
    }
    function cycleReportHTML(scope=selectedCycle()){
        const reason=cycleReadiness();if(reason)throw Error(reason);
        const root=readCycleRoot(),archives=root.archivedCycles||{};
        const cycles=scope==='all'?[{name:'Ciclo atual',data:root},...Object.values(archives)]
            :scope==='active'?[{name:'Ciclo atual',data:root}]:archives[scope]?[archives[scope]]:[];
        const labels={before:'Estado antes',after:'Estado depois',energy:'Energia',urge:'Urgência de recuperar',setup:'Respeito ao setup',good:'Acertos',trigger:'Gatilho',lesson:'Aprendizado',contexts:'Contextos revisados',
            moment:'Episódio',thought:'Pensamento',feeling:'Emoção',choice:'Decisão tomada',alternative:'Alternativa',action:'Próxima ação',proof:'Evidência esperada',completed:'Debrief concluído',
            setups:'Condições dos setups',exceptions:'Exceções previstas',response:'Resposta ao gatilho',sleep:'Descanso',tension:'Tensão',riskCents:'Risco por operação (centavos)',
            from:'Pregão de origem',focus:'Foco / compromisso',reflection:'Autoavaliação',contract:'Acompanhamento do compromisso',priority:'Prioridade',evidence:'Evidência registrada',noticed:'Quando percebeu',barrier:'Obstáculo',barrierNote:'Observação do obstáculo',items:'Regras escolhidas',
            rules:'Regras usadas',settings:'Configurações do plano',maxTrades:'Máximo de entradas',quickMinutes:'Intervalo mínimo (min)',minTargetR:'Alvo mínimo (R)',allowEarlyException:'Permitir exceção justificada',pauseMinutes:'Pausa após perda (min)',maxLosses:'Perdas seguidas',afternoon:'Início da tarde',endTime:'Última entrada',givebackPct:'Devolução do pico (%)',lossLimit:'Limite de perda',configured:'Regras personalizadas',
            exit:'Motivo de saída',notes:'Observações',riskCentsConfirmed:'Risco confirmado',entryContracts:'Contratos de entrada',stopPlanned:'Stop planejado',created:'Registrado em',updated:'Atualizado em'};
        const values={calm:'Calmo e presente',anxious:'Ansioso',frustrated:'Frustrado',euphoric:'Eufórico',tired:'Cansado',pending:'Pendente',confirmed:'Confirmado',planned:'Previsto no plano',yes:'Sim',no:'Não',partial:'Parcial',rested:'Descansado',regular:'Regular',poor:'Ruim',before:'Antes',after:'Depois',not:'Não percebeu',none:'Nenhum',unclear:'Pouco claro',impractical:'Impraticável',late:'Tarde',notused:'Não utilizado',other:'Outro'};
        const fields=obj=>'<dl>'+Object.entries(obj||{}).filter(([k,v])=>!['signature','deskPolicy'].includes(k)&&v!==''&&v!==null&&v!==undefined).map(([k,v])=>
            '<div><dt>'+esc(labels[k]||k)+'</dt><dd>'+ (typeof v==='object'&&!Array.isArray(v)?fields(v):esc(typeof v==='boolean'?(v?'Sim':'Não'):Array.isArray(v)?v.map(x=>labels[x]||values[x]||x).join(', '):values[v]||v))+'</dd></div>').join('')+'</dl>';
        const content=cycles.filter(c=>hasCycleContent(c.data)).map(c=>{
            const accounts=Object.entries(c.data.accounts).map(([key,m])=>{
                const name=masked(key.slice('account:'.length));
                const executions=c.data.trades.filter(t=>accountKey(t.account)===key);
                const dates=[...new Set([...A.dates(executions),...Object.keys(m.reviews||{}),...Object.keys(m.plans||{}),...Object.keys(m.preparations||{}),...Object.keys(m.aiReviews||{})])].sort();
                const days=dates.map(d=>{
                    const review=m.reviews?.[d],plan=m.plans?.[d],prep=m.preparations?.[d];
                    const analysis=executions.length?A.analyzeDay(executions,d,plan?.rules||review?.rules||prep?.rules||m.settings,m.annotations):null;
                    const checks=analysis&&(analysis.entries.length||analysis.closed.length)
                        ?'<h4>Leitura das execuções importadas</h4><p>'+analysis.entries.length+' entradas · '+analysis.closed.length+' operações fechadas · maior sequência de perdas: '+analysis.maxStreak+'. Estes sinais descrevem as execuções; o estado emocional depende do seu relato.</p><ul>'+analysis.checks.map(x=>'<li>'+esc(x.label)+': '+(x.pass===null?'Pendente':x.pass?'Dentro da regra':'Requer revisão')+(x.detail?' · '+esc(x.detail):'')+'</li>').join('')+'</ul>':'';
                    return '<article><h3>'+esc(name)+' · '+esc(date(d))+'</h3>'+
                        checks+
                        (prep?'<h4>Preparação</h4>'+fields(prep):'')+
                        (review?'<h4>Revisão psicológica</h4>'+fields(Object.fromEntries(Object.entries(review).filter(([k])=>k!=='desk')))+(review.desk?'<h4>Debrief / decisões</h4>'+fields(review.desk):''):'')+
                        (plan?'<h4>Compromisso para este pregão</h4>'+fields(plan):'')+
                        (m.aiReviews?.[d]&&typeof DiaryMentor!=='undefined'?'<h4>Mentor de execução · análise salva</h4>'+DiaryMentor.renderReport(m.aiReviews[d]):'')+'</article>';
                }).join('');
                const annotations=Object.entries(m.annotations||{}).map(([id,n])=>{
                    const t=c.data.trades.find(t=>t.id===id);
                    return '<article><h3>Revisão da execução · '+esc(t?`${t.symbol} · ${t.open}`:id)+'</h3>'+fields(n)+'</article>';
                }).join('');
                return days+annotations;
            }).join('');
            return '<section class="psychology-cycle"><h2>'+esc(c.name)+' · Psicologia</h2><p>'+c.data.trades.length+' execuções importadas do Profit/TradingView neste ciclo. Registros psicológicos preservados abaixo; valores dessas importações não são somados ao resumo financeiro do diário.</p>'+accounts+'</section>';
        }).join('');
        return content?'<section class="psychology-report"><h1>Psicologia · revisão e evolução</h1>'+content+'</section>':'';
    }
    return {init,render,authChanged,validateBackup,cycleGroups,hasActiveCycle,cycleReadiness,prepareCycle,completeCycle,cancelCycle,cycleReportHTML};
})();
