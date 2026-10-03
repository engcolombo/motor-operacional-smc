const fs = require('node:fs');
const vm = require('node:vm');
const assert = require('node:assert/strict');
const source = fs.readFileSync(__dirname + '/diario-backtests.js','utf8');
function boot(storage = new Map()) {
    const nodes = new Map(), cloud = new Map();
    let seq = 0;
    const node = id => {
        if (!nodes.has(id)) nodes.set(id, {value: id === 'btTarget' ? '1' : '', innerHTML:'', textContent:'', scrollIntoView(){}, click(){}});
        return nodes.get(id);
    };
    const ctx = {
        console, Blob, URL, Date, Math, JSON, Map, Number, String, Boolean,
        document: {getElementById:node, querySelector:s => s === '.main' ? {insertAdjacentHTML(){}} : {value:ctx.result}, querySelectorAll:()=>[], createElement:()=>node('download')},
        window: {addEventListener(){}}, localStorage:{getItem:k=>storage.get(k)||null,setItem:(k,v)=>{if(ctx.full)throw Error('quota');storage.set(k,v);},removeItem:k=>storage.delete(k)},
        setTimeout:()=>1, clearTimeout(){}, alert:msg=>ctx.alerts.push(msg), confirm:()=>true, toast(){},
        uid:()=>`id-${++seq}`, canUseCloud:()=>!!ctx.currentUser, currentUser:null, result:'target', alerts:[],
        supabaseClient:{from(){return {
            async upsert(batch){if(ctx.offline)return {error:{message:'offline'}};batch.forEach(row=>{const old=cloud.get(row.id);cloud.set(row.id,{...row,payload:{...row.payload,deleted:!!(old?.payload.deleted||row.payload.deleted)}})});return {};},
            select(){return this;},eq(k,v){this.who=v;return this;},order(){return this;},async range(a,b){return {data:[...cloud.values()].filter(x=>x.user_id===this.who).sort((a,b)=>a.id.localeCompare(b.id)).slice(a,b+1)};}
        };}}
    };
    vm.createContext(ctx); vm.runInContext(source+'\nthis.bt=Backtests;',ctx);ctx.bt.init();
    const submit=id=>node(id).onsubmit({preventDefault(){}});
    const click=data=>node('view-backtests').onclick({target:{closest:()=>({dataset:data})}});
    return {ctx,node,storage,cloud,submit,click,rows:who=>JSON.parse(storage.get(`diarioBacktests_v1_${who}`)||'[]')};
}
(async()=>{
    const app=boot(); const {ctx,node,submit,click}=app;
    node('btStrategy').value='POI <img src=x>'; submit('btCreate');
    assert.match(node('btList').innerHTML,/&lt;img/);
    for(const target of ['1','2','3']){node('btTarget').value=target;submit('btTrade');}
    ctx.result='stop';submit('btTrade');
    assert.match(node('btCurve').innerHTML,/4 trades · \+5R/);
    const m=ctx.bt.metrics([{r:1},{r:-1},{r:-1},{r:3}]);
    assert.equal(m.total,2);assert.equal(m.dd,2);assert.equal(m.wins,2);
    assert.deepEqual(Array.from(m.points),[0,1,0,-1,2]);
    const session=app.rows('guest').find(x=>x.kind==='session');
    const resumed=boot(app.storage);resumed.click({open:session.id});
    assert.match(resumed.node('btCurve').innerHTML,/4 trades · \+5R/);
    click({remove:app.rows('guest').find(x=>x.r===2).id});
    assert.match(node('btCurve').innerHTML,/3 trades · \+3R/);
    const before=app.storage.get('diarioBacktests_v1_guest');ctx.full=true;submit('btTrade');ctx.full=false;
    assert.equal(app.storage.get('diarioBacktests_v1_guest'),before);assert.ok(ctx.alerts.length);
    ctx.currentUser={id:'alice'};ctx.bt.authChanged();assert.equal(app.rows('alice').length,0);
    node('btImportLocal').onclick();ctx.offline=true;await node('btSync').onclick();
    assert.ok(app.rows('alice').some(x=>x.dirty));assert.match(node('btStatus').textContent,/offline/);
    ctx.offline=false;await node('btSync').onclick();assert.ok(app.rows('alice').every(x=>!x.dirty));
    const aliceSession=app.rows('alice').find(x=>x.kind==='session');click({open:aliceSession.id});
    assert.match(node('btCurve').innerHTML,/3 trades · \+3R/);
    ctx.currentUser={id:'bob'};ctx.bt.authChanged();await node('btSync').onclick();assert.equal(app.rows('bob').length,0);
    ctx.currentUser={id:'alice'};ctx.bt.authChanged();click({delete:aliceSession.id});await node('btSync').onclick();
    assert.ok(app.rows('alice').every(x=>x.deleted));
    // A stale remote update cannot revive a deletion marker in the merge.
    assert.match(node('btList').innerHTML,/primeiro backtest/);
    const corrupt=boot(new Map([['diarioBacktests_v1_guest','broken']]));corrupt.node('btStrategy').value='test';corrupt.submit('btCreate');
    assert.equal(corrupt.storage.get('diarioBacktests_v1_guest'),'broken');
    const html=fs.readFileSync(__dirname+'/diario.html','utf8');
    for(const match of html.matchAll(/<script>([\s\S]*?)<\/script>/g))new vm.Script(match[1]);
    assert.equal((html.match(/data-view="backtests"/g)||[]).length,1);
    console.log('PASS: R, drawdown, history, reload/resume, escaping, deletion, storage failure, offline retry, account isolation, import, sync and inline syntax.');
})().catch(e=>{console.error(e);process.exitCode=1;});
