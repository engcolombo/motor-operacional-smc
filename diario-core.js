const SUPABASE_URL = "https://cqjmxywdhlxlsltkrrxm.supabase.co";
const SUPABASE_KEY = "sb_publishable_FdXdp5ogCGD65omUzmLjyw_kd3mGOqB";
const SUPABASE_TABLE = "trades_pro";
const ATTACHMENTS_BUCKET = "trade-attachments";
const MAX_ATTACHMENT_BYTES = 20 * 1024 * 1024;
const ALLOWED_ATTACHMENT_TYPES = new Set(["image/jpeg", "image/png", "image/webp"]);
const STORAGE_KEY = "diarioProTrades_v1";
const PENDING_DELETE_STORAGE_KEY = "diarioProPendingCloudDeletes_v1";
const DATE_REPAIR_DAY = "2026-10-08";
const DATE_REPAIR_CUTOFF = "2026-10-08T16:10:32.000Z";

let supabaseClient = null;
let currentUser = null;
let currentSession = null;
let cloudBusy = false;

const state = {
    trades: loadTrades(),
    pendingCloudDeletes: loadPendingCloudDeletes(),
    view: "dashboard",
    assetFilter: "all",
    editingId: null,
    calMonth: new Date(new Date().getFullYear(), new Date().getMonth(), 1),
    chartMonth: localDateTimeValue().slice(0, 7),
    chartDay: null,
    fees: { cripto: 0, win: 0, wdo: 0 },
    robot: { magic: 20250321, symbol: "" },
    editAttachment: null
};

const ROBOT_DEFAULTS = { magic: 20250321, symbol: "" };
const ROBOT_STORAGE_KEY = "diarioProRobot_v1";
const ROBOT_SOURCE = "robo_smc";

function loadRobotConfig() {
    try { return { ...ROBOT_DEFAULTS, ...JSON.parse(localStorage.getItem(ROBOT_STORAGE_KEY) || "{}") }; }
    catch (e) { return { ...ROBOT_DEFAULTS }; }
}

function persistRobotConfig() {
    localStorage.setItem(ROBOT_STORAGE_KEY, JSON.stringify(state.robot));
}

function isRobotTrade(t) { return t?.source === ROBOT_SOURCE; }
function manualTrades() { return state.trades.filter((t) => !isRobotTrade(t)); }
function robotTrades() { return state.trades.filter(isRobotTrade); }

const ASSET_FILTERS = { all: "Todos", win: "WIN", cripto: "Cripto", wdo: "WDO", forex: "Forex" };
const ASSET_FILTER_VIEWS = new Set(["dashboard", "trades", "calendar", "stats", "journal"]);
const FOREX_CURRENCIES = new Set(["USD", "EUR", "GBP", "JPY", "CHF", "AUD", "NZD", "CAD", "BRL", "MXN", "ZAR", "TRY", "CNH", "CNY", "HKD", "SGD", "NOK", "SEK", "DKK", "PLN", "HUF", "CZK", "XAU", "XAG"]);

function tradeAssetCategory(trade) {
    const symbol = String(trade?.symbol || "").trim().toUpperCase();
    if (symbol.startsWith("WIN")) return "win";
    if (symbol.startsWith("WDO")) return "wdo";
    // Check currency pairs before crypto prefixes (USDCAD starts with USDC).
    const pair = symbol.match(/^([A-Z]{3})[\s/_-]?([A-Z]{3})(?:[._-]?[A-Z0-9]+)?$/);
    if (pair && pair[1] !== pair[2] && FOREX_CURRENCIES.has(pair[1]) && FOREX_CURRENCIES.has(pair[2])) return "forex";
    if (classifySymbol(symbol) === "cripto" || /^[A-Z0-9]+[/_-]?(?:USDT|USDC|BUSD)(?:[.:_-][A-Z0-9]+)?$/.test(symbol)) return "cripto";
    return null;
}

function filteredManualTrades() {
    const trades = manualTrades();
    return state.assetFilter === "all" ? trades : trades.filter((trade) => tradeAssetCategory(trade) === state.assetFilter);
}

function setAssetFilter(category) {
    if (!Object.hasOwn(ASSET_FILTERS, category)) return;
    state.assetFilter = category;
    hideTradeChartTooltip();
    renderAll();
}

function renderAssetFilters() {
    const toolbar = $("assetFilters");
    if (!toolbar) return;
    toolbar.hidden = !ASSET_FILTER_VIEWS.has(state.view);
    toolbar.querySelectorAll("[data-asset-filter]").forEach((button) => {
        const active = button.dataset.assetFilter === state.assetFilter;
        button.classList.toggle("active", active);
        button.setAttribute("aria-pressed", String(active));
    });
    if (state.view === "trades") $("viewSubtitle").textContent = `${filteredManualTrades().length} operações registradas · ${ASSET_FILTERS[state.assetFilter]}`;
}

function bindAssetFilters() {
    $("assetFilters")?.querySelectorAll("[data-asset-filter]").forEach((button) => {
        button.addEventListener("click", () => setAssetFilter(button.dataset.assetFilter));
    });
}

const $ = (id) => document.getElementById(id);

function loadTrades() {
    try {
        return JSON.parse(localStorage.getItem(STORAGE_KEY) || "[]");
    } catch (e) {
        return [];
    }
}

function saveTrades() {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(state.trades));
}

function loadPendingCloudDeletes() {
    try {
        const ids = JSON.parse(localStorage.getItem(PENDING_DELETE_STORAGE_KEY) || "[]");
        return Array.isArray(ids) ? [...new Set(ids.map(String).filter(Boolean))] : [];
    } catch (e) {
        return [];
    }
}

function savePendingCloudDeletes() {
    localStorage.setItem(PENDING_DELETE_STORAGE_KEY, JSON.stringify(state.pendingCloudDeletes));
}

function queuePendingCloudDeletes(ids) {
    const queued = new Set(state.pendingCloudDeletes || []);
    ids.forEach((id) => queued.add(String(id)));
    state.pendingCloudDeletes = [...queued];
    savePendingCloudDeletes();
    updateCloudUi();
}

function clearPendingCloudDeletes() {
    state.pendingCloudDeletes = [];
    savePendingCloudDeletes();
}

function uid() {
    return crypto.randomUUID ? crypto.randomUUID() : `${Date.now()}-${Math.random().toString(16).slice(2)}`;
}

function attachmentName(attachment) {
    return String(attachment?.name || "Imagem do gráfico");
}

function formatBytes(bytes) {
    const value = Number(bytes || 0);
    if (!value) return "";
    return value < 1024 * 1024 ? `${Math.ceil(value / 1024)} KB` : `${(value / (1024 * 1024)).toFixed(1)} MB`;
}

function validateAttachmentFile(file) {
    if (!file) return { ok: true };
    if (!ALLOWED_ATTACHMENT_TYPES.has(file.type)) {
        return { ok: false, message: "Use uma imagem JPEG, PNG ou WebP." };
    }
    if (!file.size) return { ok: false, message: "A imagem está vazia. Escolha outro arquivo." };
    if (file.size > MAX_ATTACHMENT_BYTES) {
        return { ok: false, message: "A imagem deve ter no máximo 20 MB." };
    }
    return { ok: true };
}

function resetAttachmentEditor(attachment = null) {
    const current = state.editAttachment;
    if (current?.previewUrl) URL.revokeObjectURL(current.previewUrl);
    state.editAttachment = { existing: attachment || null, removeExisting: false, previewUrl: null };
    $("fAttachment").value = "";
    renderAttachmentPreview();
}

function setAttachmentStatus(message) {
    $("attachmentStatus").textContent = message;
}

function renderAttachmentPreview() {
    const box = $("attachmentPreview");
    const image = $("attachmentImage");
    const open = $("attachmentOpen");
    const name = $("attachmentName");
    const selected = $("fAttachment").files[0];
    const editor = state.editAttachment || { existing: null, removeExisting: false, previewUrl: null };

    if (editor.previewUrl) {
        URL.revokeObjectURL(editor.previewUrl);
        editor.previewUrl = null;
    }

    if (selected) {
        const check = validateAttachmentFile(selected);
        if (!check.ok) {
            $("fAttachment").value = "";
            box.hidden = true;
            setAttachmentStatus(check.message);
            return;
        }
        editor.previewUrl = URL.createObjectURL(selected);
        image.src = editor.previewUrl;
        open.href = editor.previewUrl;
        name.textContent = `${selected.name} · ${formatBytes(selected.size)} · novo anexo`;
        box.hidden = false;
        setAttachmentStatus(canUseCloud() ? "Será enviado de forma privada ao salvar o trade." : "Entre no Supabase para salvar imagens." );
        return;
    }

    const attachment = !editor.removeExisting ? editor.existing : null;
    if (!attachment?.path) {
        image.removeAttribute("src");
        open.removeAttribute("href");
        box.hidden = true;
        setAttachmentStatus("JPEG, PNG ou WebP · até 20 MB · privado por conta.");
        return;
    }

    name.textContent = `${attachmentName(attachment)}${attachment.size ? ` · ${formatBytes(attachment.size)}` : ""}`;
    box.hidden = false;
    setAttachmentStatus(canUseCloud() ? "Carregando prévia privada…" : "Entre no Supabase para abrir este anexo privado.");
    image.removeAttribute("src");
    open.removeAttribute("href");
    if (canUseCloud()) loadAttachmentPreview(attachment);
}

async function loadAttachmentPreview(attachment) {
    const path = attachment?.path;
    if (!path || !canUseCloud()) return;
    const userId = currentUser.id;
    try {
        const { data, error } = await supabaseClient.storage.from(ATTACHMENTS_BUCKET).createSignedUrl(path, 600);
        if (error) throw error;
        const editor = state.editAttachment;
        if (currentUser?.id !== userId || !editor || editor.removeExisting || editor.existing?.path !== path || $("fAttachment").files[0]) return;
        $("attachmentImage").src = data.signedUrl;
        $("attachmentOpen").href = data.signedUrl;
        setAttachmentStatus("Anexo privado sincronizado.");
    } catch (err) {
        setAttachmentStatus(`Não foi possível abrir a imagem: ${err.message || err}`);
    }
}

function tradeAttachmentButton(trade) {
    return trade.attachment?.path ? ` <button class="tag attachment-link" type="button" data-open-attachment="${escapeHtml(trade.id)}" title="Abrir imagem anexada" aria-label="Abrir imagem do trade ${escapeHtml(trade.symbol || "")}, ${fmtDate(trade)}">imagem</button>` : "";
}

let attachmentViewerRequest = 0;

async function openTradeAttachment(tradeId) {
    const trade = state.trades.find((item) => item.id === tradeId);
    if (!trade?.attachment?.path) return;
    const viewer = $("attachmentViewer"), image = $("attachmentViewerImage"), link = $("attachmentViewerOriginal"), status = $("attachmentViewerStatus");
    const request = ++attachmentViewerRequest, path = trade.attachment.path;
    hideTradeChartTooltip();
    $("attachmentViewerTitle").textContent = `${trade.symbol || "Trade"} · ${fmtDate(trade)}`;
    image.alt = attachmentName(trade.attachment);
    image.hidden = true;
    image.removeAttribute("src");
    link.hidden = true;
    link.removeAttribute("href");
    status.hidden = false;
    status.textContent = canUseCloud() ? "Carregando imagem…" : "Entre na sua conta do Supabase para abrir este anexo privado.";
    if (!viewer.open) viewer.showModal();
    if (!canUseCloud()) return;
    const userId = currentUser.id;
    try {
        const { data, error } = await supabaseClient.storage.from(ATTACHMENTS_BUCKET).createSignedUrl(path, 600);
        if (request !== attachmentViewerRequest || !viewer.open) return;
        if (currentUser?.id !== userId || !canUseCloud()) {
            status.textContent = "A conta mudou. Feche e abra a imagem novamente.";
            return;
        }
        if (error) throw error;
        if (!data?.signedUrl) throw new Error("O link da imagem não está disponível.");
        if (state.trades.find((item) => item.id === tradeId)?.attachment?.path !== path) {
            status.textContent = "O anexo foi alterado. Feche e abra a imagem novamente.";
            return;
        }
        image.src = data.signedUrl;
        link.href = data.signedUrl;
        link.hidden = false;
    } catch (err) {
        if (request === attachmentViewerRequest && viewer.open) status.textContent = `Não foi possível abrir a imagem: ${err.message || err}`;
    }
}

function bindAttachmentViewer() {
    const viewer = $("attachmentViewer"), image = $("attachmentViewerImage");
    document.addEventListener("click", (event) => {
        const button = event.target.closest?.("[data-open-attachment]");
        if (button) openTradeAttachment(button.dataset.openAttachment);
    });
    $("attachmentViewerClose").addEventListener("click", () => viewer.close());
    viewer.addEventListener("keydown", (event) => event.stopPropagation());
    viewer.addEventListener("click", (event) => {
        if (event.target !== viewer) return;
        const rect = viewer.getBoundingClientRect();
        if (event.clientX < rect.left || event.clientX > rect.right || event.clientY < rect.top || event.clientY > rect.bottom) viewer.close();
    });
    viewer.addEventListener("close", () => {
        if (viewer.open) return;
        attachmentViewerRequest++;
        image.removeAttribute("src");
        image.hidden = true;
        $("attachmentViewerOriginal").removeAttribute("href");
        $("attachmentViewerOriginal").hidden = true;
    });
    image.addEventListener("load", () => {
        if (!viewer.open || !image.getAttribute("src")) return;
        image.hidden = false;
        $("attachmentViewerStatus").hidden = true;
    });
    image.addEventListener("error", () => {
        if (!viewer.open || !image.getAttribute("src")) return;
        image.hidden = true;
        $("attachmentViewerStatus").hidden = false;
        $("attachmentViewerStatus").textContent = "Não foi possível carregar a imagem. Tente abrir novamente.";
    });
}

async function uploadTradeAttachment(tradeId, file) {
    const check = validateAttachmentFile(file);
    if (!check.ok) return check;
    if (!canUseCloud()) return { ok: false, message: "Entre no Supabase para anexar uma imagem." };
    const extension = ({ "image/jpeg": "jpg", "image/png": "png", "image/webp": "webp" })[file.type];
    const path = `${currentUser.id}/${tradeId}/${uid()}.${extension}`;
    try {
        const { error } = await supabaseClient.storage.from(ATTACHMENTS_BUCKET).upload(path, file, {
            cacheControl: "31536000",
            contentType: file.type,
            upsert: false
        });
        if (error) return { ok: false, message: error.message };
        return {
            ok: true,
            attachment: { path, name: file.name.slice(0, 160), size: file.size, type: file.type, uploadedAt: new Date().toISOString() }
        };
    } catch (err) {
        return { ok: false, message: err.message || String(err) };
    }
}

async function removeTradeAttachment(attachment) {
    if (!attachment?.path || !canUseCloud()) return { ok: true };
    try {
        const { error } = await supabaseClient.storage.from(ATTACHMENTS_BUCKET).remove([attachment.path]);
        return error ? { ok: false, message: error.message } : { ok: true };
    } catch (err) {
        return { ok: false, message: err.message || String(err) };
    }
}

function fmtR(v) {
    const n = Number(v || 0);
    const sign = n > 0 ? "+" : "";
    return `${sign}${n.toFixed(Number.isInteger(n) ? 0 : 2)}R`;
}

function isRPending(trade) {
    if (trade?.rCompleted) return false;
    if (trade?.source === "broker_csv" && Number(trade?.r || 0) === 0 && !Number(trade?.riskMoney || 0) && (trade?.stop === "" || trade?.stop === null || trade?.stop === undefined)) return true;
    return Boolean(trade?.rPending) || trade?.r === null || trade?.r === "";
}

