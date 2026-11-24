/* Monitor ao vivo e controle remoto do Robô SMC POI Determinístico V8 (100% MT5 Nativo via Supabase). */
window.RobotLiveMonitor = (() => {
    const TABLE = "robot_live_status";
    const NORMAL_POLL_MS = 10000;
    const FAST_POLL_MS = 2500;
    const FAST_WINDOW_MS = 25000;
    const STALE_AFTER_SECONDS = 50;

    const REASON_LABELS = {
        blocked_by_emergency_pause: "Pausa remota ativa (Diário Pro+)",
        emergency_pause: "Pausa remota acionada",
        emergency_resume: "Entradas retomadas remotamente",
        emergency_flatten: "Zeragem de emergência (FLATTEN)",
        rejected: "Ordem rejeitada pela corretora",
        veto_daily_loss: "EA: limite de perda diária atingido",
        veto_max_dd: "EA: drawdown máximo global atingido",
        veto_max_trades: "EA: limite diário de trades",
        veto_consec_losses: "EA: limite de perdas seguidas",
        veto_time: "EA: sessão encerrada (zeragem)",
        veto_algotrading: "AlgoTrading desligado no MT5",
        veto_demo_mode_on_real_account: "EA: trava DEMO em conta REAL",
        veto_risk: "EA: veto de risco/conta",
        v8_lunch_block: "Gate V8: filtro de almoço ativo",
        v8_avwap_barrier: "Gate V8: barreira AVWAP oposta no caminho",
        v8_avwap_dir: "Gate V8: regra de direção AVWAP ativa",
        v8_no_context: "Gate V8: sem contexto A/B/C/D válido",
        v8_stop_bounds: "Gate V8: distância de stop fora dos limites",
        v8_expired: "Gate V8: zona 50% expirou ou invalidou",
        gate_rejected: "Gate V8: condição não atendida",
        signal_ok: "Ordem enviada pelo EA",
        filled: "Posição aberta no MT5",
        trade_win: "Trade encerrado no lucro",
        trade_loss: "Trade encerrado no prejuízo"
    };

    const CATEGORY_LABEL = {
        gate_v8: "Gate V8",
        risco: "Risco EA"
    };

    let rowData = null;
    let lastError = null;
    let loading = false;
    let commandBusy = false;
    let initialized = false;
    let pollTimer = null;
    let fastUntilMs = 0;

    function el(id) {
        return document.getElementById(id);
    }

    function esc(value) {
        if (typeof escapeHtml === "function") return escapeHtml(value == null ? "" : String(value));
        return String(value == null ? "" : value)
            .replace(/&/g, "&amp;")
            .replace(/</g, "&lt;")
            .replace(/>/g, "&gt;")
            .replace(/"/g, "&quot;");
    }

    function fmtMoney(v) {
        if (v === null || v === undefined || v === "" || !Number.isFinite(Number(v))) return "—";
        if (typeof fmtCurrency === "function") return fmtCurrency(Number(v));
        const n = Number(v);
        return `${n < 0 ? "-" : ""}R$ ${Math.abs(n).toFixed(2).replace(".", ",")}`;
    }

    function fmtNum(v) {
        if (v === null || v === undefined || v === "" || !Number.isFinite(Number(v))) return "—";
        return String(Math.trunc(Number(v)));
    }

    function fmtPctVal(v) {
        if (v === null || v === undefined || !Number.isFinite(Number(v))) return "—";
        return `${Number(v).toFixed(1)}%`;
    }

    function fmtRVal(v) {
        if (v === null || v === undefined || !Number.isFinite(Number(v))) return "—";
        const n = Number(v);
        return `${n > 0 ? "+" : n < 0 ? "-" : ""}${Math.abs(n).toFixed(2)}R`;
    }

    function fmtMt5EpochDate(ts) {
        if (!ts || !Number.isFinite(Number(ts)) || Number(ts) <= 0) return "";
        const d = new Date(Number(ts) * 1000);
        if (!Number.isFinite(d.getTime())) return "";
        return d.toLocaleDateString("pt-BR", { timeZone: "UTC" });
    }

    function reasonLabel(reason) {
        if (!reason) return "—";
        return REASON_LABELS[reason] || String(reason);
    }

    function formatCtxLine(ctx) {
        if (!ctx || typeof ctx !== "object") return "—";
        const a = ctx.a ? `A:${Math.round(Number(ctx.a_min || 0))}m` : "A:-";
        const b = ctx.b ? `B:${Math.round(Number(ctx.b_min || 0))}m` : "B:-";
        const c = ctx.c ? "C:ON" : "C:-";
        const d = ctx.d ? `D:${Math.round(Number(ctx.d_min || 0))}m` : "D:-";
        return `${a} · ${b} · ${c} · ${d}`;
    }

    function isRobotActive() {
        return typeof state !== "undefined" && state.view === "robot";
    }

    function cloudReady() {
        return typeof canUseCloud === "function" && canUseCloud() && typeof supabaseClient !== "undefined" && supabaseClient;
    }

    function ageFromIso(iso) {
        if (!iso) return null;
        const ms = Date.parse(iso);
        if (!Number.isFinite(ms)) return null;
        const sec = Math.max(0, Math.round((Date.now() - ms) / 1000));
        if (sec < 60) return { sec, text: `há ${sec}s`, stale: sec > STALE_AFTER_SECONDS };
        const min = Math.floor(sec / 60);
        const rem = sec % 60;
        if (min < 60) return { sec, text: `há ${min}m ${rem}s`, stale: true };
        const hr = Math.floor(min / 60);
        return { sec, text: `há ${hr}h ${min % 60}m`, stale: true };
    }

    function isMissingTableError(err) {
        const msg = String(err?.message || err?.code || "").toLowerCase();
        return msg.includes("42p01") || msg.includes("pgrst205") || (msg.includes("robot_live_status") && msg.includes("does not exist"));
    }

    function clearSchedule() {
        if (pollTimer) {
            clearTimeout(pollTimer);
            pollTimer = null;
        }
    }

    function scheduleNext() {
        clearSchedule();
        if (!isRobotActive() || !cloudReady()) return;
        if (typeof document !== "undefined" && document.hidden) return;
        const waitMs = Date.now() < fastUntilMs ? FAST_POLL_MS : NORMAL_POLL_MS;
        pollTimer = setTimeout(() => {
            refresh();
        }, waitMs);
    }

    function renderReasonsList(bucket) {
        if (!bucket) return `<div class="muted robot-live-empty">Aguardando dados do MT5.</div>`;
        const reasons = bucket.reasons || {};
        const entries = Object.entries(reasons).sort((a, b) => Number(b[1]) - Number(a[1]));
        if (!entries.length) return `<div class="muted robot-live-empty">Nenhum veto registrado hoje.</div>`;
        return entries
            .map(([reason, count]) => (
                `<div class="metric-row"><span>${esc(reasonLabel(reason))}</span><strong>${esc(count)}</strong></div>`
            ))
            .join("");
    }

    function renderEventsList(events) {
        if (!Array.isArray(events) || !events.length) {
            return `<div class="muted robot-live-empty">Nenhum evento registrado hoje ainda.</div>`;
        }
        return [...events]
            .reverse()
            .slice(0, 20)
            .map((ev) => {
                const time = esc(ev.time_brt || "—");
                const isRej = ev.kind === "rejection";
                const tagText = isRej
                    ? `VETO · ${CATEGORY_LABEL[ev.category] || ev.category || "Regra"}`
                    : String(ev.kind || "EVENTO").toUpperCase();
                const tagCls = isRej
                    ? "is-rej"
                    : (ev.kind === "filled" || ev.kind === "signal_dispatched" || ev.kind === "emergency_resume" || ev.kind === "closed")
                        ? "is-ok"
                        : "is-warn";
                const text = ev.detail || reasonLabel(ev.reason);
                return (
                    `<div class="robot-live-event-item">` +
                    `<span class="robot-live-event-time">${time}</span>` +
                    `<span class="robot-live-event-tag ${tagCls}">${esc(tagText)}</span>` +
                    `<span class="robot-live-event-desc">${esc(text)}</span>` +
                    `</div>`
                );
            })
            .join("");
    }

    function render() {
        const panel = el("robotLivePanel");
        if (!panel) return;

        const badge = el("robotLiveBadge");
        const updatedEl = el("robotLiveUpdated");
        const pauseBtn = el("btnRobotLivePause");
        const flattenBtn = el("btnRobotLiveFlatten");
        const refreshBtn = el("btnRobotLiveRefresh");
        const alertBox = el("robotLiveAlert");
        const kpisBox = el("robotLiveKpis");
        const stateRowsBox = el("robotLiveStateRows");
        const rejectionsBox = el("robotLiveRejections");
        const eventsBox = el("robotLiveEvents");
        const accBlock = el("robotLiveAccBlock");
        const accMeta = el("robotLiveAccMeta");
        const accKpis = el("robotLiveAccKpis");

        if (refreshBtn) refreshBtn.disabled = !cloudReady() || loading;

        if (!cloudReady()) {
            if (badge) { badge.className = "robot-live-badge is-off"; badge.textContent = "Sem login"; }
            if (updatedEl) updatedEl.textContent = "Faça login em Conta e sincronização para conectar ao painel ao vivo.";
            if (pauseBtn) { pauseBtn.disabled = true; pauseBtn.textContent = "Pausar entradas"; }
            if (flattenBtn) flattenBtn.disabled = true;
            if (alertBox) {
                alertBox.hidden = false;
                alertBox.className = "robot-live-alert is-warn";
                alertBox.textContent = "Conecte sua conta na barra lateral (Conta e sincronização) para acompanhar o POI Determinístico V8 e acionar comandos.";
            }
            if (kpisBox) kpisBox.innerHTML = "";
            if (stateRowsBox) stateRowsBox.innerHTML = `<div class="muted robot-live-empty">Aguardando autenticação na nuvem.</div>`;
            if (rejectionsBox) rejectionsBox.innerHTML = `<div class="muted robot-live-empty">Aguardando autenticação na nuvem.</div>`;
            if (eventsBox) eventsBox.innerHTML = "";
            if (accBlock) accBlock.hidden = true;
            if (accKpis) accKpis.innerHTML = "";
            return;
        }

        if (lastError) {
            if (badge) { badge.className = "robot-live-badge is-danger"; badge.textContent = "Erro de leitura"; }
            if (updatedEl) updatedEl.textContent = "Falha ao consultar Supabase.";
            if (pauseBtn) { pauseBtn.disabled = true; pauseBtn.textContent = "Pausar entradas"; }
            if (flattenBtn) flattenBtn.disabled = true;
            if (alertBox) {
                alertBox.hidden = false;
                alertBox.className = "robot-live-alert is-danger";
                alertBox.textContent = isMissingTableError(lastError)
                    ? "Tabela public.robot_live_status ainda não existe no Supabase. Rode o arquivo supabase-robot-live.sql no SQL Editor do Supabase."
                    : `Erro ao consultar telemetria ao vivo: ${lastError.message || lastError}`;
            }
            if (kpisBox) kpisBox.innerHTML = "";
            if (stateRowsBox) stateRowsBox.innerHTML = "";
            if (rejectionsBox) rejectionsBox.innerHTML = "";
            if (eventsBox) eventsBox.innerHTML = "";
            if (accBlock) accBlock.hidden = true;
            if (accKpis) accKpis.innerHTML = "";
            return;
        }

        const tel = rowData && typeof rowData.telemetry === "object" ? rowData.telemetry : null;
        const isV8 = Boolean(tel && tel.engine === "poi_deterministico_v8" && tel.v8);
        const hasTel = Boolean(tel && Object.keys(tel).length > 0 && isV8);
        const hasLegacyTel = Boolean(tel && Object.keys(tel).length > 0 && !isV8);
        const ctrl = (rowData && rowData.control) || { paused: false, flatten_seq: 0 };
        const ack = (rowData && rowData.control_ack) || { paused: false, last_flatten_seq: 0 };
        const v8 = (tel && tel.v8) || {};
        const mt5 = (tel && tel.mt5) || {};
        const stats = (tel && tel.daily_stats) || {};
        const rej = stats.rejections || {};
        const age = ageFromIso(rowData?.telemetry_updated_at || tel?.generated_at_utc);
        const stale = !hasTel || !age || age.stale;

        const ctrlPaused = Boolean(ctrl.paused);
        const ackPaused = Boolean(ack.paused);
        const eaPaused = hasTel ? Boolean(v8.emergency_paused) : ackPaused;
        const effectivePaused = rowData?.control_updated_at ? ctrlPaused : eaPaused;
        const pausePending = Boolean(rowData?.control_updated_at) && ctrlPaused !== ackPaused;
        const flattenPending = Number(ctrl.flatten_seq || 0) > Number(ack.last_flatten_seq || 0);

        if (pauseBtn) {
            pauseBtn.disabled = commandBusy;
            pauseBtn.textContent = effectivePaused ? "Retomar entradas" : "Pausar entradas";
            pauseBtn.classList.toggle("btn-primary", effectivePaused);
        }
        if (flattenBtn) flattenBtn.disabled = commandBusy;

        if (!hasTel) {
            if (badge) { badge.className = "robot-live-badge is-warn"; badge.textContent = "Aguardando MT5"; }
            if (updatedEl) {
                updatedEl.textContent = hasLegacyTel
                    ? "Telemetria antiga do robô anterior detectada. Aguardando primeiro envio do POI Determinístico V8..."
                    : "Nenhuma telemetria do POI Determinístico V8 recebida ainda.";
            }
            if (alertBox) {
                alertBox.hidden = false;
                alertBox.className = "robot-live-alert is-warn";
                alertBox.textContent = "No MetaTrader 5, mantenha o EA SMC_POI_Deterministico_V8_EA no gráfico e o serviço POI_V8_DiarioSync ativo em Navegador -> Serviços.";
            }
        } else if (flattenPending || pausePending) {
            if (badge) { badge.className = "robot-live-badge is-warn"; badge.textContent = "Comando enviado"; }
            if (updatedEl) updatedEl.textContent = `Aguardando confirmação do MT5 (${age ? age.text : "—"})`;
            if (alertBox) {
                alertBox.hidden = false;
                alertBox.className = "robot-live-alert is-warn";
                alertBox.textContent = flattenPending
                    ? "Comando ZERAR TUDO (FLATTEN) enviado na fila. Aguardando execução no MetaTrader 5..."
                    : (ctrlPaused ? "Comando PAUSAR ENTRADAS enviado. Aguardando confirmação do MT5..." : "Comando RETOMAR ENTRADAS enviado. Aguardando confirmação do MT5...");
            }
        } else if (stale) {
            if (badge) { badge.className = "robot-live-badge is-danger"; badge.textContent = "Desatualizado / Offline"; }
            if (updatedEl) updatedEl.textContent = `Última atualização ${age ? age.text : "desconhecida"} · Sessão ${tel.session_date || "—"}`;
            if (alertBox) {
                alertBox.hidden = false;
                alertBox.className = "robot-live-alert is-danger";
                alertBox.textContent = `Sem telemetria recente do MetaTrader 5 (${age ? age.text : "—"}). O terminal pode estar fechado, fora do pregão ou com o serviço POI_V8_DiarioSync parado.`;
            }
        } else if (eaPaused) {
            if (badge) { badge.className = "robot-live-badge is-warn"; badge.textContent = "Pausado"; }
            if (updatedEl) updatedEl.textContent = `${tel.symbol || "—"} · Magic ${tel.magic || mt5.magic || "26002801"} · Atualizado ${age.text}`;
            if (alertBox) {
                alertBox.hidden = false;
                alertBox.className = "robot-live-alert is-warn";
                alertBox.textContent = "PAUSA REMOTA ATIVA: o POI Determinístico V8 continua analisando contextos SMC/AVWAP no MT5, mas bloqueia novas entradas até você clicar em Retomar entradas.";
            }
        } else {
            if (badge) { badge.className = "robot-live-badge is-ok"; badge.textContent = "Ao vivo · MT5"; }
            if (updatedEl) updatedEl.textContent = `${tel.symbol || "—"} · ${v8.setup_name || "V8"} · Sessão ${tel.session_date || "—"} · Atualizado ${age.text}`;
            if (alertBox) alertBox.hidden = true;
        }

        const dayPl = mt5.daily_total_pl !== null && mt5.daily_total_pl !== undefined
            ? Number(mt5.daily_total_pl)
            : (mt5.daily_closed_pl !== null && mt5.daily_closed_pl !== undefined ? Number(mt5.daily_closed_pl) : null);
        const plCls = dayPl === null ? "neutral" : dayPl > 0 ? "win" : dayPl < 0 ? "loss" : "neutral";
        const tradesCount = mt5.daily_trades_count !== null && mt5.daily_trades_count !== undefined
            ? mt5.daily_trades_count
            : (hasTel ? stats.signals_executed : null);
        const engCounts = v8.engine_counts || {};

        if (kpisBox) {
            kpisBox.innerHTML = hasTel ? `
                <div class="kpi-card ${eaPaused ? "loss" : "neutral"}">
                    <div class="label">Estado do Robô (MT5)</div>
                    <div class="value robot-live-kpi-text">${esc(v8.operating_state || "—")}</div>
                    <div class="meta">${mt5.mode ? esc(mt5.mode) : "DEMO"} · Magic ${esc(tel.magic || mt5.magic || "26002801")} · Warm-up: ${v8.warmup_ready ? "OK" : "CARREGANDO"}</div>
                </div>
                <div class="kpi-card ${plCls}">
                    <div class="label">Resultado do Dia (MT5)</div>
                    <div class="value">${esc(fmtMoney(dayPl))}</div>
                    <div class="meta">Fechado: ${esc(fmtMoney(mt5.daily_closed_pl))} · Flut.: ${esc(fmtMoney(mt5.floating_pl))}</div>
                </div>
                <div class="kpi-card neutral">
                    <div class="label">Operações &amp; POIs Hoje</div>
                    <div class="value">${esc(fmtNum(tradesCount))}</div>
                    <div class="meta">POIs M1: ${esc(fmtNum(stats.pois_formed_today ?? engCounts.pois_today ?? 0))} · Armados: ${esc(fmtNum(v8.armed_zones_count || 0))}${mt5.daily_consec_losses !== null && mt5.daily_consec_losses !== undefined ? ` · Losses seg.: ${esc(mt5.daily_consec_losses)}` : ""}</div>
                </div>
                <div class="kpi-card neutral">
                    <div class="label">Setup &amp; Risco Ativo</div>
                    <div class="value robot-live-kpi-text">${esc(v8.target_rr ? `${Number(v8.target_rr).toFixed(1)}R` : "4.0R")} · ${esc(fmtMoney(v8.risk_per_trade_brl))}</div>
                    <div class="meta">${v8.lunch_blocked ? `Almoço bloq. (${esc(v8.lunch_window || "12:00-15:00")})` : "Almoço liberado"} · Máx ${esc(fmtNum(v8.max_contracts))}ct · ${esc(v8.order_mode || "Limite 1:1")}</div>
                </div>
            ` : "";
        }

        const posDesc = !hasTel
            ? "—"
            : mt5.has_position
                ? `${mt5.pos_side || ""} ${Number(mt5.pos_vol || 0).toFixed(0)}ct @ ${Number(mt5.pos_price || 0).toFixed(0)}${mt5.pos_sl ? ` · SL ${Number(mt5.pos_sl).toFixed(0)}` : ""}${mt5.pos_tp ? ` · TP ${Number(mt5.pos_tp).toFixed(0)}` : ""}${mt5.pos_ticket ? ` (#${mt5.pos_ticket})` : ""}`
                : (mt5.has_pending ? "Ordem Limite apregoada no book" : "ZERADO (Monitorando)");
        const avwap = v8.avwap || {};
        const avwapDesc = `${esc(avwap.tf || "M5")}: ${esc(fmtNum(avwap.buy_count || 0))}B/${esc(fmtNum(avwap.nearest_buy || 0))} · ${esc(fmtNum(avwap.sell_count || 0))}V/${esc(fmtNum(avwap.nearest_sell || 0))} · Regra: ${esc(avwap.rule_dir || "NENHUMA")} · ATR42: ${esc(fmtNum(avwap.atr42 || 0))}`;
        const setupCfgDesc = `${esc(v8.setup_name || "—")} · BarrOpp: ${v8.barrier_opp ? `SIM (${Number(v8.barrier_opp_r || 0).toFixed(1)}R)` : "NÃO"} · AVDir: ${v8.avwap_dir_rule ? "SIM" : "NÃO"} · TF ${esc(v8.avwap_tf || "M5")} (${esc(fmtNum(v8.avwap_days || 5))}d)`;

        if (stateRowsBox) {
            stateRowsBox.innerHTML = hasTel ? `
                <div class="metric-row"><span>Setup ativo</span><strong>${setupCfgDesc}</strong></div>
                <div class="metric-row"><span>Contextos BUY</span><strong>${esc(formatCtxLine(v8.ctx_buy))}</strong></div>
                <div class="metric-row"><span>Contextos SELL</span><strong>${esc(formatCtxLine(v8.ctx_sell))}</strong></div>
                <div class="metric-row"><span>AVWAP &amp; ATR</span><strong>${avwapDesc}</strong></div>
                <div class="metric-row"><span>POI 50% (M1)</span><strong>${esc(v8.armed_detail || "Nenhum POI 50% armado")}</strong></div>
                <div class="metric-row"><span>Último Gate V8</span><strong>${esc(v8.last_gate_log || "Aguardando...")}</strong></div>
                <div class="metric-row"><span>Último gatilho</span><strong>${esc(v8.last_signal_info || "—")}</strong></div>
                <div class="metric-row"><span>Posição no MT5</span><strong>${esc(posDesc)}</strong></div>
                <div class="metric-row"><span>Status de risco (EA)</span><strong>${esc(mt5.risk_status || "SISTEMA OPERACIONAL (OK)")}</strong></div>
                <div class="metric-row"><span>Saldo / Equity · Núcleo</span><strong>${esc(fmtMoney(mt5.balance))} / ${esc(fmtMoney(mt5.equity))} · OBs:${esc(fmtNum(engCounts.blocks || 0))} NivA:${esc(fmtNum(engCounts.levels || 0))} CapA:${esc(fmtNum(engCounts.captures || 0))}</strong></div>
            ` : `<div class="muted robot-live-empty">Sem leitura ao vivo do POI Determinístico V8 disponível.</div>`;
        }

        if (rejectionsBox) {
            rejectionsBox.innerHTML = hasTel ? `
                <div class="robot-live-rej-col">
                    <div class="robot-live-rej-head"><span>Gate V8 (Determinístico)</span><strong>${esc(fmtNum(rej.gate_v8?.total || 0))}</strong></div>
                    ${renderReasonsList(rej.gate_v8)}
                </div>
                <div class="robot-live-rej-col">
                    <div class="robot-live-rej-head"><span>Sistema de Risco (EA)</span><strong>${esc(fmtNum(rej.risco?.total || 0))}</strong></div>
                    ${renderReasonsList(rej.risco)}
                </div>
            ` : "";
        }

        if (eventsBox) eventsBox.innerHTML = hasTel ? renderEventsList(stats.recent_events) : "";

        const acc = hasTel && mt5.accumulated && typeof mt5.accumulated === "object" ? mt5.accumulated : null;
        if (hasTel && typeof window.syncRobotTradesFromLive === "function") {
            try {
                window.syncRobotTradesFromLive(tel.recent_closed_trades, acc ? acc.trades : null);
            } catch (_e) {}
        }
        if (accBlock) accBlock.hidden = !hasTel;
        if (accMeta && accKpis) {
            if (!hasTel) {
                accMeta.textContent = "Aguardando leitura do MT5";
                accKpis.innerHTML = "";
            } else if (!acc) {
                accMeta.textContent = "Aguardando envio do histórico acumulado pelo EA no MT5";
                accKpis.innerHTML = "";
            } else {
                const accTrades = Number(acc.trades || 0);
                const accWins = Number(acc.wins || 0);
                const accLosses = Number(acc.losses || 0);
                const accBes = Number(acc.bes || 0);
                const decisive = accWins + accLosses;
                const accNet = Number(acc.net_pl || 0);
                const accFees = Number(acc.fees || 0);
                const accWr = Number(acc.winrate || 0);
                const pfInf = Boolean(acc.profit_factor_infinite);
                const accPf = acc.profit_factor === null || acc.profit_factor === undefined ? 0 : Number(acc.profit_factor);
                const accExpBrl = Number(acc.expectancy_brl || 0);
                const accMaxDd = Math.abs(Number(acc.max_dd_brl || 0));
                const accRTrades = Number(acc.r_trades || 0);
                const firstDate = fmtMt5EpochDate(acc.first_close_ts);
                const lastDate = fmtMt5EpochDate(acc.last_close_ts);
                const rangeText = firstDate && lastDate
                    ? (firstDate === lastDate ? firstDate : `${firstDate} → ${lastDate}`)
                    : "Histórico carregado";

                accMeta.textContent = `Magic ${acc.magic || "26002801"} · ${accTrades} fechado(s) · ${rangeText}`;

                const valCls = (v) => v > 0 ? "win" : v < 0 ? "loss" : "neutral";
                const pfText = pfInf ? "∞" : accPf.toFixed(2);
                const pfCls = pfInf ? "win" : accTrades === 0 ? "neutral" : accPf > 1 ? "win" : accPf < 1 ? "loss" : "neutral";
                const wrText = decisive > 0 ? fmtPctVal(accWr) : "—";
                const expMeta = accRTrades > 0
                    ? `${fmtRVal(acc.expectancy_r)} · ${accRTrades} c/ R`
                    : "média por trade fechado";
                const ddMeta = accRTrades > 0
                    ? `${fmtRVal(-Math.abs(acc.max_dd_r || 0))} pico-vale`
                    : "pico-vale fechado";
                const tradesMeta = accRTrades > 0
                    ? `${accTrades} fechados (${fmtRVal(acc.total_r)})`
                    : `${accTrades} fechados`;

                accKpis.innerHTML = `
                    <div class="kpi-card ${valCls(accNet)}">
                        <div class="label">Net P&amp;L líq.</div>
                        <div class="value">${esc(fmtMoney(accNet))}</div>
                        <div class="meta">taxas: ${esc(fmtMoney(accFees))}</div>
                    </div>
                    <div class="kpi-card neutral">
                        <div class="label">Winrate</div>
                        <div class="value">${esc(wrText)}</div>
                        <div class="meta">${esc(`${accWins}W / ${accLosses}L / ${accBes}BE`)}</div>
                    </div>
                    <div class="kpi-card ${pfCls}">
                        <div class="label">Profit Factor</div>
                        <div class="value">${esc(pfText)}</div>
                        <div class="meta">gross win / gross loss</div>
                    </div>
                    <div class="kpi-card ${valCls(accExpBrl)}">
                        <div class="label">Expectancy</div>
                        <div class="value">${esc(fmtMoney(accExpBrl))}</div>
                        <div class="meta">${esc(expMeta)}</div>
                    </div>
                    <div class="kpi-card ${accMaxDd > 0 ? "loss" : "neutral"}">
                        <div class="label">Max Drawdown</div>
                        <div class="value">${esc(fmtMoney(-accMaxDd))}</div>
                        <div class="meta">${esc(ddMeta)}</div>
                    </div>
                    <div class="kpi-card neutral">
                        <div class="label">Trades</div>
                        <div class="value">${esc(fmtNum(accTrades))}</div>
                        <div class="meta">${esc(tradesMeta)}</div>
                    </div>
                `;
            }
        }
    }

    async function refresh() {
        if (!cloudReady()) {
            rowData = null;
            lastError = null;
            render();
            return;
        }
        if (loading) return;
        const uid = currentUser.id;
        loading = true;
        render();
        try {
            const res = await supabaseClient
                .from(TABLE)
                .select("telemetry,telemetry_updated_at,control,control_updated_at,control_ack,updated_at")
                .eq("user_id", uid)
                .maybeSingle();
            if (currentUser?.id !== uid) return;
            if (res.error) throw res.error;
            rowData = res.data || null;
            lastError = null;
        } catch (err) {
            if (currentUser?.id !== uid) return;
            lastError = err;
        } finally {
            loading = false;
            render();
            scheduleNext();
        }
    }

    async function writeControl(nextControl) {
        if (!cloudReady()) {
            alert("Faça login na nuvem para enviar comandos ao robô.");
            return false;
        }
        if (commandBusy) return false;
        const uid = currentUser.id;
        const nowIso = new Date().toISOString();
        const ctrlPayload = { ...nextControl, updated_at: nowIso };
        commandBusy = true;
        render();
        try {
            let res;
            if (rowData) {
                res = await supabaseClient
                    .from(TABLE)
                    .update({
                        control: ctrlPayload,
                        control_updated_at: nowIso,
                        updated_at: nowIso
                    })
                    .eq("user_id", uid)
                    .select("telemetry,telemetry_updated_at,control,control_updated_at,control_ack,updated_at")
                    .single();
            } else {
                res = await supabaseClient
                    .from(TABLE)
                    .upsert({
                        user_id: uid,
                        control: ctrlPayload,
                        control_updated_at: nowIso,
                        updated_at: nowIso
                    }, { onConflict: "user_id" })
                    .select("telemetry,telemetry_updated_at,control,control_updated_at,control_ack,updated_at")
                    .single();
            }
            if (res.error) throw res.error;
            rowData = res.data;
            lastError = null;
            fastUntilMs = Date.now() + FAST_WINDOW_MS;
            if (typeof toast === "function") {
                toast(nextControl.flatten_seq > Number((rowData?.control_ack || {}).last_flatten_seq || 0)
                    ? "Comando ZERAR TUDO (FLATTEN) enviado ao MT5!"
                    : (nextControl.paused ? "Comando de PAUSA enviado ao MT5!" : "Comando para RETOMAR enviado ao MT5!"));
            }
            return true;
        } catch (err) {
            alert(`Não foi possível enviar o comando: ${err.message || err}`);
            return false;
        } finally {
            commandBusy = false;
            render();
            scheduleNext();
        }
    }

    async function togglePause() {
        const ctrl = (rowData && rowData.control) || { paused: false, flatten_seq: 0 };
        const ack = (rowData && rowData.control_ack) || { paused: false, last_flatten_seq: 0 };
        const eaPaused = Boolean(rowData?.telemetry?.v8?.emergency_paused);
        const currentPaused = rowData?.control_updated_at ? Boolean(ctrl.paused) : (rowData?.telemetry ? eaPaused : Boolean(ack.paused));
        const nextPaused = !currentPaused;
        await writeControl({
            paused: nextPaused,
            flatten_seq: Math.max(Number(ctrl.flatten_seq || 0), Number(ack.last_flatten_seq || 0)),
            reason: nextPaused ? "web_emergency_pause" : "web_resume"
        });
    }

    async function triggerFlatten() {
        const ok = window.confirm(
            "ATENÇÃO — ZERAGEM DE EMERGÊNCIA (FLATTEN):\n\n" +
            "Isso irá acionar o EA POI Determinístico V8 no MetaTrader 5 para:\n" +
            "1. Pausar novas entradas no EA\n" +
            "2. Cancelar todas as ordens pendentes no MT5\n" +
            "3. Fechar a mercado qualquer posição aberta do Magic 26002801\n\n" +
            "Deseja realmente zerar tudo agora?"
        );
        if (!ok) return;
        const ctrl = (rowData && rowData.control) || { paused: false, flatten_seq: 0 };
        const ack = (rowData && rowData.control_ack) || { paused: false, last_flatten_seq: 0 };
        const nextSeq = Math.max(Number(ctrl.flatten_seq || 0), Number(ack.last_flatten_seq || 0)) + 1;
        await writeControl({
            paused: true,
            flatten_seq: nextSeq,
            reason: "web_emergency_flatten"
        });
    }

    function syncViewState() {
        if (!initialized) return;
        render();
        if (isRobotActive() && cloudReady()) {
            refresh();
        } else {
            clearSchedule();
        }
    }

    function onAuthChanged(loggedIn) {
        if (!loggedIn) {
            rowData = null;
            lastError = null;
            clearSchedule();
            render();
            return;
        }
        syncViewState();
    }

    function init() {
        if (initialized) return;
        initialized = true;
        const pauseBtn = el("btnRobotLivePause");
        const flattenBtn = el("btnRobotLiveFlatten");
        const refreshBtn = el("btnRobotLiveRefresh");
        if (pauseBtn) pauseBtn.addEventListener("click", togglePause);
        if (flattenBtn) flattenBtn.addEventListener("click", triggerFlatten);
        if (refreshBtn) refreshBtn.addEventListener("click", refresh);
        if (typeof document !== "undefined") {
            document.addEventListener("visibilitychange", () => {
                if (!document.hidden && isRobotActive() && cloudReady()) {
                    refresh();
                } else if (document.hidden) {
                    clearSchedule();
                }
            });
        }
        render();
    }

    return {
        init,
        refresh,
        render,
        syncViewState,
        onAuthChanged,
        togglePause,
        triggerFlatten
    };
})();
