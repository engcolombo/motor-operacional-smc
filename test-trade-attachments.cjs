const fs = require("node:fs");
const vm = require("node:vm");
const assert = require("node:assert/strict");
process.env.TZ = "America/Sao_Paulo";

const core = fs.readFileSync(`${__dirname}/diario-core.js`, "utf8");
const initAt = core.indexOf("\nBacktests.init();");
assert.ok(initAt > 0, "Diário core deve manter a inicialização identificável");

const calls = { uploads: [], removals: [], events: [], saves: [], alerts: [], signedUrls: [] };
let failSave = false, failUpload = false;
let signedResult = () => ({ data: { signedUrl: "https://example.test/private-image?token=private" }, error: null });
const client = {
    storage: {
        from(bucket) {
            assert.equal(bucket, "trade-attachments");
            return {
                async createSignedUrl(path, expires) {
                    calls.signedUrls.push({path, expires});
                    return signedResult();
                },
                async upload(path, file, options) {
                    calls.uploads.push({ path, file, options });
                    calls.events.push("upload");
                    return { error: failUpload ? {message:"upload offline"} : null };
                },
                async remove(paths) {
                    calls.removals.push(paths);
                    calls.events.push(`remove:${paths[0]}`);
                    return { error: null };
                }
            };
        }
    },
    from() { return { async upsert(row) { calls.events.push("save"); calls.saves.push(row); return {error: failSave ? {message:"database offline"} : null}; } }; }
};

const nodes = new Map();
const node = id => {
    if (!nodes.has(id)) nodes.set(id, {
        value:"", files:[], disabled:false, textContent:"", innerHTML:"",
        classList:{add(){},remove(){}}, listeners:{}, open:false,
        querySelectorAll(){return [];}, removeAttribute(name){delete this[name];}, getAttribute(name){return this[name] ?? null;},
        addEventListener(name, listener){this.listeners[name]=listener;},
        showModal(){this.open=true;}, close(){this.open=false;this.listeners.close?.();}
    });
    return nodes.get(id);
};

const context = {
    console,
    Date,
    Math,
    JSON,
    Set,
    String,
    Number,
    crypto: { randomUUID: () => "file-id" },
    URL: { revokeObjectURL() {} },
    alert: message => calls.alerts.push(message),
    setTimeout: () => 1, clearTimeout() {},
    localStorage: { getItem: () => null, setItem() {} },
    document: { getElementById: node, addEventListener() {} }
};
vm.createContext(context);
vm.runInContext(`${core.slice(0, initAt)}
this.attachments = {
  validateAttachmentFile,
  uploadTradeAttachment,
  removeTradeAttachment,
  openTradeAttachment,
  bindAttachmentViewer,
  tradeAttachmentButton,
  saveFromForm,
  openModal,
  calendarResults,
  state,
  prepare: (existing, file, remove) => {
    state.trades = existing ? [existing] : [];
    state.editingId = existing?.id || null;
    state.editAttachment = {existing: existing?.attachment || null, removeExisting: Boolean(remove)};
    state.editPartials = [];
    document.getElementById('fAttachment').files = file ? [file] : [];
  },
  configure: (nextClient, user) => { supabaseClient = nextClient; currentUser = user; currentSession = { user }; }
};
renderAll = () => {};`, context);