function tradeRValue(trade) {
    return isRPending(trade) ? null : Number(trade?.r || 0);
}

function tradeOutcome(trade) {
    if (trade?.status === "open") return "open";
    const r = tradeRValue(trade);
    if (r === null || !Number.isFinite(r)) return "pending";
    return r > 0 ? "win" : r < 0 ? "loss" : "be";
}

function renderRBadge(trade) {
    const outcome = tradeOutcome(trade);
    if (outcome === "open") return '<span class="pill be">Em aberto</span>';
    if (outcome === "be") return '<span class="pill be" title="Resultado bruto zero; taxas são descontadas do líquido">Empate · 0R</span>';
    if (outcome === "pending") return `<span class="pill be" title="Preencha stop/risco para calcular o R">R pendente</span>`;
    const r = tradeRValue(trade);
    return `<span class="pill ${r > 0 ? "win" : r < 0 ? "loss" : "be"}">${fmtR(r)}</span>`;
}

function fmtCurrency(v) {
    return Number(v || 0).toLocaleString("pt-BR", { style: "currency", currency: "BRL" });
}

const FEE_DEFAULTS = { cripto: 0, win: 0, wdo: 0 };
const FEE_STORAGE_KEY = "diarioProFees_v1";
const CRIPTO_HINTS = ["BTC","ETH","SOL","BNB","ADA","XRP","DOGE","LTC","MATIC","DOT","AVAX","LINK","UNI","ATOM","ARB","OP","SUI","APT","INJ","SHIB","TRX","NEAR","TON","PEPE","USDT","USDC","AAVE","FIL","ICP","HBAR","RNDR","FET","TIA","STX","IMX","KAS","ALGO","SAND","MANA","CRO","VET","XLM","ETC","BCH"];

function loadFees() {
    try { return { ...FEE_DEFAULTS, ...JSON.parse(localStorage.getItem(FEE_STORAGE_KEY) || "{}") }; }
    catch (e) { return { ...FEE_DEFAULTS }; }
}

function persistFees() {
    localStorage.setItem(FEE_STORAGE_KEY, JSON.stringify(state.fees));
}

function classifySymbol(symbol) {
    const s = String(symbol || "").trim().toUpperCase();
    if (!s) return null;
    if (s.startsWith("WIN")) return "win";
    if (s.startsWith("WDO")) return "wdo";
    if (CRIPTO_HINTS.some((c) => s === c || s.startsWith(c))) return "cripto";
    return null;
}

function feeRateFor(symbol) {
    const cat = classifySymbol(symbol);
    if (!cat) return 0;
    return Number((state.fees || FEE_DEFAULTS)[cat] || 0);
}

function tradeFees(trade) {
    const manual = Number(trade?.fees || 0);
    if (manual > 0) return manual;
    const rate = feeRateFor(trade?.symbol);
    if (!rate) return 0;
    const qty = Number(trade?.qty || trade?.initQty || 0);
    return qty * rate;
}

function tradeNetPnl(trade) {
    return Number(trade?.pnl || 0) - tradeFees(trade);
}

function parseRobotCsv(text) {
    const lines = text.trim().split(/\r?\n/).filter((l) => l.trim().length > 0);
    if (lines.length < 2) return [];
    const headers = lines[0].split(",").map((h) => h.trim().toLowerCase());
    const idx = (name) => headers.indexOf(name);
    const rows = lines.slice(1).map((line) => {
        const cols = line.split(",");
        return { get: (name) => (cols[idx(name)] ?? "").trim() };
    });
    const magicFilter = Number(state.robot.magic || 0);
    const symFilter = String(state.robot.symbol || "").trim().toUpperCase();
    return rows
        .map((r) => robotRowToTrade(r))
        .filter(Boolean)
        .filter((t) => !magicFilter || t.magic === magicFilter)
        .filter((t) => !symFilter || t.symbol === symFilter);
}

function parseMt5Date(s) {
    if (!s) return new Date().toISOString();
    const m = s.match(/^(\d{4})\.(\d{2})\.(\d{2})\s+(\d{2}):(\d{2})(?::(\d{2}))?/);
    if (!m) return new Date(s).toISOString();
    return new Date(Date.UTC(+m[1], +m[2] - 1, +m[3], +m[4], +m[5], +(m[6] || 0))).toISOString();
}

function robotRowToTrade(r) {
    const ticket = r.get("ticket");
    if (!ticket) return null;
    const type = r.get("type");
    const side = (type === "0" || /buy/i.test(type)) ? "long" : "short";
    const profit = Number(r.get("profit") || 0);
    const commission = Number(r.get("commission") || 0);
    const swap = Number(r.get("swap") || 0);
    const pnl = profit + commission + swap;
    const entry = Number(r.get("price_open") || 0);
    const exit = Number(r.get("price_close") || 0);
    const sl = Number(r.get("sl") || 0);
    const tp = Number(r.get("tp") || 0);
    const volume = Number(r.get("volume") || 0);
    const symbol = String(r.get("symbol") || "").toUpperCase();
    const magic = Number(r.get("magic") || 0);
    const score = Number(r.get("score") || 0);
    const threshold = Number(r.get("threshold") || 0);
    const obType = String(r.get("ob_type") || "").toLowerCase();
    const obPts = Number(r.get("ob_pts") || 0);
    return {
        id: `robo-${ticket}`,
        date: parseMt5Date(r.get("time_open")),
        closeDate: parseMt5Date(r.get("time_close")),
        symbol,
        side,
        setup: obType ? `Robô SMC · ${obType}` : "Robô SMC",
        initQty: volume,
        qty: volume,
        entry,
        stop: sl,
        exit,
        targetMoney: 0,
        targetR: 0,
        status: "manual",
        manualR: 0,
        partials: [],
        riskMoney: 0,
        pnl,
        r: null,
        rPending: true,
        fees: 0,
        tags: ["robo", obType].filter(Boolean),
        mistakes: [],
        notes: `Ticket ${ticket} | magic ${magic} | score ${score.toFixed(4)} thr ${threshold.toFixed(4)} | OB ${obType || "?"}/${obPts}pts | comm ${commission.toFixed(2)} | swap ${swap.toFixed(2)} | comment: ${r.get("comment") || "-"}`,
        source: ROBOT_SOURCE,
        ticket,
        magic,
        commission,
        swap,
        tp,
        sl,
        score,
        threshold,
        obType,
        obPts,
        createdAt: new Date().toISOString()
    };
}

async function importRobotFile(file) {
    if (!file) { toast("Selecione um arquivo CSV"); return; }
    let text;
    try { text = await file.text(); }
    catch (e) { alert("Falha ao ler arquivo: " + e.message); return; }
    const parsed = parseRobotCsv(text);
    if (!parsed.length) {
        $("robotImportHint").innerHTML = `<span style="color:var(--red)">Nenhum trade compatível encontrado. Confira Magic Number e Símbolo.</span>`;
        return;
    }

    const byId = new Map(state.trades.map((t) => [t.id, t]));
    let added = 0, updated = 0;
    const toUpsert = [];
    for (const t of parsed) {
        const existing = byId.get(t.id);
        if (existing) {
            Object.assign(existing, t);
            updated++;
        } else {
            state.trades.push(t);
            added++;
        }
        toUpsert.push(t);
    }
    saveTrades();

    let cloudFailed = 0;
    if (canUseCloud()) {
        $("robotImportHint").textContent = `Sincronizando ${toUpsert.length} trades na nuvem...`;
        const results = await Promise.all(toUpsert.map((t) => upsertTradeCloud(t)));
        cloudFailed = results.filter((r) => !r.ok).length;
    }

    $("robotImportHint").innerHTML = `
        <strong>${added}</strong> novos · <strong>${updated}</strong> atualizados${cloudFailed ? ` · <span style="color:var(--red)">${cloudFailed} falharam na nuvem</span>` : ""}
        ${canUseCloud() ? " · sincronizado" : " · só local (faça login pra sincronizar)"}
    `;
    toast(`Robô: ${added}+ ${updated}↻`);
    renderAll();
}

function purgeRobotTrades() {
    if (!confirm("Apagar TODOS os trades importados do robô? Trades manuais não serão tocados.")) return;
    const robos = robotTrades();
    state.trades = manualTrades();
    saveTrades();
    if (canUseCloud()) {
        Promise.all(robos.map((t) => deleteTradeCloud(t.id))).then(() => {
            toast(`${robos.length} trades do robô removidos`);
            renderAll();
        });
    } else {
        toast(`${robos.length} trades do robô removidos (local)`);
        renderAll();
    }
}

function renderRobot() {
    $("fRobotMagic").value = state.robot.magic ?? "";
    $("fRobotSymbol").value = state.robot.symbol ?? "";

    const robos = [...robotTrades()].sort((a, b) => new Date(a.date) - new Date(b.date));
    if (!robos.length) {
        $("robotSummary").textContent = "Sem trades importados";
        $("robotKpis").innerHTML = "";
        $("robotTradesBox").innerHTML = `<div class="panel-body"><span class="muted">Importe um CSV pra ver as estatísticas.</span></div>`;
        const c = $("robotEquityCanvas");
        if (c.getContext) { const ctx = c.getContext("2d"); ctx.clearRect(0, 0, c.width, c.height); }
        return;
    }

    const pnls = robos.map(tradeNetPnl);
    const totalPnl = pnls.reduce((a, b) => a + b, 0);
    const wins = pnls.filter((p) => p > 0);
    const losses = pnls.filter((p) => p < 0);
    const bes = pnls.filter((p) => p === 0);
    const decisive = wins.length + losses.length;
    const winrate = decisive ? (wins.length / decisive) * 100 : 0;
    const avgWin = wins.length ? wins.reduce((a, b) => a + b, 0) / wins.length : 0;
    const avgLoss = losses.length ? losses.reduce((a, b) => a + b, 0) / losses.length : 0;
    const grossWin = wins.reduce((a, b) => a + b, 0);
    const grossLoss = Math.abs(losses.reduce((a, b) => a + b, 0));
    const pf = grossLoss ? grossWin / grossLoss : grossWin ? Infinity : 0;
    const best = Math.max(...pnls, 0);
    const worst = Math.min(...pnls, 0);

    let peak = 0, equity = 0, maxDD = 0;
    pnls.forEach((p) => { equity += p; peak = Math.max(peak, equity); maxDD = Math.max(maxDD, peak - equity); });

    const first = new Date(robos[0].date);
    const last = new Date(robos[robos.length - 1].date);
    $("robotSummary").textContent = `${robos.length} trades · ${first.toLocaleDateString("pt-BR")} → ${last.toLocaleDateString("pt-BR")} · magic ${state.robot.magic}`;

    const cls = (v) => v > 0 ? "win" : v < 0 ? "loss" : "neutral";
    const kpis = [
        { label: "P&L total liq.", value: fmtCurrency(totalPnl), meta: `${robos.length} trades`, cls: cls(totalPnl) },
        { label: "Winrate", value: fmtPct(winrate), meta: `${wins.length}W / ${losses.length}L / ${bes.length}BE`, cls: "neutral" },
        { label: "Profit factor", value: pf === Infinity ? "∞" : pf.toFixed(2), meta: "gross win / gross loss", cls: cls(pf - 1) },
        { label: "Avg win / loss", value: `${fmtCurrency(avgWin)} / ${fmtCurrency(avgLoss)}`, meta: avgLoss ? `R/R ${(avgWin / Math.abs(avgLoss)).toFixed(2)}` : "—", cls: "neutral" },
        { label: "Melhor / pior", value: `${fmtCurrency(best)} / ${fmtCurrency(worst)}`, cls: "neutral" },
        { label: "Max DD (R$)", value: fmtCurrency(-maxDD), cls: "loss" }
    ];
    const splitStats = (subset) => {
        if (!subset.length) return null;
        const sp = subset.map(tradeNetPnl);
        const sw = sp.filter((p) => p > 0).length;
        const sl = sp.filter((p) => p < 0).length;
        const sb = sp.filter((p) => p === 0).length;
        const sdec = sw + sl;
        const stot = sp.reduce((a, b) => a + b, 0);
        const swinrate = sdec ? (sw / sdec) * 100 : 0;
        return { count: subset.length, pnl: stot, winrate: swinrate, wins: sw, losses: sl, bes: sb };
    };
    const sInt = splitStats(robos.filter((t) => t.obType === "internal"));
    const sSwg = splitStats(robos.filter((t) => t.obType === "swing"));

    const obKpis = [];
    if (sInt) obKpis.push({ label: "OB Internal", value: fmtCurrency(sInt.pnl), meta: `${sInt.count} trades · ${fmtPct(sInt.winrate)} (${sInt.wins}W/${sInt.losses}L)`, cls: cls(sInt.pnl) });
    if (sSwg) obKpis.push({ label: "OB Swing", value: fmtCurrency(sSwg.pnl), meta: `${sSwg.count} trades · ${fmtPct(sSwg.winrate)} (${sSwg.wins}W/${sSwg.losses}L)`, cls: cls(sSwg.pnl) });
    const allKpis = [...kpis, ...obKpis];

    $("robotKpis").innerHTML = allKpis.map((k) => `
        <div class="kpi-card ${k.cls}">
            <div class="label">${k.label}</div>
            <div class="value">${k.value}</div>
            ${k.meta ? `<div class="meta">${k.meta}</div>` : ""}
        </div>
    `).join("");

    requestAnimationFrame(() => drawRobotEquity(pnls, robos));

    const last30 = [...robos].reverse().slice(0, 30);
    $("robotTradesBox").innerHTML = `
        <div class="panel-body" style="overflow-x:auto;">
            <table>
                <thead><tr>
                    <th>Data</th><th>Ticket</th><th>Ativo</th><th>Lado</th>
                    <th>OB</th><th class="right">OB pts</th>
                    <th class="right">Score</th><th class="right">Thr</th>
                    <th class="right">Vol</th>
                    <th class="right">Entrada</th><th class="right">Saída</th><th class="right">P&L liq.</th>
                </tr></thead>
                <tbody>
                ${last30.map((t) => `
                    <tr>
                        <td>${new Date(t.date).toLocaleString("pt-BR")}</td>
                        <td>${escapeHtml(t.ticket || "")}</td>
                        <td>${escapeHtml(t.symbol)}</td>
                        <td>${t.side === "long" ? "Compra" : "Venda"}</td>
                        <td>${escapeHtml(t.obType || "-")}</td>
                        <td class="right">${t.obPts || "-"}</td>
                        <td class="right">${t.score ? Number(t.score).toFixed(3) : "-"}</td>
                        <td class="right muted">${t.threshold ? Number(t.threshold).toFixed(3) : "-"}</td>
                        <td class="right">${t.qty}</td>
                        <td class="right">${t.entry}</td>
                        <td class="right">${t.exit}</td>
                        <td class="right" style="color:${tradeNetPnl(t) > 0 ? "var(--green)" : tradeNetPnl(t) < 0 ? "var(--red)" : "var(--muted)"}"><strong>${fmtCurrency(tradeNetPnl(t))}</strong></td>
                    </tr>
                `).join("")}
                </tbody>
            </table>
        </div>
    `;
}

let s_lastRobotEquity = null;
function drawRobotEquity(pnls, robos) {
    const eq = [0];
    pnls.forEach((p) => eq.push(eq[eq.length - 1] + p));
    const dates = ["Início"];
    (robos || []).forEach((t) => dates.push(fmtDateShort(t.closeDate || t.date)));
    s_lastRobotEquity = { eq, dates, color: "#2ddb8a" };
    drawCapitalCurve("robotEquityCanvas", eq, dates, { color: "#2ddb8a" });
}

