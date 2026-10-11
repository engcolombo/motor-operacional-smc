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
    function weekdayStats(list, dayList) {
        const byId = new Map(dayList.map(d=>[d.id,d]));
        const groups = WEEKDAYS.map(d=>{
            const ts = list.filter(t=>byId.get(t.dayId)?.weekday===d.value), m = metrics(ts);
            const countDays = new Set(ts.map(t=>t.dayId)).size;
            return {...d,...m,days:countDays,avgDay:countDays ? m.total/countDays : null};
        });
        return {groups,unassigned:list.filter(t=>!WEEKDAYS.some(d=>d.value===byId.get(t.dayId)?.weekday)).length};
    }
    function metrics(list) {
        let total = 0, peak = 0, dd = 0, wins = 0, losses = 0, grossWins = 0, grossLosses = 0;
        let largestWin = 0, largestLoss = 0, winStreak = 0, lossStreak = 0, bestWinStreak = 0, worstLossStreak = 0;
        const points = [0], targets = {1:0, 2:0, 3:0};
        list.forEach(t => {
            total += t.r;
            if (t.r > 0) {
                wins++; grossWins += t.r; largestWin = Math.max(largestWin, t.r);
                winStreak++; lossStreak = 0; bestWinStreak = Math.max(bestWinStreak, winStreak);
                if (t.r in targets) targets[t.r]++;
            } else if (t.r < 0) {
                losses++; grossLosses -= t.r; largestLoss = Math.min(largestLoss, t.r);
                lossStreak++; winStreak = 0; worstLossStreak = Math.max(worstLossStreak, lossStreak);
            } else { winStreak = 0; lossStreak = 0; }
            peak = Math.max(peak, total); dd = Math.max(dd, peak - total); points.push(total);
        });
        const count = list.length;
        return {total, dd, wins, losses, count, breakevens:count-wins-losses, points, targets,
            grossWins, grossLosses, largestWin, largestLoss, bestWinStreak, worstLossStreak,
            winRate:wins+losses ? 100*wins/(wins+losses) : 0,
            expectancy:count ? total/count : null, avgWin:wins ? grossWins/wins : null,
            avgLoss:losses ? -grossLosses/losses : null, profitFactor:grossLosses ? grossWins/grossLosses : null};
    }
    function tradeMode() {
        el('btTradeLegend').textContent = editing ? `Editar trade #${trades(active).findIndex(t=>t.id===editing)+1}` : 'Resultado do próximo trade';
        el('btSaveTrade').textContent = editing ? 'Salvar alterações' : 'Registrar trade';
        el('btCancelEdit').hidden = !editing;
        dayControls();
    }
    function clearEdit() {
        if (editing) {
            el('btTarget').value = '1'; el('btTarget').disabled = false;
            document.querySelectorAll('input[name="btResult"]').forEach(input=>input.checked=input.value==='target');
            el('btSetupTag').value = '';
        }
        const wasEditing = Boolean(editing);
        editing = null; if (wasEditing) loadDay(); tradeMode();
    }
    function editTrade(id) {
        const trade = trades(active).find(t=>t.id===id);
        if (!trade) return;
        editing = id;
        document.querySelectorAll('input[name="btResult"]').forEach(input=>input.checked=input.value===(trade.r<0?'stop':trade.r>0?'target':'breakeven'));
        el('btTarget').value = String(trade.r>0?trade.r:1); el('btTarget').disabled = trade.r<=0;
        el('btSetupTag').value = trade.setupTag || '';
        const day = days(active).find(d=>d.id===trade.dayId);
        daySelection = day?.id || ''; selectedWeekday = day?.weekday || null; el('btDayDate').value = day?.date || '';
        tradeMode(); el('btTrade').scrollIntoView({behavior:'smooth',block:'center'});
        el('btSetupTag').focus({preventScroll:true});
    }
    function renderStats(m) {
        const percent = `${m.winRate.toLocaleString('pt-BR',{minimumFractionDigits:1,maximumFractionDigits:1})}%`;
        const optionalR = value => value === null ? '—' : rfmt(value);
        const groups = [
            ['Operações', [
                ['Quantidade de trades',m.count],['Alvos atingidos',m.wins],['Stops',m.losses],['Empates',m.breakevens],
                ['Taxa de acerto',percent],['Alvos 1R / 2R / 3R',`${m.targets[1]} / ${m.targets[2]} / ${m.targets[3]}`]
            ]],
            ['Retorno em R', [
                ['Resultado acumulado',rfmt(m.total)],['Ganhos brutos',rfmt(m.grossWins)],['Perdas brutas',rfmt(-m.grossLosses)],
                ['Média por trade',optionalR(m.expectancy)],['Média dos alvos',optionalR(m.avgWin)],['Média dos stops',optionalR(m.avgLoss)]
            ]],
            ['Risco e sequências', [
                ['Profit factor',m.profitFactor === null ? (m.wins ? 'Sem perdas' : '—') : number(m.profitFactor)],
                ['Drawdown máximo',`${number(m.dd)}R`],['Maior alvo',m.wins ? rfmt(m.largestWin) : '—'],
                ['Maior perda',m.losses ? rfmt(m.largestLoss) : '—'],['Alvos consecutivos (máx.)',m.bestWinStreak],['Stops consecutivos (máx.)',m.worstLossStreak]
            ]]
        ];
        el('btStats').innerHTML = groups.map(([heading,rows])=>`<div class="bt-stats-group"><h3>${heading}</h3>${rows.map(([label,value])=>`<div class="metric-row"><span>${label}</span><strong>${value}</strong></div>`).join('')}</div>`).join('');
    }
    function renderWeekdays(list) {
        const {groups,unassigned} = weekdayStats(list,days(active));
        const eligible = groups.filter(g=>g.count);
        let comparison = 'A comparação aparece quando houver trades em pelo menos dois dias da semana.';
        if (eligible.length>1) {
            const highest = Math.max(...eligible.map(g=>g.expectancy)), lowest = Math.min(...eligible.map(g=>g.expectancy));
            comparison = highest===lowest ? `Médias iguais entre os dias registrados: ${rfmt(highest)} por trade.` :
                `Maior média por trade: ${eligible.filter(g=>g.expectancy===highest).map(g=>g.label).join(', ')} (${rfmt(highest)}). Menor média: ${eligible.filter(g=>g.expectancy===lowest).map(g=>g.label).join(', ')} (${rfmt(lowest)}).`;
        }
        el('btWeekdayComparison').textContent = comparison;
        el('btWeekdayRows').innerHTML = groups.map(g=>`<tr><td>${g.label}</td><td>${g.days}</td><td>${g.count}</td><td>${g.wins}</td><td>${g.losses}</td><td>${g.breakevens}</td><td>${g.wins+g.losses ? `${number(g.winRate)}%` : '—'}</td><td class="${g.total>0?'win-text':g.total<0?'loss-text':''}">${g.count ? rfmt(g.total) : '—'}</td><td>${g.expectancy===null ? '—' : rfmt(g.expectancy)}</td><td>${g.avgDay===null ? '—' : rfmt(g.avgDay)}</td><td>${g.profitFactor===null ? (g.wins ? 'Sem perdas' : '—') : number(g.profitFactor)}</td></tr>`).join('');
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
            const ts = trades(s.id), m = metrics(ts);
            return `<tr><td><strong>${esc(s.name)}</strong><br><span class="muted">${esc(new Date(s.created).toLocaleString('pt-BR'))}</span></td><td>${ts.length}</td><td>${rfmt(m.total)}</td><td><button class="btn btn-mini" data-open="${esc(s.id)}">Continuar</button> <button class="btn btn-mini btn-danger" data-delete="${esc(s.id)}">Excluir</button></td></tr>`;
        }).join('') : '<tr><td colspan="4" class="empty">Crie seu primeiro backtest: POI, Orderblock ou outra estratégia.</td></tr>';
        const session = list.find(x => x.id === active);
        el('btEditor').hidden = !session;
        if (!session) { clearEdit(); dayContext=null; return; }
        if (dayContext!==active) loadDay();
        el('btName').textContent = session.name;
        const ts = trades(active), m = metrics(ts);
        if (editing && !ts.some(t=>t.id===editing)) clearEdit();
        tradeMode();
        el('btKpis').innerHTML = [['Resultado',rfmt(m.total)],['Trades',m.count],['Acerto',`${number(m.winRate)}%`],['Drawdown máximo',`${number(m.dd)}R`]].map(([label,value])=>`<div class="kpi-card"><div class="label">${label}</div><div class="value">${value}</div></div>`).join('');
        let accumulated = 0;
        const history = ts.map((t,i) => {
            accumulated += t.r;
            return {trade:t,row:`<tr data-trade="${esc(t.id)}"><td>${i+1}</td><td>${esc(new Date(t.created).toLocaleString('pt-BR'))}</td><td><span class="pill ${t.r>0?'win':t.r<0?'loss':'be'}">${t.r>0?'Alvo':t.r<0?'Stop':'Empate'}</span></td><td class="bt-history-setup">${t.setupTag ? `<span class="tag">${esc(t.setupTag)}</span>` : '<span class="muted">—</span>'}</td><td>${rfmt(t.r)}</td><td>${rfmt(accumulated)}</td><td><div class="bt-history-actions"><button class="btn btn-mini" data-edit="${esc(t.id)}" aria-label="Editar trade ${i+1}">Editar</button><button class="btn btn-mini btn-danger" data-remove="${esc(t.id)}" aria-label="Excluir trade ${i+1}">Excluir</button></div></td></tr>`};
        }).reverse();
        const dayMap = new Map(days(active).map(d=>[d.id,d])), grouped = new Map();
        history.forEach(item=>{
            const group = dayMap.has(item.trade.dayId) ? item.trade.dayId : '';
            if (!grouped.has(group)) grouped.set(group,[]);
            grouped.get(group).push(item);
        });
        el('btHistory').innerHTML = history.length ? [...grouped].map(([id,items])=>{
            const day = dayMap.get(id), total = items.reduce((sum,item)=>sum+item.trade.r,0);
            return `<tr class="bt-day-separator" data-day="${esc(id)}"><td colspan="7"><div class="bt-day-heading"><strong>${esc(day ? dayLabel(day) : 'Trades sem dia informado')}</strong><span>${items.length} trade${items.length===1?'':'s'} · ${rfmt(total)}${day && session.currentDay===id ? ' · dia atual' : ''}</span>${day ? `<button type="button" class="btn btn-mini" data-resume-day="${esc(id)}"${editing?' disabled':''}>Continuar dia</button>` : ''}</div></td></tr>${items.map(item=>item.row).join('')}`;
        }).join('') : '<tr><td colspan="7" class="empty">Selecione o dia da semana, marque o resultado e registre o primeiro trade.</td></tr>';
        draw(m.points); renderStats(m); renderWeekdays(ts);
    }
    function draw(points) {
        const w=800,h=220,p=36, min=Math.min(0,...points), max=Math.max(1,...points), span=max-min || 1;
        const y=v=>h-p-(v-min)/span*(h-2*p);
        const line=points.map((v,i)=>`${p+i/Math.max(1,points.length-1)*(w-2*p)},${y(v)}`).join(' ');
        el('btCurve').innerHTML=`<title>Curva acumulada em R por trade</title><line x1="${p}" y1="${y(0)}" x2="${w-p}" y2="${y(0)}" stroke="#5a6a8a" stroke-dasharray="5 5"/><text x="4" y="${p}" fill="#8a98b5">${max}R</text><text x="4" y="${h-p}" fill="#8a98b5">${min}R</text><polyline points="${line}" fill="none" stroke="#b591ff" stroke-width="3"/><circle cx="${points.length>1?w-p:p}" cy="${y(points.at(-1))}" r="4" fill="#2ddb8a"/><text x="${p}" y="${h-5}" fill="#8a98b5">Início · 0R</text><text x="${w-p}" y="${h-5}" fill="#8a98b5" text-anchor="end">${points.length-1} trades · ${rfmt(points.at(-1))}</text>`;
    }
    function init() {
        document.querySelector('.main').insertAdjacentHTML('beforeend', `
        <section class="view" id="view-backtests">
          <div class="panel"><div class="panel-head"><div><h2>Meus backtests</h2><p>Uma estratégia por teste. Pare e continue quando quiser.</p></div><div class="actions"><button class="btn" id="btSync">Sincronizar / buscar</button><button class="btn" id="btExport">Exportar backup</button><button class="btn" id="btImportLocal" hidden>Trazer testes locais</button></div></div>
          <div class="panel-body"><p id="btStatus" class="muted" role="status" style="overflow-wrap:anywhere"></p><form id="btCreate" class="actions"><div class="field" style="flex:1;min-width:180px"><label for="btStrategy">Nome da estratégia</label><input id="btStrategy" required maxlength="100" placeholder="Ex.: POI · EURUSD · H1"></div><button class="btn btn-primary" type="submit">Iniciar novo backtest</button></form></div>
          <div style="overflow-x:auto"><table><thead><tr><th>Estratégia</th><th>Trades</th><th>Resultado</th><th>Ações</th></tr></thead><tbody id="btList"></tbody></table></div></div>
          <div class="panel" id="btEditor" hidden><div class="panel-head"><h2 id="btName"></h2><button class="btn" id="btClose">Voltar à lista</button></div><div class="panel-body">
          <div id="btKpis" class="kpi-grid"></div>
          <div class="bt-day-tools"><div class="bt-day-top"><div><h3>Dia do replay</h3><p id="btDayStatus" class="muted" role="status"></p></div><button class="btn" id="btNewDay" type="button">+ Novo dia</button></div><div class="bt-day-fields"><div id="btWeekdays" class="bt-weekdays" role="group" aria-label="Dia da semana do replay">${WEEKDAYS.map(d=>`<button type="button" class="btn bt-weekday" data-weekday="${d.value}" aria-pressed="false">${d.short}</button>`).join('')}</div><div class="field bt-day-date"><label for="btDayDate">Data do replay (opcional)</label><input id="btDayDate" type="date"></div><div class="field bt-day-group" id="btDayGroupField" hidden><label for="btDayGroup">Grupo de dia deste trade</label><select id="btDayGroup"></select></div></div></div>
          <form id="btTrade"><fieldset style="border:1px solid var(--line);border-radius:8px;padding:16px"><legend id="btTradeLegend">Resultado do próximo trade</legend><div class="actions"><label class="btn"><input type="radio" name="btResult" value="target" checked> Alvo</label><label class="btn"><input type="radio" name="btResult" value="stop"> Stop (−1R)</label><label class="btn"><input type="radio" name="btResult" value="breakeven"> 0 a 0 (0R)</label><label class="btn">Alvo em R <select id="btTarget" style="background:var(--bg)"><option value="1">1R</option><option value="2">2R</option><option value="3">3R</option></select></label><div class="field bt-setup-field"><label for="btSetupTag">Tag do setup</label><input id="btSetupTag" type="text" maxlength="100" placeholder="Ex.: POI, Orderblock" autocomplete="off"></div><button class="btn btn-primary" id="btSaveTrade" type="submit">Registrar trade</button><button class="btn" id="btCancelEdit" type="button" hidden>Cancelar edição</button></div></fieldset></form>
          <p class="muted">1R é o risco de uma operação. Curva bruta, sem taxas ou parciais.</p><svg id="btCurve" viewBox="0 0 800 220" role="img" aria-label="Curva de lucro acumulado em R" style="width:100%;display:block;background:var(--bg-elev-2);border-radius:8px"></svg>
          <section class="bt-statistics" aria-labelledby="btStatsTitle"><h2 id="btStatsTitle">Estatísticas do backtest</h2><div class="bt-stats-grid" id="btStats"></div><p class="muted bt-stats-note">Acerto = alvos ÷ (alvos + stops), sem empates. Profit factor = ganhos brutos ÷ perdas brutas. Valores em R, sem taxas.</p></section>
          <section class="bt-statistics" aria-labelledby="btWeekdayTitle"><h2 id="btWeekdayTitle">Resultado por dia da semana</h2><p id="btWeekdayComparison" class="bt-weekday-comparison"></p><div class="table-scroll bt-weekday-table" tabindex="0" role="region" aria-label="Estatísticas por dia da semana"><table><thead><tr><th>Dia da semana</th><th>Dias</th><th>Trades</th><th>Alvos</th><th>Stops</th><th>0 a 0</th><th>Acerto</th><th>Total</th><th>Média / trade</th><th>Média / dia</th><th>Profit factor</th></tr></thead><tbody id="btWeekdayRows"></tbody></table></div><p class="muted bt-stats-note">Compare as médias junto com a quantidade de dias e trades. O ranking descreve esta amostra; não define sozinho quais dias operar.</p><p class="muted bt-stats-note" id="btUnassignedDays" hidden></p></section></div>
          <div class="table-scroll" style="max-height:440px" tabindex="0" role="region" aria-label="Histórico do backtest"><table><thead><tr><th>#</th><th>Registrado em</th><th>Resultado</th><th>Tag do setup</th><th>R</th><th>Acumulado</th><th>Ações</th></tr></thead><tbody id="btHistory"></tbody></table></div></div>
        </section>`);
        el('btCreate').onsubmit = e => {
            e.preventDefault(); const name=el('btStrategy').value.trim(); if (!name) return;
            const s={id:uid(),kind:'session',name,created:new Date().toISOString(),dirty:true};
            const previous=active; active=s.id;
            if (commit([...records,s])) el('btStrategy').value=''; else active=previous;
        };
        el('btTrade').onsubmit = e => {
            e.preventDefault(); if (!sessions().some(s=>s.id===active)) return;
            const result=document.querySelector('input[name="btResult"]:checked').value;
            const r=result==='stop'?-1:result==='breakeven'?0:Number(el('btTarget').value); if (![-1,0,1,2,3].includes(r)) return;
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
                next = records.map(t=>t.id===editing ? {...t,r,setupTag,dayId:day?.id || null,updated:new Date().toISOString(),dirty:true} : t);
            } else {
                next = [...records.map(s=>s.id===active ? {...s,currentDay:day.id,dirty:true} : s),{id:uid(),kind:'trade',parent:active,r,setupTag,dayId:day.id,created:new Date().toISOString(),dirty:true}];
            }
            if (newDay) next = [...next,newDay];
            if (commit(next)) {
                if (editing) clearEdit();
                else { el('btSetupTag').value=''; loadDay(); dayControls(); }
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
        document.querySelectorAll('input[name="btResult"]').forEach(input=>input.onchange=()=>{ el('btTarget').disabled=document.querySelector('input[name="btResult"]:checked').value!=='target'; });
        el('view-backtests').onclick = e => {
            const b=e.target.closest('button'); if (!b) return;
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
    return {init,render,authChanged,metrics,weekdayStats};
})();
