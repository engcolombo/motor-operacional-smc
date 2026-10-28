/* Cycles live in each trade payload: no deletion, new table or detached image links. */
const DiaryArchives = (() => {
    let busy = false;
    const active = () => manualTrades().filter(t => !t.archive?.id);
    function groups() {
        const result = new Map();
        if(typeof ProfitTrades!=='undefined')ProfitTrades.cycleGroups().forEach(c=>result.set(c.id,c));
        manualTrades().forEach(t => {
            if (!t.archive?.id) return;
            const a = t.archive;
            if (!result.has(a.id)) result.set(a.id, { ...a, count: 0 });
            result.get(a.id).count++;
        });
        return [...result.values()].sort((a, b) => String(b.createdAt).localeCompare(String(a.createdAt)));
    }
    function unavailable() {
        if (busy || cloudBusy) return "Aguarde a sincronização terminar.";
        if (!psychologyDiarySnapshot().ready) return "Atualize os dados da nuvem antes de continuar.";
        const owner = localStorage.getItem("diarioProTradesOwner_v1");
        if (owner && owner !== currentUser?.id) return "Entre na conta que salvou estes trades para arquivar ou exportar.";
        if (currentUser && !canUseCloud()) return "Entre novamente na sua conta antes de continuar.";
        if (state.pendingCloudDeletes.length) return "Há exclusões locais pendentes. Resolva-as em Conta e sincronização antes de arquivar.";
        if(typeof ProfitTrades!=='undefined'){
            const reason=ProfitTrades.cycleReadiness();if(reason)return reason;
        }
        if ($("btnSave")?.disabled) return "Aguarde o trade terminar de salvar.";
        return "";
    }
    function render() {
        if(typeof ProfitTrades!=='undefined')ProfitTrades.authChanged();
        const bar = $("archiveToolbar");
        if (!bar) return;
        bar.hidden = !ASSET_FILTER_VIEWS.has(state.view) && state.view !== 'profit';
        const archives = groups();
        if (!["active", "all", ...archives.map(a => a.id)].includes(state.archiveView)) state.archiveView = "active";
        $("archiveSelect").innerHTML = '<option value="active">Ciclo atual</option><option value="all">Histórico completo</option>' +
            archives.map(a => `<option value="${escapeHtml(a.id)}">${escapeHtml(a.name)} · ${a.count} trades</option>`).join("");
        $("archiveSelect").value = state.archiveView;
        $("archiveSelect").disabled = busy;
        const selected = archives.find(a => a.id === state.archiveView);
        $("archiveHint").textContent = selected
            ? `Arquivo: ${selected.name} · ${selected.count} trades preservados com notas e imagens. Novas operações entram no ciclo atual.`
            : state.archiveView === "all" ? "Histórico completo: ciclo atual e arquivos anteriores."
            : `Ciclo atual · ${active().length} trades · ${archives.length} arquivos anteriores. Arquivar inclui todos os ativos deste ciclo.`;
        const reason = unavailable();
        $("btnArchiveCycle").disabled = !!reason || (!active().length && !(typeof ProfitTrades!=='undefined'&&ProfitTrades.hasActiveCycle()));
        $("btnArchiveCycle").title = reason;
        $("btnArchiveRestore").hidden = !selected;
        $("btnArchiveRestore").disabled = !!reason;
        $("btnArchivePDF").disabled = !!reason || (!cycleManualTrades().length && !(typeof ProfitTrades!=='undefined'&&(state.archiveView==='active'?ProfitTrades.hasActiveCycle():groups().some(c=>state.archiveView==='all'||c.id===state.archiveView))));
        $("btnArchivePDF").title = reason || "Inclui todos os ativos do ciclo selecionado, com notas e imagens.";
        $("btnDeleteAllTrades").hidden = state.archiveView !== "active";
    }
    function select(value) {
        state.archiveView = value;
        state.chartDay = null;
        const rows = cycleManualTrades().slice().sort((a, b) => tradeDisplayDate(b) - tradeDisplayDate(a));
        const last = rows[0] ? tradeLocalDateTime(rows[0]) : localDateTimeValue();
        state.chartMonth = last.slice(0, 7);
        state.calMonth = new Date(Number(last.slice(0, 4)), Number(last.slice(5, 7)) - 1, 1);
        hideTradeChartTooltip();
        renderAll();
    }
    function openArchive() {
        const reason = unavailable();
        if (reason) { alert(reason); return; }
        const count = active().length;
        if (!count && !(typeof ProfitTrades!=='undefined'&&ProfitTrades.hasActiveCycle())) return;
        $("archiveName").value = `Plano anterior · ${new Date().toLocaleDateString("pt-BR")}`;
        $("archiveConfirmText").textContent = `${count} trades de todos os ativos e os registros da Psicologia serão arquivados. Visão geral, Operações, Calendário, Estatísticas, Diário e Psicologia começarão um novo ciclo. Taxas, Robô SMC e Backtests serão mantidos. Nenhum trade ou imagem será apagado. A Psicologia continua salva neste navegador; exporte o PDF e seu Backup para guardar fora dele.`;
        $("archiveDialog").showModal();
        $("archiveName").focus();
    }
    async function commit(changes,kind,meta) {
        const reason = unavailable();
        if (reason) throw new Error(reason);
        const userId = currentUser?.id || null;
        const before = JSON.stringify(state.trades);
        // A recoverable copy must fit before any request or change is made.
        localStorage.setItem(`diarioProBeforeArchive_v1_${userId || "guest"}`, before);
        busy = true;
        render();
        let psychology=null,remoteSaved=false,applied=false;
        try {
            if(typeof ProfitTrades!=='undefined')psychology=ProfitTrades.prepareCycle(kind,meta,changes.map(t=>t.id));
            if (userId && changes.length) {
                const { error } = await supabaseClient.from(SUPABASE_TABLE).upsert(changes.map(t => ({
                    id: t.id, user_id: userId, payload: t, trade_timestamp: t.date || null,
                    updated_at: new Date().toISOString()
                })));
                if (error) throw new Error(error.message || String(error));
                remoteSaved=true;
                if (currentUser?.id !== userId) throw new Error("A conta mudou durante o salvamento. Atualize a conta original para conferir o arquivo salvo.");
            }
            const byId = new Map(changes.map(t => [t.id, t]));
            const next = state.trades.map(t => byId.get(t.id) || t);
            try { localStorage.setItem(STORAGE_KEY, JSON.stringify(next)); }
            catch (error) {
                if (!userId) throw new Error("Sem espaço para salvar o arquivo neste navegador. O ciclo atual foi mantido.");
                alert("Arquivo salvo na nuvem, mas sem espaço para atualizar a cópia local. Entre na mesma conta e atualize da nuvem ao reabrir.");
            }
            state.trades = next;
            applied=true;
            if(psychology){
                try{ProfitTrades.completeCycle(psychology);}
                catch(error){alert('Trades salvos. A Psicologia está preservada e aguardando conclusão local: '+error.message+'. Reabra o diário ou atualize da nuvem para recuperar.');}
            }
        } catch(error) {
            if(psychology&&!remoteSaved&&!applied)ProfitTrades.cancelCycle(psychology);
            throw error;
        } finally {
            busy = false;
            render();
            if ((currentUser?.id || null) !== userId && canUseCloud()) loadCloudTrades();
        }
    }
    async function archive(name) {
        const rows = active();
        if (!rows.length && !(typeof ProfitTrades!=='undefined'&&ProfitTrades.hasActiveCycle())) throw new Error("Não há trades nem registros psicológicos no ciclo atual.");
        name = String(name || "").trim().slice(0, 100);
        if (!name) throw new Error("Dê um nome ao arquivo.");
        const meta = { id: uid(), name, createdAt: new Date().toISOString() };
        await commit(rows.map(t => ({ ...t, archive: { ...meta, fees: tradeFees(t) } })), 'archive', meta);
        select("active");
        return meta.id;
    }
    async function restore(id) {
        const rows = manualTrades().filter(t => t.archive?.id === id);
        if (!rows.length && !groups().some(c=>c.id===id)) throw new Error("Arquivo não encontrado.");
        await commit(rows.map(t => { const copy = { ...t }; delete copy.archive; return copy; }), 'restore', {id});
        select("active");
    }
    function readImage(blob) {
        return new Promise((resolve, reject) => {
            const reader = new FileReader();
            reader.onerror = () => reject(new Error("Não foi possível ler a imagem."));
            reader.onload = () => resolve(reader.result);
            reader.readAsDataURL(blob);
        });
    }
    async function reportImages(rows, userId, progress) {
        const images = new Map();
        for (let i = 0; i < rows.length; i++) {
            const t = rows[i];
            for (const attachment of tradeAttachments(t)) {
                if (!userId || currentUser?.id !== userId || !canUseCloud()) throw new Error("Entre na conta que contém as imagens para gerar o relatório completo.");
                progress(`Carregando imagem do trade ${i + 1} de ${rows.length}…`);
                const { data, error } = await supabaseClient.storage.from(ATTACHMENTS_BUCKET).download(attachment.path);
                if (error || !data) throw new Error(`Imagem de ${t.symbol || t.id} indisponível: ${error?.message || "arquivo ausente"}. Tente novamente antes de salvar o PDF.`);
                if (!ALLOWED_ATTACHMENT_TYPES.has(data.type)) throw new Error(`Formato de imagem inválido em ${t.symbol || t.id}.`);
                images.set(attachment.path, await readImage(data));
                if (currentUser?.id !== userId) throw new Error("A conta mudou durante a exportação. Tente novamente.");
            }
        }
        return images;
    }
    function reportHTML(rows, title, images, psychologyHTML = '') {
        const s = computeStats(rows), e = escapeHtml;
        const number = value => value == null || !Number.isFinite(Number(value)) ? "—" : Number(value).toLocaleString("pt-BR", { maximumFractionDigits: 3 });
        const outcome = { target: "Alvo", stop: "Stop", breakeven: "Empate", open: "Aberta", manual: "Manual" };
        const cards = rows.map((t, i) => {
            const fields = [
                ["Data e hora", fmtDate(t)], ["Direção", t.side === "long" ? "Compra" : t.side === "short" ? "Venda" : t.side],
                ["Status", outcome[t.status] || t.status || "—"], ["Setup", t.setup || "—"],
                ["Quantidade", number(t.initQty ?? t.qty)], ["Stop / risco", fmtCurrency(t.stopMoney ?? t.riskMoney ?? 0)],
                ["Alvo", fmtCurrency(t.targetMoney || 0)], ["Resultado em R", number(tradeRValue(t))],
                ["Resultado bruto", fmtCurrency(t.pnl || 0)], ["Taxas", fmtCurrency(tradeFees(t))],
                ["Resultado líquido", fmtCurrency(tradeNetPnl(t))], ["Ciclo", t.archive?.name || "Ciclo atual"],
                ["Entrada / stop / saída", [t.entry, t.stop, t.exit].map(number).join(" / ")],
                ["Tags", (t.tags || []).join(", ") || "—"], ["Erros / Mistakes", (t.mistakes || []).join(", ") || "—"],
                ["Parciais", (t.partials || []).map(p => `${number(p.qty)} contratos · ${number(p.r)} R`).join("; ") || "—"]
            ];
            const attachments = tradeAttachments(t);
            const figures = attachments.map(attachment => {
                const src = images.get(attachment.path) || (attachments.length === 1 ? images.get(t.id) : null);
                if (!src) throw new Error(`A imagem de ${t.symbol || t.id} ainda não foi carregada.`);
                return `<figure><img src="${e(src)}" alt="${e(attachmentName(attachment))}"><figcaption>${e(attachmentName(attachment))}</figcaption></figure>`;
            }).join("");
            return `<article><h2>${i + 1}. ${e(t.symbol || "Trade")} <small>${e(fmtDate(t))}</small></h2><dl>${fields.map(([k, v]) => `<div><dt>${e(k)}</dt><dd>${e(v)}</dd></div>`).join("")}</dl><h3>Diário / observações</h3><p class="notes">${e(t.notes || "Sem observações.")}</p>${figures}<p class="id">Registro: ${e(t.id)}${t.archive?.createdAt ? ` · Arquivado em ${e(new Date(t.archive.createdAt).toLocaleString("pt-BR"))}` : ""}</p></article>`;
        }).join("");
        return `<!doctype html><html lang="pt-BR"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${e(title)} · Diário Pro+</title><style>
        *{box-sizing:border-box}body{font:14px/1.5 system-ui,sans-serif;color:#18202b;background:#edf0f3;margin:0}main{max-width:1000px;margin:24px auto;background:white;padding:32px}h1{font-size:28px;margin:0}h2{font-size:20px}h3{font-size:14px}small{font-size:12px;font-weight:400}header{border-bottom:2px solid #18202b;padding-bottom:20px}.summary{display:flex;flex-wrap:wrap;gap:12px 30px}.summary b{display:block;font-size:20px}article{border-top:1px solid #cbd1d8;margin-top:28px;padding-top:8px}dl{display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:10px}dl div{break-inside:avoid}dt{font-size:11px;color:#526070}dd{margin:0;overflow-wrap:anywhere}.notes{white-space:pre-wrap;overflow-wrap:anywhere}figure{margin:16px 0;break-inside:avoid}img{display:block;max-width:100%;max-height:225mm;object-fit:contain}figcaption,.id{font-size:11px;color:#526070;overflow-wrap:anywhere}.print-tools{padding:14px;background:#18202b;color:white;display:flex;gap:12px;align-items:center;flex-wrap:wrap}button{padding:10px 18px;cursor:pointer}button:disabled{cursor:wait}article h2{break-after:avoid}.psychology-report{break-before:page;margin-top:32px}.psychology-report dl{display:block}.psychology-report dl div{margin:8px 0}.psychology-report dd{white-space:pre-wrap}.psychology-report dd dl{margin-left:14px}.psychology-cycle+ .psychology-cycle{break-before:page}@page{size:A4;margin:14mm}@media print{body{background:white}main{margin:0;padding:0;max-width:none}.print-tools{display:none}header{break-after:avoid}article+article{break-before:page}img{max-height:210mm}dl{font-size:12px}}@media(max-width:600px){main{padding:18px;margin:0}dl{grid-template-columns:repeat(2,minmax(0,1fr))}}
        </style></head><body><div class="print-tools"><button id="printReport" disabled>Salvar em PDF / Imprimir</button><span id="reportReady">Preparando imagens…</span></div><main><header><p>DIÁRIO PRO+ · HISTÓRICO DE EVOLUÇÃO</p><h1>${e(title)}</h1><p>${e(rows.length ? `${fmtDate(rows[0])} a ${fmtDate(rows.at(-1))}` : "")} · Gerado em ${e(new Date().toLocaleString("pt-BR"))}</p><p>Todos os ativos do período selecionado, sem filtros de tela.</p><div class="summary"><div>Operações<b>${s.total}</b></div><div>Líquido<b>${e(fmtCurrency(s.pnlTotal))}</b></div><div>Resultado em R<b>${number(s.rTotal)} R</b></div><div>Acerto (sem empates)<b>${number(s.winrate)}%</b></div><div>Taxas<b>${e(fmtCurrency(s.feesTotal))}</b></div><div>Profit factor (R)<b>${s.pf === Infinity ? "∞" : number(s.pf)}</b></div></div><p>${s.wins} ganhos · ${s.losses} perdas · ${s.bes} empates · ${s.openCount} abertas · ${s.pendingR} com R pendente.</p></header>${cards}${psychologyHTML}</main></body></html>`;
    }
    async function exportPDF() {
        const reason = unavailable();
        if (reason) { alert(reason); return; }
        const rows = JSON.parse(JSON.stringify(cycleManualTrades())).sort((a, b) => tradeDisplayDate(a) - tradeDisplayDate(b));
        let psychologyHTML = '';
        try { if(typeof ProfitTrades!=='undefined')psychologyHTML=ProfitTrades.cycleReportHTML(state.archiveView); }
        catch(error){alert('Não foi possível preparar a Psicologia: '+error.message);return;}
        if (!rows.length && !psychologyHTML) return;
        const title = state.archiveView === "active" ? "Ciclo atual" : state.archiveView === "all" ? "Histórico completo" : groups().find(c=>c.id===state.archiveView)?.name || 'Arquivo';
        const report = window.open("", "_blank");
        if (!report) { alert("Permita abrir a aba do relatório para salvar o PDF."); return; }
        report.opener = null;
        report.document.title = "Preparando relatório · Diário Pro+";
        report.document.body.textContent = "Preparando relatório com todas as imagens…";
        busy = true; render();
        const userId = currentUser?.id || null;
        try {
            const images = await reportImages(rows, userId, text => { if (!report.closed) report.document.body.textContent = text; });
            if (report.closed) return;
            report.document.open(); report.document.write(reportHTML(rows, title, images, psychologyHTML)); report.document.close();
            await Promise.all([...report.document.images].map(img => img.decode()));
            if ((currentUser?.id || null) !== userId) throw new Error("A conta mudou durante a exportação. Tente novamente.");
            const button = report.document.getElementById("printReport");
            button.disabled = false;
            button.onclick = () => report.print();
            report.document.getElementById("reportReady").textContent = `${images.size} imagens incorporadas. Clique no botão e escolha Salvar como PDF no destino de impressão.`;
        } catch (error) {
            if (!report.closed) report.document.body.textContent = `Relatório não concluído: ${error.message || error}`;
            alert(`Não foi possível preparar o PDF completo: ${error.message || error}`);
        } finally {
            busy = false; render();
            if ((currentUser?.id || null) !== userId && canUseCloud()) loadCloudTrades();
        }
    }
    function init() {
        $("archiveSelect").addEventListener("change", event => select(event.target.value));
        $("btnArchiveCycle").addEventListener("click", openArchive);
        $("archiveCancel").addEventListener("click", () => { if (!busy) $("archiveDialog").close(); });
        $("archiveDialog").addEventListener("cancel", event => { if (busy) event.preventDefault(); });
        $("archiveDialog").addEventListener("keydown", event => event.stopPropagation());
        $("archiveForm").addEventListener("submit", async event => {
            event.preventDefault();
            if (busy) return;
            $("archiveConfirm").disabled = true;
            $("archiveCancel").disabled = true;
            $("archiveStatus").textContent = "Salvando arquivo…";
            try {
                await archive($("archiveName").value);
                $("archiveDialog").close();
                toast("Histórico arquivado. Seu novo ciclo começa agora.");
            } catch (error) { alert(`Não foi possível concluir: ${error.message || error}`); }
            finally { $("archiveConfirm").disabled = false; $("archiveCancel").disabled = false; $("archiveStatus").textContent = ""; }
        });
        $("btnArchiveRestore").addEventListener("click", async () => {
            const id = state.archiveView, group = groups().find(a => a.id === id);
            if (!group || !confirm(`Devolver os ${group.count} trades e a Psicologia de “${group.name}” ao ciclo atual? As operações usarão as taxas atuais. Revisões conflitantes impedem a restauração e preservam os dois históricos.`)) return;
            try { await restore(id); toast("Trades devolvidos ao ciclo atual."); }
            catch (error) { alert(`Não foi possível restaurar: ${error.message || error}`); }
        });
        $("btnArchivePDF").addEventListener("click", exportPDF);
    }
    return { init, render, archive, restore, select, groups, reportImages, reportHTML, get busy() { return busy; } };
})();