function redrawChartsForView() {
    if (state.view === "dashboard") {
        drawEquity();
        drawDist();
    } else if (state.view === "robot") {
        if (s_lastRobotEquity)
            drawCapitalCurve("robotEquityCanvas", s_lastRobotEquity.eq, s_lastRobotEquity.dates, { color: s_lastRobotEquity.color });
    } else if (state.view === "stats") {
        drawHour();
    }
}

let s_chartResizeObserver = null;
function setupChartResize() {
    if (typeof ResizeObserver === "undefined") return;
    if (s_chartResizeObserver) s_chartResizeObserver.disconnect();
    s_chartResizeObserver = new ResizeObserver(() => requestAnimationFrame(redrawChartsForView));
    document.querySelectorAll(".chart-frame, .hour-chart-scroll").forEach((el) => s_chartResizeObserver.observe(el));
}

function fmtPct(v) {
    return `${Number(v || 0).toFixed(1)}%`;
}

function fmtDate(value) {
    if (!value) return "-";
    const local = typeof value === "object" ? tradeLocalDateTime(value) : localDateTimeValue(value);
    if (!local) return "-";
    return `${local.slice(8, 10)}/${local.slice(5, 7)}/${local.slice(0, 4)} ${local.slice(11, 16)}`;
}

function bindNav() {
    document.querySelectorAll(".nav-item").forEach((btn) => {
        btn.addEventListener("click", () => switchView(btn.dataset.view));
    });
}

function switchView(view) {
    hideTradeChartTooltip();
    state.view = view;
    document.querySelectorAll(".nav-item").forEach((b) => b.classList.toggle("active", b.dataset.view === view));
    document.querySelectorAll(".view").forEach((v) => v.classList.toggle("active", v.id === `view-${view}`));
    const titles = {
        backtests: ["Backtests", "Teste manual por estratégia · resultado em R"],
        dashboard: ["Dashboard", "Visão geral da performance"],
        trades: ["Trades", `${filteredManualTrades().length} operações registradas`],
        calendar: ["Calendário", "Resultado diário"],
        stats: ["Estatísticas", "Métricas avançadas e análises"],
        journal: ["Diário", "Notas e revisão por trade"],
        fees: ["Taxas", "Configuração por categoria de ativo"],
        robot: ["Robô SMC", "Import automático dos trades do MT5"]
    };
    const [t, s] = titles[view] || titles.dashboard;
    $("viewTitle").textContent = t;
    $("viewSubtitle").textContent = s;
    renderAll();
}

