const fs = require('node:fs'), vm = require('node:vm'), assert = require('node:assert/strict');
const nodes = new Map(), stored = new Map(), alerts = [], requests = [];
let storageFails = false, cloudError = null, cloudHook = null, remoteRows = [], failPage = false;
const pages=[];
const node = id => {
    if (!nodes.has(id)) nodes.set(id, { value: '', textContent: '', innerHTML: '', hidden: false, disabled: false,
        classList: { toggle() {}, remove() {} }, querySelectorAll: () => [], setAttribute() {} });
    return nodes.get(id);
};
const ctx = vm.createContext({ console, Date, Intl, Map, Set, JSON, Number, String, Error,
    crypto: { randomUUID: () => 'archive-' + Math.random() },
    document: { getElementById: node }, requestAnimationFrame() {},
    localStorage: { getItem: k => stored.get(k) || null, setItem(k, v) { if (storageFails) throw Error('quota'); stored.set(k, v); } },
    alert: message => alerts.push(message), window: {location:{search:''}}, URLSearchParams,
    FileReader: class { readAsDataURL(blob) { this.result = 'data:' + blob.type + ';base64,aW1hZ2U='; this.onload(); } },
    cloud: { from: () => ({ async upsert(rows) { requests.push(rows); if (cloudHook) cloudHook(); return { error: cloudError }; },
        select(){return {eq(){return this;},order(){return this;},async range(start,end){pages.push([start,end]);return failPage&&start>0?{error:{message:'page offline'}}:{data:remoteRows.slice(start,end+1)};}};} }),
        storage: { from: () => ({ download: async path => path === 'missing' ? { error: { message: 'missing' } } : { data: { type: 'image/png' } } }) } }
});
const core = fs.readFileSync(__dirname + '/diario-core.js', 'utf8');
vm.runInContext(fs.readFileSync(__dirname + '/diario-archives.js', 'utf8') + '\n' + core.slice(0, core.indexOf('\nBacktests.init();')) + `
this.loadRealCloud=loadCloudTrades;
renderAll=()=>{}; hideTradeChartTooltip=()=>{}; loadCloudTrades=()=>{};updateCloudUi=()=>{};toast=()=>{};
this.api={state, archives:DiaryArchives, filteredManualTrades, cycleManualTrades, tradeFees,
    login(id) { currentUser=id?{id}:null;currentSession=id?{}:null;supabaseClient=cloud;psychologyLoadedUser=id;psychologyDiaryLoadError=false; },
    loading(value) {cloudBusy=value;}, failedLoad(value) {psychologyDiaryLoadError=value;},
    reset(){state.trades=[];state.archiveView='active';state.assetFilter='all';state.pendingCloudDeletes=[];}}
`, ctx);
const a = ctx.api, plain = value => JSON.parse(JSON.stringify(value));
const fixture = () => [
    { id:'old', symbol:'WIN', date:'2026-10-10T12:00:00Z', pnl:100, r:1, qty:2, notes:'Evolução <script>alert(1)</script>', tags:['POI'], mistakes:['Fora do plano'], attachment:{path:'owner/chart.png', name:'Minha imagem'}, archive:{id:'previous', name:'Primeiro plano', createdAt:'2026-10-01', fees:4} },
    { id:'one', symbol:'WIN', date:'2026-10-20T12:00:00Z', pnl:200, r:2, qty:2, notes:'Manter o histórico', partials:[{qty:1,r:1}], attachment:{path:'owner/one.png',name:'Trade 1'} },
    { id:'two', symbol:'BTCUSDT', date:'2026-10-21T12:00:00Z', pnl:-80, r:-1, qty:1 },
    { id:'robot', source:'robo_smc', symbol:'WIN', pnl:999 }
];
(async () => {
    a.state.trades=fixture(); a.state.fees={win:5,cripto:0,wdo:0}; a.login(null);
    assert.equal(a.filteredManualTrades().length,2,'Existing archives are excluded by default');
    a.state.assetFilter='win';
    const before=plain(a.state.trades);
    const id=await a.archives.archive('Backtest live · plano antigo');
    assert.equal(a.filteredManualTrades().length,0,'Current dashboard resets');
    assert.equal(a.state.trades.length,4,'No record deleted');
    assert.deepEqual(plain(a.state.trades[0]),before[0],'Prior archive preserved');
    assert.deepEqual(plain(a.state.trades[3]),before[3],'Robot preserved');
    for (const t of a.state.trades.slice(1,3)) { const copy=plain(t); delete copy.archive; assert.deepEqual(copy,before.find(b=>b.id===t.id)); }
    assert.equal(a.state.trades[2].archive.id,id,'Archive ignores asset filter');
    assert.equal(requests.length,0,'Guest archive is local');
    assert.deepEqual(JSON.parse(stored.get('diarioProBeforeArchive_v1_guest')),before);
    a.state.fees.win=50;
    assert.equal(a.tradeFees(a.state.trades[1]),10,'Archived fee snapshot survives fee changes');
    a.archives.select(id); a.state.assetFilter='all';
    assert.equal(a.filteredManualTrades().length,2);
    a.state.trades.push({id:'new',symbol:'EURUSD',pnl:10});
    assert.equal(a.filteredManualTrades().length,2,'New trade stays out of archived cycle');
    a.archives.select('active'); assert.equal(a.filteredManualTrades().length,1);
    await a.archives.restore(id);
    assert.equal(a.filteredManualTrades().length,3);
    assert.equal(a.state.trades[0].archive.id,'previous');
    assert.equal(a.tradeFees(a.state.trades[1]),100,'Restore uses current fee configuration');

    a.reset(); a.state.trades=fixture(); a.login('owner');
    const cloudBefore=JSON.stringify(a.state.trades);
    cloudError={message:'offline'};
    await assert.rejects(a.archives.archive('Falha'),/offline/);
    assert.equal(JSON.stringify(a.state.trades),cloudBefore,'Failed cloud save does not reset anything');
    assert.equal(a.archives.busy,false);
    cloudError=null; storageFails=true;
    const count=requests.length;
    await assert.rejects(a.archives.archive('Quota'),/quota/);
    assert.equal(requests.length,count,'Backup failure stops cloud request');
    assert.equal(JSON.stringify(a.state.trades),cloudBefore);
    storageFails=false;
    a.loading(true); await assert.rejects(a.archives.archive('Busy'),/Aguarde/); a.loading(false);
    a.failedLoad(true); await assert.rejects(a.archives.archive('Load error'),/Atualize/); a.failedLoad(false);
    a.state.pendingCloudDeletes=['x']; await assert.rejects(a.archives.archive('Pending'),/exclusões/); a.state.pendingCloudDeletes=[];
    const savedId=await a.archives.archive('Cloud');
    assert.equal(requests.at(-1).length,2,'Single atomic batch contains current manual trades only');
    assert.ok(requests.at(-1).every(row=>row.user_id==='owner'&&row.payload.archive.id===savedId));
    a.state.trades=JSON.parse(stored.get('diarioProTrades_v1'));
    a.archives.select(savedId); assert.equal(a.filteredManualTrades().length,2,'Archive survives reload');
    await a.archives.restore(savedId);
    assert.ok(requests.at(-1).every(row=>!row.payload.archive),'Restore synchronizes removal of archive metadata');
    cloudHook=()=>a.login('other');
    const original=JSON.stringify(a.state.trades);
    await assert.rejects(a.archives.archive('Race'),/conta mudou/);
    assert.equal(JSON.stringify(a.state.trades),original,'Account change never applies old account results locally');
    cloudHook=null; a.login('owner');

    const rows=fixture().slice(0,3);
    rows[0].attachments=[rows[0].attachment,{path:'owner/second.png',name:'Segunda imagem'}];
    const images=await a.archives.reportImages(rows,'owner',()=>{});
    assert.equal(images.size,3);
    const html=a.archives.reportHTML(rows,'Plano <antigo>',images);
    assert.ok(html.includes('data:image/png;base64,'),'Images embedded without expiring URLs');
    assert.equal((html.match(/<figure>/g)||[]).length,3,'PDF includes all images including legacy attachment');
    assert.ok(html.includes('Segunda imagem'));
    assert.ok(html.includes('Fora do plano') && html.includes('Manter o histórico'));
    assert.ok(html.includes('&lt;script&gt;alert(1)&lt;/script&gt;'));
    assert.ok(!html.includes('<script>alert(1)</script>'));
    assert.ok(html.includes('Plano &lt;antigo&gt;'));
    assert.throws(()=>a.archives.reportHTML(rows,'Incomplete',new Map()),/imagem/);
    await assert.rejects(a.archives.reportImages([{id:'x',attachment:{path:'missing'}}],'owner',()=>{}),/indisponível/);
    await assert.rejects(a.archives.reportImages(rows,null,()=>{}),/Entre na conta/);
    remoteRows=Array.from({length:1201},(_,i)=>({id:'many-'+i,payload:{symbol:'WIN',archive:{id:'long-history',name:'History'}}}));
    await ctx.loadRealCloud();
    assert.equal(a.state.trades.length,1201,'Cloud loads complete archive history beyond 1000 rows');
    assert.deepEqual(pages,[[0,499],[500,999],[1000,1499]]);
    const fullHistory=JSON.stringify(a.state.trades);
    failPage=true;remoteRows=remoteRows.slice(0,800);
    await ctx.loadRealCloud();
    assert.equal(JSON.stringify(a.state.trades),fullHistory,'Later page failure never replaces history with partial results');
    console.log('PASS: cycles, filter scope, preservation, frozen fees, restore, reload, atomic cloud batch, quota/offline/account failures, complete embedded images and escaped PDF report.');
})().catch(error=>{console.error(error);process.exitCode=1;});
