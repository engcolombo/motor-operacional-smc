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
    const robotEquityPos = html.indexOf('id="robotEquityCanvas"', robotStart);
    const robotTradesPos = html.indexOf('id="robotTradesBox"', robotStart);
    const robotCfgPos = html.indexOf('id="fRobotFile"', robotStart);
    assert.ok(
        robotStart > 0 &&
        robotLivePos > robotStart &&
        robotAccPos > robotLivePos &&
        robotEquityPos > robotAccPos &&
        robotTradesPos > robotEquityPos &&
        robotCfgPos > robotTradesPos,
        "Monitor ao vivo, estatísticas/curva e últimos trades devem aparecer antes da Importação manual no final de #view-robot"
    );
    assert.match(html, /diario-pro-plus\.css\?v=20261124-poi-v8/);
    assert.match(html, /diario-robot-live\.js\?v=20261124-poi-v8/);
    assert.match(html, /diario-core\.js\?v=20261124-poi-v8/);
    assert.match(html, /26002801/);
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

    // 4. Real POI V8 telemetry rendering & XSS escaping
    const freshIso = new Date(Date.now() - 5000).toISOString();
    const live = boot({
        initialRow: {
            telemetry_updated_at: freshIso,
            telemetry: {
                engine: "poi_deterministico_v8",
                robot_name: "SMC POI Deterministico V8",
                generated_at_utc: freshIso,
                session_date: "2026-11-24",
                symbol: "WINZ26<img src=x>",
                magic: 26002801,
                v8: {
                    setup_name: "V8_BC75_NL_AV2",
                    lunch_blocked: true,
                    lunch_window: "12:00-15:00",
                    target_rr: 4.0,
                    barrier_opp: true,
                    barrier_opp_r: 2.0,
                    avwap_dir_rule: false,
                    avwap_tf: "M5",
                    avwap_days: 5,
                    order_mode: "Limite 1:1",
                    risk_per_trade_brl: 100.0,
                    max_contracts: 5,
                    warmup_ready: true,
                    emergency_paused: false,
                    operating_state: "OPERACIONAL · MONITORANDO",
                    ctx_buy: { a: true, a_min: 12, b: false, b_min: -1, c: false, d: true, d_min: 4 },
                    ctx_sell: { a: false, a_min: -1, b: true, b_min: 20, c: false, d: false, d_min: -1 },
                    avwap: { tf: "M5", buy_count: 1, nearest_buy: 166100, sell_count: 2, nearest_sell: 166900, rule_dir: "COMPRA", atr42: 145 },
                    engine_counts: { session_idx: 12, blocks: 18, levels: 9, captures: 3, pois_today: 7 },
                    armed_zones_count: 1,
                    armed_detail: "COMPRA 50%:166250 SL:166020 <img src=x>",
                    last_gate_log: "REPROVADO: BARREIRA AVWAP",
                    last_signal_info: "COMPRA 166250 SL:166020 TP:167170 1c"
                },
                mt5: {
                    connected: true,
                    mode: "DEMO",
                    magic: 26002801,
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
                        magic: 26002801,
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
                    pois_formed_today: 7,
                    signals_executed: 1,
                    rejections: {
                        gate_v8: { total: 3, reasons: { v8_avwap_barrier: 2, v8_lunch_block: 1 } },
                        risco: { total: 2, reasons: { veto_daily_loss: 1, blocked_by_emergency_pause: 1 } }
                    },
                    recent_events: [
                        { time_brt: "14:20:01", kind: "rejection", category: "gate_v8", reason: "v8_avwap_barrier", detail: "REPROVADO: BARREIRA AVWAP" }
                    ]
                }
            },
            control: { paused: false, flatten_seq: 2 },
            control_ack: { paused: false, last_flatten_seq: 2 }
        }
    });
    await live.monitor.refresh();
    assert.equal(live.node("robotLiveBadge").textContent, "Ao vivo · MT5");
    assert.doesNotMatch(live.node("robotLiveStateRows").innerHTML, /<img/);
    assert.match(live.node("robotLiveStateRows").innerHTML, /&lt;img src=x&gt;/);
    assert.match(live.node("robotLiveStateRows").innerHTML, /A:12m · B:- · C:- · D:4m/);
    assert.match(live.node("robotLiveKpis").innerHTML, /-R\$ 96,00/);
    assert.match(live.node("robotLiveKpis").innerHTML, /4\.0R/);
    assert.match(live.node("robotLiveRejections").innerHTML, /Gate V8: barreira AVWAP oposta no caminho/);
    assert.match(live.node("robotLiveRejections").innerHTML, /EA: limite de perda diária atingido/);
    assert.doesNotMatch(live.node("robotLiveRejections").innerHTML, /Modelo GRU/);
    assert.equal(live.node("robotLiveAccBlock").hidden, false);
    assert.match(live.node("robotLiveAccMeta").textContent, /Magic 26002801/);
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
            engine: "poi_deterministico_v8",
            generated_at_utc: freshIso,
            symbol: "WINZ26",
            magic: 26002801,
            v8: { emergency_paused: false, warmup_ready: true },
            mt5: {
                connected: true,
                accumulated: {
                    magic: 26002801,
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
            daily_stats: { rejections: { gate_v8: { total: 0 }, risco: { total: 0 } } }
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
    assert.equal(Object.hasOwn(live.updates[0], "telemetry"), false, "Comando web nunca sobrescreve telemetria do MT5");
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
            engine: "poi_deterministico_v8",
            generated_at_utc: staleIso,
            symbol: "WINZ26",
            v8: { emergency_paused: false },
            mt5: { connected: true },
            daily_stats: { rejections: { gate_v8: { total: 0 }, risco: { total: 0 } } }
        },
        control: { paused: false, flatten_seq: 3 },
        control_ack: { paused: false, last_flatten_seq: 3 }
    });
    await live.monitor.refresh();
    assert.equal(live.node("robotLiveBadge").textContent, "Desatualizado / Offline");

    console.log("PASS: POI Determinístico V8 robot live HTML placement, SQL RLS, guest/missing-table/stale states, real V8 telemetry, XSS escape, pause & confirmed flatten controls.");
})().catch((err) => {
    console.error(err);
    process.exitCode = 1;
});