function localDateTimeValue(value = new Date()) {
    const date = new Date(value);
    if (!Number.isFinite(date.getTime())) return "";
    const pad = (n) => String(n).padStart(2, "0");
    return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}T${pad(date.getHours())}:${pad(date.getMinutes())}`;
}

function parseDateTimeLocal(value) {
    const match = String(value || "").match(/^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})(?::(\d{2})(?:\.(\d{1,3}))?)?$/);
    if (!match) return null;
    const [, year, month, day, hour, minute, second = "0", fraction = "0"] = match;
    const date = new Date(+year, +month - 1, +day, +hour, +minute, +second, +fraction.padEnd(3, "0"));
    if (date.getFullYear() !== +year || date.getMonth() !== +month - 1 || date.getDate() !== +day
        || date.getHours() !== +hour || date.getMinutes() !== +minute || date.getSeconds() !== +second) return null;
    return date;
}

function tradeLocalDateTime(trade) {
    // The form's wall clock value is authoritative; UTC remains the cloud timestamp/index.
    if (parseDateTimeLocal(trade?.dateLocal)) return trade.dateLocal.slice(0, 16);
    return trade?.date ? localDateTimeValue(trade.date) : "";
}

function tradeDisplayDate(trade) {
    return parseDateTimeLocal(trade?.dateLocal) || new Date(trade?.date);
}

function openModal(trade) {
    if ($("btnSave").disabled) return;
    state.editingId = trade ? trade.id : null;
    $("modalTitle").textContent = trade ? "Editar trade" : "Novo trade";
    $("fDate").value = trade ? tradeLocalDateTime(trade) : localDateTimeValue();
    $("fSymbol").value = trade?.symbol || "";
    $("fSide").value = trade?.side || "long";
    $("fSetup").value = trade?.setup || "";
    $("fInitQty").value = trade?.initQty ?? trade?.qty ?? "";

    const legacyRisk = trade?.riskMoney || (Number(trade?.entry || 0) && Number(trade?.stop || 0) && Number(trade?.qty || 0)
        ? Math.abs(Number(trade.entry) - Number(trade.stop)) * Number(trade.qty) : 0);
    $("fStopMoney").value = trade?.stopMoney ?? (legacyRisk || "");
    $("fTargetMoney").value = trade?.targetMoney ?? "";
    $("fStatus").value = trade?.status || (trade && trade.r != null ? "manual" : "open");
    $("fManualR").value = trade?.manualR ?? (trade?.status ? "" : (trade?.r ?? ""));

    $("fTags").value = (trade?.tags || []).join(", ");
    $("fMistakes").value = (trade?.mistakes || []).join(", ");
    $("fNotes").value = trade?.notes || "";
    resetAttachmentEditor(trade?.attachment || null);

    let partials = [];
    if (trade?.partials?.length && trade.partials[0].r !== undefined) {
        partials = trade.partials.map((p) => ({ qty: p.qty ?? "", r: p.r ?? "" }));
    }
    state.editPartials = partials;
    renderPartials();
    $("modalBackdrop").classList.add("open");
    recomputeFromInputs();
}

function renderPartials() {
    const box = $("partialsBox");
    if (!state.editPartials.length) {
        box.innerHTML = `<div class="partials-empty">Nenhuma saída. Clique <strong>+ Parcial</strong>.</div>`;
        recomputeFromInputs();
        return;
    }
    box.innerHTML = state.editPartials.map((p, i) => `
        <div class="partial-row">
            <div class="field">
                <label>Qtd parcial ${i + 1}</label>
                <input type="number" step="any" data-pi="${i}" data-pk="qty" value="${p.qty ?? ""}">
            </div>
            <div class="field">
                <label>R alcançado</label>
                <input type="number" step="any" data-pi="${i}" data-pk="r" value="${p.r ?? ""}" placeholder="Ex: 2">
            </div>
            <button class="partial-del" type="button" data-pdel="${i}" title="Remover">×</button>
        </div>
    `).join("");

    box.querySelectorAll("[data-pi]").forEach((inp) => {
        inp.addEventListener("input", () => {
            const i = Number(inp.dataset.pi);
            state.editPartials[i][inp.dataset.pk] = inp.value === "" ? "" : Number(inp.value);
            recomputeFromInputs();
        });
    });
    box.querySelectorAll("[data-pdel]").forEach((btn) => {
        btn.addEventListener("click", () => {
            state.editPartials.splice(Number(btn.dataset.pdel), 1);
            renderPartials();
        });
    });
    recomputeFromInputs();
}

function computeTradeMath() {
    const initQty = Number($("fInitQty").value || 0);
    const stopMoney = Number($("fStopMoney").value || 0);
    const targetMoney = Number($("fTargetMoney").value || 0);
    const status = $("fStatus").value;
    const manualR = Number($("fManualR").value || 0);

    const targetR = stopMoney > 0 ? targetMoney / stopMoney : 0;

    const partials = (state.editPartials || []).filter((p) => Number(p.qty) > 0);
    let pnlPartials = 0;
    let qtyDone = 0;
    partials.forEach((p) => {
        const q = Number(p.qty);
        const r = Number(p.r || 0);
        qtyDone += q;
        if (initQty > 0 && stopMoney > 0) {
            pnlPartials += (q / initQty) * r * stopMoney;
        }
    });

    const qtyRemaining = Math.max(0, initQty - qtyDone);
    let finalR = 0;
    if (status === "target") finalR = targetR;
    else if (status === "stop") finalR = -1;
    else if (status === "breakeven") finalR = 0;
    else if (status === "manual") finalR = manualR;

    let pnlFinal = 0;
    if (status !== "open" && initQty > 0 && stopMoney > 0) {
        pnlFinal = (qtyRemaining / initQty) * finalR * stopMoney;
    }

    const pnl = pnlPartials + pnlFinal;
    const totalR = stopMoney > 0 ? pnl / stopMoney : 0;

    return { stopMoney, targetMoney, targetR, qtyDone, qtyRemaining, pnlPartials, pnlFinal, pnl, totalR, finalR, status, initQty };
}

function recomputeFromInputs() {
    const m = computeTradeMath();
    $("fTargetR").value = m.targetR ? `${m.targetR.toFixed(2)}R` : "";
    $("fPnl").value = m.stopMoney > 0 ? m.pnl.toFixed(2) : "";
    $("fR").value = m.stopMoney > 0 ? `${m.totalR >= 0 ? "+" : ""}${m.totalR.toFixed(2)}R` : "";
    $("fManualR").disabled = m.status !== "manual";
    const breakevenHint = $("breakevenHint");
    if (breakevenHint) breakevenHint.hidden = m.status !== "breakeven";

    const sum = $("partialSummary");
    if (sum) {
        if (m.stopMoney > 0 && m.initQty > 0) {
            const color = (v) => v > 0 ? "var(--green)" : v < 0 ? "var(--red)" : "var(--accent-2)";
            const statusLabel = { open: "Em aberto", target: "Alvo", stop: "Stop", breakeven: "Empate / 0x0", manual: `Manual ${m.finalR >= 0 ? "+" : ""}${m.finalR}R` }[m.status];
            sum.innerHTML = `
                <span>Executado: <strong>${m.qtyDone} de ${m.initQty}</strong></span>
                <span>Restante: <strong>${m.qtyRemaining}</strong></span>
                <span>Alvo: <strong>${m.targetR ? m.targetR.toFixed(2) + "R" : "—"}</strong></span>
                <span>P&L parciais: <strong style="color:${color(m.pnlPartials)}">${fmtCurrency(m.pnlPartials)}</strong></span>
                <span>P&L fechamento: <strong style="color:${color(m.pnlFinal)}">${fmtCurrency(m.pnlFinal)}</strong></span>
                <span>Status: <strong>${statusLabel}</strong></span>
                <span>P&L total: <strong style="color:${color(m.pnl)}">${fmtCurrency(m.pnl)}</strong></span>
                <span>R total: <strong style="color:${color(m.totalR)}">${m.totalR >= 0 ? "+" : ""}${m.totalR.toFixed(2)}R</strong></span>
            `;
        } else {
            sum.innerHTML = `<span class="muted">Preencha quantidade, stop (R$) e parciais pra ver os cálculos.</span>`;
        }
    }
}

function closeModal() {
    if ($("btnSave").disabled) return;
    $("modalBackdrop").classList.remove("open");
    if (state.editAttachment?.previewUrl) URL.revokeObjectURL(state.editAttachment.previewUrl);
    state.editAttachment = null;
    state.editingId = null;
}

async function saveFromForm() {
    if ($("btnSave").disabled) return;
    const savingUserId = canUseCloud() ? currentUser.id : null;
    const m = computeTradeMath();
    const initQty = Number($("fInitQty").value || 0);
    const status = $("fStatus").value;
    const manualR = Number($("fManualR").value || 0);
    const partials = (state.editPartials || []).filter((p) => Number(p.qty) > 0)
        .map((p) => ({ qty: Number(p.qty), r: Number(p.r || 0) }));

    const isEdit = Boolean(state.editingId);
    const existingTrade = isEdit ? state.trades.find((t) => t.id === state.editingId) : null;
    const enteredDateLocal = $("fDate").value;
    const enteredDate = parseDateTimeLocal(enteredDateLocal);
    if (!enteredDate) {
        toast("Informe uma data e hora válidas.");
        return;
    }
    const unchangedDate = existingTrade?.date && enteredDateLocal === tradeLocalDateTime(existingTrade);
    const previousAttachment = existingTrade?.attachment || null;
    const selectedAttachment = $("fAttachment").files[0];
    const attachmentRemoved = Boolean(state.editAttachment?.removeExisting);
    const trade = {
        id: state.editingId || uid(),
        date: unchangedDate ? existingTrade.date : enteredDate.toISOString(),
        dateLocal: enteredDateLocal,
        dateTimeZone: unchangedDate && existingTrade.dateTimeZone
            ? existingTrade.dateTimeZone : Intl.DateTimeFormat().resolvedOptions().timeZone,
        symbol: $("fSymbol").value.trim().toUpperCase(),
        side: $("fSide").value,
        setup: $("fSetup").value.trim(),
        initQty,
        qty: initQty,
        stopMoney: m.stopMoney,
        targetMoney: m.targetMoney,
        targetR: m.targetR,
        status,
        manualR: status === "manual" ? manualR : 0,
        partials,
        riskMoney: m.stopMoney,
        pnl: m.pnl,
        r: m.totalR,
        fees: 0,
        entry: 0,
        stop: 0,
        exit: 0,
        tags: $("fTags").value.split(",").map((t) => t.trim()).filter(Boolean),
        mistakes: $("fMistakes").value.split(",").map((t) => t.trim()).filter(Boolean),
        notes: $("fNotes").value.trim(),
        attachment: previousAttachment,
        createdAt: isEdit ? existingTrade?.createdAt : new Date().toISOString()
    };
    if (existingTrade?.source) trade.source = existingTrade.source;
    if (existingTrade?.dateCorrection) trade.dateCorrection = existingTrade.dateCorrection;

    if (!trade.symbol) {
        toast("Informe o ativo");
        return;
    }

    const attachmentCheck = validateAttachmentFile(selectedAttachment);
    if (!attachmentCheck.ok) {
        toast(attachmentCheck.message);
        return;
    }
    if ((selectedAttachment || attachmentRemoved) && !canUseCloud()) {
        toast("Entre no Supabase para anexar ou remover uma imagem.");
        return;
    }

    $("btnSave").disabled = true;
    let uploadedAttachment = null;
    try {
        if (selectedAttachment) {
            const upload = await uploadTradeAttachment(trade.id, selectedAttachment);
            if (!upload.ok) {
                alert(`Falha ao enviar imagem: ${upload.message}`);
                return;
            }
            uploadedAttachment = upload.attachment;
            trade.attachment = uploadedAttachment;
        } else if (attachmentRemoved) {
            trade.attachment = null;
        }

        if (savingUserId && (!canUseCloud() || currentUser.id !== savingUserId)) {
            alert("A sessão mudou durante o envio. Entre novamente na mesma conta e tente salvar.");
            return;
        }
        if (savingUserId) {
            const result = await upsertTradeCloud(trade);
            if (!result.ok) {
                if (uploadedAttachment) {
                    const cleanup = await removeTradeAttachment(uploadedAttachment);
                    if (!cleanup.ok) alert("O envio da imagem foi concluído, mas não foi possível limpar o arquivo após a falha. Remova-o em Storage > trade-attachments no Supabase.");
                }
                alert(`Falha ao salvar na nuvem: ${result.message}`);
                return;
            }
        }

        if (previousAttachment && (selectedAttachment || attachmentRemoved)) {
            const removal = await removeTradeAttachment(previousAttachment);
            if (!removal.ok) alert(`O trade foi salvo, mas a imagem anterior continua no Storage. Você pode removê-la no Supabase. ${removal.message}`);
        }
    } finally {
        $("btnSave").disabled = false;
    }

    if (isEdit) {
        const idx = state.trades.findIndex((t) => t.id === trade.id);
        if (idx >= 0) state.trades[idx] = trade;
        toast(canUseCloud() ? "Trade atualizado · sincronizado" : "Trade atualizado (local)");
    } else {
        state.trades.push(trade);
        toast(canUseCloud() ? "Trade salvo · sincronizado" : "Trade salvo (local)");
    }

    saveTrades();
    closeModal();
    renderAll();
}

async function deleteTrade(id) {
    if (!confirm("Excluir este trade?")) return;
    if (canUseCloud()) {
        const result = await deleteTradeCloud(id);
        if (!result.ok) {
            alert(`Falha ao excluir na nuvem: ${result.message}`);
            return;
        }
    }
    state.trades = state.trades.filter((t) => t.id !== id);
    saveTrades();
    toast(canUseCloud() ? "Trade excluído · sincronizado" : "Trade excluído (local)");
    renderAll();
}

function computeStats(trades) {
    const sorted = [...trades].sort((a, b) => tradeDisplayDate(a) - tradeDisplayDate(b));
    const total = sorted.length;
    const openCount = sorted.filter((t) => tradeOutcome(t) === "open").length;
    const completedR = sorted.filter((t) => ["win", "loss", "be"].includes(tradeOutcome(t)));
    const rCount = completedR.length;
    const pendingR = total - rCount - openCount;
    const wins = completedR.filter((t) => tradeRValue(t) > 0);
    const losses = completedR.filter((t) => tradeRValue(t) < 0);
    const bes = completedR.filter((t) => tradeRValue(t) === 0);
    const decisive = wins.length + losses.length;
    const winrate = decisive ? (wins.length / decisive) * 100 : 0;
    const rTotal = completedR.reduce((a, t) => a + tradeRValue(t), 0);
    const feesTotal = sorted.reduce((a, t) => a + tradeFees(t), 0);
    const pnlTotal = sorted.reduce((a, t) => a + tradeNetPnl(t), 0);
    const avgWin = wins.length ? wins.reduce((a, t) => a + tradeRValue(t), 0) / wins.length : 0;
    const avgLoss = losses.length ? losses.reduce((a, t) => a + tradeRValue(t), 0) / losses.length : 0;
    const grossWin = wins.reduce((a, t) => a + tradeRValue(t), 0);
    const grossLoss = Math.abs(losses.reduce((a, t) => a + tradeRValue(t), 0));
    const pf = grossLoss ? grossWin / grossLoss : grossWin ? Infinity : 0;
    const expectancy = rCount ? rTotal / rCount : 0;
    const largestWin = wins.length ? Math.max(...wins.map(tradeRValue)) : 0;
    const largestLoss = losses.length ? Math.min(...losses.map(tradeRValue)) : 0;
    const equity = [0];
    const capitalEquity = [0];
    completedR.forEach((t) => {
        equity.push(equity[equity.length - 1] + tradeRValue(t));
    });
    sorted.forEach((t) => {
        capitalEquity.push(capitalEquity[capitalEquity.length - 1] + tradeNetPnl(t));
    });
    let peak = 0, maxDD = 0;
    equity.forEach((v) => { peak = Math.max(peak, v); maxDD = Math.max(maxDD, peak - v); });

    let curStreak = 0, bestWin = 0, bestLoss = 0;
    let lastSign = 0;
    completedR.forEach((t) => {
        const r = tradeRValue(t);
        const sign = r > 0 ? 1 : r < 0 ? -1 : 0;
        if (sign === 0) { curStreak = 0; lastSign = 0; return; }
        if (sign === lastSign) curStreak++;
        else { curStreak = 1; lastSign = sign; }
        if (sign > 0) bestWin = Math.max(bestWin, curStreak);
        else bestLoss = Math.max(bestLoss, curStreak);
    });

    const lastDir = completedR.length ? (tradeRValue(completedR[completedR.length - 1]) > 0 ? 1 : tradeRValue(completedR[completedR.length - 1]) < 0 ? -1 : 0) : 0;
    let curRunLen = 0;
    for (let i = completedR.length - 1; i >= 0; i--) {
        const r = tradeRValue(completedR[i]);
        const s = r > 0 ? 1 : r < 0 ? -1 : 0;
        if (s === lastDir && s !== 0) curRunLen++;
        else break;
    }

    return {
        total, rCount, pendingR, openCount, wins: wins.length, losses: losses.length, bes: bes.length,
        winrate, rTotal, pnlTotal, feesTotal, avgWin, avgLoss, pf, expectancy,
        largestWin, largestLoss, maxDD, equity, capitalEquity,
        bestWinStreak: bestWin, bestLossStreak: bestLoss,
        currentStreak: curRunLen, currentStreakDir: lastDir
    };
}

function renderKPIs() {
    const s = computeStats(filteredManualTrades());
    const rMeta = `${s.rCount} fechados com R${s.pendingR ? ` / ${s.pendingR} pend.` : ""}${s.openCount ? ` / ${s.openCount} em aberto` : ""}`;
    const kpis = [
        { label: "Net P&L liq.", value: fmtCurrency(s.pnlTotal), meta: `fees: ${fmtCurrency(s.feesTotal)}`, cls: s.pnlTotal > 0 ? "win" : s.pnlTotal < 0 ? "loss" : "neutral" },
        { label: "R Total", value: s.rCount ? fmtR(s.rTotal) : "pendente", meta: rMeta, cls: s.rTotal > 0 ? "win" : s.rTotal < 0 ? "loss" : "neutral" },
        { label: "Winrate", value: s.rCount ? fmtPct(s.winrate) : "—", meta: `${s.wins}W / ${s.losses}L / ${s.bes}BE${s.openCount ? ` / ${s.openCount} em aberto` : ""}${s.pendingR ? ` / ${s.pendingR} pend.` : ""}`, cls: "neutral" },
        { label: "Expectancy", value: fmtR(s.expectancy), meta: "média por trade", cls: s.expectancy > 0 ? "win" : "loss" },
        { label: "Max Drawdown", value: fmtR(-s.maxDD), cls: "loss" },
        { label: "Trades", value: s.total, meta: s.currentStreakDir ? `Streak ${s.currentStreakDir > 0 ? "🟢" : "🔴"} ${s.currentStreak}` : "", cls: "neutral" }
    ];
    kpis[3] = { label: "Expectancy", value: s.rCount ? fmtR(s.expectancy) : "pendente", meta: "media por trade com R", cls: s.rCount && s.expectancy > 0 ? "win" : s.rCount && s.expectancy < 0 ? "loss" : "neutral" };
    kpis[4] = { label: "Max Drawdown", value: s.rCount ? fmtR(-s.maxDD) : "pendente", cls: s.rCount ? "loss" : "neutral" };
    kpis[5] = { label: "Trades", value: s.total, meta: [`${s.rCount} fechados`, s.openCount ? `${s.openCount} em aberto` : "", s.pendingR ? `${s.pendingR} com R pendente` : ""].filter(Boolean).join(" · "), cls: "neutral" };
    $("kpiGrid").innerHTML = kpis.map((k) => `
        <div class="kpi-card ${k.cls}">
            <div class="label">${k.label}</div>
            <div class="value">${k.value}</div>
            ${k.meta ? `<div class="meta">${k.meta}</div>` : ""}
        </div>
    `).join("");
}

function setupCanvas(id) {
    const c = $(id);
    if (!c) return null;
    const r = c.getBoundingClientRect();
    const ratio = window.devicePixelRatio || 1;
    c.width = Math.max(1, Math.floor(r.width * ratio));
    c.height = Math.max(1, Math.floor(r.height * ratio));
    const ctx = c.getContext("2d");
    ctx.setTransform(ratio, 0, 0, ratio, 0, 0);
    ctx.clearRect(0, 0, r.width, r.height);
    return { ctx, w: r.width, h: r.height };
}

function fmtDateShort(iso) {
    if (!iso) return "";
    const d = typeof iso === "object" ? tradeDisplayDate(iso) : new Date(iso);
    if (Number.isNaN(d.getTime())) return "";
    return `${String(d.getDate()).padStart(2,"0")}/${String(d.getMonth()+1).padStart(2,"0")}`;
}

function niceStep(rawStep) {
    if (rawStep <= 0) return 1;
    const mag = Math.pow(10, Math.floor(Math.log10(rawStep)));
    const norm = rawStep / mag;
    let nice;
    if (norm < 1.5) nice = 1;
    else if (norm < 3) nice = 2;
    else if (norm < 7) nice = 5;
    else nice = 10;
    return nice * mag;
}

function drawCapitalCurve(canvasId, points, dates, opts) {
    const setup = setupCanvas(canvasId);
    if (!setup) return;
    const { ctx, w, h } = setup;
    const posColor = (opts && opts.color) || "#2ddb8a";
    const negColor = (opts && opts.negativeColor) || "#ff5d6c";
    if (!points || points.length === 0) { drawEmpty(ctx, w, h); return; }

    const pad = { t: 14, r: 86, b: 28, l: 14 };
    const innerW = Math.max(1, w - pad.l - pad.r);
    const innerH = Math.max(1, h - pad.t - pad.b);

    const dataMin = Math.min(...points, 0);
    const dataMax = Math.max(...points, 0);
    const span = Math.max(dataMax - dataMin, 1);
    const target = niceStep(span / 4);
    let lo = Math.floor(dataMin / target) * target;
    let hi = Math.ceil(dataMax / target) * target;
    if (lo === hi) hi = lo + target;
    const divisors = Math.max(2, Math.round((hi - lo) / target));
    const range = hi - lo;

    const xPos = (i) => pad.l + (i / Math.max(points.length - 1, 1)) * innerW;
    const yPos = (v) => pad.t + ((hi - v) / range) * innerH;
    const yZero = yPos(0);

    for (let i = 0; i <= divisors; i++) {
        const value = hi - (i / divisors) * range;
        const y = pad.t + (i / divisors) * innerH;
        const isZero = Math.abs(value) < target * 0.001;
        ctx.strokeStyle = isZero ? "rgba(255,255,255,0.32)" : "rgba(255,255,255,0.06)";
        ctx.lineWidth = isZero ? 1.4 : 1;
        ctx.beginPath();
        ctx.moveTo(pad.l, y);
        ctx.lineTo(w - pad.r, y);
        ctx.stroke();

        if (isZero) ctx.fillStyle = "#e8edf7";
        else if (value < 0) ctx.fillStyle = "#ff8a92";
        else ctx.fillStyle = "#8a98b5";
        ctx.font = isZero ? "800 11px Inter, Arial" : "700 11px Inter, Arial";
        ctx.textAlign = "left";
        ctx.textBaseline = "middle";
        ctx.fillText(fmtCurrency(value), w - pad.r + 6, y);
    }

    const buildAreaPath = () => {
        ctx.beginPath();
        points.forEach((v, i) => {
            const x = xPos(i), y = yPos(v);
            if (i === 0) ctx.moveTo(x, y); else ctx.lineTo(x, y);
        });
        ctx.lineTo(xPos(points.length - 1), yZero);
        ctx.lineTo(xPos(0), yZero);
        ctx.closePath();
    };

    if (yZero > pad.t) {
        ctx.save();
        ctx.beginPath();
        ctx.rect(pad.l, pad.t, innerW, yZero - pad.t);
        ctx.clip();
        const posGrad = ctx.createLinearGradient(0, pad.t, 0, yZero);
        posGrad.addColorStop(0, posColor + "66");
        posGrad.addColorStop(1, posColor + "00");
        buildAreaPath();
        ctx.fillStyle = posGrad;
        ctx.fill();
        ctx.restore();
    }

    if (yZero < pad.t + innerH) {
        ctx.save();
        ctx.beginPath();
        ctx.rect(pad.l, yZero, innerW, pad.t + innerH - yZero);
        ctx.clip();
        const negGrad = ctx.createLinearGradient(0, yZero, 0, pad.t + innerH);
        negGrad.addColorStop(0, negColor + "00");
        negGrad.addColorStop(1, negColor + "55");
        buildAreaPath();
        ctx.fillStyle = negGrad;
        ctx.fill();
        ctx.restore();
    }

    ctx.lineWidth = 2.4;
    ctx.lineJoin = "round";
    ctx.lineCap = "round";
    for (let i = 0; i < points.length - 1; i++) {
        const v1 = points[i], v2 = points[i + 1];
        const x1 = xPos(i), x2 = xPos(i + 1);
        const y1 = yPos(v1), y2 = yPos(v2);
        const crosses = (v1 < 0 && v2 > 0) || (v1 > 0 && v2 < 0);
        if (!crosses) {
            ctx.strokeStyle = (v1 < 0 || v2 < 0) ? negColor : posColor;
            ctx.beginPath();
            ctx.moveTo(x1, y1);
            ctx.lineTo(x2, y2);
            ctx.stroke();
        } else {
            const t = v1 / (v1 - v2);
            const xc = x1 + t * (x2 - x1);
            ctx.strokeStyle = v1 >= 0 ? posColor : negColor;
            ctx.beginPath();
            ctx.moveTo(x1, y1);
            ctx.lineTo(xc, yZero);
            ctx.stroke();
            ctx.strokeStyle = v2 >= 0 ? posColor : negColor;
            ctx.beginPath();
            ctx.moveTo(xc, yZero);
            ctx.lineTo(x2, y2);
            ctx.stroke();
        }
    }

    if (dates && dates.length === points.length) {
        ctx.fillStyle = "#8a98b5";
        ctx.font = "700 10px Inter, Arial";
        ctx.textAlign = "center";
        ctx.textBaseline = "top";
        const ticks = Math.min(6, points.length);
        for (let i = 0; i < ticks; i++) {
            const idx = Math.round((i / Math.max(ticks - 1, 1)) * (points.length - 1));
            const label = dates[idx];
            if (!label) continue;
            ctx.fillText(label, xPos(idx), h - pad.b + 6);
        }
    }
}

function drawEquity() {
    const c = $("equityCanvas");
    if (!c) return;
    const mt = filteredManualTrades();
    const s = computeStats(mt);
    if (!mt.length) {
        const { ctx, w, h } = setupCanvas("equityCanvas");
        drawEmpty(ctx, w, h);
        return;
    }
    const sortedMt = [...mt].sort((a, b) => tradeDisplayDate(a) - tradeDisplayDate(b));
    const dates = ["Início", ...sortedMt.map((t) => fmtDateShort(t))];
    drawCapitalCurve("equityCanvas", s.capitalEquity, dates, { color: "#b591ff" });
}

function drawDist() {
    const setup = setupCanvas("distCanvas");
    if (!setup || setup.w <= 0 || setup.h <= 0) return;
    const { ctx, w, h } = setup;
    const s = computeStats(filteredManualTrades());
    if (!s.rCount) { drawEmpty(ctx, w, h, s.pendingR ? "R pendente nos trades importados" : s.openCount ? "Nenhum trade fechado ainda" : "Sem dados ainda"); return; }
    const data = [
        { l: "Wins", v: s.wins, c: "#2ddb8a" },
        { l: "Stops", v: s.losses, c: "#ff5d6c" },
        { l: "Empates", v: s.bes, c: "#f5c542" }
    ].filter((d) => d.v > 0);
    const total = data.reduce((a, d) => a + d.v, 0);
    const legendColumns = Math.max(1, Math.min(data.length, Math.floor((w - 20) / 110)));
    const legendRows = Math.ceil(data.length / legendColumns);
    const plotHeight = h - legendRows * 22;
    const cx = w / 2, cy = plotHeight / 2 - 6;
    const radius = Math.min(w, plotHeight) * 0.28;
    let start = -Math.PI / 2;
    data.forEach((d) => {
        const ang = (d.v / total) * Math.PI * 2;
        ctx.beginPath();
        ctx.arc(cx, cy, radius, start, start + ang);
        ctx.lineWidth = radius * 0.42;
        ctx.strokeStyle = d.c;
        ctx.stroke();
        start += ang;
    });
    ctx.fillStyle = "#e8edf7";
    ctx.font = "900 22px Inter, Arial";
    ctx.textAlign = "center";
    ctx.fillText(s.rCount, cx, cy + 6);
    ctx.font = "700 11px Inter, Arial";
    ctx.fillStyle = "#8a98b5";
    ctx.fillText("fechados", cx, cy + 22);

    data.forEach((d, i) => {
        const x = 10 + (i % legendColumns) * ((w - 20) / legendColumns);
        const ly = h - legendRows * 22 + Math.floor(i / legendColumns) * 22 + 5;
        ctx.fillStyle = d.c;
        ctx.fillRect(x, ly, 10, 10);
        ctx.fillStyle = "#8a98b5";
        ctx.font = "700 11px Inter, Arial";
        ctx.textAlign = "left";
        ctx.fillText(`${d.l}: ${d.v}`, x + 14, ly + 9);
    });
}

function tradeChartData(trades, month, selectedDay = null, now = new Date()) {
    const today = localDateTimeValue(now).slice(0, 10);
    const validMonth = /^\d{4}-(0[1-9]|1[0-2])$/.test(month) ? month : today.slice(0, 7);
    const day = selectedDay?.startsWith(`${validMonth}-`) && parseDateTimeLocal(`${selectedDay}T12:00`) ? selectedDay : null;
    const rows = [];
    let invalid = 0;
    trades.forEach((trade) => {
        if (isRobotTrade(trade)) return;
        const local = tradeLocalDateTime(trade);
        if (!local) { invalid++; return; }
        if (!local.startsWith(`${validMonth}-`) || (day && local.slice(0, 10) !== day)) return;
        const pnl = tradeNetPnl(trade);
        if (!Number.isFinite(pnl)) { invalid++; return; }
        rows.push({ trade, local, cents: Math.round(pnl * 100) });
    });
    rows.sort((a, b) => a.local.localeCompare(b.local) || tradeDisplayDate(a.trade) - tradeDisplayDate(b.trade));
    const bars = [], days = new Map(), ordinals = new Map();
    rows.forEach((row) => {
        const date = row.local.slice(0, 10);
        const ordinal = (ordinals.get(date) || 0) + 1;
        ordinals.set(date, ordinal);
        // Consolidation is a view only: the original trades and their civil times stay intact.
        if (!day && date < today) {
            if (!days.has(date)) {
                const bar = { kind: "day", day: date, rows: [] };
                days.set(date, bar);
                bars.push(bar);
            }
            days.get(date).rows.push(row);
        } else bars.push({ kind: "trade", day: date, rows: [row], ordinal });
    });
    const totalCents = (group) => group.reduce((sum, row) => sum + row.cents, 0);
    bars.forEach((bar) => { bar.cents = totalCents(bar.rows); });
    return { bars, rows, month: validMonth, day, today, cents: totalCents(rows), invalid };
}

function chartDayLabel(day) {
    return day.split("-").reverse().join("/");
}

function chartResultLabel(bar) {
    return fmtCurrency(bar.cents / 100);
}

function tradeChartBarClass(bar) {
    const outcomes = bar.rows.map((row) => tradeOutcome(row.trade));
    if (outcomes.every((outcome) => outcome === "be")) return "hour-breakeven";
    if (outcomes.every((outcome) => outcome === "open")) return "hour-open";
    return bar.cents > 0 ? "hour-gain" : bar.cents < 0 ? "hour-loss" : "hour-breakeven";
}

function tradeChartTooltipHtml(bar) {
    const title = bar.kind === "day" ? chartDayLabel(bar.day) : fmtDate(bar.rows[0].trade);
    return `<div class="trade-tooltip-head"><strong>${escapeHtml(title)}</strong><button type="button" class="trade-tooltip-close" data-chart-close aria-label="Fechar detalhes">×</button></div>
        <p class="trade-tooltip-summary">${chartResultLabel(bar)} líquido · ${bar.rows.length} ${bar.rows.length === 1 ? "trade" : "trades"}</p>
        ${bar.rows.map(({ trade, local, cents }) => `<div class="trade-tooltip-trade">
            <div class="trade-tooltip-result"><span>${local.slice(11)} · ${escapeHtml(trade.symbol || "Sem ativo")}</span><strong class="${["be", "open"].includes(tradeOutcome(trade)) ? "" : cents > 0 ? "gain" : cents < 0 ? "loss" : ""}">${fmtCurrency(cents / 100)}</strong></div>
            ${["be", "open"].includes(tradeOutcome(trade)) ? `<div class="trade-tooltip-status">${tradeOutcome(trade) === "be" ? "Empate / 0x0 · taxas incluídas no líquido" : "Em aberto"}</div>` : ""}
            <div class="trade-tooltip-setup">${escapeHtml(trade.setup || "Sem setup")}</div>
            <div class="trade-tooltip-tags">${(trade.tags || []).length ? trade.tags.map((tag) => `<span>${escapeHtml(tag)}</span>`).join("") : "Sem tags"}</div>
            ${(trade.mistakes || []).length ? `<div class="trade-tooltip-mistakes"><strong>Erros / Mistakes</strong><p>${escapeHtml(trade.mistakes.join(", "))}</p></div>` : ""}
        </div>`).join("")}
        ${bar.kind === "day" ? '<button type="button" class="btn trade-tooltip-open" data-chart-open>Abrir trades deste dia →</button>' : ""}`;
}

let tradeChartBars = [];
let tradeTooltipTimer;
let tradeTooltipIndex = null;

function hideTradeChartTooltip() {
    clearTimeout(tradeTooltipTimer);
    const tooltip = $("tradeChartTooltip");
    if (tooltip) tooltip.hidden = true;
    tradeTooltipIndex = null;
}

function positionTradeChartTooltip(x, y) {
    const tooltip = $("tradeChartTooltip");
    const rect = tooltip.getBoundingClientRect();
    tooltip.style.left = `${Math.max(12, Math.min(x + 14, window.innerWidth - rect.width - 12))}px`;
    const top = y + 16 + rect.height <= window.innerHeight - 12 ? y + 16 : y - rect.height - 16;
    tooltip.style.top = `${Math.max(12, Math.min(top, window.innerHeight - rect.height - 12))}px`;
}

function showTradeChartTooltip(group, event) {
    const index = Number(group.dataset.chartIndex);
    const bar = tradeChartBars[index];
    if (!bar) return;
    clearTimeout(tradeTooltipTimer);
    const tooltip = $("tradeChartTooltip");
    if (tradeTooltipIndex !== index || tooltip.hidden) {
        tooltip.innerHTML = tradeChartTooltipHtml(bar);
        tooltip.scrollTop = 0;
    }
    tooltip.hidden = false;
    tradeTooltipIndex = index;
    const rect = group.getBoundingClientRect();
    positionTradeChartTooltip(event?.clientX ?? rect.x + rect.width / 2, event?.clientY ?? rect.y + rect.height / 2);
}

function openTradeChartDay(bar) {
    if (bar?.kind !== "day") return;
    state.chartDay = bar.day;
    drawHour();
    $("hourChart").parentElement.scrollLeft = 0;
    $("tradeChartBack").focus();
}

function bindTradeChartEvents() {
    const chart = $("hourChart"), tooltip = $("tradeChartTooltip");
    if (!chart || !tooltip) return;
    $("tradeChartMonth").addEventListener("change", (event) => {
        if (!/^\d{4}-(0[1-9]|1[0-2])$/.test(event.target.value)) return;
        state.chartMonth = event.target.value;
        state.chartDay = null;
        drawHour();
        chart.parentElement.scrollLeft = 0;
    });
    $("tradeChartBack").addEventListener("click", () => {
        state.chartDay = null;
        drawHour();
        chart.parentElement.scrollLeft = 0;
        $("tradeChartMonth").focus();
    });
    const groupOf = (event) => event.target.closest?.("[data-chart-index]");
    const queueHide = () => { clearTimeout(tradeTooltipTimer); tradeTooltipTimer = setTimeout(hideTradeChartTooltip, 180); };
    chart.addEventListener("pointerover", (event) => {
        const group = groupOf(event);
        if (group && event.pointerType !== "touch") showTradeChartTooltip(group, event);
    });
    chart.addEventListener("pointermove", (event) => {
        if (groupOf(event) && !tooltip.hidden && event.pointerType !== "touch") positionTradeChartTooltip(event.clientX, event.clientY);
    });
    chart.addEventListener("pointerout", (event) => {
        const group = groupOf(event);
        if (group && !group.contains(event.relatedTarget)) queueHide();
    });
    chart.addEventListener("focusin", (event) => { const group = groupOf(event); if (group) showTradeChartTooltip(group); });
    chart.addEventListener("focusout", (event) => { if (!tooltip.contains(event.relatedTarget)) queueHide(); });
    chart.addEventListener("click", (event) => {
        const group = groupOf(event);
        if (!group) return;
        const bar = tradeChartBars[Number(group.dataset.chartIndex)];
        if (bar?.kind === "day") openTradeChartDay(bar);
        else showTradeChartTooltip(group);
    });
    chart.addEventListener("keydown", (event) => {
        const group = groupOf(event);
        if (group && (event.key === "Enter" || event.key === " ")) { event.preventDefault(); group.dispatchEvent(new MouseEvent("click", { bubbles: true })); }
    });
    tooltip.addEventListener("pointerenter", () => clearTimeout(tradeTooltipTimer));
    tooltip.addEventListener("pointerleave", queueHide);
    tooltip.addEventListener("focusin", () => clearTimeout(tradeTooltipTimer));
    tooltip.addEventListener("focusout", (event) => { if (!tooltip.contains(event.relatedTarget)) queueHide(); });
    tooltip.addEventListener("click", (event) => {
        if (event.target.closest("[data-chart-close]")) hideTradeChartTooltip();
        if (event.target.closest("[data-chart-open]")) openTradeChartDay(tradeChartBars[tradeTooltipIndex]);
    });
    document.addEventListener("keydown", (event) => { if (event.key === "Escape") hideTradeChartTooltip(); });
    document.addEventListener("pointerdown", (event) => { if (!chart.contains(event.target) && !tooltip.contains(event.target)) hideTradeChartTooltip(); });
    chart.parentElement.addEventListener("scroll", hideTradeChartTooltip, { passive: true });
    window.addEventListener("scroll", hideTradeChartTooltip, { passive: true });
    document.addEventListener("visibilitychange", () => { if (!document.hidden && state.view === "stats") drawHour(); });
    // A page left open overnight automatically consolidates yesterday without rewriting data.
    const scheduleMidnight = () => {
        const now = new Date(), next = new Date(now.getFullYear(), now.getMonth(), now.getDate() + 1);
        setTimeout(() => { if (state.view === "stats") drawHour(); scheduleMidnight(); }, next - now + 100);
    };
    scheduleMidnight();
}

function drawHour() {
    const chart = $("hourChart");
    if (!chart) return;
    hideTradeChartTooltip();
    const data = tradeChartData(filteredManualTrades(), state.chartMonth, state.chartDay);
    const { bars, rows, month, day, today, invalid } = data;
    state.chartMonth = month;
    state.chartDay = day;
    tradeChartBars = bars;
    $("tradeChartMonth").value = month;
    $("tradeChartBack").hidden = !day;
    const period = day ? chartDayLabel(day) : new Date(`${month}-01T12:00`).toLocaleDateString("pt-BR", { month: "long", year: "numeric" });
    $("tradeChartPeriod").textContent = `${period} · ${rows.length} ${rows.length === 1 ? "trade" : "trades"}${rows.length ? ` · ${chartResultLabel(data)}` : ""}`;
    const maxAbs = bars.reduce((max, bar) => Math.max(max, Math.abs(bar.cents)), 100);
    const step = niceStep(maxAbs / 2), limit = Math.ceil(maxAbs / step) * step;
    const axisValues = [-limit, -limit / 2, 0, limit / 2, limit];
    const pad = { t: 30, r: 18, b: 53, l: Math.max(88, ...axisValues.map((value) => fmtCurrency(value / 100).length * 6 + 18)) };
    const columnWidth = bars.reduce((width, bar) => Math.max(width, chartResultLabel(bar).length * 6.5 + 20), 104);
    const minWidth = bars.length ? Math.max(280, bars.length * columnWidth + pad.l + pad.r) : 0;
    const w = Math.max(280, minWidth, chart.parentElement.clientWidth), h = 310;
    chart.style.minWidth = `${minWidth}px`;
    chart.setAttribute("viewBox", `0 0 ${w} ${h}`);
    const notes = [day ? "Uma barra por trade, em R$ líquidos após taxas. Passe o mouse ou toque para ver setup, tags e Mistakes." : "Hoje: uma barra por trade. Dias anteriores: saldo líquido do dia em R$; clique para abrir os trades. Valores após taxas.", "Empates são neutros; suas taxas aparecem no líquido."];
    if (invalid) notes.push(`${invalid} trade(s) com data ou valor financeiro inválido não incluído(s).`);
    if (minWidth > chart.parentElement.clientWidth) notes.push("Deslize para ver todas as barras.");
    $("hourHint").textContent = notes.join(" ");
    if (!bars.length) {
        const empty = day ? "Sem trades neste dia" : "Sem trades neste mês";
        chart.setAttribute("aria-label", empty);
        chart.innerHTML = `<text class="hour-empty" x="${w / 2}" y="${h / 2}" text-anchor="middle">${empty}</text>`;
        return;
    }
    const half = (h - pad.t - pad.b) / 2, zero = pad.t + half;
    const groupWidth = (w - pad.l - pad.r) / bars.length, barWidth = Math.min(40, groupWidth * .48);
    let html = "";
    for (const value of axisValues) {
        const y = zero - value / limit * half;
        html += `<line class="${value === 0 ? "hour-zero" : "hour-grid"}" x1="${pad.l}" x2="${w - pad.r}" y1="${y}" y2="${y}"/><text class="hour-axis" x="${pad.l - 10}" y="${y + 4}" text-anchor="end">${fmtCurrency(value / 100)}</text>`;
    }
    const descriptions = [];
    bars.forEach((bar, index) => {
        const center = pad.l + (index + .5) * groupWidth, cents = bar.cents;
        const local = bar.rows[0].local;
        const label = bar.kind === "day" ? chartDayLabel(bar.day).slice(0, 5) : local.slice(11);
        const sublabel = bar.kind === "day" ? `${bar.rows.length} ${bar.rows.length === 1 ? "trade" : "trades"} ↗` : `${day ? "" : bar.day === today ? "Hoje · " : `${chartDayLabel(bar.day).slice(0, 5)} · `}#${bar.ordinal}`;
        const details = bar.kind === "day" ? "Clique para ver os trades." : `${bar.rows[0].trade.setup || "Sem setup"}. Tags: ${(bar.rows[0].trade.tags || []).join(", ") || "Sem tags"}.${(bar.rows[0].trade.mistakes || []).length ? ` Mistakes: ${bar.rows[0].trade.mistakes.join(", ")}.` : ""}`;
        const description = `${bar.kind === "day" ? chartDayLabel(bar.day) : fmtDate(bar.rows[0].trade)}: ${chartResultLabel(bar)}. ${details}`;
        descriptions.push(description);
        const barClass = tradeChartBarClass(bar);
        const color = barClass === "hour-gain" ? "gain" : barClass === "hour-loss" ? "loss" : "neutral";
        const height = cents ? Math.max(3, Math.abs(cents) / limit * half) : 5;
        const y = cents > 0 ? zero - height : cents < 0 ? zero : zero - height / 2;
        const valueY = cents < 0 ? zero + height + 16 : y - 9;
        html += `<g class="hour-group" data-chart-index="${index}" data-chart-kind="${bar.kind}" data-chart-day="${bar.day}" tabindex="0" role="button" aria-label="${escapeHtml(description)}" aria-describedby="tradeChartTooltip">
            <rect class="hour-hit" x="${center - groupWidth / 2 + 2}" y="${pad.t - 20}" width="${groupWidth - 4}" height="${h - pad.t + 20}"/>
            <rect class="hour-bar ${barClass}" x="${center - barWidth / 2}" y="${y}" width="${barWidth}" height="${height}" rx="2"/>
            <text class="hour-value hour-${color}-text" x="${center}" y="${valueY}" text-anchor="middle">${chartResultLabel(bar)}</text>
            <text class="hour-label" x="${center}" y="${h - 23}" text-anchor="middle">${label}</text><text class="hour-count" x="${center}" y="${h - 7}" text-anchor="middle">${sublabel}</text></g>`;
    });
    chart.innerHTML = html;
    chart.setAttribute("aria-label", `Resultados líquidos em reais, após taxas. ${descriptions.join(" ")}`);
}

