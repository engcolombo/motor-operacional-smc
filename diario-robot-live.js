/* Monitor ao vivo e controle de emergência do Robô SMC (Python + MetaTrader 5 via Supabase). */
window.RobotLiveMonitor = (() => {
    const TABLE = "robot_live_status";
    const NORMAL_POLL_MS = 10000;
    const FAST_POLL_MS = 2500;
    const FAST_WINDOW_MS = 25000;
    const STALE_AFTER_SECONDS = 50;

    const REASON_LABELS = {
        gru_below_threshold: "Score GRU abaixo do threshold",
        blocked_by_active_position: "Posição/pendente já ativa no MT5",
        blocked_by_emergency_pause: "Pausa de emergência ativa",
        another_position_submitted: "Outro sinal simultâneo já despachado",
        emergency_pause: "Cancelado por pausa de emergência",
        emergency_flatten: "Cancelado por zeragem de emergência",
        stop_out_of_bounds: "Stop normalizado fora dos limites",
        budget_exceeded_or_invalid_size: "1 contrato excede o orçamento de risco",
        rejected: "Ordem rejeitada pelo EA/corretora",
        veto_duplicate: "EA: candidato duplicado",
        veto_time: "EA: fora do horário de entrada",
        veto_daily_loss: "EA: limite de perda diária atingido",
        veto_max_dd: "EA: drawdown máximo atingido",
        veto_max_trades: "EA: limite diário de trades",
        veto_consec_losses: "EA: limite de perdas seguidas",
        veto_active_exposure: "EA: exposição ativa",
        veto_demo_mode_on_real_account: "EA: trava DEMO em conta REAL",
        veto_spread: "EA: spread acima do máximo",
        veto_stop_distance: "EA: distância de stop fora dos limites",
        veto_zero_lots: "EA: lote calculado zero",
        veto_expired: "EA: sinal expirou por latência",
        candidate_rejected_missing_wick_stop: "Sem pavio de formação para Stop",
        candidate_context_rejected: "Sem captura M5 ou OB pós-captura",
        poi_retest_not_armed: "POI sem re-teste / OB nativo ambíguo",
        poi_rejected_invalid_risk: "Risco do POI inválido",
        poi_rejected_stop_too_short: "Stop do POI abaixo do mínimo",
        choch_rejected_missing_prior_m1_bos: "CHoCH M1 sem BOS interno prévio",
        choch_rejected_missing_prior_m5_bos: "CHoCH M5 sem BOS interno prévio",
        choch_rejected_formation_too_long: "Formação do CHoCH excedeu tempo máx.",
        choch_missing_native_ob_link: "CHoCH sem Order Block nativo vinculado",
        timeout: "Candidato expirou antes do toque",
        entry_cutoff: "Horário limite de entradas atingido",
        past_last_entry: "Fora do horário de entradas",
        session_flatten: "Encerramento automático de sessão",
        stop_or_zone_invalidated: "Preço violou stop/zona antes da entrada",
        original_poi_target_reached: "Alvo original do POI já atingido",
        poi_no_longer_active: "POI mitigado/inativo",
        native_ob_no_longer_active: "OB nativo mitigado/inativo",
        choch_stretched_2r_before_return: "Preço esticou 2R antes do pullback",
        too_far_from_ob: "Preço afastou além do limite do OB",
        entry_response_too_late: "Delay após gatilho excedido",
        expired_in_wall_clock: "Candidato expirou no relógio",
        context_no_longer_valid: "Contexto de liquidez/OB invalidado",
        ai_context_warmup_m5_m10_unavailable: "Frames M5/M10 indisponíveis",
        price_moved_after_trigger: "Desvio de preço após gatilho excedido",
        opposing_approved_candidates: "Candidatos opostos simultâneos",
        features_warming_up: "Indicadores em aquecimento",
        evaluation_error: "Erro na avaliação do candidato"
    };

    const CATEGORY_LABEL = {
        gru: "GRU",
        risco: "Risco",
        deterministico: "Determinístico"
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
        if (!bucket) return `<div class="muted robot-live-empty">Aguardando dados do Python.</div>`;
        const reasons = bucket.reasons || {};
        const entries = Object.entries(reasons).sort((a, b) => Number(b[1]) - Number(a[1]));
        if (!entries.length) return `<div class="muted robot-live-empty">Nenhuma rejeição hoje.</div>`;
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
            .slice(0, 15)
            .map((ev) => {
                const time = esc(ev.time_brt || "—");
                const isRej = ev.kind === "rejection";
                const tagText = isRej
                    ? `REJ · ${CATEGORY_LABEL[ev.category] || ev.category || "Regra"}`
                    : String(ev.kind || "EVENTO").toUpperCase();
                const tagCls = isRej
                    ? "is-rej"
                    : (ev.kind === "filled" || ev.kind === "signal_dispatched" || ev.kind === "emergency_resume")
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
                alertBox.textContent = "Conecte sua conta na barra lateral (Conta e sincronização) para acompanhar o robô em tempo real e acionar comandos.";
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
        const hasTel = Boolean(tel && Object.keys(tel).length > 0);
        const ctrl = (rowData && rowData.control) || { paused: false, flatten_seq: 0 };
        const ack = (rowData && rowData.control_ack) || { paused: false, last_flatten_seq: 0 };
        const py = (tel && tel.python) || {};
        const mt5 = (tel && tel.mt5) || {};
        const stats = (tel && tel.daily_stats) || {};
        const rej = stats.rejections || {};
        const age = ageFromIso(rowData?.telemetry_updated_at || tel?.generated_at_utc);
        const stale = !hasTel || !age || age.stale;

        const ctrlPaused = Boolean(ctrl.paused);
        const ackPaused = Boolean(ack.paused);
        const pyPaused = hasTel ? Boolean(py.emergency_paused) : ackPaused;
        const effectivePaused = rowData?.control_updated_at ? ctrlPaused : pyPaused;
        const pausePending = Boolean(rowData?.control_updated_at) && ctrlPaused !== ackPaused;
        const flattenPending = Number(ctrl.flatten_seq || 0) > Number(ack.last_flatten_seq || 0);

        if (pauseBtn) {
            pauseBtn.disabled = commandBusy;
            pauseBtn.textContent = effectivePaused ? "Retomar entradas" : "Pausar entradas";
            pauseBtn.classList.toggle("btn-primary", effectivePaused);
        }
        if (flattenBtn) flattenBtn.disabled = commandBusy;

        if (!hasTel) {
            if (badge) { badge.className = "robot-live-badge is-warn"; badge.textContent = "Aguardando Python"; }
            if (updatedEl) updatedEl.textContent = "Nenhuma telemetria enviada ainda.";
            if (alertBox) {
                alertBox.hidden = false;
                alertBox.className = "robot-live-alert is-warn";
                alertBox.textContent = "Conexão com Supabase pronta. Ligue o robô com configs/supabase.local.json configurado para iniciar os envios.";
            }
        } else if (flattenPending || pausePending) {
            if (badge) { badge.className = "robot-live-badge is-warn"; badge.textContent = "Comando enviado"; }
            if (updatedEl) updatedEl.textContent = `Aguardando confirmação do Python (${age ? age.text : "—"})`;
            if (alertBox) {
                alertBox.hidden = false;
                alertBox.className = "robot-live-alert is-warn";
                alertBox.textContent = flattenPending
                    ? "Comando ZERAR TUDO (FLATTEN) enviado na fila. Aguardando execução no Python e no MetaTrader 5..."
                    : (ctrlPaused ? "Comando PAUSAR ENTRADAS enviado. Aguardando confirmação do Python..." : "Comando RETOMAR ENTRADAS enviado. Aguardando confirmação do Python...");
            }
        } else if (stale) {
            if (badge) { badge.className = "robot-live-badge is-danger"; badge.textContent = "Desatualizado / Offline"; }
            if (updatedEl) updatedEl.textContent = `Última atualização ${age ? age.text : "desconhecida"} · Sessão ${tel.session_date || "—"}`;
            if (alertBox) {
                alertBox.hidden = false;
                alertBox.className = "robot-live-alert is-danger";
                alertBox.textContent = `Sem telemetria recente do Python (${age ? age.text : "—"}). O robô pode estar desligado, fora do pregão ou sem internet.`;
            }
        } else if (pyPaused) {
            if (badge) { badge.className = "robot-live-badge is-warn"; badge.textContent = "Pausado"; }
            if (updatedEl) updatedEl.textContent = `${tel.symbol || "—"} · Atualizado ${age.text}`;
            if (alertBox) {
                alertBox.hidden = false;
                alertBox.className = "robot-live-alert is-warn";
                alertBox.textContent = "PAUSA DE EMERGÊNCIA ATIVA: Python monitora o mercado normalmente, porém bloqueia novas entradas até você clicar em Retomar entradas.";
            }
        } else if (!mt5.connected) {
            if (badge) { badge.className = "robot-live-badge is-warn"; badge.textContent = "Python ON · MT5 OFF"; }
            if (updatedEl) updatedEl.textContent = `${tel.symbol || "—"} · Atualizado ${age.text}`;
            if (alertBox) {
                alertBox.hidden = false;
                alertBox.className = "robot-live-alert is-warn";
                alertBox.textContent = "Python está online, mas o MetaTrader 5 EA não está enviando ticks/heartbeat no momento.";
            }
        } else {
            if (badge) { badge.className = "robot-live-badge is-ok"; badge.textContent = "Ao vivo"; }
            if (updatedEl) updatedEl.textContent = `${tel.symbol || "—"} · Sessão ${tel.session_date || "—"} · Atualizado ${age.text}`;
            if (alertBox) alertBox.hidden = true;
        }

        const totalRej = hasTel
            ? Number(rej.gru?.total || 0) + Number(rej.risco?.total || 0) + Number(rej.deterministico?.total || 0)
            : null;
        const dayPl = mt5.daily_total_pl !== null && mt5.daily_total_pl !== undefined
            ? Number(mt5.daily_total_pl)
            : (mt5.daily_closed_pl !== null && mt5.daily_closed_pl !== undefined ? Number(mt5.daily_closed_pl) : null);
        const plCls = dayPl === null ? "neutral" : dayPl > 0 ? "win" : dayPl < 0 ? "loss" : "neutral";
        const tradesCount = mt5.daily_trades_count !== null && mt5.daily_trades_count !== undefined
            ? mt5.daily_trades_count
            : (hasTel ? stats.total_trades_filled : null);

        if (kpisBox) {
            kpisBox.innerHTML = hasTel ? `
                <div class="kpi-card ${pyPaused ? "loss" : "neutral"}">
                    <div class="label">Estado Python + MT5</div>
                    <div class="value robot-live-kpi-text">${esc(py.operating_state || "—")}</div>
                    <div class="meta">EA: ${mt5.connected ? "CONECTADO" : "DESCONECTADO"}${mt5.mode ? ` · ${esc(mt5.mode)}` : ""} · Warm-up: ${py.warmup_ready ? "OK" : "CARREGANDO"}</div>
                </div>
                <div class="kpi-card ${plCls}">
                    <div class="label">Resultado do Dia (MT5)</div>
                    <div class="value">${esc(fmtMoney(dayPl))}</div>
                    <div class="meta">Fechado: ${esc(fmtMoney(mt5.daily_closed_pl))} · Flut.: ${esc(fmtMoney(mt5.floating_pl))}</div>
                </div>
                <div class="kpi-card neutral">
                    <div class="label">Operações Hoje</div>
                    <div class="value">${esc(fmtNum(tradesCount))}</div>
                    <div class="meta">Sinais: ${esc(fmtNum(stats.total_signals_dispatched))} · Avaliações GRU: ${esc(fmtNum(stats.total_evaluations))}${mt5.daily_consec_losses !== null && mt5.daily_consec_losses !== undefined ? ` · Losses seg.: ${esc(mt5.daily_consec_losses)}` : ""}</div>
                </div>
                <div class="kpi-card ${totalRej ? "loss" : "neutral"}">
                    <div class="label">Operações Rejeitadas</div>
                    <div class="value">${esc(fmtNum(totalRej))}</div>
                    <div class="meta">GRU: ${esc(fmtNum(rej.gru?.total || 0))} · Risco: ${esc(fmtNum(rej.risco?.total || 0))} · Determ.: ${esc(fmtNum(rej.deterministico?.total || 0))}</div>
                </div>
            ` : "";
        }

        const posDesc = !hasTel
            ? "—"
            : mt5.has_position
                ? `${mt5.pos_side || ""} ${Number(mt5.pos_vol || 0).toFixed(0)}ct @ ${Number(mt5.pos_price || 0).toFixed(0)}${mt5.pos_ticket ? ` (#${mt5.pos_ticket})` : ""}`
                : (mt5.has_pending ? "Ordem limite pendente no book" : "Sem posição aberta (FLAT)");
        const lastEval = py.last_evaluation;
        const evalDesc = lastEval
            ? `${String(lastEval.setup || "-").toUpperCase()} ${String(lastEval.side || "-").toUpperCase()} · ${Number(lastEval.p_gru || 0).toFixed(4)} / ${Number(lastEval.threshold || 0).toFixed(2)} · ${lastEval.approved ? "APROVADA" : "REJEITADA"}${lastEval.inference_ms !== undefined ? ` (${Number(lastEval.inference_ms).toFixed(1)}ms)` : ""}`
            : "Nenhuma avaliação GRU registrada hoje";
        const drift = py.feature_drift;
        const driftDesc = drift && typeof drift === "object"
            ? (drift.alert
                ? `ALERTA DRIFT: ${Number(drift.outliers_5sigma || 0)} feat >= 5σ (máx ${esc(drift.top_feature || "?")} ${Number(drift.max_abs_z || 0).toFixed(1)}σ)`
                : `Estável (máx |z|=${Number(drift.max_abs_z || 0).toFixed(1)}σ em ${esc(drift.top_feature || "-")})`)
            : null;

        if (stateRowsBox) {
            stateRowsBox.innerHTML = hasTel ? `
                <div class="metric-row"><span>Ação atual (Python)</span><strong>${esc(py.setup_detail || "—")}</strong></div>
                <div class="metric-row"><span>Contexto SMC</span><strong>${esc(py.context_status || "—")}</strong></div>
                <div class="metric-row"><span>Tendência M5 / H1</span><strong>${esc(py.trend_m5 || "—")} / ${esc(py.trend_h1 || "—")} · POIs M1: ${esc(fmtNum(py.pois_active))} · Armados: ${esc(fmtNum(py.armed_candidates_count))}</strong></div>
                <div class="metric-row"><span>Posição no MT5</span><strong>${esc(posDesc)}</strong></div>
                <div class="metric-row"><span>Última avaliação GRU</span><strong>${esc(evalDesc)}</strong></div>
                ${driftDesc ? `<div class="metric-row"><span>Distribuição Features (WIN$)</span><strong style="${drift.alert ? "color:var(--amber, #f59e0b)" : ""}">${driftDesc}</strong></div>` : ""}
                <div class="metric-row"><span>Status de risco (EA)</span><strong>${esc(mt5.risk_status || "Aguardando atualização do EA")}</strong></div>
                <div class="metric-row"><span>Saldo / Equity · Ticks</span><strong>${esc(fmtMoney(mt5.balance))} / ${esc(fmtMoney(mt5.equity))} · ${esc(fmtNum(py.total_ticks))} ticks</strong></div>
            ` : `<div class="muted robot-live-empty">Sem leitura ao vivo disponível.</div>`;
        }

        if (rejectionsBox) {
            rejectionsBox.innerHTML = hasTel ? `
                <div class="robot-live-rej-col">
                    <div class="robot-live-rej-head"><span>Modelo GRU</span><strong>${esc(fmtNum(rej.gru?.total || 0))}</strong></div>
                    ${renderReasonsList(rej.gru)}
                </div>
                <div class="robot-live-rej-col">
                    <div class="robot-live-rej-head"><span>Sistema de Risco</span><strong>${esc(fmtNum(rej.risco?.total || 0))}</strong></div>
                    ${renderReasonsList(rej.risco)}
                </div>
                <div class="robot-live-rej-col">
                    <div class="robot-live-rej-head"><span>Determinístico (SMC)</span><strong>${esc(fmtNum(rej.deterministico?.total || 0))}</strong></div>
                    ${renderReasonsList(rej.deterministico)}
                </div>
            ` : "";
        }

        if (eventsBox) eventsBox.innerHTML = hasTel ? renderEventsList(stats.recent_events) : "";

        const acc = hasTel && mt5.accumulated && typeof mt5.accumulated === "object" ? mt5.accumulated : null;
        if (hasTel && typeof window.syncRobotTradesFromLive === "function") {
            try {
                window.syncRobotTradesFromLive(py.recent_closed_trades, acc ? acc.trades : null);
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

                accMeta.textContent = `Magic ${acc.magic || "—"} · ${accTrades} fechado(s) · ${rangeText}`;

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
                    ? "Comando ZERAR TUDO (FLATTEN) enviado!"
                    : (nextControl.paused ? "Comando de PAUSA enviado!" : "Comando para RETOMAR enviado!"));
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
        const pyPaused = Boolean(rowData?.telemetry?.python?.emergency_paused);
        const currentPaused = rowData?.control_updated_at ? Boolean(ctrl.paused) : (rowData?.telemetry ? pyPaused : Boolean(ack.paused));
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
            "Isso irá:\n" +
            "1. Pausar novas entradas no Python\n" +
            "2. Cancelar todas as ordens pendentes no MetaTrader 5\n" +
            "3. Fechar a mercado qualquer posição aberta do robô\n\n" +
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
