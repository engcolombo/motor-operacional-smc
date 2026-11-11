const fs = require("node:fs");
const vm = require("node:vm");
const assert = require("node:assert/strict");

const html = fs.readFileSync(__dirname + "/diario-pro-plus.html", "utf8");
const sql = fs.readFileSync(__dirname + "/supabase-robot-live.sql", "utf8");
const source = fs.readFileSync(__dirname + "/diario-robot-live.js", "utf8");

function boot(options = {}) {
    const nodes = new Map();
    const updates = [];
    const upserts = [];
    let currentRow = options.initialRow ?? null;
    let queryError = options.queryError ?? null;
    let confirmResult = options.confirmResult ?? true;

    const node = (id) => {
        if (!nodes.has(id)) {
            nodes.set(id, {
                id,
                value: "",
                innerHTML: "",
                textContent: "",
                className: "",
                hidden: false,
                disabled: false,
                classList: {
                    _set: new Set(),
                    toggle(cls, force) {
                        if (force) this._set.add(cls);
                        else this._set.delete(cls);
                    },
                    contains(cls) {
                        return this._set.has(cls);
                    }
                },
                addEventListener(type, fn) {
                    this["on" + type] = fn;
                }
            });
        }
        return nodes.get(id);
    };

    const ctx = {
        console,
        Date,
        Math,
        Number,
        String,
        Boolean,
        Object,
        Array,
        JSON,
        document: {
            hidden: false,
            getElementById: node,
            addEventListener() {}
        },
        window: {
            confirm: () => confirmResult,
            addEventListener() {}
        },
        alert: (m) => ctx.alerts.push(m),
        toast: (m) => ctx.toasts.push(m),
        escapeHtml: (s) => String(s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;"),
        fmtCurrency: (v) => `${v < 0 ? "-" : ""}R$ ${Math.abs(v).toFixed(2).replace(".", ",")}`,
        setTimeout: () => 1,
        clearTimeout() {},
        alerts: [],
        toasts: [],
        state: { view: options.view || "robot" },
        currentUser: options.loggedIn === false ? null : { id: "user-123" },
        canUseCloud: () => Boolean(ctx.currentUser),
        supabaseClient: {
            from(table) {
                assert.equal(table, "robot_live_status");
                return {
                    select() {
                        return {
                            eq() {
                                return {
                                    async maybeSingle() {
                                        if (queryError) return { data: null, error: queryError };
                                        return { data: currentRow, error: null };
                                    }
                                };
                            }
                        };
                    },
                    update(payload) {
                        updates.push(payload);
                        return {
                            eq() {
                                return {
                                    select() {
                                        return {
                                            async single() {
                                                currentRow = {
                                                    ...(currentRow || {}),
                                                    ...payload
                                                };
                                                return { data: currentRow, error: null };
                                            }
                                        };
                                    }
                                };
                            }
                        };
                    },
                    upsert(payload) {
                        upserts.push(payload);
                        return {
                            select() {
                                return {
                                    async single() {
                                        currentRow = payload;
                                        return { data: currentRow, error: null };
                                    }
                                };
                            }
                        };
                    }
                };
            }
        }
    };

    vm.createContext(ctx);
    vm.runInContext(source, ctx);
    ctx.window.RobotLiveMonitor.init();
    return {
        ctx,
        node,
        updates,
        upserts,
        setConfirm(v) { confirmResult = v; },
        setRow(r) { currentRow = r; },
        setError(e) { queryError = e; },
        monitor: ctx.window.RobotLiveMonitor
    };
}

(async () => {
    // 1. HTML & SQL structural guardrails
    const robotStart = html.indexOf('<section class="view" id="view-robot">');
    const robotLivePos = html.indexOf('id="robotLivePanel"', robotStart);
    const robotAccPos = html.indexOf('id="robotLiveAccKpis"', robotStart);
    const robotCfgPos = html.indexOf("<h2>Configuração do robô</h2>", robotStart);
    assert.ok(robotStart > 0 && robotLivePos > robotStart && robotAccPos > robotLivePos && robotLivePos < robotCfgPos && robotAccPos < robotCfgPos,
        "Monitor ao vivo e resumo acumulado devem aparecer dentro de #view-robot antes da Configuração do robô");
    assert.match(html, /diario-pro-plus\.css\?v=20261110-robot-live-v2/);
    assert.match(html, /diario-robot-live\.js\?v=20261110-robot-live-v2/);
    assert.ok(html.indexOf("diario-robot-live.js") < html.indexOf("diario-core.js"),
        "diario-robot-live.js precisa carregar antes de diario-core.js");

    assert.match(sql, /enable row level security/i);
    assert.match(sql, /force row level security/i);
    assert.match(sql, /revoke all on public\.robot_live_status from anon/i);
    assert.match(sql, /auth\.uid\(\)/i);

    // 2. Unauthenticated state disables emergency controls and shows no fake numbers
    const guest = boot({ loggedIn: false });
    assert.equal(guest.node("btnRobotLivePause").disabled, true);
    assert.equal(guest.node("btnRobotLiveFlatten").disabled, true);
    assert.equal(guest.node("robotLiveKpis").innerHTML, "");
    assert.equal(guest.node("robotLiveAccBlock").hidden, true);
    assert.equal(guest.node("robotLiveAccKpis").innerHTML, "");
    assert.equal(guest.node("robotLiveBadge").textContent, "Sem login");

    // 3. Missing table surfaces SQL hint cleanly
    const missingTbl = boot({ queryError: { code: "42P01", message: 'relation "robot_live_status" does not exist' } });
    await missingTbl.monitor.refresh();
    assert.equal(missingTbl.node("robotLiveBadge").textContent, "Erro de leitura");
    assert.match(missingTbl.node("robotLiveAlert").textContent, /supabase-robot-live\.sql/);

    // 4. Real telemetry rendering & XSS escaping
    const freshIso = new Date(Date.now() - 5000).toISOString();
    const live = boot({
        initialRow: {
            telemetry_updated_at: freshIso,
            telemetry: {
                generated_at_utc: freshIso,
                session_date: "2026-11-10",
                symbol: "WINZ26<img src=x>",
                python: {
                    online: true,
                    warmup_ready: true,
                    emergency_paused: false,
                    operating_state: "OPERACIONAL · MONITORANDO",
                    context_status: "AUTORIZADO: Liq M5 LOW @ 170100 (BUY)",
                    setup_detail: "ARMADO: POI BUY <img src=x>",
                    trend_m5: "ALTA",
                    trend_h1: "BAIXA",
                    pois_active: 2,
                    armed_candidates_count: 1,
                    total_ticks: 900,
                    last_evaluation: { setup: "poi", side: "buy", p_gru: 0.4123, threshold: 0.52, approved: false }
                },
                mt5: {
                    connected: true,
                    mode: "DEMO",
                    has_position: false,
                    has_pending: false,
                    daily_closed_pl: -96.0,
                    floating_pl: 0.0,
                    daily_total_pl: -96.0,
                    daily_trades_count: 1,
                    daily_consec_losses: 1,
                    risk_status: "SISTEMA OPERACIONAL (OK)",
                    balance: 9904.0,
                    equity: 9904.0,
                    accumulated: {
                        magic: 26002601,
                        trades: 20,
                        wins: 8,
                        losses: 12,
                        bes: 0,
                        net_pl: 479.0,
                        fees: 200.0,
                        winrate: 40.0,
                        profit_factor: 1.45,
                        profit_factor_infinite: false,
                        expectancy_brl: 23.95,
                        max_dd_brl: 310.0,
                        r_trades: 20,
                        total_r: 0.61,
                        expectancy_r: 0.03,
                        max_dd_r: 5.33,
                        first_close_ts: 1794000000,
                        last_close_ts: 1794300000
                    }
                },
                daily_stats: {
                    total_evaluations: 5,
                    total_signals_dispatched: 1,
                    total_trades_filled: 1,
                    rejections: {
                        gru: { total: 4, reasons: { gru_below_threshold: 4 } },
                        risco: { total: 2, reasons: { veto_daily_loss: 1, stop_out_of_bounds: 1 } },
                        deterministico: { total: 3, reasons: { timeout: 2, choch_rejected_missing_prior_m1_bos: 1 } }
                    },
                    recent_events: [
                        { time_brt: "14:20:01", kind: "rejection", category: "gru", reason: "gru_below_threshold", detail: "GRU_V2_POI: 0.4123 < 0.52" }
                    ]
                }
            },
            control: { paused: false, flatten_seq: 2 },
            control_ack: { paused: false, last_flatten_seq: 2 }
        }
    });
    await live.monitor.refresh();
    assert.equal(live.node("robotLiveBadge").textContent, "Ao vivo");
    assert.doesNotMatch(live.node("robotLiveStateRows").innerHTML, /<img/);
    assert.match(live.node("robotLiveStateRows").innerHTML, /&lt;img src=x&gt;/);
    assert.match(live.node("robotLiveKpis").innerHTML, /-R\$ 96,00/);
    assert.match(live.node("robotLiveKpis").innerHTML, />9</); // 4 + 2 + 3 rejections
    assert.match(live.node("robotLiveRejections").innerHTML, /Score GRU abaixo do threshold/);
    assert.match(live.node("robotLiveRejections").innerHTML, /EA: limite de perda diária atingido/);
    assert.match(live.node("robotLiveRejections").innerHTML, /CHoCH M1 sem BOS interno prévio/);
    assert.equal(live.node("robotLiveAccBlock").hidden, false);
    assert.match(live.node("robotLiveAccMeta").textContent, /Magic 26002601/);
    assert.match(live.node("robotLiveAccKpis").innerHTML, /R\$ 479,00/);
    assert.match(live.node("robotLiveAccKpis").innerHTML, /taxas: R\$ 200,00/);
    assert.match(live.node("robotLiveAccKpis").innerHTML, /40\.0%/);
    assert.match(live.node("robotLiveAccKpis").innerHTML, /8W \/ 12L \/ 0BE/);
    assert.match(live.node("robotLiveAccKpis").innerHTML, /1\.45/);
    assert.match(live.node("robotLiveAccKpis").innerHTML, /-5\.33R/);
    assert.match(live.node("robotLiveAccKpis").innerHTML, /\+0\.61R/);

    // 4b. Infinite profit factor renders ∞ when gross_loss == 0 and gross_win > 0
    live.setRow({
        telemetry_updated_at: freshIso,
        telemetry: {
            generated_at_utc: freshIso,
            symbol: "WINZ26",
            python: { online: true, emergency_paused: false, warmup_ready: true },
            mt5: {
                connected: true,
                accumulated: {
                    magic: 26002601,
                    trades: 2,
                    wins: 2,
                    losses: 0,
                    bes: 0,
                    net_pl: 150.0,
                    fees: 4.0,
                    winrate: 100.0,
                    profit_factor: null,
                    profit_factor_infinite: true,
                    expectancy_brl: 75.0,
                    max_dd_brl: 0.0,
                    r_trades: 0
                }
            },
            daily_stats: { rejections: { gru: { total: 0 }, risco: { total: 0 }, deterministico: { total: 0 } } }
        },
        control: { paused: false, flatten_seq: 2 },
        control_ack: { paused: false, last_flatten_seq: 2 }
    });
    await live.monitor.refresh();
    assert.match(live.node("robotLiveAccKpis").innerHTML, />∞</);
    assert.match(live.node("robotLiveAccKpis").innerHTML, /100\.0%/);

    // 5. Partial update on Pause preserves existing telemetry column and toggles button
    await live.monitor.togglePause();
    assert.equal(live.updates.length, 1);
    assert.equal(live.updates[0].control.paused, true);
    assert.equal(live.updates[0].control.flatten_seq, 2);
    assert.equal(Object.hasOwn(live.updates[0], "telemetry"), false, "Comando web nunca sobrescreve telemetria do Python");
    assert.equal(live.node("btnRobotLivePause").textContent, "Retomar entradas");

    // 6. Flatten cancels when confirmation rejected, and increments flatten_seq when confirmed
    live.setConfirm(false);
    await live.monitor.triggerFlatten();
    assert.equal(live.updates.length, 1);
    live.setConfirm(true);
    await live.monitor.triggerFlatten();
    assert.equal(live.updates.length, 2);
    assert.equal(live.updates[1].control.flatten_seq, 3);
    assert.equal(live.updates[1].control.paused, true);

    // 7. Stale telemetry (> 50s) triggers warning state
    const staleIso = new Date(Date.now() - 120000).toISOString();
    live.setRow({
        telemetry_updated_at: staleIso,
        telemetry: {
            generated_at_utc: staleIso,
            symbol: "WINZ26",
            python: { emergency_paused: false },
            mt5: { connected: true },
            daily_stats: { rejections: { gru: { total: 0 }, risco: { total: 0 }, deterministico: { total: 0 } } }
        },
        control: { paused: false, flatten_seq: 3 },
        control_ack: { paused: false, last_flatten_seq: 3 }
    });
    await live.monitor.refresh();
    assert.equal(live.node("robotLiveBadge").textContent, "Desatualizado / Offline");

    console.log("PASS: robot live HTML placement, SQL RLS, guest/missing-table/stale states, real telemetry, XSS escape, pause & confirmed flatten controls.");
})().catch((err) => {
    console.error(err);
    process.exitCode = 1;
});