function drawEmpty(ctx, w, h, text = "Sem dados ainda") {
    ctx.fillStyle = "#5a6a8a";
    ctx.font = "700 13px Inter, Arial";
    ctx.textAlign = "center";
    ctx.fillText(text, w / 2, h / 2);
}

function renderRecent() {
    const trades = [...filteredManualTrades()].sort((a, b) => tradeDisplayDate(b) - tradeDisplayDate(a));
    if (!trades.length) {
        $("recentTrades").innerHTML = `<div class="empty"><div class="empty-ico">∅</div>Nenhum trade ainda. Clique em <strong>+ Novo Trade</strong>.</div>`;
        return;
    }
    $("recentTrades").innerHTML = `<table>
        <thead><tr><th>Data</th><th>Ativo</th><th>Lado</th><th>Setup</th><th class="right">R</th><th class="right">Fees</th><th class="right">P&L liq.</th><th class="right">Ação</th></tr></thead>
        <tbody>${trades.map((t) => `
            <tr>
                <td class="muted">${fmtDate(t)}</td>
                <td><strong>${escapeHtml(t.symbol)}</strong></td>
                <td><span class="pill ${t.side}">${t.side === "long" ? "Long" : "Short"}</span></td>
                <td class="muted">${escapeHtml(t.setup || "-")}${tradeAttachmentButton(t)}</td>
                <td class="right">${renderRBadge(t)}</td>
                <td class="right muted">${fmtCurrency(tradeFees(t))}</td>
                <td class="right"><strong style="color:${tradeNetPnl(t) > 0 ? "var(--green)" : tradeNetPnl(t) < 0 ? "var(--red)" : "var(--muted)"}">${fmtCurrency(tradeNetPnl(t))}</strong></td>
                <td class="right"><button class="btn btn-ghost btn-mini" data-recent-edit="${escapeHtml(t.id)}" type="button">Editar</button></td>
            </tr>
        `).join("")}</tbody></table>`;
    $("recentTrades").querySelectorAll("[data-recent-edit]").forEach((button) => {
        button.addEventListener("click", () => openModal(state.trades.find((t) => t.id === button.dataset.recentEdit)));
    });
}

