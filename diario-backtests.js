/* Manual backtests: independent of live trades; append-only entries with deletion markers. */
const Backtests = (() => {
    const TABLE = 'backtest_entries';
    let owner = null, records = [], active = null, busy = false, message = '', timer, storageReady = true;
    const el = id => document.getElementById(id);
    const key = who => `diarioBacktests_v1_${who}`;
    const esc = value => String(value).replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
    const rfmt = n => `${n > 0 ? '+' : ''}${n}R`;
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
    function metrics(list) {
        let total = 0, peak = 0, dd = 0, wins = 0;
        const points = [0];
        list.forEach(t => { total += t.r; wins += t.r > 0 ? 1 : 0; peak = Math.max(peak, total); dd = Math.max(dd, peak - total); points.push(total); });
        return {total, dd, wins, points};
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
        if (!session) return;
        el('btName').textContent = session.name;
        const ts = trades(active), m = metrics(ts);
        el('btKpis').innerHTML = [['Resultado',rfmt(m.total)],['Trades',ts.length],['Acerto',`${ts.length ? (100*m.wins/ts.length).toFixed(1) : '0'}%`],['Drawdown máximo',`${m.dd}R`]].map(([label,value])=>`<div class="kpi-card"><div class="label">${label}</div><div class="value">${value}</div></div>`).join('');
        let accumulated = 0;
        el('btHistory').innerHTML = ts.length ? ts.map((t,i) => {
            accumulated += t.r;
            return `<tr><td>${i+1}</td><td>${esc(new Date(t.created).toLocaleString('pt-BR'))}</td><td><span class="pill ${t.r>0?'win':'loss'}">${t.r>0?'Alvo':'Stop'}</span></td><td class="bt-history-setup">${t.setupTag ? `<span class="tag">${esc(t.setupTag)}</span>` : '<span class="muted">—</span>'}</td><td>${rfmt(t.r)}</td><td>${rfmt(accumulated)}</td><td><button class="btn btn-mini btn-danger" data-remove="${esc(t.id)}" aria-label="Excluir trade ${i+1}">Excluir</button></td></tr>`;
        }).reverse().join('') : '<tr><td colspan="7" class="empty">Marque o resultado e registre o primeiro trade.</td></tr>';
        draw(m.points);
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
          <form id="btTrade"><fieldset style="border:1px solid var(--line);border-radius:8px;padding:16px"><legend>Resultado do próximo trade</legend><div class="actions"><label class="btn"><input type="radio" name="btResult" value="target" checked> Alvo</label><label class="btn"><input type="radio" name="btResult" value="stop"> Stop (−1R)</label><label class="btn">Alvo em R <select id="btTarget" style="background:var(--bg)"><option value="1">1R</option><option value="2">2R</option><option value="3">3R</option></select></label><div class="field bt-setup-field"><label for="btSetupTag">Tag do setup</label><input id="btSetupTag" type="text" maxlength="100" placeholder="Ex.: POI, Orderblock" autocomplete="off"></div><button class="btn btn-primary" type="submit">Registrar trade</button></div></fieldset></form>
          <p class="muted">1R é o risco de uma operação. Curva bruta, sem taxas ou parciais.</p><svg id="btCurve" viewBox="0 0 800 220" role="img" aria-label="Curva de lucro acumulado em R" style="width:100%;display:block;background:var(--bg-elev-2);border-radius:8px"></svg></div>
          <div class="table-scroll" style="max-height:440px" tabindex="0" role="region" aria-label="Histórico do backtest"><table><thead><tr><th>#</th><th>Registrado em</th><th>Resultado</th><th>Tag do setup</th><th>R</th><th>Acumulado</th><th>Ação</th></tr></thead><tbody id="btHistory"></tbody></table></div></div>
        </section>`);
        el('btCreate').onsubmit = e => {
            e.preventDefault(); const name=el('btStrategy').value.trim(); if (!name) return;
            const s={id:uid(),kind:'session',name,created:new Date().toISOString(),dirty:true};
            const previous=active; active=s.id;
            if (commit([...records,s])) el('btStrategy').value=''; else active=previous;
        };
        el('btTrade').onsubmit = e => {
            e.preventDefault(); if (!sessions().some(s=>s.id===active)) return;
            const stop=document.querySelector('input[name="btResult"]:checked').value==='stop';
            const r=stop?-1:Number(el('btTarget').value); if (![-1,1,2,3].includes(r)) return;
            const setupTag=el('btSetupTag').value.trim().slice(0,100);
            if (commit([...records,{id:uid(),kind:'trade',parent:active,r,setupTag,created:new Date().toISOString(),dirty:true}])) el('btSetupTag').value='';
        };
        document.querySelectorAll('input[name="btResult"]').forEach(input=>input.onchange=()=>{ el('btTarget').disabled=document.querySelector('input[name="btResult"]:checked').value==='stop'; });
        el('view-backtests').onclick = e => {
            const b=e.target.closest('button'); if (!b) return;
            if (b.dataset.open) { active=b.dataset.open; render(); el('btEditor').scrollIntoView({behavior:'smooth',block:'start'}); }
            const id=b.dataset.delete || b.dataset.remove;
            if (id && confirm(b.dataset.delete ? 'Excluir este backtest e seu histórico? A exclusão será sincronizada com o Supabase.' : 'Excluir este trade e recalcular a curva?')) {
                commit(records.map(x=> x.id===id || x.parent===id ? {...x,deleted:true,dirty:true} : x));
            }
        };
        el('btClose').onclick=()=>{active=null;render();};
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
                if (commit([...records,...guest.filter(x=>!x.deleted).map(x=>({...x,id:ids.get(x.id),parent:ids.get(x.parent),dirty:true}))])) localStorage.removeItem(key('guest'));
            } catch(e) {alert(`Falha ao trazer testes locais: ${e.message}`);}
        };
        window.addEventListener('online',sync);
        authChanged();
    }
    return {init,render,authChanged,metrics};
})();
