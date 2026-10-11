/* Manual backtests: independent of live trades; stable entries with deletion markers. */
const Backtests = (() => {
    const TABLE = 'backtest_entries';
    const WEEKDAYS = [{value:1,label:'Segunda-feira',short:'Segunda'},{value:2,label:'Terça-feira',short:'Terça'},{value:3,label:'Quarta-feira',short:'Quarta'},{value:4,label:'Quinta-feira',short:'Quinta'},{value:5,label:'Sexta-feira',short:'Sexta'}];
    let owner = null, records = [], active = null, editing = null, busy = false, message = '', timer, storageReady = true;
    let dayContext = null, daySelection = 'new', selectedWeekday = null;
    const el = id => document.getElementById(id);
    const key = who => `diarioBacktests_v1_${who}`;
    const esc = value => String(value).replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
    const number = n => (n === 0 ? 0 : n).toLocaleString('pt-BR', {maximumFractionDigits:2});
    const rfmt = n => `${n > 0 ? '+' : ''}${number(n)}R`;
    const selectedUnit = () => sessions().find(s=>s.id===active)?.unit==='brl' ? 'brl' : 'r';
    const validAmount = value => typeof value==='number' && Number.isFinite(value);
    function tradeValues(trade) {
        const stop=Math.round(trade.stopCash*100), target=Math.round(trade.targetCash*100);
        const complete=validAmount(trade.stopCash) && stop>0 && Number.isSafeInteger(stop) && validAmount(trade.targetCash) && target>0 && Number.isSafeInteger(target) && ['target','stop','breakeven'].includes(trade.result);
        if (complete) {
            return {complete,result:trade.result,r:trade.result==='target'?target/stop:trade.result==='stop'?-1:0,cashPnl:trade.result==='target'?target/100:trade.result==='stop'?-stop/100:0};
        }
        // Older records keep their known result; missing amounts are never inferred.
        const r=validAmount(trade.r)?trade.r:null, cashPnl=validAmount(trade.cashPnl)?trade.cashPnl:null, value=r??cashPnl;
        return {complete:false,r,cashPnl,result:value===null?'unknown':value>0?'target':value<0?'stop':'breakeven'};
    }
    const valueOf = (trade,unit) => tradeValues(trade)[unit==='brl'?'cashPnl':'r'];
    const cashfmt = n => `${n>0?'+':n<0?'−':''}R$ ${Math.abs(n).toLocaleString('pt-BR',{minimumFractionDigits:2,maximumFractionDigits:2})}`;
    const formatValue = (n,unit) => unit==='brl' ? cashfmt(n) : rfmt(n);
    const totalLabel = (m,unit) => m.count && !m.valuedCount ? '—' : `${formatValue(m.total,unit)}${m.missingCount?' (parcial)':''}`;
    function parseCash(value) {
        let text = String(value).trim().replace(/−/g,'-').replace(/^([+-]?)\s*R\$\s*/,'$1').replace(/\s/g,'');
        if (text.includes(',')) {
            if (!/^[+-]?(?:\d+|\d{1,3}(?:\.\d{3})+),\d{1,2}$/.test(text)) return null;
            text = text.replace(/\./g,'').replace(',','.');
        } else if (/^[+-]?\d{1,3}(?:\.\d{3})+$/.test(text)) text = text.replace(/\./g,'');
        else if (!/^[+-]?\d+(?:\.\d{1,2})?$/.test(text)) return null;
        const amount = Number(text);
        return Number.isFinite(amount) && Number.isSafeInteger(Math.round(amount*100)) ? (amount===0 ? 0 : amount) : null;
    }
    function unitControls() {
        const unit=selectedUnit(), cash=unit==='brl', ts=trades(active), m=metrics(ts,unit);
        document.querySelectorAll('#view-backtests [data-unit]').forEach(button=>{
            button.classList.toggle('selected',button.dataset.unit===unit);
            button.setAttribute('aria-pressed',String(button.dataset.unit===unit));
        });
        el('btCurveInfo').textContent=`Curva acumulada em ${cash?'reais':'R'}. O stop é o risco de 1R; R do alvo = alvo em reais ÷ stop em reais.`;
        el('btStatsNote').textContent=`Acerto = alvos ÷ (alvos + stops), sem empates. Profit factor = ganhos ÷ perdas. Valores em ${cash?'reais':'R'}, sem taxas.${m.missingCount ? ` Cálculos financeiros parciais: ${m.valuedCount} de ${m.count} trades têm valores nesta unidade. Médias financeiras usam apenas os trades com valores; quantidade, acerto e sequências incluem todos.` : ''}`;
        el('btPartialNote').hidden=!m.missingCount;
        el('btPartialNote').textContent=`${m.missingCount} trade${m.missingCount===1?'':'s'} sem resultado em ${cash?'R$':'R'}. Curva e totais parciais; as lacunas indicam valores pendentes, não resultado zero.`;
        const pending=ts.filter(t=>!tradeValues(t).complete);
        el('btPendingValues').hidden=!pending.length;
        el('btPendingValues').innerHTML=pending.length ? `<span><strong>${pending.length} trade${pending.length===1?'':'s'} antigo${pending.length===1?'':'s'} com valores pendentes.</strong> Use “Preencher valores” na tabela para informar stop e alvo em reais. O resultado já registrado está preservado.</span><button type="button" class="btn btn-mini" data-edit="${esc(pending[0].id)}">Completar primeiro</button>` : '';
    }
    function formPreview() {
        const stopCash=parseCash(el('btStopCash').value), targetCash=parseCash(el('btTargetCash').value), result=document.querySelector('input[name="btResult"]:checked').value;
        const values=tradeValues({stopCash,targetCash,result});
        el('btAutoR').value=values.complete ? rfmt(values.r) : '—';
        el('btFormHelp').textContent=values.complete ? `Resultado: ${cashfmt(values.cashPnl)} · ${rfmt(values.r)}. Alvo / stop: ${number(targetCash/stopCash)}R.` : 'Digite stop e alvo em reais, ambos positivos. Alvo = lucro; stop = perda do risco; 0 a 0 = empate.';
        document.querySelectorAll('#btResultControls label').forEach(label=>label.classList.toggle('selected',label.querySelector('input').value===result));
    }
    function read(who) {
        const data = JSON.parse(localStorage.getItem(key(who)) || '[]');
        if (!Array.isArray(data)) throw new Error('Backup local inválido');
        return data;
    }
    function save(next) {
        if (!storageReady) { alert("Dados locais inválidos. Recupere o backup antes de gravar novos registros."); return false; }
        try { localStorage.setItem(key(owner), JSON.stringify(next)); records = next; return true; }
        catch (e) { alert('Não foi possível salvar no navegador. Nenhuma alteração foi aplicada. Exporte seu backup e verifique o espaço disponível.'); return false; }
    }
    const sessions = () => records.filter(x => x.kind === 'session' && !x.deleted);
    const trades = id => records.filter(x => x.kind === 'trade' && x.parent === id && !x.deleted).sort((a,b) => a.created.localeCompare(b.created) || a.id.localeCompare(b.id));
    const days = id => records.filter(x=>x.kind==='day' && x.parent===id && !x.deleted).sort((a,b)=>a.number-b.number || a.created.localeCompare(b.created) || a.id.localeCompare(b.id));
    const weekdayName = value => WEEKDAYS.find(d=>d.value===value)?.label || 'Sem dia informado';
    const dayLabel = day => `Dia ${day.number} · ${weekdayName(day.weekday)}${day.date ? ` · ${day.date.split('-').reverse().join('/')}` : ''}`;
    function replayWeekday(value) {
        if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return null;
        const [y,m,d] = value.split('-').map(Number), date = new Date(Date.UTC(y,m-1,d));
        return date.getUTCFullYear()===y && date.getUTCMonth()===m-1 && date.getUTCDate()===d ? date.getUTCDay() : null;
    }
    function loadDay() {
        const session = sessions().find(s=>s.id===active), day = days(active).find(d=>d.id===session?.currentDay);
        dayContext = active; daySelection = day?.id || 'new'; selectedWeekday = day?.weekday || null;
        el('btDayDate').value = day?.date || '';
    }
    function dayControls() {
        const list = days(active), day = list.find(d=>d.id===daySelection);
        document.querySelectorAll('[data-resume-day]').forEach(button=>button.disabled=Boolean(editing));
        document.querySelectorAll('#btWeekdays [data-weekday]').forEach(button=>{
            const selected = selectedWeekday===Number(button.dataset.weekday);
            button.classList.toggle('selected',selected); button.setAttribute('aria-pressed',String(selected));
        });
        el('btDayGroupField').hidden = !editing;
        el('btDayGroup').innerHTML = `<option value="">Sem dia informado</option><option value="new">Criar novo grupo de dia</option>${list.map(d=>`<option value="${esc(d.id)}">${esc(dayLabel(d))}</option>`).join('')}`;
        el('btDayGroup').value = daySelection;
        const count = day ? trades(active).filter(t=>t.dayId===day.id).length : 0;
        el('btDayStatus').textContent = day ? `${dayLabel(day)} · ${count} trade${count===1?'':'s'}` :
            selectedWeekday ? `${editing?'Novo grupo para este trade':'O próximo trade começa um novo dia'} · ${weekdayName(selectedWeekday)}` :
            editing && daySelection==='' ? 'Este trade ainda não tem dia. Escolha um grupo existente ou selecione o dia da semana.' : 'Selecione o dia da semana do replay para registrar os trades.';
    }
    function selectWeekday(value) {
        if (!WEEKDAYS.some(d=>d.value===value)) return;
        const day = days(active).find(d=>d.id===daySelection);
        if (day && day.weekday!==value) { daySelection='new'; el('btDayDate').value=''; }
        if (daySelection==='') daySelection='new';
        selectedWeekday = value; dayControls();
    }
    function weekdayStats(list, dayList, unit='r') {
        const byId = new Map(dayList.map(d=>[d.id,d]));
        const groups = WEEKDAYS.map(d=>{
            const ts = list.filter(t=>byId.get(t.dayId)?.weekday===d.value), m = metrics(ts,unit);
            const countDays = new Set(ts.map(t=>t.dayId)).size, valuedDays=new Set(ts.filter(t=>valueOf(t,unit)!==null).map(t=>t.dayId)).size;
            return {...d,...m,days:countDays,avgDay:valuedDays ? m.total/valuedDays : null};
        });
        return {groups,unassigned:list.filter(t=>!WEEKDAYS.some(d=>d.value===byId.get(t.dayId)?.weekday)).length};
    }
    function metrics(list, unit='r') {
        const scale=unit==='brl'?100:1;
        let total = 0, peak = 0, dd = 0, wins = 0, losses = 0, grossWins = 0, grossLosses = 0;
        let valuedCount=0, valuedWins=0, valuedLosses=0, breakevens=0, otherTargets=0;
        let largestWin = 0, largestLoss = 0, winStreak = 0, lossStreak = 0, bestWinStreak = 0, worstLossStreak = 0;
        const points = [0], targets = {1:0, 2:0, 3:0};
        list.forEach(t => {
            const values=tradeValues(t), amount=valueOf(t,unit), value=amount===null?null:unit==='brl'?Math.round(amount*100):amount;
            if (values.result==='target') {
                wins++;
                winStreak++; lossStreak = 0; bestWinStreak = Math.max(bestWinStreak, winStreak);
                if (values.r!==null) { if (values.r in targets) targets[values.r]++; else otherTargets++; }
            } else if (values.result==='stop') {
                losses++;
                lossStreak++; winStreak = 0; worstLossStreak = Math.max(worstLossStreak, lossStreak);
            } else { if(values.result==='breakeven')breakevens++; winStreak = 0; lossStreak = 0; }
            if (value===null) { points.push(null); return; }
            valuedCount++; total+=value;
            if(value>0) { valuedWins++;grossWins+=value;largestWin=Math.max(largestWin,value); }
            if(value<0) { valuedLosses++;grossLosses-=value;largestLoss=Math.min(largestLoss,value); }
            peak = Math.max(peak, total); dd = Math.max(dd, peak - total); points.push(total/scale);
        });
        const count = list.length;
        return {total:total/scale, dd:dd/scale, wins, losses, count, breakevens, points, targets, otherTargets,valuedCount,valuedWins,valuedLosses,missingCount:count-valuedCount,
            grossWins:grossWins/scale, grossLosses:grossLosses/scale, largestWin:largestWin/scale, largestLoss:largestLoss/scale, bestWinStreak, worstLossStreak,
            winRate:wins+losses ? 100*wins/(wins+losses) : 0,
            expectancy:valuedCount ? total/scale/valuedCount : null, avgWin:valuedWins ? grossWins/scale/valuedWins : null,
            avgLoss:valuedLosses ? -grossLosses/scale/valuedLosses : null, profitFactor:grossLosses ? grossWins/grossLosses : null};
    }
    function tradeMode() {
        el('btTradeLegend').textContent = editing ? `Editar trade #${trades(active).findIndex(t=>t.id===editing)+1}` : 'Resultado do próximo trade';
        el('btSaveTrade').textContent = editing ? 'Salvar alterações' : 'Registrar trade';
        el('btCancelEdit').hidden = !editing;
        unitControls(); dayControls(); formPreview();
    }
    function clearEdit() {
        document.querySelectorAll('input[name="btResult"]').forEach(input=>input.checked=input.value==='target');
        el('btSetupTag').value = ''; el('btStopCash').value=''; el('btTargetCash').value=''; el('btLegacyEditNote').hidden=true;
        const wasEditing = Boolean(editing);
        editing = null; if (wasEditing) loadDay(); tradeMode();
    }
    function editTrade(id) {
        const trade = trades(active).find(t=>t.id===id);
        if (!trade) return;
        editing = id;
        const values=tradeValues(trade);
        document.querySelectorAll('input[name="btResult"]').forEach(input=>input.checked=input.value===(values.result==='unknown'?'target':values.result));
        el('btSetupTag').value = trade.setupTag || '';
        const inputValue=n=>n===null?'':n.toFixed(2).replace('.',',');
        el('btStopCash').value=inputValue(validAmount(trade.stopCash)?trade.stopCash:values.cashPnl<0?-values.cashPnl:null);
        el('btTargetCash').value=inputValue(validAmount(trade.targetCash)?trade.targetCash:values.cashPnl>0?values.cashPnl:null);
        el('btLegacyEditNote').hidden=values.complete;
        el('btLegacyEditNote').textContent=`Registro antigo: ${[values.r===null?null:rfmt(values.r),values.cashPnl===null?null:cashfmt(values.cashPnl)].filter(v=>v!==null).join(' · ')}. Informe stop e alvo em reais para completar este trade; R será recalculado ao salvar.`;
        const day = days(active).find(d=>d.id===trade.dayId);
        daySelection = day?.id || ''; selectedWeekday = day?.weekday || null; el('btDayDate').value = day?.date || '';
        tradeMode(); el('btTrade').scrollIntoView({behavior:'smooth',block:'center'});
        el('btStopCash').focus({preventScroll:true});
    }
    function renderStats(m,unit) {
        const cash=unit==='brl', fmt=value=>formatValue(value,unit);
        const percent = `${m.winRate.toLocaleString('pt-BR',{minimumFractionDigits:1,maximumFractionDigits:1})}%`;
        const optional = value => value === null ? '—' : fmt(value);
        const groups = [
            ['Operações', [
                ['Quantidade de trades',m.count],['Alvos atingidos',m.wins],['Stops',m.losses],['Empates',m.breakevens],
                ['Taxa de acerto',percent],...(!cash ? [['Alvos 1R / 2R / 3R / outros',`${m.targets[1]} / ${m.targets[2]} / ${m.targets[3]} / ${m.otherTargets}`]] : [])
            ]],
            [cash?'Retorno em R$':'Retorno em R', [
                ['Resultado acumulado',totalLabel(m,unit)],[cash?'Soma dos ganhos':'Ganhos brutos',m.count&&!m.valuedCount?'—':fmt(m.grossWins)],[cash?'Soma das perdas':'Perdas brutas',m.count&&!m.valuedCount?'—':fmt(-m.grossLosses)],
                ['Média por trade',optional(m.expectancy)],[cash?'Média dos ganhos':'Média dos alvos',optional(m.avgWin)],[cash?'Média das perdas':'Média dos stops',optional(m.avgLoss)]
            ]],
            ['Risco e sequências', [
                ['Profit factor',m.profitFactor === null ? (m.valuedWins ? 'Sem perdas' : '—') : number(m.profitFactor)],
                ['Drawdown máximo',m.count&&!m.valuedCount?'—':cash?cashfmt(m.dd).replace(/^\+/,''):`${number(m.dd)}R`],[cash?'Maior ganho':'Maior alvo',m.valuedWins ? fmt(m.largestWin) : '—'],
                ['Maior perda',m.valuedLosses ? fmt(m.largestLoss) : '—'],['Alvos consecutivos (máx.)',m.bestWinStreak],['Stops consecutivos (máx.)',m.worstLossStreak]
            ]]
        ];
        el('btStats').innerHTML = groups.map(([heading,rows])=>`<div class="bt-stats-group"><h3>${heading}</h3>${rows.map(([label,value])=>`<div class="metric-row"><span>${label}</span><strong>${value}</strong></div>`).join('')}</div>`).join('');
    }
    function renderWeekdays(list,unit) {
        const fmt=value=>formatValue(value,unit);
        const {groups,unassigned} = weekdayStats(list,days(active),unit);
        const eligible = groups.filter(g=>g.count && !g.missingCount);
        let comparison = 'A comparação aparece com valores completos em pelo menos dois dias da semana.';
        if (eligible.length>1) {
            const highest = Math.max(...eligible.map(g=>g.expectancy)), lowest = Math.min(...eligible.map(g=>g.expectancy));
            comparison = highest===lowest ? `Médias iguais entre os dias registrados: ${fmt(highest)} por trade.` :
                `Maior média por trade: ${eligible.filter(g=>g.expectancy===highest).map(g=>g.label).join(', ')} (${fmt(highest)}). Menor média: ${eligible.filter(g=>g.expectancy===lowest).map(g=>g.label).join(', ')} (${fmt(lowest)}).`;
        }
        if(groups.some(g=>g.missingCount))comparison+=' Complete os valores pendentes; dias da semana com dados incompletos ficam fora do ranking.';
        el('btWeekdayComparison').textContent = comparison;
        el('btWeekdayRows').innerHTML = groups.map(g=>`<tr><td>${g.label}</td><td>${g.days}</td><td>${g.count}</td><td>${g.wins}</td><td>${g.losses}</td><td>${g.breakevens}</td><td>${g.wins+g.losses ? `${number(g.winRate)}%` : '—'}</td><td class="${g.total>0?'win-text':g.total<0?'loss-text':''}">${g.count ? totalLabel(g,unit) : '—'}</td><td>${g.expectancy===null ? '—' : fmt(g.expectancy)}</td><td>${g.avgDay===null ? '—' : fmt(g.avgDay)}</td><td>${g.profitFactor===null ? (g.valuedWins ? 'Sem perdas' : '—') : number(g.profitFactor)}</td></tr>`).join('');
        el('btUnassignedDays').hidden = !unassigned;
        el('btUnassignedDays').textContent = `${unassigned} trade${unassigned===1?'':'s'} sem dia informado, fora desta comparação. Use Editar para associar cada trade ao dia correto.`;
    }
    function commit(next) {
        if (!save(next)) return false;
        message = owner === 'guest' ? 'Salvo neste navegador. Faça login para sincronizar.' : 'Salvo localmente · sincronização pendente';
        render(); clearTimeout(timer); timer = setTimeout(sync, 700); return true;
    }
    function authChanged() {
        const next = canUseCloud() ? currentUser.id : 'guest';
        if (next === owner) return;
        clearTimeout(timer); owner = next; active = null; busy = false;
        try { records = read(owner); storageReady = true; } catch (e) { storageReady = false; records = []; message = 'Falha ao ler dados locais. Exporte/recupere o backup antes de registrar.'; render(); return; }
        message = next === 'guest' ? 'Salvamento local automático · entre para sincronizar' : 'Dados desta conta · preparando sincronização';
        render(); if (next !== 'guest') timer = setTimeout(sync, 0);
    }
    async function sync() {
        if (busy || !storageReady || owner === 'guest' || !canUseCloud()) return;
        const who = owner; let succeeded = false;
        busy = true; message = 'Sincronizando…'; render();
        try {
            const pending = records.filter(x => x.dirty).map(x => ({...x}));
            for (let offset = 0; offset < pending.length; offset += 200) {
                const batch = pending.slice(offset, offset + 200);
                const {error} = await supabaseClient.from(TABLE).upsert(batch.map(({dirty, ...payload}) => ({id: payload.id, user_id: who, payload})), {onConflict:'id'});
                if (error) throw error;
                if (who !== owner) return;
                const sent = new Map(batch.map(x => [x.id, JSON.stringify(x)]));
                if (!save(records.map(x => sent.get(x.id) === JSON.stringify(x) ? {...x, dirty:false} : x))) throw new Error('Falha ao salvar confirmação local');
            }
            const remote = [];
            for (let start = 0; ; start += 500) {
                const {data, error} = await supabaseClient.from(TABLE).select('id,payload').eq('user_id',who).order('id').range(start,start+499);
                if (error) throw error;
                if (who !== owner) return;
                remote.push(...data.map(row => ({...row.payload, id:row.id, dirty:false})));
                if (data.length < 500) break;
            }
            const merged = new Map(records.map(x => [x.id,x]));
            remote.forEach(x => {
                const local = merged.get(x.id);
                merged.set(x.id, local?.dirty ? {...local, deleted: Boolean(local.deleted || x.deleted)} : x);
            });
            if (!save([...merged.values()])) throw new Error('Falha ao salvar cópia local');
            succeeded = true;
            message = records.some(x => x.dirty) ? 'Salvo localmente · sincronização pendente' : 'Sincronizado com Supabase · cópia local salva';
        } catch(e) {
            if (who !== owner) return;
            message = `Salvo localmente. Nuvem indisponível: ${e.message || e}. Se a tabela não existir, execute supabase-backtests.sql no SQL Editor do Supabase.`;
        } finally {
            if (who === owner) { busy = false; render(); if (succeeded && records.some(x => x.dirty)) timer = setTimeout(sync, 700); }
        }
    }
    function render() {
        if (!el('btList')) return;
        el('btStatus').textContent = message;
        el('btSync').disabled = busy || owner === 'guest';
        el('btImportLocal').hidden = owner === 'guest';
        const list = sessions().sort((a,b) => b.created.localeCompare(a.created));
        el('btList').innerHTML = list.length ? list.map(s => {
            const ts = trades(s.id), r = metrics(ts), cash = metrics(ts,'brl');
            const pending=ts.filter(t=>!tradeValues(t).complete).length;
            return `<tr><td><strong>${esc(s.name)}</strong><br><span class="muted">${esc(new Date(s.created).toLocaleString('pt-BR'))}</span>${pending ? `<br><span class="bt-pending-label">${pending} com valores pendentes</span>` : ''}</td><td>${ts.length}</td><td>${totalLabel(r,'r')}</td><td>${totalLabel(cash,'brl')}</td><td><div class="bt-history-actions"><button class="btn btn-mini" data-open="${esc(s.id)}">Continuar</button><button class="btn btn-mini btn-danger" data-delete="${esc(s.id)}">Excluir</button></div></td></tr>`;
        }).join('') : '<tr><td colspan="5" class="empty">Crie seu primeiro backtest: POI, Orderblock ou outra estratégia.</td></tr>';
        const session = list.find(x => x.id === active);
        el('btEditor').hidden = !session;
        if (!session) { clearEdit(); dayContext=null; return; }
        if (dayContext!==active) loadDay();
        el('btName').textContent = session.name;
        const unit=selectedUnit(), ts = trades(active), m = metrics(ts,unit), r=metrics(ts), cash=metrics(ts,'brl');
        if (editing && !ts.some(t=>t.id===editing)) clearEdit();
        tradeMode();
        el('btKpis').innerHTML = [[`Resultado (${unit==='brl'?'R$':'R'})`,m.count&&!m.valuedCount?'—':formatValue(m.total,unit)],['Trades',m.count],['Acerto',`${number(m.winRate)}%`],['Drawdown máximo',m.count&&!m.valuedCount?'—':unit==='brl'?cashfmt(m.dd).replace(/^\+/,''):`${number(m.dd)}R`]].map(([label,value])=>`<div class="kpi-card"><div class="label">${label}${m.missingCount && (label.startsWith('Resultado')||label==='Drawdown máximo')?' · parcial':''}</div><div class="value">${value}</div></div>`).join('');
        const amountCell=(value,unit)=>value===null?'<span class="bt-pending-label">Pendente</span>':formatValue(value,unit);
        const accumulatedCell=(values,i,unit)=>values.points[i+1]===null?'—':`${formatValue(values.points[i+1],unit)}${values.missingCount?' *':''}`;
        const history = ts.map((t,i) => {
            const values=tradeValues(t), result=values.result==='target'?'Alvo':values.result==='stop'?'Stop':values.result==='breakeven'?'Empate':'—';
            return {trade:t,row:`<tr data-trade="${esc(t.id)}"><td>${i+1}</td><td>${esc(new Date(t.created).toLocaleString('pt-BR'))}</td><td><span class="pill ${values.result==='target'?'win':values.result==='stop'?'loss':'be'}">${result}</span></td><td class="bt-history-setup">${t.setupTag ? `<span class="tag">${esc(t.setupTag)}</span>` : '<span class="muted">—</span>'}</td><td>${validAmount(t.stopCash)?cashfmt(t.stopCash).replace(/^\+/,''):'—'}</td><td>${validAmount(t.targetCash)?cashfmt(t.targetCash).replace(/^\+/,''):'—'}</td><td>${amountCell(values.r,'r')}</td><td>${amountCell(values.cashPnl,'brl')}</td><td>${accumulatedCell(r,i,'r')}</td><td>${accumulatedCell(cash,i,'brl')}</td><td><div class="bt-history-actions"><button class="btn btn-mini${values.complete?'':' bt-complete-values'}" data-edit="${esc(t.id)}" aria-label="Editar trade ${i+1}">${values.complete?'Editar':'Preencher valores'}</button><button class="btn btn-mini btn-danger" data-remove="${esc(t.id)}" aria-label="Excluir trade ${i+1}">Excluir</button></div></td></tr>`};
        }).reverse();
        const dayMap = new Map(days(active).map(d=>[d.id,d])), grouped = new Map();
        history.forEach(item=>{
            const group = dayMap.has(item.trade.dayId) ? item.trade.dayId : '';
            if (!grouped.has(group)) grouped.set(group,[]);
            grouped.get(group).push(item);
        });
        el('btHistory').innerHTML = history.length ? [...grouped].map(([id,items])=>{
            const day = dayMap.get(id), dayTrades=items.map(item=>item.trade);
            return `<tr class="bt-day-separator" data-day="${esc(id)}"><td colspan="11"><div class="bt-day-heading"><strong>${esc(day ? dayLabel(day) : 'Trades sem dia informado')}</strong><span>${items.length} trade${items.length===1?'':'s'} · ${totalLabel(metrics(dayTrades),'r')} · ${totalLabel(metrics(dayTrades,'brl'),'brl')}${day && session.currentDay===id ? ' · dia atual' : ''}</span>${day ? `<button type="button" class="btn btn-mini" data-resume-day="${esc(id)}"${editing?' disabled':''}>Continuar dia</button>` : ''}</div></td></tr>${items.map(item=>item.row).join('')}`;
        }).join('') : '<tr><td colspan="11" class="empty">Selecione o dia da semana, informe stop e alvo em reais e registre o primeiro trade.</td></tr>';
        el('btHistoryNote').hidden=!(r.missingCount||cash.missingCount);
        draw(m,unit); renderStats(m,unit); renderWeekdays(ts,unit);
    }
    function draw(m,unit) {
        if(!m.valuedCount) {
            el('btCurve').innerHTML=`<title>Curva acumulada em ${unit==='brl'?'reais':'R'} por trade${m.missingCount?' · parcial':''}</title><text x="400" y="105" fill="#8a98b5" text-anchor="middle">${m.count?'Preencha os valores para calcular esta curva':'Registre o primeiro trade para iniciar a curva'}</text><text x="400" y="135" fill="#8a98b5" text-anchor="middle">${m.count} trades${m.missingCount?' · valores pendentes':''}</text>`;
            return;
        }
        const points=m.points, known=points.filter(v=>v!==null), w=800,h=220,p=36,left=unit==='brl'?112:p, min=Math.min(0,...known), max=Math.max(1,...known), span=max-min || 1;
        const y=v=>h-p-(v-min)/span*(h-2*p);
        const fmt=value=>formatValue(value,unit);
        const x=i=>left+i/Math.max(1,points.length-1)*(w-left-p), segments=[];let segment=[];
        points.forEach((value,i)=>{if(value===null){if(segment.length)segments.push(segment.join(' '));segment=[];}else segment.push(`${x(i)},${y(value)}`);});
        if(segment.length)segments.push(segment.join(' '));
        const gaps=points.map((v,i)=>v===null?`<text x="${x(i)}" y="${h-p+18}" fill="#d0b079" text-anchor="middle"><title>Trade ${i}: valor pendente</title>?</text>`:'').join('');
        const markers=points.map((v,i)=>i>0 && v!==null && (i===points.length-1 || points[i-1]===null || points[i+1]===null)?`<circle cx="${x(i)}" cy="${y(v)}" r="4" fill="#2ddb8a"/>`:'').join('');
        el('btCurve').innerHTML=`<title>Curva acumulada em ${unit==='brl'?'reais':'R'} por trade${m.missingCount?' · parcial':''}</title><line x1="${left}" y1="${y(0)}" x2="${w-p}" y2="${y(0)}" stroke="#5a6a8a" stroke-dasharray="5 5"/><text x="4" y="${p}" fill="#8a98b5">${fmt(max)}</text><text x="4" y="${h-p}" fill="#8a98b5">${fmt(min)}</text>${segments.map(line=>`<polyline points="${line}" fill="none" stroke="#b591ff" stroke-width="3"/>`).join('')}${markers}${gaps}<text x="${left}" y="${h-5}" fill="#8a98b5">Início · ${fmt(0)}</text><text x="${w-p}" y="${h-5}" fill="#8a98b5" text-anchor="end">${m.count} trades · ${totalLabel(m,unit)}</text>`;
    }
    function init() {
        document.querySelector('.main').insertAdjacentHTML('beforeend', `
        <section class="view" id="view-backtests">
          <div class="panel"><div class="panel-head"><div><h2>Meus backtests</h2><p>Uma estratégia por teste. Pare e continue quando quiser.</p></div><div class="actions"><button class="btn" id="btSync">Sincronizar / buscar</button><button class="btn" id="btExport">Exportar backup</button><button class="btn" id="btImportLocal" hidden>Trazer testes locais</button></div></div>
          <div class="panel-body"><p id="btStatus" class="muted" role="status" style="overflow-wrap:anywhere"></p><form id="btCreate" class="actions"><div class="field" style="flex:1;min-width:180px"><label for="btStrategy">Nome da estratégia</label><input id="btStrategy" required maxlength="100" placeholder="Ex.: POI · EURUSD · H1"></div><button class="btn btn-primary" type="submit">Iniciar novo backtest</button></form></div>
          <div class="table-scroll" tabindex="0" role="region" aria-label="Lista de backtests"><table><thead><tr><th>Estratégia</th><th>Trades</th><th>Resultado em R</th><th>Resultado em R$</th><th>Ações</th></tr></thead><tbody id="btList"></tbody></table></div></div>
          <div class="panel" id="btEditor" hidden><div class="panel-head"><h2 id="btName"></h2><button class="btn" id="btClose">Voltar à lista</button></div><div class="panel-body">
          <div class="bt-unit-tools"><span>Gráfico e análises em</span><div class="bt-unit-buttons" role="group" aria-label="Unidade do gráfico e das análises"><button type="button" class="btn" data-unit="r" aria-pressed="true">R</button><button type="button" class="btn" data-unit="brl" aria-pressed="false">R$</button></div></div><div id="btPendingValues" class="bt-pending-values" role="status" hidden></div>
          <div id="btKpis" class="kpi-grid"></div>
          <div class="bt-day-tools"><div class="bt-day-top"><div><h3>Dia do replay</h3><p id="btDayStatus" class="muted" role="status"></p></div><button class="btn" id="btNewDay" type="button">+ Novo dia</button></div><div class="bt-day-fields"><div id="btWeekdays" class="bt-weekdays" role="group" aria-label="Dia da semana do replay">${WEEKDAYS.map(d=>`<button type="button" class="btn bt-weekday" data-weekday="${d.value}" aria-pressed="false">${d.short}</button>`).join('')}</div><div class="field bt-day-date"><label for="btDayDate">Data do replay (opcional)</label><input id="btDayDate" type="date"></div><div class="field bt-day-group" id="btDayGroupField" hidden><label for="btDayGroup">Grupo de dia deste trade</label><select id="btDayGroup"></select></div></div></div>
          <form id="btTrade"><fieldset class="bt-trade-fieldset"><legend id="btTradeLegend">Resultado do próximo trade</legend><div id="btResultControls" class="bt-result-controls" role="group" aria-label="Resultado do trade"><label class="btn"><input type="radio" name="btResult" value="target" checked> Alvo</label><label class="btn"><input type="radio" name="btResult" value="stop"> Stop</label><label class="btn"><input type="radio" name="btResult" value="breakeven"> 0 a 0</label></div><p id="btLegacyEditNote" class="bt-pending-label bt-form-help" hidden></p><div class="bt-trade-fields"><div class="field"><label for="btStopCash">Stop (R$ = 1R)</label><input id="btStopCash" type="text" inputmode="decimal" maxlength="24" required placeholder="Ex.: 50,00" autocomplete="off"></div><div class="field"><label for="btTargetCash">Alvo (R$)</label><input id="btTargetCash" type="text" inputmode="decimal" maxlength="24" required placeholder="Ex.: 108,00" autocomplete="off"></div><div class="field"><label for="btAutoR">Resultado em R · auto</label><input id="btAutoR" type="text" readonly value="—" aria-describedby="btFormHelp"></div><div class="field bt-setup-field"><label for="btSetupTag">Tag do setup</label><input id="btSetupTag" type="text" maxlength="100" placeholder="Ex.: POI, Orderblock" autocomplete="off"></div><div class="bt-trade-actions"><button class="btn btn-primary" id="btSaveTrade" type="submit">Registrar trade</button><button class="btn" id="btCancelEdit" type="button" hidden>Cancelar edição</button></div></div><p id="btFormHelp" class="muted bt-form-help" role="status"></p></fieldset></form>
          <p class="muted" id="btCurveInfo"></p><p id="btPartialNote" class="bt-pending-label bt-form-help" role="status" hidden></p><svg id="btCurve" viewBox="0 0 800 220" role="img" aria-label="Curva de lucro acumulado" style="width:100%;display:block;background:var(--bg-elev-2);border-radius:8px"></svg>
          <section class="bt-statistics" aria-labelledby="btStatsTitle"><h2 id="btStatsTitle">Estatísticas do backtest</h2><div class="bt-stats-grid" id="btStats"></div><p class="muted bt-stats-note" id="btStatsNote"></p></section>
          <section class="bt-statistics" aria-labelledby="btWeekdayTitle"><h2 id="btWeekdayTitle">Resultado por dia da semana</h2><p id="btWeekdayComparison" class="bt-weekday-comparison"></p><div class="table-scroll bt-weekday-table" tabindex="0" role="region" aria-label="Estatísticas por dia da semana"><table><thead><tr><th>Dia da semana</th><th>Dias</th><th>Trades</th><th id="btWeekdayWins">Alvos</th><th id="btWeekdayLosses">Stops</th><th>0 a 0</th><th>Acerto</th><th>Total</th><th>Média / trade</th><th>Média / dia</th><th>Profit factor</th></tr></thead><tbody id="btWeekdayRows"></tbody></table></div><p class="muted bt-stats-note">Compare as médias junto com a quantidade de dias e trades. O ranking descreve esta amostra; não define sozinho quais dias operar.</p><p class="muted bt-stats-note" id="btUnassignedDays" hidden></p></section></div>
          <div class="table-scroll bt-history-table" style="max-height:440px" tabindex="0" role="region" aria-label="Histórico do backtest em R e reais"><table><thead><tr><th>#</th><th>Registrado em</th><th>Resultado</th><th>Tag do setup</th><th>Stop (R$)</th><th>Alvo (R$)</th><th>R</th><th>Resultado (R$)</th><th>Acum. R</th><th>Acum. R$</th><th>Ações</th></tr></thead><tbody id="btHistory"></tbody></table></div><p class="muted bt-history-note" id="btHistoryNote" hidden>* Acumulados parciais: somam somente os resultados conhecidos. Complete os valores pendentes para obter os totais integrais.</p></div>
        </section>`);
        el('btCreate').onsubmit = e => {
            e.preventDefault(); const name=el('btStrategy').value.trim(); if (!name) return;
            const s={id:uid(),kind:'session',name,unit:'r',created:new Date().toISOString(),dirty:true};
            const previous=active; active=s.id;
            if (commit([...records,s])) { el('btStrategy').value='';clearEdit(); } else active=previous;
        };
        el('btTrade').onsubmit = e => {
            e.preventDefault(); if (!sessions().some(s=>s.id===active)) return;
            const stopCash=parseCash(el('btStopCash').value), targetCash=parseCash(el('btTargetCash').value), result=document.querySelector('input[name="btResult"]:checked').value;
            const values=tradeValues({stopCash,targetCash,result});
            if (!values.complete) { alert('Informe stop e alvo em reais, ambos maiores que zero e com até duas casas decimais. Marque Alvo, Stop ou 0 a 0.'); el(stopCash===null||stopCash<=0?'btStopCash':'btTargetCash').focus();return; }
            const outcome={stopCash,targetCash,result,r:values.r,cashPnl:values.cashPnl};
            const setupTag=el('btSetupTag').value.trim().slice(0,100);
            let day = days(active).find(d=>d.id===daySelection), newDay = null;
            if (!day && !(editing && daySelection==='')) {
                if (!WEEKDAYS.some(d=>d.value===selectedWeekday)) { alert('Selecione o dia da semana do replay antes de registrar o trade.'); return; }
                const date = el('btDayDate').value.trim();
                if (date && replayWeekday(date)!==selectedWeekday) { alert('A data do replay deve corresponder ao dia da semana selecionado, de segunda a sexta.'); return; }
                newDay = {id:uid(),kind:'day',parent:active,number:Math.max(0,...days(active).map(d=>d.number))+1,weekday:selectedWeekday,date,created:new Date().toISOString(),dirty:true};
                day = newDay;
            }
            let next = records;
            if (editing) {
                if (!trades(active).some(t=>t.id===editing)) { clearEdit(); return; }
                next = records.map(t=>t.id===editing ? {...t,...outcome,setupTag,dayId:day?.id || null,updated:new Date().toISOString(),dirty:true} : t);
            } else {
                next = [...records.map(s=>s.id===active ? {...s,currentDay:day.id,dirty:true} : s),{id:uid(),kind:'trade',parent:active,...outcome,setupTag,dayId:day.id,created:new Date().toISOString(),dirty:true}];
            }
            if (newDay) next = [...next,newDay];
            if (commit(next)) {
                if (editing) clearEdit();
                else { clearEdit();loadDay();dayControls(); }
            }
        };
        el('btNewDay').onclick=()=>{daySelection='new';selectedWeekday=null;el('btDayDate').value='';dayControls();};
        el('btDayGroup').onchange=()=>{
            daySelection=el('btDayGroup').value;
            const day=days(active).find(d=>d.id===daySelection);
            selectedWeekday=day?.weekday || null;el('btDayDate').value=day?.date || '';dayControls();
        };
        el('btDayDate').onchange=()=>{
            const date=el('btDayDate').value, day=days(active).find(d=>d.id===daySelection), weekday=replayWeekday(date);
            if (day && day.date!==date) daySelection='new';
            if (WEEKDAYS.some(d=>d.value===weekday)) { selectedWeekday=weekday;if(daySelection==='')daySelection='new'; }
            dayControls();
        };
        document.querySelectorAll('input[name="btResult"]').forEach(input=>input.onchange=formPreview);
        el('btStopCash').oninput=formPreview;el('btTargetCash').oninput=formPreview;
        el('view-backtests').onclick = e => {
            const b=e.target.closest('button'); if (!b) return;
            if (['r','brl'].includes(b.dataset.unit) && sessions().some(s=>s.id===active)) {
                commit(records.map(s=>s.id===active ? {...s,unit:b.dataset.unit,dirty:true} : s));
            }
            if (b.dataset.open) { clearEdit(); active=b.dataset.open; render(); el('btEditor').scrollIntoView({behavior:'smooth',block:'start'}); }
            if (b.dataset.edit) editTrade(b.dataset.edit);
            if (b.dataset.weekday) selectWeekday(Number(b.dataset.weekday));
            if (b.dataset.resumeDay && !editing && days(active).some(d=>d.id===b.dataset.resumeDay)) {
                if (commit(records.map(s=>s.id===active ? {...s,currentDay:b.dataset.resumeDay,dirty:true} : s))) { loadDay();dayControls(); }
            }
            const id=b.dataset.delete || b.dataset.remove;
            if (id && confirm(b.dataset.delete ? 'Excluir este backtest e seu histórico? A exclusão será sincronizada com o Supabase.' : 'Excluir este trade e recalcular a curva?')) {
                commit(records.map(x=> x.id===id || x.parent===id ? {...x,deleted:true,dirty:true} : x));
            }
        };
        el('btClose').onclick=()=>{active=null;render();};
        el('btCancelEdit').onclick=clearEdit;
        el('btSync').onclick=sync;
        el('btExport').onclick=()=>{
            const url=URL.createObjectURL(new Blob([JSON.stringify({version:1,records},null,2)],{type:'application/json'}));
            const a=document.createElement('a');a.href=url;a.download='backtests-backup.json';a.click();setTimeout(()=>URL.revokeObjectURL(url),1000);
        };
        el('btImportLocal').onclick=()=>{
            try {
                const guest=read('guest');
                if (!guest.some(x=>x.kind==='session'&&!x.deleted)) {toast('Nenhum backtest local sem conta para trazer.');return;}
                if (!confirm('Copiar os testes criados sem login para esta conta?')) return;
                const ids=new Map(guest.map(x=>[x.id,uid()]));
                if (commit([...records,...guest.filter(x=>!x.deleted).map(x=>({...x,id:ids.get(x.id),parent:ids.get(x.parent),...(x.dayId ? {dayId:ids.get(x.dayId)} : {}),...(x.currentDay ? {currentDay:ids.get(x.currentDay)} : {}),dirty:true}))])) localStorage.removeItem(key('guest'));
            } catch(e) {alert(`Falha ao trazer testes locais: ${e.message}`);}
        };
        window.addEventListener('online',sync);
        authChanged();
    }
    return {init,render,authChanged,metrics,weekdayStats,parseCash,tradeValues};
})();