function renderTrades() {
    const text = $("filterText").value.trim().toLowerCase();
    const side = $("filterSide").value;
    const result = $("filterResult").value;
    const base = filteredManualTrades();
    const filtered = base.filter((t) => {
        if (side && t.side !== side) return false;
        if (result && tradeOutcome(t) !== result) return false;
        if (text) {
            const blob = `${t.symbol} ${t.setup} ${t.notes} ${(t.tags || []).join(" ")} ${(t.mistakes || []).join(" ")}`.toLowerCase();
            if (!blob.includes(text)) return false;
        }
        return true;
    }).sort((a, b) => tradeDisplayDate(b) - tradeDisplayDate(a));

    $("filterCount").textContent = `${filtered.length} de ${base.length}`;

    if (!filtered.length) {
        $("tradesTable").innerHTML = `<div class="empty"><div class="empty-ico">∅</div>Nenhum trade encontrado.</div>`;
        return;
    }

    $("tradesTable").innerHTML = `<table>
        <thead><tr>
            <th>Data</th><th>Ativo</th><th>Lado</th><th>Setup</th><th>Tags</th>
            <th class="right">R</th><th class="right">Fees</th><th class="right">P&L liq.</th><th></th>
        </tr></thead>
        <tbody>${filtered.map((t) => `
            <tr>
                <td class="muted">${fmtDate(t)}</td>
                <td><strong>${escapeHtml(t.symbol)}</strong></td>
                <td><span class="pill ${t.side}">${t.side === "long" ? "Long" : "Short"}</span></td>
                <td class="muted">${escapeHtml(t.setup || "-")}${tradeAttachmentButton(t)}</td>
                <td>${(t.tags || []).slice(0, 3).map((tg) => `<span class="tag">${escapeHtml(tg)}</span>`).join("")}</td>
                <td class="right">${renderRBadge(t)}</td>
                <td class="right muted">${fmtCurrency(tradeFees(t))}</td>
                <td class="right" style="color:${tradeNetPnl(t) > 0 ? "var(--green)" : tradeNetPnl(t) < 0 ? "var(--red)" : "var(--muted)"}">${fmtCurrency(tradeNetPnl(t))}</td>
                <td class="right">
                    <button class="btn btn-ghost" data-edit="${t.id}" type="button" title="Editar trade" aria-label="Editar trade">✎</button>
                    <button class="btn btn-danger" data-del="${t.id}" type="button" title="Excluir trade" aria-label="Excluir trade">×</button>
                </td>
            </tr>
        `).join("")}</tbody></table>`;

    $("tradesTable").querySelectorAll("[data-edit]").forEach((b) => {
        b.addEventListener("click", () => openModal(state.trades.find((t) => t.id === b.dataset.edit)));
    });
    $("tradesTable").querySelectorAll("[data-del]").forEach((b) => {
        b.addEventListener("click", () => deleteTrade(b.dataset.del));
    });
}

function calendarResults(trades, month, now = new Date()) {
    const start7 = new Date(now.getFullYear(), now.getMonth(), now.getDate() - 6);
    const start30 = new Date(now.getFullYear(), now.getMonth(), now.getDate() - 29);
    const end = new Date(now.getFullYear(), now.getMonth(), now.getDate() + 1);
    const dayMap = {};
    let cents7 = 0, cents30 = 0, futureCount = 0;
    trades.forEach((trade) => {
        if (isRobotTrade(trade)) return;
        const date = tradeDisplayDate(trade);
        const pnl = tradeNetPnl(trade);
        if (!Number.isFinite(date.getTime()) || !Number.isFinite(pnl)) return;
        const cents = Math.round(pnl * 100);
        if (date < end) {
            if (date >= start7) cents7 += cents;
            if (date >= start30) cents30 += cents;
        } else futureCount++;
        if (date.getFullYear() !== month.getFullYear() || date.getMonth() !== month.getMonth()) return;
        const day = date.getDate();
        if (!dayMap[day]) dayMap[day] = { cents: 0, count: 0 };
        dayMap[day].cents += cents;
        dayMap[day].count++;
    });
    return { dayMap, last7: cents7 / 100, last30: cents30 / 100, start7, start30, now, futureCount };
}

function renderCalendar() {
    const month = state.calMonth;
    $("calLabel").textContent = month.toLocaleDateString("pt-BR", { month: "long", year: "numeric" });
    const first = new Date(month.getFullYear(), month.getMonth(), 1);
    const last = new Date(month.getFullYear(), month.getMonth() + 1, 0);
    const startDow = first.getDay();
    const days = last.getDate();

    const results = calendarResults(filteredManualTrades(), month);
    const { dayMap } = results;
    const allVals = Object.values(dayMap).map((day) => day.cents / 100);
    const maxAbs = Math.max(0.01, ...allVals.map(Math.abs));
    for (const [id, value, start, rangeId] of [
        ["calLast7", results.last7, results.start7, "calRange7"],
        ["calLast30", results.last30, results.start30, "calRange30"]
    ]) {
        const el = $(id);
        el.textContent = fmtCurrency(value);
        el.className = `cal-period-value ${value > 0 ? "positive" : value < 0 ? "negative" : ""}`;
        el.title = `${start.toLocaleDateString("pt-BR")} a ${results.now.toLocaleDateString("pt-BR")} · líquido após taxas`;
        const shortDate = (date) => date.toLocaleDateString("pt-BR", { day: "2-digit", month: "2-digit" });
        $(rangeId).textContent = `${shortDate(start)} a ${shortDate(results.now)}`;
    }
    $("calFutureNotice").hidden = !results.futureCount;
    $("calFutureNotice").textContent = results.futureCount
        ? `${results.futureCount} ${results.futureCount === 1 ? "trade com data futura não entra" : "trades com data futura não entram"} nesses totais. Confira Data e hora em Operações → Editar.`
        : "";

    let html = "";
    for (let i = 0; i < startDow; i++) html += `<div class="cal-cell empty"></div>`;
    for (let d = 1; d <= days; d++) {
        const entry = dayMap[d];
        const v = entry ? entry.cents / 100 : undefined;
        let cls = "";
        if (v !== undefined) {
            const ratio = Math.abs(v) / maxAbs;
            const intensity = ratio > 0.66 ? 3 : ratio > 0.33 ? 2 : 1;
            cls = v > 0 ? `win-${intensity}` : v < 0 ? `loss-${intensity}` : "";
        }
        const dateLabel = new Date(month.getFullYear(), month.getMonth(), d).toLocaleDateString("pt-BR");
        const isToday = dateLabel === results.now.toLocaleDateString("pt-BR");
        const tip = entry
            ? `${dateLabel}: ${fmtCurrency(v)} líquido · ${entry.count} ${entry.count === 1 ? "trade" : "trades"}`
            : `${dateLabel}: sem operações`;
        html += `<div class="cal-cell ${cls}${isToday ? " today" : ""}"${isToday ? ' aria-current="date"' : ""} title="${tip}" aria-label="${tip}"><span class="cal-day">${isToday ? '<span class="cal-today-label">Hoje</span>' : ""}${d}</span><span class="cal-pnl">${entry ? fmtCurrency(v) : "—"}</span></div>`;
    }
    $("calendarGrid").innerHTML = html;

    const monthTotal = allVals.reduce((a, b) => a + b, 0);
    $("calMonthSummary").textContent = allVals.length
        ? `Mês: ${fmtCurrency(monthTotal)} líquido · ${allVals.length} ${allVals.length === 1 ? "dia operado" : "dias operados"}`
        : "Mês sem operações";
}

function renderAdvancedStats() {
    const s = computeStats(filteredManualTrades());
    const items = [
        ["P&L liquido", fmtCurrency(s.pnlTotal)],
        ["Fees/custos", fmtCurrency(s.feesTotal)],
        ["Trades com R", s.rCount],
        ["R pendente", s.pendingR],
        ["Profit factor", s.pf === Infinity ? "∞" : s.pf.toFixed(2)],
        ["Expectancy (R)", s.expectancy.toFixed(2)],
        ["Avg win", fmtR(s.avgWin)],
        ["Avg loss", fmtR(s.avgLoss)],
        ["Largest win", fmtR(s.largestWin)],
        ["Largest loss", fmtR(s.largestLoss)],
        ["Max drawdown", fmtR(-s.maxDD)],
        ["Best win streak", `${s.bestWinStreak}`],
        ["Worst loss streak", `${s.bestLossStreak}`],
        ["Total trades", s.total],
        ["Wins", s.wins],
        ["Stops", s.losses],
        ["Empates", s.bes],
        ["Em aberto", s.openCount]
    ];
    if (!s.rCount) {
        items[4] = ["Profit factor", "pendente"];
        items[5] = ["Expectancy (R)", "pendente"];
        items[6] = ["Avg win", "pendente"];
        items[7] = ["Avg loss", "pendente"];
        items[8] = ["Largest win", "pendente"];
        items[9] = ["Largest loss", "pendente"];
        items[10] = ["Max drawdown", "pendente"];
    }
    $("advancedStats").innerHTML = items.map(([l, v]) => `
        <div class="metric-row">
            <span class="muted">${l}</span>
            <strong>${v}</strong>
        </div>
    `).join("");
}

function renderTagStats() {
    const tagAgg = {};
    filteredManualTrades().forEach((t) => {
        if (["open", "pending"].includes(tradeOutcome(t))) return;
        (t.tags || []).forEach((tag) => {
            tagAgg[tag] = tagAgg[tag] || { count: 0, r: 0, wins: 0 };
            tagAgg[tag].count++;
            tagAgg[tag].r += tradeRValue(t);
            if (tradeRValue(t) > 0) tagAgg[tag].wins++;
        });
    });
    const arr = Object.entries(tagAgg).sort((a, b) => b[1].count - a[1].count);
    if (!arr.length) {
        $("tagStats").innerHTML = `<div class="empty muted">Sem tags ainda. Adicione tags no formulário de trade.</div>`;
        return;
    }
    const max = Math.max(...arr.map(([, v]) => v.count));
    $("tagStats").innerHTML = arr.map(([tag, v]) => `
        <div class="bar-row">
            <span class="lbl">${escapeHtml(tag)}</span>
            <div class="bar"><div class="bar-fill" style="width:${(v.count / max) * 100}%"></div></div>
            <span class="val">${v.count} · ${fmtR(v.r)}</span>
        </div>
    `).join("");
}

function renderStreaks() {
    const s = computeStats(filteredManualTrades());
    $("streaksBox").innerHTML = `
        <div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(160px,1fr));gap:12px">
            <div class="kpi-card win"><div class="label">Maior sequência verde</div><div class="value">${s.bestWinStreak}</div></div>
            <div class="kpi-card loss"><div class="label">Maior sequência vermelha</div><div class="value">${s.bestLossStreak}</div></div>
            <div class="kpi-card neutral"><div class="label">Sequência atual</div><div class="value">${s.currentStreak}</div><div class="meta">${s.currentStreakDir > 0 ? "🟢 wins seguidos" : s.currentStreakDir < 0 ? "🔴 stops seguidos" : "—"}</div></div>
        </div>
    `;
}

function renderJournal() {
    const trades = [...filteredManualTrades()]
        .filter((t) => t.notes || (t.mistakes || []).length || t.attachment?.path)
        .sort((a, b) => tradeDisplayDate(b) - tradeDisplayDate(a))
        .slice(0, 30);
    if (!trades.length) {
        $("journalList").innerHTML = `<div class="empty"><div class="empty-ico">📝</div>Nenhuma anotação ou imagem ainda.</div>`;
        return;
    }
    $("journalList").innerHTML = trades.map((t) => `
        <div style="padding:14px 18px;border-bottom:1px solid var(--line-soft)">
            <div style="display:flex;align-items:center;gap:10px;flex-wrap:wrap;margin-bottom:6px">
                <strong>${escapeHtml(t.symbol)}</strong>
                <span class="pill ${t.side}">${t.side}</span>
                ${renderRBadge(t)}
                ${tradeAttachmentButton(t)}
                <span class="muted">Fees ${fmtCurrency(tradeFees(t))} | P&L liq. ${fmtCurrency(tradeNetPnl(t))}</span>
                <span class="muted" style="margin-left:auto;font-size:0.78rem">${fmtDate(t)}</span>
            </div>
            ${(t.mistakes || []).length ? `<div style="margin:6px 0">${t.mistakes.map((m) => `<span class="tag" style="background:var(--red-soft);color:var(--red);border-color:rgba(255,93,108,0.32)">${escapeHtml(m)}</span>`).join("")}</div>` : ""}
            ${(t.tags || []).length ? `<div style="margin:6px 0">${t.tags.map((tg) => `<span class="tag">${escapeHtml(tg)}</span>`).join("")}</div>` : ""}
            ${t.notes ? `<p class="muted" style="margin:6px 0 0;white-space:pre-wrap">${escapeHtml(t.notes)}</p>` : ""}
        </div>
    `).join("");
}