(async () => {
    const api = context.attachments;
    assert.equal(api.validateAttachmentFile({ type: "image/gif", size: 10 }).ok, false);
    assert.equal(api.validateAttachmentFile({ type: "image/png", size: 20 * 1024 * 1024 + 1 }).ok, false);
    assert.equal(api.validateAttachmentFile({ type: "image/webp", size: 20 * 1024 * 1024 }).ok, true);

    const offline = await api.uploadTradeAttachment("trade-a", { type: "image/png", size: 20, name: "chart.png" });
    assert.equal(offline.ok, false);

    api.configure(client, { id: "user-a" });
    const uploaded = await api.uploadTradeAttachment("trade-a", { type: "image/jpeg", size: 1024, name: "chart.jpg" });
    assert.equal(uploaded.ok, true);
    assert.equal(uploaded.attachment.path, "user-a/trade-a/file-id.jpg");
    assert.equal(calls.uploads[0].options.contentType, "image/jpeg");
    assert.equal(calls.uploads[0].options.upsert, false);
    assert.equal(calls.uploads[0].options.cacheControl, "31536000");

    const removed = await api.removeTradeAttachment(uploaded.attachment);
    assert.equal(removed.ok, true);
    assert.deepEqual(Array.from(calls.removals[0]), ["user-a/trade-a/file-id.jpg"]);

    // Exercise the real form save: database commit precedes deletion of the old image.
    node("fSymbol").value = "WIN";
    node("fSide").value = "long";
    node("fDate").value = "2026-10-08T10:00";
    node("fInitQty").value = "2";
    node("fStopMoney").value = "170";
    node("fTargetMoney").value = "360";
    node("fStatus").value = "target";
    const old = {id:"trade-a", createdAt:"2026-10-08T12:00:00Z", attachment:{path:"user-a/trade-a/old.png"}};
    const file = {type:"image/png", size:1024, name:"new.png"};
    calls.events.length = 0;
    api.prepare(old, file, false);
    await api.saveFromForm();
    assert.deepEqual(calls.events, ["upload", "save", "remove:user-a/trade-a/old.png"]);
    assert.equal(api.state.trades[0].attachment.path, "user-a/trade-a/file-id.png");
    assert.equal(api.state.trades[0].pnl, 360);

    // Failed database save cleans only the new upload, keeping the prior trade and image.
    failSave = true;
    calls.events.length = 0;
    api.prepare(old, file, false);
    await api.saveFromForm();
    assert.deepEqual(calls.events, ["upload", "save", "remove:user-a/trade-a/file-id.png"]);
    assert.equal(api.state.trades[0].attachment.path, old.attachment.path);
    assert.equal(node("btnSave").disabled, false);
    failSave = false;

    // Failed upload never updates the trade or deletes its old attachment.
    failUpload = true;
    calls.events.length = 0;
    api.prepare(old, file, false);
    await api.saveFromForm();
    assert.deepEqual(calls.events, ["upload"]);
    assert.equal(api.state.trades[0].attachment.path, old.attachment.path);
    failUpload = false;

    calls.events.length = 0;
    api.prepare(old, null, true);
    await api.saveFromForm();
    assert.deepEqual(calls.events, ["save", "remove:user-a/trade-a/old.png"]);
    assert.equal(api.state.trades[0].attachment, null);

    calls.events.length = 0;
    api.prepare(old, null, false);
    await api.saveFromForm();
    assert.deepEqual(calls.events, ["save"]);
    assert.equal(api.state.trades[0].attachment.path, old.attachment.path);

    // Editing a UTC timestamp must display local time without shifting the trade each save.
    // This UTC date is already the 9th, but the trade occurred on the 8th in São Paulo.
    const timestamp = "2026-10-09T01:12:34.567Z";
    api.prepare({ id:"date-trade", date:timestamp, symbol:"WIN", side:"long", initQty:1,
        stopMoney:100, targetMoney:507, status:"target", pnl:507 }, null, false);
    for (let edit = 0; edit < 5; edit++) {
        api.openModal(api.state.trades[0]);
        assert.equal(node("fDate").value, "2026-10-08T22:12", "UTC must be converted to local time in the editor");
        await api.saveFromForm();
        assert.equal(api.state.trades[0].date, timestamp, "Repeated edits preserve the exact original timestamp");
        const totals = api.calendarResults(api.state.trades, new Date(2026, 9, 1), new Date(2026, 9, 8, 23));
        assert.equal(totals.dayMap[8].cents, 50700);
        assert.equal(totals.last7, 507, "Today's local trade enters the rolling total even when its UTC date is tomorrow");
        assert.equal(totals.last30, 507);
    }
    api.openModal(api.state.trades[0]);
    node("fDate").value = "2026-10-08T13:06";
    await api.saveFromForm();
    assert.equal(api.state.trades[0].date, "2026-10-08T16:06:00.000Z", "Intentional local date changes convert to UTC exactly once");
    api.openModal(api.state.trades[0]);
    assert.equal(node("fDate").value, "2026-10-08T13:06");

    // Direct viewing authenticates a private signed URL without opening or changing the editor.
    const imageTrade = {id:"image-trade", dateLocal:"2026-10-08T13:06", date:"2026-10-08T16:06:00Z", symbol:"WIN", attachment:{path:"user-a/image-trade/chart.png", name:"Gráfico.png"}};
    api.prepare(imageTrade, null, false);
    api.state.editingId = null;
    api.bindAttachmentViewer();
    calls.signedUrls.length = 0;
    const formBefore = node("fDate").value;
    await api.openTradeAttachment("image-trade");
    assert.equal(node("attachmentViewer").open, true);
    assert.equal(api.state.editingId, null);
    assert.equal(node("fDate").value, formBefore);
    assert.deepEqual(calls.signedUrls, [{path:imageTrade.attachment.path, expires:600}]);
    assert.equal(node("attachmentViewerImage").src, "https://example.test/private-image?token=private");
    assert.equal(node("attachmentViewerOriginal").href, node("attachmentViewerImage").src);
    node("attachmentViewerImage").listeners.load();
    assert.equal(node("attachmentViewerImage").hidden, false);
    assert.equal(node("attachmentViewerStatus").hidden, true);
    node("attachmentViewerImage").listeners.error();
    assert.equal(node("attachmentViewerStatus").hidden, false);
    assert.match(node("attachmentViewerStatus").textContent, /Não foi possível carregar/);
    node("attachmentViewer").close();
    assert.equal(node("attachmentViewerImage").src, undefined);
    assert.equal(node("attachmentViewerOriginal").href, undefined);
    await api.openTradeAttachment("nonexistent");
    assert.equal(calls.signedUrls.length, 1);

    api.configure(client, null);
    await api.openTradeAttachment("image-trade");
    assert.match(node("attachmentViewerStatus").textContent, /Entre na sua conta/);
    assert.equal(calls.signedUrls.length, 1, "Signed URLs are never requested without login");
    api.configure(client, {id:"user-a"});
    signedResult = () => ({error:{message:"Storage indisponível"}});
    await api.openTradeAttachment("image-trade");
    assert.match(node("attachmentViewerStatus").textContent, /Storage indisponível/);
    assert.equal(node("attachmentViewerOriginal").hidden, true);

    let resolveSigned;
    signedResult = () => new Promise(resolve => {resolveSigned = resolve;});
    const accountChanged = api.openTradeAttachment("image-trade");
    api.configure(client, {id:"user-b"});
    resolveSigned({data:{signedUrl:"https://example.test/user-a"}});
    await accountChanged;
    assert.equal(node("attachmentViewerImage").src, undefined, "A changed account cannot receive a stale image response");
    assert.match(node("attachmentViewerStatus").textContent, /A conta mudou/);
    api.configure(client, {id:"user-a"});
    const closed = api.openTradeAttachment("image-trade");
    node("attachmentViewer").close();
    resolveSigned({data:{signedUrl:"https://example.test/closed"}});
    await closed;
    assert.equal(node("attachmentViewerImage").src, undefined, "Closing during loading cancels the response");

    const oldResponse = api.openTradeAttachment("image-trade");
    const resolveOld = resolveSigned;
    signedResult = () => ({data:{signedUrl:"https://example.test/latest"}});
    await api.openTradeAttachment("image-trade");
    resolveOld({data:{signedUrl:"https://example.test/old"}});
    await oldResponse;
    assert.equal(node("attachmentViewerImage").src, "https://example.test/latest", "Late responses never replace the currently opened image");
    assert.match(api.tradeAttachmentButton(imageTrade), /data-open-attachment="image-trade"/);
    assert.equal(api.tradeAttachmentButton({id:"no-image"}), "");
    node("attachmentViewer").close();

    const sql = fs.readFileSync(`${__dirname}/supabase-attachments.sql`, "utf8");
    assert.match(sql, /'trade-attachments'/);
    assert.match(sql, /false/);
    assert.match(sql, /file_size_limit[\s\S]*20971520/);
    ["select", "insert", "update", "delete"].forEach((operation) => assert.match(sql, new RegExp(`for ${operation} to authenticated`)));
    assert.match(sql, /storage\.foldername\(name\)\)\[1\] = \(select auth\.uid\(\)::text\)/);

    ["diario-pro-plus.html"].forEach((page) => {
        const html = fs.readFileSync(`${__dirname}/${page}`, "utf8");
        assert.match(html, /id="fAttachment"/);
        assert.match(html, /id="attachmentPreview"/);
        assert.match(html, /diario-attachments\.css/);
        assert.equal((html.match(/id="partialSummary"/g) || []).length, 1);
        assert.ok(html.indexOf('id="partialSummary"') > html.indexOf('id="attachmentPreview"'));
    });
    const legacy = fs.readFileSync(`${__dirname}/diario.html`, "utf8");
    const redirect = legacy.match(/<script>([\s\S]*?)<\/script>/)[1];
    let redirected;
    vm.runInNewContext(redirect, {location:{search:"?origem=favorito",hash:"#trade",replace:url=>{redirected=url;}}});
    assert.equal(redirected, "diario-pro-plus.html?origem=favorito#trade");
    assert.match(legacy, /http-equiv="refresh"/);
    ["index.html", "diario-pro-plus.html", "checklist.html", "checklist-pro.html"].forEach(page => {
        assert.doesNotMatch(fs.readFileSync(`${__dirname}/${page}`, "utf8"), /href="diario\.html"/);
    });
    console.log("PASS: private attachments, direct viewing without editing, signed URL errors/account changes/stale responses, removal, RLS, and unchanged trade dates.");
})().catch((error) => {
    console.error(error);
    process.exitCode = 1;
});
