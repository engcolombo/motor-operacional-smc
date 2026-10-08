const fs = require("node:fs");
const vm = require("node:vm");
const assert = require("node:assert/strict");

const core = fs.readFileSync(`${__dirname}/diario-core.js`, "utf8");
const initAt = core.indexOf("\nBacktests.init();");
assert.ok(initAt > 0, "Diário core deve manter a inicialização identificável");

const calls = { uploads: [], removals: [], events: [], saves: [], alerts: [] };
let failSave = false, failUpload = false;
const client = {
    storage: {
        from(bucket) {
            assert.equal(bucket, "trade-attachments");
            return {
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
        classList:{add(){},remove(){}},
        querySelectorAll(){return [];}, removeAttribute(){}, addEventListener(){}
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
    document: { getElementById: node }
};
vm.createContext(context);
vm.runInContext(`${core.slice(0, initAt)}
this.attachments = {
  validateAttachmentFile,
  uploadTradeAttachment,
  removeTradeAttachment,
  saveFromForm,
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
    console.log("PASS: validação, upload privado, remoção, RLS e formulários de anexos.");
})().catch((error) => {
    console.error(error);
    process.exitCode = 1;
});