function renderAll() {
    renderAssetFilters();
    if (state.view === "backtests") Backtests.render();
    if (state.view === "dashboard") {
        renderKPIs();
        requestAnimationFrame(() => { drawEquity(); drawDist(); });
        renderRecent();
    } else if (state.view === "trades") {
        renderTrades();
    } else if (state.view === "calendar") {
        renderCalendar();
    } else if (state.view === "stats") {
        renderAdvancedStats();
        renderTagStats();
        renderStreaks();
        requestAnimationFrame(drawHour);
    } else if (state.view === "journal") {
        renderJournal();
    } else if (state.view === "fees") {
        renderFees();
    } else if (state.view === "robot") {
        renderRobot();
    }
}

function renderFees() {
    $("fFeeCripto").value = state.fees.cripto || "";
    $("fFeeWin").value = state.fees.win || "";
    $("fFeeWdo").value = state.fees.wdo || "";
    const totalFees = state.trades.reduce((a, t) => a + tradeFees(t), 0);
    const byCat = { cripto: 0, win: 0, wdo: 0, none: 0 };
    state.trades.forEach((t) => {
        const cat = classifySymbol(t.symbol) || "none";
        byCat[cat] += tradeFees(t);
    });
    $("feesSummary").innerHTML = `
        Total acumulado em fees: <strong>${fmtCurrency(totalFees)}</strong>
        · Cripto: ${fmtCurrency(byCat.cripto)}
        · WIN: ${fmtCurrency(byCat.win)}
        · WDO: ${fmtCurrency(byCat.wdo)}
        ${byCat.none ? `· Sem categoria: ${fmtCurrency(byCat.none)}` : ""}
    `;
}

function escapeHtml(v) {
    return String(v ?? "")
        .replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;")
        .replace(/"/g, "&quot;").replace(/'/g, "&#039;");
}

function exportJSON() {
    const blob = new Blob([JSON.stringify(state.trades, null, 2)], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `diario-pro-${new Date().toISOString().slice(0, 10)}.json`;
    a.click();
    URL.revokeObjectURL(url);
    toast("Exportado");
}

function importFile(file) {
    const name = (file.name || "").toLowerCase();
    if (name.endsWith(".json")) {
        importJSON(file);
        return;
    }

    const reader = new FileReader();
    reader.onload = () => {
        const text = decodeImportBuffer(reader.result);
        const trimmed = text.trim();
        if (trimmed.startsWith("[") || trimmed.startsWith("{")) {
            importJSONText(trimmed);
            return;
        }
        importBrokerCSVText(text);
    };
    reader.readAsArrayBuffer(file);
}

function decodeImportBuffer(buffer) {
    const utf8 = new TextDecoder("utf-8").decode(buffer);
    if (!utf8.includes("\uFFFD")) return utf8;
    return new TextDecoder("windows-1252").decode(buffer);
}

function importJSONText(text) {
    try {
        const data = JSON.parse(text);
        if (!Array.isArray(data)) throw new Error("Formato invalido");
        if (!confirm(`Importar ${data.length} trades? Isso substitui os atuais.`)) return;
        state.trades = data;
        saveTrades();
        toast(`${data.length} trades importados`);
        renderAll();
    } catch (e) {
        alert(`Erro ao importar: ${e.message}`);
    }
}

function promptImportBroker(tradesCount) {
    return new Promise(resolve => {
        $("modalImportTitle").textContent = "Confirmar importação";
        $("modalImportDesc").textContent = `Foram encontrados ${tradesCount} trades no CSV da corretora. Eles serão adicionados ao histórico atual.`;
        $("modalImportConfirm").classList.add("open");
        
        $("btnImportConfirmCancel").onclick = () => {
            $("modalImportConfirm").classList.remove("open");
            resolve(null);
        };
        
        $("btnImportConfirmOk").onclick = () => {
            const dedup = $("cbDedupImport").checked;
            $("modalImportConfirm").classList.remove("open");
            resolve(dedup);
        };
    });
}

async function importBrokerCSVText(text) {
    try {
        const trades = parseBrokerCSV(text);
        if (!trades.length) throw new Error("Nenhum trade encontrado");
        
        const dedup = await promptImportBroker(trades.length);
        if (dedup === null) return;
        
        let tradesToAdd = trades;
        if (dedup) {
            tradesToAdd = trades.filter(t => {
                return !state.trades.some(existing => 
                    existing.date === t.date &&
                    existing.symbol === t.symbol &&
                    existing.side === t.side
                );
            });
            if (!tradesToAdd.length) {
                toast("Nenhum trade novo após remover duplicados.");
                return;
            }
        }

        state.trades = [...state.trades, ...tradesToAdd];
        saveTrades();
        renderAll();
        const sync = await syncImportedTradesCloud(tradesToAdd);
        if (!sync.ok) {
            alert(`Trades importados localmente, mas falha ao sincronizar na nuvem: ${sync.message}`);
            toast(`${tradesToAdd.length} trades importados localmente`);
            return;
        }
        toast(sync.synced ? `${tradesToAdd.length} trades importados e sincronizados` : `${tradesToAdd.length} trades da corretora importados`);
    } catch (e) {
        alert(`Erro ao importar CSV: ${e.message}`);
    }
}

async function syncImportedTradesCloud(trades) {
    if (!canUseCloud()) return { ok: true, synced: false };
    cloudBusy = true;
    updateCloudUi();
    try {
        const results = await Promise.all(trades.map((trade) => upsertTradeCloud(trade)));
        const failed = results.find((result) => !result.ok);
        if (failed) return { ok: false, synced: true, message: failed.message };
        return { ok: true, synced: true };
    } catch (err) {
        return { ok: false, synced: true, message: err.message || String(err) };
    } finally {
        cloudBusy = false;
        updateCloudUi();
    }
}

function splitCsvLine(line) {
    const cells = [];
    let current = "";
    let quoted = false;
    for (let i = 0; i < line.length; i++) {
        const ch = line[i];
        if (ch === "\"") {
            if (quoted && line[i + 1] === "\"") {
                current += "\"";
                i++;
            } else {
                quoted = !quoted;
            }
        } else if (ch === ";" && !quoted) {
            cells.push(current.trim());
            current = "";
        } else {
            current += ch;
        }
    }
    cells.push(current.trim());
    return cells;
}

function normalizeCsvHeader(value) {
    return String(value ?? "")
        .toLowerCase()
        .normalize("NFD")
        .replace(/[\u0300-\u036f]/g, "")
        .replace(/\uFFFD/g, "")
        .replace(/[^a-z0-9%]+/g, " ")
        .trim();
}

function findHeaderIndex(headers, matcher) {
    return headers.findIndex((header) => matcher(normalizeCsvHeader(header)));
}

function parseBrokerNumber(value) {
    const raw = String(value ?? "").trim();
    if (!raw || raw === "-") return 0;
    const cleaned = raw.replace(/\s/g, "").replace(/[^\d,.\-]/g, "");
    if (!cleaned || cleaned === "-") return 0;
    const normalized = cleaned.includes(",")
        ? cleaned.replace(/\./g, "").replace(",", ".")
        : cleaned;
    const parsed = Number(normalized);
    return Number.isFinite(parsed) ? parsed : 0;
}

function parseBrokerDate(value) {
    const match = String(value ?? "").match(/^(\d{2})\/(\d{2})\/(\d{4})(?:\s+(\d{2}):(\d{2})(?::(\d{2}))?)?/);
    if (!match) return new Date().toISOString();
    const [, day, month, year, hour = "0", minute = "0", second = "0"] = match;
    const date = new Date(Number(year), Number(month) - 1, Number(day), Number(hour), Number(minute), Number(second));
    return Number.isNaN(date.getTime()) ? new Date().toISOString() : date.toISOString();
}

function parseBrokerCSV(text) {
    const lines = text.replace(/^\uFEFF/, "").split(/\r?\n/).map((line) => line.trim()).filter(Boolean);
    const headerLine = lines.findIndex((line) => normalizeCsvHeader(splitCsvLine(line)[0]) === "ativo");
    if (headerLine < 0) throw new Error("Cabecalho 'Ativo' nao encontrado");

    const headers = splitCsvLine(lines[headerLine]);
    const idx = {
        symbol: findHeaderIndex(headers, (h) => h === "ativo"),
        opened: findHeaderIndex(headers, (h) => h === "abertura"),
        side: findHeaderIndex(headers, (h) => h === "lado"),
        qtyBuy: findHeaderIndex(headers, (h) => h.includes("qtd") && h.includes("compra")),
        qtySell: findHeaderIndex(headers, (h) => h.includes("qtd") && h.includes("venda")),
        buyPrice: findHeaderIndex(headers, (h) => h.includes("pre") && h.includes("compra")),
        sellPrice: findHeaderIndex(headers, (h) => h.includes("pre") && h.includes("venda")),
        pnl: findHeaderIndex(headers, (h) => h.includes("res") && h.includes("opera") && !h.includes("%"))
    };
    const required = ["symbol", "opened", "side", "buyPrice", "sellPrice", "pnl"];
    const missing = required.filter((key) => idx[key] < 0);
    if (missing.length) throw new Error(`Colunas obrigatorias ausentes: ${missing.join(", ")}`);

    const cell = (row, index) => index >= 0 ? row[index] || "" : "";
    return lines.slice(headerLine + 1).map((line) => {
        const row = splitCsvLine(line);
        const symbol = cell(row, idx.symbol).trim().toUpperCase();
        if (!symbol) return null;

        const sideRaw = cell(row, idx.side).trim().toUpperCase();
        const side = sideRaw.startsWith("V") ? "short" : "long";
        const qtyBuy = parseBrokerNumber(cell(row, idx.qtyBuy));
        const qtySell = parseBrokerNumber(cell(row, idx.qtySell));
        const qty = side === "long" ? (qtyBuy || qtySell) : (qtySell || qtyBuy);
        const buyPrice = parseBrokerNumber(cell(row, idx.buyPrice));
        const sellPrice = parseBrokerNumber(cell(row, idx.sellPrice));
        const entry = side === "long" ? buyPrice : sellPrice;
        const exit = side === "long" ? sellPrice : buyPrice;
        const cat = classifySymbol(symbol);
        const brokerPnl = parseBrokerNumber(cell(row, idx.pnl));

        return {
            id: uid(),
            date: parseBrokerDate(cell(row, idx.opened)),
            symbol,
            side,
            r: null,
            rPending: true,
            entry,
            stop: "",
            exit,
            qty,
            initQty: qty,
            partials: [],
            riskMoney: 0,
            fees: 0,
            pnl: brokerPnl,
            brokerPnl,
            setup: "",
            tags: [],
            mistakes: [],
            notes: `Importado da corretora. P&L bruto ${fmtCurrency(brokerPnl)}; taxa auto aplicada conforme config (${cat || "sem categoria"}). Preencha stop/risco para calcular o R.`,
            source: "broker_csv",
            pnlLocked: true,
            createdAt: new Date().toISOString()
        };
    }).filter(Boolean);
}

function importJSON(file) {
    const reader = new FileReader();
    reader.onload = () => {
        try {
            const data = JSON.parse(reader.result);
            if (!Array.isArray(data)) throw new Error("Formato inválido");
            if (!confirm(`Importar ${data.length} trades? Isso substitui os atuais.`)) return;
            state.trades = data;
            saveTrades();
            toast(`${data.length} trades importados`);
            renderAll();
        } catch (e) {
            alert(`Erro ao importar: ${e.message}`);
        }
    };
    reader.readAsText(file);
}

let toastTimer;
function toast(msg) {
    const el = $("toast");
    el.textContent = msg;
    el.classList.add("show");
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => el.classList.remove("show"), 2200);
}

function bindEvents() {
    bindAttachmentViewer();
    bindTradeChartEvents();
    bindAssetFilters();
    $("btnAddTrade").addEventListener("click", () => openModal());
    $("modalClose").addEventListener("click", closeModal);
    $("btnCancel").addEventListener("click", closeModal);
    $("btnSave").addEventListener("click", saveFromForm);
    $("fAttachment").addEventListener("change", () => {
        if (!state.editAttachment) state.editAttachment = { existing: null, removeExisting: false, previewUrl: null };
        renderAttachmentPreview();
    });
    $("btnRemoveAttachment").addEventListener("click", () => {
        const hadSelection = Boolean($("fAttachment").files[0]);
        $("fAttachment").value = "";
        if (!state.editAttachment) return;
        if (!hadSelection && state.editAttachment.existing) state.editAttachment.removeExisting = true;
        renderAttachmentPreview();
    });

    $("btnSaveFees").addEventListener("click", async () => {
        state.fees = {
            cripto: Number($("fFeeCripto").value || 0),
            win: Number($("fFeeWin").value || 0),
            wdo: Number($("fFeeWdo").value || 0)
        };
        persistFees();
        if (canUseCloud()) {
            const result = await saveCloudSettings();
            toast(result.ok ? "Taxas salvas · sincronizado" : `Salvo local. Nuvem falhou: ${result.message}`);
        } else {
            toast("Taxas salvas (local)");
        }
        renderAll();
    });

    $("btnRobotSaveCfg").addEventListener("click", async () => {
        state.robot = {
            magic: Number($("fRobotMagic").value || 0),
            symbol: String($("fRobotSymbol").value || "").trim().toUpperCase()
        };
        persistRobotConfig();
        if (canUseCloud()) {
            const result = await saveCloudSettings();
            toast(result.ok ? "Config robô salva · sincronizado" : `Salvo local. Nuvem falhou: ${result.message}`);
        } else {
            toast("Config robô salva (local)");
        }
        renderAll();
    });

    $("btnRobotImport").addEventListener("click", async () => {
        state.robot = {
            magic: Number($("fRobotMagic").value || 0),
            symbol: String($("fRobotSymbol").value || "").trim().toUpperCase()
        };
        persistRobotConfig();
        const file = $("fRobotFile").files[0];
        if (!file) { toast("Escolha o CSV antes de importar"); return; }
        await importRobotFile(file);
    });

    $("btnRobotPurge").addEventListener("click", purgeRobotTrades);
    $("modalBackdrop").addEventListener("click", (e) => {
        if (e.target === $("modalBackdrop")) closeModal();
    });

    $("btnAddPartial").addEventListener("click", () => {
        if (!state.editPartials) state.editPartials = [];
        state.editPartials.push({ qty: "", r: "" });
        renderPartials();
    });

    ["fInitQty", "fStopMoney", "fTargetMoney", "fManualR"].forEach((id) => {
        $(id).addEventListener("input", recomputeFromInputs);
    });
    $("fStatus").addEventListener("change", recomputeFromInputs);
    $("fSide").addEventListener("change", recomputeFromInputs);

    $("btnExport").addEventListener("click", exportJSON);
    $("btnImport").addEventListener("click", () => $("importFile").click());
    $("importFile").addEventListener("change", (e) => {
        if (e.target.files[0]) importFile(e.target.files[0]);
        e.target.value = "";
    });

    $("filterText").addEventListener("input", renderTrades);
    $("filterSide").addEventListener("change", renderTrades);
    $("filterResult").addEventListener("change", renderTrades);

    $("btnDeleteAllTrades").addEventListener("click", () => {
        const manuals = manualTrades();
        if (!manuals.length) {
            toast("Não há trades manuais para excluir.");
            return;
        }
        if (confirm("Tem certeza que deseja apagar TODOS os trades MANUAIS deste navegador? Trades do robô não serão afetados. O Supabase não será alterado e os trades podem voltar ao atualizar da nuvem.")) {
            queuePendingCloudDeletes(manuals.map((trade) => trade.id));
            state.trades = robotTrades();
            saveTrades();
            renderAll();
            toast("Todos os trades manuais foram removidos localmente. O Supabase não foi alterado.");
        }
    });

    $("calPrev").addEventListener("click", () => {
        state.calMonth = new Date(state.calMonth.getFullYear(), state.calMonth.getMonth() - 1, 1);
        renderCalendar();
    });
    $("calNext").addEventListener("click", () => {
        state.calMonth = new Date(state.calMonth.getFullYear(), state.calMonth.getMonth() + 1, 1);
        renderCalendar();
    });

    document.addEventListener("keydown", (e) => {
        if (e.key === "Escape") closeModal();
        if (e.key === "n" && !e.target.matches("input, textarea, select")) openModal();
    });

    window.addEventListener("resize", () => requestAnimationFrame(renderAll));
}

function canUseCloud() {
    return Boolean(supabaseClient && currentUser && currentSession);
}

function setCloudUi(stateName, label) {
    const dot = $("cloudDot");
    const lbl = $("cloudLabel");
    dot.classList.remove("on", "off", "busy");
    if (stateName) dot.classList.add(stateName);
    lbl.textContent = label;
}

function updateCloudUi() {
    Backtests.authChanged();
    const logged = canUseCloud();
    const hasPendingDeletes = Boolean(state.pendingCloudDeletes?.length);
    $("cloudFormBox").hidden = logged;
    $("btnCloudLogout").hidden = !logged;
    $("btnCloudApplyDeletes").hidden = !logged || !hasPendingDeletes;
    $("btnCloudApplyDeletes").disabled = !logged || cloudBusy || !hasPendingDeletes;
    $("btnCloudReload").hidden = !logged;
    $("btnCloudReload").disabled = !logged || cloudBusy;
    if (cloudBusy) {
        setCloudUi("busy", "Sincronizando...");
        $("cloudHint").textContent = "Aguarde, falando com Supabase.";
    } else if (logged) {
        setCloudUi("on", currentUser.email);
        $("cloudHint").innerHTML = `Login ativo, dados em <code>trades_pro</code>. Compartilhado com Motor SMC.`;
    } else if (!supabaseClient) {
        setCloudUi("off", "Supabase offline");
        $("cloudHint").innerHTML = `Sem conexão. Dados salvos só neste navegador.`;
    } else {
        setCloudUi("off", "Não logado");
        $("cloudHint").innerHTML = `Faça login para sincronizar. Mesmo email/senha do <strong>Motor SMC</strong>.`;
    }
}

async function initCloud() {
    if (!window.supabase || !window.supabase.createClient) {
        setCloudUi("off", "Lib Supabase não carregou");
        return;
    }
    supabaseClient = window.supabase.createClient(SUPABASE_URL, SUPABASE_KEY, {
        auth: { persistSession: true, autoRefreshToken: true, detectSessionInUrl: true }
    });
    try {
        const { data } = await supabaseClient.auth.getSession();
        currentSession = data.session || null;
        currentUser = currentSession?.user || null;
    } catch (err) {
        console.warn("getSession falhou:", err);
    }
    supabaseClient.auth.onAuthStateChange((event, session) => {
        if (event === "INITIAL_SESSION") return;
        currentSession = session || null;
        currentUser = currentSession?.user || null;
        updateCloudUi();
        if (currentUser) {
            loadCloudTrades();
            loadCloudSettings();
        }
    });
    updateCloudUi();
    if (canUseCloud()) {
        await loadCloudTrades();
        await loadCloudSettings();
    }
}

async function signInCloud() {
    if (!supabaseClient) return;
    const email = $("cloudEmail").value.trim();
    const password = $("cloudPassword").value;
    if (!email || !password) { alert("Email e senha obrigatórios."); return; }
    cloudBusy = true;
    updateCloudUi();
    let error = null;
    let data = null;
    try {
        const result = await supabaseClient.auth.signInWithPassword({ email, password });
        data = result.data;
        error = result.error;
    } catch (err) {
        error = err;
    } finally {
        cloudBusy = false;
    }
    if (error) {
        updateCloudUi();
        $("cloudPassword").value = "";
        alert(`Não foi possível entrar: ${error.message || error}`);
        return;
    }
    currentSession = data?.session || null;
    currentUser = currentSession?.user || null;
    updateCloudUi();
    if (canUseCloud()) {
        await loadCloudTrades();
        await loadCloudSettings();
    }
}

async function signOutCloud() {
    if (!supabaseClient) return;
    cloudBusy = true;
    updateCloudUi();
    try {
        await supabaseClient.auth.signOut();
    } catch (err) {
        console.warn("signOut falhou:", err);
    } finally {
        cloudBusy = false;
    }
    currentUser = null;
    currentSession = null;
    updateCloudUi();
    toast("Sessão encerrada");
}

async function loadCloudTrades() {
    if (!canUseCloud()) return;
    if (dateRepairRequested() && (cloudBusy || dateRepairBusy)) return;
    const loadingUserId = currentUser.id;
    cloudBusy = true;
    updateCloudUi();
    let data = null;
    let error = null;
    try {
        const result = await supabaseClient
            .from(SUPABASE_TABLE)
            .select("id,payload,trade_timestamp,created_at")
            .eq("user_id", loadingUserId)
            .order("trade_timestamp", { ascending: true });
        data = result.data;
        error = result.error;
    } catch (err) {
        error = err;
    } finally {
        cloudBusy = false;
    }
    if (currentUser?.id !== loadingUserId) return;
    if (error) {
        updateCloudUi();
        if (dateRepairRequested()) setDateRepairStatus("Não foi possível carregar os trades. Use Atualizar nuvem para tentar a correção novamente.");
        alert(`Falha ao carregar nuvem: ${error.message || error}`);
        return;
    }
    clearPendingCloudDeletes();
    state.trades = (data || []).map((row) => ({ ...(row.payload || {}), id: row.id }));
    saveTrades();
    updateCloudUi();
    renderAll();
    toast(`${state.trades.length} trades sincronizados`);
    if (dateRepairRequested()) await repairRegisteredTradeDates(data || []);
}

function dateRepairRequested() {
    return typeof window !== "undefined"
        && new URLSearchParams(window.location.search).get("corrigir-datas") === DATE_REPAIR_DAY;
}

function setDateRepairStatus(message) {
    const box = $("dateRepairStatus");
    box.hidden = false;
    box.textContent = message;
}

function planRegisteredDateRepair(rows) {
    const formatter = new Intl.DateTimeFormat("en-CA", {
        timeZone: "America/Sao_Paulo", year: "numeric", month: "2-digit", day: "2-digit",
        hour: "2-digit", minute: "2-digit", second: "2-digit", hourCycle: "h23"
    });
    return rows.flatMap((row) => {
        const trade = row.payload || {};
        if (isRobotTrade(trade)) return [];
        const created = trade.createdAt || row.created_at;
        if (created && (!Number.isFinite(new Date(created).getTime()) || new Date(created) > new Date(DATE_REPAIR_CUTOFF))) return [];
        const date = new Date(trade.date);
        if (!Number.isFinite(date.getTime())) return [];
        const parts = Object.fromEntries(formatter.formatToParts(date).map((part) => [part.type, part.value]));
        if (`${parts.year}-${parts.month}-${parts.day}` === DATE_REPAIR_DAY) return [];
        // Only the day is known from the user's instruction; retain the recorded local clock time.
        const milliseconds = String(date.getMilliseconds()).padStart(3, "0");
        const corrected = new Date(`${DATE_REPAIR_DAY}T${parts.hour}:${parts.minute}:${parts.second}.${milliseconds}-03:00`).toISOString();
        return [{
            ...row,
            payload: { ...trade, date: corrected,
                ...(trade.dateLocal ? { dateLocal: `${DATE_REPAIR_DAY}${trade.dateLocal.slice(10)}` } : {}),
                dateCorrection: {
                originalDate: trade.date, targetDay: DATE_REPAIR_DAY,
                timezone: "America/Sao_Paulo", correctedAt: new Date().toISOString()
            } },
            trade_timestamp: corrected
        }];
    });
}

let dateRepairBusy = false;
async function repairRegisteredTradeDates(rows) {
    if (!canUseCloud() || dateRepairBusy) return;
    dateRepairBusy = true;
    const userId = currentUser.id;
    try {
        const changes = planRegisteredDateRepair(rows);
        if (changes.length) {
            setDateRepairStatus(`Corrigindo ${changes.length} trade(s) para 08/10/2026 e sincronizando com Supabase…`);
            const backupKey = `diarioProDateRepair_2026-10-08_${userId}`;
            if (!localStorage.getItem(backupKey)) localStorage.setItem(backupKey, JSON.stringify({
                userId, targetDay: DATE_REPAIR_DAY, savedAt: new Date().toISOString(), rows
            }));
            if (currentUser?.id !== userId) throw new Error("A conta mudou. Abra o link novamente na conta correta.");
            const { error } = await supabaseClient.from(SUPABASE_TABLE).upsert(changes.map((row) => ({
                id: row.id, user_id: userId, payload: row.payload,
                trade_timestamp: row.trade_timestamp, updated_at: new Date().toISOString()
            })));
            if (error) throw error;
            if (currentUser?.id !== userId) throw new Error("A conta mudou durante a sincronização. Entre novamente na conta corrigida.");
            const corrected = new Map(changes.map((row) => [row.id, row.payload]));
            state.trades = state.trades.map((trade) => corrected.has(trade.id) ? { ...corrected.get(trade.id), id: trade.id } : trade);
            saveTrades();
        }
        setDateRepairStatus(changes.length
            ? `${changes.length} trade(s) corrigido(s) para 08/10/2026 e sincronizado(s) com Supabase. Valores e anexos preservados.`
            : "As datas dos trades deste lote já estão em 08/10/2026. Nenhuma alteração necessária.");
        const url = new URL(window.location.href);
        url.searchParams.delete("corrigir-datas");
        window.history.replaceState(null, "", url.href);
        state.calMonth = new Date(2026, 9, 1);
        switchView("calendar");
    } catch (error) {
        setDateRepairStatus(`Correção pendente: ${error.message || error}. Use Atualizar nuvem para tentar novamente.`);
    } finally {
        dateRepairBusy = false;
    }
}

async function upsertTradeCloud(trade) {
    if (!canUseCloud()) return { ok: false, message: "Sem sessão" };
    try {
        const { error } = await supabaseClient
            .from(SUPABASE_TABLE)
            .upsert({
                id: trade.id,
                user_id: currentUser.id,
                payload: trade,
                trade_timestamp: trade.date,
                updated_at: new Date().toISOString()
            });
        if (error) return { ok: false, message: error.message };
        return { ok: true };
    } catch (err) {
        return { ok: false, message: err.message || String(err) };
    }
}

async function loadCloudSettings() {
    if (!canUseCloud()) return;
    try {
        const { data, error } = await supabaseClient
            .from("user_settings")
            .select("payload")
            .eq("user_id", currentUser.id)
            .maybeSingle();
        if (error) { console.warn("loadCloudSettings:", error.message); return; }
        if (data?.payload?.fees) {
            state.fees = { ...FEE_DEFAULTS, ...data.payload.fees };
            persistFees();
        }
        if (data?.payload?.robot) {
            state.robot = { ...ROBOT_DEFAULTS, ...data.payload.robot };
            persistRobotConfig();
        }
        if (state.view === "fees" || state.view === "robot") renderAll();
        else renderAll();
    } catch (err) {
        console.warn("loadCloudSettings exception:", err);
    }
}

async function saveCloudSettings() {
    if (!canUseCloud()) return { ok: false, message: "Sem sessão" };
    try {
        const { error } = await supabaseClient
            .from("user_settings")
            .upsert({
                user_id: currentUser.id,
                payload: { fees: state.fees, robot: state.robot },
                updated_at: new Date().toISOString()
            });
        if (error) return { ok: false, message: error.message };
        return { ok: true };
    } catch (err) {
        return { ok: false, message: err.message || String(err) };
    }
}

async function deleteTradeCloud(id) {
    if (!canUseCloud()) return { ok: false, message: "Sem sessão" };
    try {
        const { data: row } = await supabaseClient
            .from(SUPABASE_TABLE)
            .select("payload")
            .eq("id", id)
            .maybeSingle();
        const { error } = await supabaseClient
            .from(SUPABASE_TABLE)
            .delete()
            .eq("id", id);
        if (error) return { ok: false, message: error.message };
        const removal = await removeTradeAttachment(row?.payload?.attachment);
        if (!removal.ok) console.warn("Trade excluído, mas o anexo não pôde ser removido:", removal.message);
        return { ok: true };
    } catch (err) {
        return { ok: false, message: err.message || String(err) };
    }
}

async function applyPendingCloudDeletes() {
    if (!canUseCloud()) {
        alert("Faça login para aplicar as exclusões no Supabase.");
        return;
    }

    const ids = [...(state.pendingCloudDeletes || [])];
    if (!ids.length) {
        toast("Não há exclusões locais pendentes.");
        return;
    }

    if (!confirm(`Aplicar ${ids.length} exclusão(ões) no Supabase? Esta ação não poderá ser desfeita pela nuvem.`)) return;

    cloudBusy = true;
    updateCloudUi();
    try {
        const results = await Promise.all(ids.map((id) => deleteTradeCloud(id)));
        const failedIds = ids.filter((id, index) => !results[index].ok);
        state.pendingCloudDeletes = failedIds;
        savePendingCloudDeletes();

        if (failedIds.length) {
            const firstFailure = results.find((result) => !result.ok);
            alert(`${failedIds.length} exclusão(ões) falharam. Elas continuam pendentes para nova tentativa.\n\n${firstFailure?.message || "Erro desconhecido"}`);
            return;
        }

        toast(`${ids.length} exclusão(ões) aplicadas no Supabase.`);
    } finally {
        cloudBusy = false;
        updateCloudUi();
    }
}

function bindCloudEvents() {
    $("btnCloudLogin").addEventListener("click", signInCloud);
    $("btnCloudLogout").addEventListener("click", signOutCloud);
    $("btnCloudApplyDeletes").addEventListener("click", applyPendingCloudDeletes);
    $("btnCloudReload").addEventListener("click", async () => {
        if (!canUseCloud()) {
            alert("Faça login para atualizar os dados da nuvem.");
            return;
        }
        await loadCloudTrades();
    });
    $("cloudPassword").addEventListener("keydown", (e) => { if (e.key === "Enter") signInCloud(); });
    $("cloudEmail").addEventListener("keydown", (e) => { if (e.key === "Enter") signInCloud(); });
}

Backtests.init();
state.fees = loadFees();
state.robot = loadRobotConfig();
bindNav();
bindEvents();
bindCloudEvents();
renderAll();
setupChartResize();
if (dateRepairRequested()) setDateRepairStatus("Conecte sua conta do Supabase para corrigir os trades já registrados para 08/10/2026. A correção será aplicada ao carregar os dados.");
initCloud();
