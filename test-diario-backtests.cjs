const fs=require('node:fs'),vm=require('node:vm'),assert=require('node:assert/strict');
const source=fs.readFileSync(__dirname+'/diario-backtests.js','utf8');
function boot(storage=new Map(),cloud=new Map()) {
    const nodes=new Map();let seq=0,tick=0;
    for(const data of storage.values()){try{JSON.parse(data).forEach(row=>{const m=/^id-(\d+)$/.exec(row.id);if(m)seq=Math.max(seq,Number(m[1]));});}catch{}}
    const node=id=>{if(!nodes.has(id))nodes.set(id,{value:'',innerHTML:'',textContent:'',scrollIntoView(){},focus(){},click(){}});return nodes.get(id);};
    class TestDate extends Date {constructor(...args){super(...(args.length?args:[Date.UTC(2026,9,11,16,0,0)+tick++]));}}
    const ctx={console,Blob,URL,Date:TestDate,Math,JSON,Map,Number,String,Boolean,
        document:{getElementById:node,querySelector:s=>s==='.main'?{insertAdjacentHTML(){}}:{value:ctx.result},querySelectorAll:s=>s.includes('btResult')&&s.includes('input')?['target','stop','breakeven'].map(value=>({value,set checked(checked){if(checked)ctx.result=value;}})):[],createElement:()=>node('download')},
        window:{addEventListener(){}},localStorage:{getItem:k=>storage.get(k)||null,setItem:(k,v)=>{if(ctx.full)throw Error('quota');storage.set(k,v);},removeItem:k=>storage.delete(k)},
        setTimeout:()=>1,clearTimeout(){},alert:msg=>ctx.alerts.push(msg),confirm:()=>true,toast(){},uid:()=>`id-${++seq}`,canUseCloud:()=>!!ctx.currentUser,currentUser:null,result:'target',alerts:[],
        supabaseClient:{from(){return {async upsert(batch){if(ctx.offline)return{error:{message:'offline'}};batch.forEach(row=>{const old=cloud.get(row.id);cloud.set(row.id,{...row,payload:{...row.payload,deleted:!!(old?.payload.deleted||row.payload.deleted)}});});return{};},select(){return this;},eq(k,v){this.who=v;return this;},order(){return this;},async range(a,b){if(ctx.offline)return{error:{message:'offline'}};return{data:[...cloud.values()].filter(x=>x.user_id===this.who).sort((a,b)=>a.id.localeCompare(b.id)).slice(a,b+1)};}};}}
    };
    vm.createContext(ctx);vm.runInContext(source+'\nthis.bt=Backtests;',ctx);ctx.bt.init();
    const submit=id=>node(id).onsubmit({preventDefault(){}}),click=data=>node('view-backtests').onclick({target:{closest:()=>({dataset:data})}});
    const rows=who=>JSON.parse(storage.get(`diarioBacktests_v1_${who}`)||'[]');
    const entries=(who='guest')=>rows(who).filter(t=>t.kind==='trade'&&!t.deleted);
    const register=(result,stop,target,tag='')=>{ctx.result=result;node('btStopCash').value=String(stop);node('btTargetCash').value=String(target);node('btSetupTag').value=tag;submit('btTrade');};
    return{ctx,node,storage,cloud,submit,click,rows,entries,register};
}
const close=(actual,expected)=>assert.ok(Math.abs(actual-expected)<1e-12,`${actual} != ${expected}`);
const dayMetrics=(app,unit='r')=>app.ctx.bt.weekdayStats(app.entries(),app.rows('guest').filter(t=>t.kind==='day'&&!t.deleted),unit);
(async()=>{
    const app=boot();app.node('btStrategy').value='POI <img src=x>';app.submit('btCreate');
    assert.match(app.node('btList').innerHTML,/&lt;img/);
    app.register('target',50,108);assert.equal(app.entries().length,0,'New trades require an explicit replay weekday');
    app.click({weekday:'1'});
    for(const [result,stop,target,tag] of [['target','50','108',' POI '],['stop','40','80','OB <img src=x>'],['breakeven','20','60','BE'],['target','48','144','FVG'],['target','125','100','']]){
        app.register(result,stop,target,tag);
        assert.equal(app.node('btStopCash').value,'');assert.equal(app.node('btTargetCash').value,'');assert.equal(app.node('btSetupTag').value,'','Clear fields only after successful registration');
    }
    assert.deepEqual(app.entries().map(t=>t.cashPnl),[108,-40,0,144,100]);assert.deepEqual(app.entries().map(t=>t.r),[2.16,-1,0,3,0.8]);
    assert.ok(app.entries().every(t=>t.stopCash>0&&t.targetCash>0&&t.result&&!Object.hasOwn(t,'unit')),'Every new trade stores paired amounts independent of graph unit');
    assert.equal(app.entries()[0].setupTag,'POI');assert.match(app.node('btHistory').innerHTML,/OB &lt;img src=x&gt;/);assert.doesNotMatch(app.node('btHistory').innerHTML,/<img/);
    const r=app.ctx.bt.metrics(app.entries()),cash=app.ctx.bt.metrics(app.entries(),'brl');
    close(r.total,4.96);assert.equal(cash.total,312);assert.equal(r.count,5);assert.equal(cash.count,5);assert.equal(cash.wins,3);assert.equal(cash.losses,1);assert.equal(cash.breakevens,1);
    assert.equal(cash.winRate,75);close(r.expectancy,0.992);assert.equal(cash.expectancy,62.4);assert.equal(cash.dd,40);assert.equal(r.dd,1);
    assert.equal(cash.grossWins,352);assert.equal(cash.grossLosses,40);assert.equal(cash.profitFactor,8.8);close(r.profitFactor,5.96);
    assert.equal(r.otherTargets,2);assert.deepEqual({...r.targets},{1:0,2:0,3:1});assert.equal(r.missingCount,0);assert.equal(cash.missingCount,0);
    assert.deepEqual(Array.from(cash.points),[0,108,68,68,212,312]);
    const history=app.node('btHistory').innerHTML;
    const cells=[...history.matchAll(/<tr data-trade="[^"]+">(.*?)<\/tr>/g)].map(row=>[...row[1].matchAll(/<td(?: [^>]*)?>(.*?)<\/td>/g)].map(cell=>cell[1]));
    assert.deepEqual(cells.map(row=>Number(row[0])),[5,4,3,2,1]);assert.ok(cells.every(row=>row.length===11));
    assert.equal(cells[0][6],'+0,8R');assert.equal(cells[0][7],'+R$ 100,00');assert.equal(cells[0][8],'+4,96R');assert.equal(cells[0][9],'+R$ 312,00');
    assert.match(app.node('btCurve').innerHTML,/5 trades · \+4,96R/);
    app.click({unit:'brl'});assert.equal(app.node('btHistory').innerHTML,history,'Changing chart unit never filters or reorders the table');
    assert.match(app.node('btCurve').innerHTML,/5 trades · \+R\$ 312,00/);assert.match(app.node('btDayStatus').textContent,/5 trades/);assert.equal(app.node('btPendingValues').hidden,true);
    app.node('btStopCash').value='50';app.node('btTargetCash').value='108';app.ctx.result='target';app.node('btTargetCash').oninput();assert.equal(app.node('btAutoR').value,'+2,16R');
    app.ctx.result='stop';app.node('btTargetCash').oninput();assert.equal(app.node('btAutoR').value,'-1R');assert.match(app.node('btFormHelp').textContent,/−R\$ 50,00/);
    app.ctx.result='breakeven';app.node('btTargetCash').oninput();assert.equal(app.node('btAutoR').value,'0R');
    const session=app.rows('guest').find(t=>t.kind==='session'),first=app.entries()[0],oldStop=app.entries()[1];
    app.click({edit:oldStop.id});assert.equal(app.ctx.result,'stop');assert.equal(app.node('btStopCash').value,'40,00');assert.equal(app.node('btTargetCash').value,'80,00');
    app.node('btStopCash').value='45,50';app.node('btTargetCash').value='150';app.node('btSetupTag').value='Novo stop';app.click({unit:'r'});
    assert.equal(app.node('btStopCash').value,'45,50');assert.equal(app.node('btTargetCash').value,'150','Changing chart unit does not discard an edit');
    app.submit('btTrade');let edited=app.entries().find(t=>t.id===oldStop.id);
    assert.equal(edited.cashPnl,-45.5);assert.equal(edited.r,-1);assert.equal(edited.created,oldStop.created);assert.ok(edited.updated);assert.equal(app.entries().length,5);
    assert.equal(app.node('btCancelEdit').hidden,true);assert.equal(app.node('btSaveTrade').textContent,'Registrar trade');
    app.click({edit:first.id});app.node('btStopCash').value='1';app.node('btTargetCash').value='999';app.node('btCancelEdit').onclick();assert.equal(app.entries()[0].r,2.16,'Cancel preserves original amounts');
    app.click({edit:first.id});app.node('btSetupTag').value='Tag atualizada';app.submit('btTrade');assert.equal(app.entries()[0].cashPnl,108,'Tag-only edits preserve the paired result');
    const beforeQuota=app.storage.get('diarioBacktests_v1_guest');app.ctx.full=true;app.register('target',50,108,'Manter');app.ctx.full=false;
    assert.equal(app.storage.get('diarioBacktests_v1_guest'),beforeQuota);assert.equal(app.node('btStopCash').value,'50');assert.equal(app.node('btTargetCash').value,'108');assert.equal(app.node('btSetupTag').value,'Manter');
    for(const [stop,target] of [['',108],[0,108],[-50,108],[50,0],[50,-108],['abc',108],[50,'12,345']]){const before=app.storage.get('diarioBacktests_v1_guest');app.register('target',stop,target);assert.equal(app.storage.get('diarioBacktests_v1_guest'),before,'Reject invalid risk/target without creating records');}
    app.click({unit:'brl'});const reloaded=boot(app.storage);reloaded.click({open:session.id});
    assert.match(reloaded.node('btCurve').innerHTML,/5 trades · \+R\$ 306,50/);assert.equal(reloaded.entries().length,5);assert.match(reloaded.node('btHistory').innerHTML,/Tag atualizada/);
    const derived=app.ctx.bt.tradeValues({stopCash:50,targetCash:108,result:'target',r:999,cashPnl:999});assert.equal(derived.r,2.16);assert.equal(derived.cashPnl,108,'Amounts are the source of truth');
    const cents=app.ctx.bt.metrics([{stopCash:1,targetCash:10.01,result:'target'},{stopCash:9.99,targetCash:20,result:'stop'}],'brl');assert.equal(cents.total,0.02);assert.equal(cents.dd,9.99);assert.deepEqual(Array.from(cents.points),[0,10.01,0.02]);
    for(const [value,expected] of [['108',108],['+108,25',108.25],['-75.50',-75.5],['R$ 1.234,56',1234.56],['−R$ 75,50',-75.5],['1.000',1000],['0',0],['-0,00',0]])assert.equal(app.ctx.bt.parseCash(value),expected);
    for(const value of ['', ' ', 'abc', '12,345','1.23,45','1.234.56','NaN','Infinity','1e3','9007199254740992'])assert.equal(app.ctx.bt.parseCash(value),null);
    const legacyMetrics=app.ctx.bt.metrics([1,2,-1,-1,-1,0,3,3].map(r=>({r})));assert.equal(legacyMetrics.total,6);assert.equal(legacyMetrics.breakevens,1);assert.equal(legacyMetrics.dd,3);assert.equal(legacyMetrics.bestWinStreak,2);assert.equal(legacyMetrics.worstLossStreak,3);
    const empty=app.ctx.bt.metrics([]),allWins=app.ctx.bt.metrics([{r:2},{r:3}]),allLosses=app.ctx.bt.metrics([{r:-1},{r:-1}]),allZero=app.ctx.bt.metrics([{r:0},{r:0}]);
    assert.equal(empty.expectancy,null);assert.equal(empty.profitFactor,null);assert.equal(allWins.winRate,100);assert.equal(allWins.profitFactor,null);assert.equal(allLosses.dd,2);assert.equal(allLosses.profitFactor,0);assert.equal(allZero.count,2);assert.equal(allZero.breakevens,2);assert.equal(allZero.winRate,0);
    const legacySession={id:'legacy-session',kind:'session',name:'Antigos juntos',unit:'brl',created:'2026-10-01T12:00:00Z'};
    const legacyTrades=[{r:2},{r:-1},{r:0},{unit:'brl',cashPnl:108},{unit:'brl',cashPnl:-75},{unit:'brl',cashPnl:0}].map((values,i)=>({id:`legacy-${i}`,kind:'trade',parent:legacySession.id,setupTag:'Antigo',created:`2026-10-02T12:0${i}:00Z`,...values}));
    const legacy=boot(new Map([['diarioBacktests_v1_guest',JSON.stringify([legacySession,...legacyTrades])]]));legacy.click({open:legacySession.id});
    assert.equal((legacy.node('btHistory').innerHTML.match(/<tr data-trade=/g)||[]).length,6,'Old R-only and cash-only trades are visible together');
    assert.match(legacy.node('btPendingValues').innerHTML,/6 trades antigos/);assert.match(legacy.node('btHistory').innerHTML,/Preencher valores/);
    let partial=legacy.ctx.bt.metrics(legacy.entries(),'brl');assert.equal(partial.count,6);assert.equal(partial.valuedCount,3);assert.equal(partial.missingCount,3);assert.equal(partial.total,33);assert.equal(partial.expectancy,11);assert.equal(partial.winRate,50);assert.equal(partial.breakevens,2);
    assert.deepEqual(Array.from(partial.points),[0,null,null,null,108,33,33]);assert.match(legacy.node('btCurve').innerHTML,/parcial/);assert.match(legacy.node('btPartialNote').textContent,/3 trades/);
    const legacyHistory=legacy.node('btHistory').innerHTML;legacy.click({unit:'r'});assert.equal(legacy.node('btHistory').innerHTML,legacyHistory);
    assert.deepEqual(Array.from(legacy.ctx.bt.metrics(legacy.entries()).points),[0,2,1,1,null,null,null]);
    const zeroCash=boot(new Map([['diarioBacktests_v1_guest',JSON.stringify([legacySession,...legacyTrades.slice(0,3)])]]));zeroCash.click({open:legacySession.id});
    assert.match(zeroCash.node('btKpis').innerHTML,/<div class="value">—<\/div>/);assert.match(zeroCash.node('btCurve').innerHTML,/Preencha os valores/);assert.doesNotMatch(zeroCash.node('btCurve').innerHTML,/3 trades · R\$ 0,00/,'Unknown money does not masquerade as zero');
    const corrections=[[50,100],[40,80],[20,60],[50,108],[75,150],[30,60]];
    for(let i=0;i<legacyTrades.length;i++){
        legacy.click({edit:legacyTrades[i].id});assert.equal(legacy.node('btLegacyEditNote').hidden,false);
        if(i===0){assert.equal(legacy.node('btStopCash').value,'');assert.equal(legacy.node('btTargetCash').value,'');assert.match(legacy.node('btLegacyEditNote').textContent,/\+2R/);}
        if(i===3)assert.equal(legacy.node('btTargetCash').value,'108,00','Known old gain prefills only the known target');
        if(i===4)assert.equal(legacy.node('btStopCash').value,'75,00','Known old loss prefills only the known stop');
        legacy.node('btStopCash').value=String(corrections[i][0]);legacy.node('btTargetCash').value=String(corrections[i][1]);legacy.submit('btTrade');
        const trade=legacy.entries().find(t=>t.id===legacyTrades[i].id);assert.equal(trade.created,legacyTrades[i].created);assert.equal(trade.id,legacyTrades[i].id);
    }
    assert.equal(legacy.entries().length,6);assert.equal(legacy.node('btPendingValues').hidden,true);assert.equal(legacy.node('btHistoryNote').hidden,true);
    close(legacy.ctx.bt.metrics(legacy.entries()).total,2.16);assert.equal(legacy.ctx.bt.metrics(legacy.entries(),'brl').total,93);assert.equal(legacy.ctx.bt.metrics(legacy.entries(),'brl').missingCount,0);
    assert.equal(legacy.entries()[2].cashPnl,0);assert.equal(legacy.entries()[5].r,0,'Completing a neutral legacy trade keeps it neutral');
    const dayApp=boot();dayApp.node('btStrategy').value='Dias do replay';dayApp.submit('btCreate');const daySession=dayApp.rows('guest').find(t=>t.kind==='session');
    dayApp.click({weekday:'1'});dayApp.register('target',50,100);dayApp.register('stop',50,100);const monday=dayApp.rows('guest').find(t=>t.kind==='day');
    dayApp.node('btNewDay').onclick();assert.equal(dayApp.rows('guest').filter(t=>t.kind==='day').length,1,'Empty draft days are not saved');
    dayApp.node('btDayDate').value='2026-10-06';dayApp.node('btDayDate').onchange();dayApp.register('target',50,150);dayApp.register('breakeven',50,150);
    const tuesday=dayApp.rows('guest').find(t=>t.kind==='day'&&t.weekday===2);assert.equal(tuesday.date,'2026-10-06');
    dayApp.node('btNewDay').onclick();dayApp.click({weekday:'1'});dayApp.register('stop',20,40);const secondMonday=dayApp.rows('guest').find(t=>t.kind==='day'&&t.number===3);assert.notEqual(secondMonday.id,monday.id);
    let weekdays=dayMetrics(dayApp,'brl');assert.equal(weekdays.groups[0].days,2);assert.equal(weekdays.groups[0].count,3);assert.equal(weekdays.groups[0].total,30);assert.equal(weekdays.groups[0].expectancy,10);assert.equal(weekdays.groups[0].avgDay,15);
    assert.equal(weekdays.groups[1].count,2);assert.equal(weekdays.groups[1].breakevens,1);assert.equal(weekdays.groups[1].avgDay,150);assert.equal(weekdays.groups[1].expectancy,75);assert.equal(dayMetrics(dayApp).groups[0].total,0);
    assert.equal((dayApp.node('btHistory').innerHTML.match(/class="bt-day-separator"/g)||[]).length,3);
    const dayReload=boot(dayApp.storage);dayReload.click({open:daySession.id});assert.match(dayReload.node('btDayStatus').textContent,/Dia 3 · Segunda-feira/);
    dayReload.register('breakeven',20,40);assert.equal(dayReload.entries().filter(t=>t.dayId===secondMonday.id).length,2);
    dayReload.click({resumeDay:tuesday.id});dayReload.register('target',50,50);assert.equal(dayReload.entries().filter(t=>t.dayId===tuesday.id).length,3);
    const moved=dayReload.entries().find(t=>t.dayId===monday.id&&t.result==='target');dayReload.click({edit:moved.id});dayReload.click({weekday:'5'});dayReload.submit('btTrade');
    const friday=dayReload.rows('guest').find(t=>t.kind==='day'&&t.weekday===5);assert.equal(dayReload.entries().find(t=>t.id===moved.id).dayId,friday.id);assert.equal(dayReload.rows('guest').find(t=>t.kind==='session').currentDay,tuesday.id);
    dayReload.click({edit:moved.id});dayReload.node('btDayGroup').value=monday.id;dayReload.node('btDayGroup').onchange();dayReload.node('btCancelEdit').onclick();assert.equal(dayReload.entries().find(t=>t.id===moved.id).dayId,friday.id);
    dayReload.node('btNewDay').onclick();dayReload.click({weekday:'1'});dayReload.node('btDayDate').value='2026-10-09';const invalidBefore=dayReload.storage.get('diarioBacktests_v1_guest');dayReload.register('target',50,100);assert.equal(dayReload.storage.get('diarioBacktests_v1_guest'),invalidBefore,'Mismatched replay date/weekday is rejected');
    dayReload.node('btDayDate').value='2026-10-10';dayReload.node('btDayDate').onchange();dayReload.register('target',50,100);assert.equal(dayReload.storage.get('diarioBacktests_v1_guest'),invalidBefore,'Weekend replay dates are rejected');
    dayReload.node('btDayDate').value='2026-10-09';dayReload.node('btDayDate').onchange();dayReload.ctx.full=true;dayReload.register('target',50,100);dayReload.ctx.full=false;assert.equal(dayReload.storage.get('diarioBacktests_v1_guest'),invalidBefore,'Quota failure saves neither a partial day nor trade');
    const unassigned={id:'unassigned',kind:'trade',parent:daySession.id,r:2,created:'2026-09-04T12:00:00Z'};
    const assignment=boot(new Map([['diarioBacktests_v1_guest',JSON.stringify([...dayReload.rows('guest'),unassigned])]]));assignment.click({open:daySession.id});assert.equal(dayMetrics(assignment).unassigned,1);assert.match(assignment.node('btUnassignedDays').textContent,/1 trade sem dia informado/);
    assignment.click({edit:'unassigned'});assignment.node('btStopCash').value='50';assignment.node('btTargetCash').value='100';assignment.node('btDayGroup').value=monday.id;assignment.node('btDayGroup').onchange();assignment.submit('btTrade');assert.equal(dayMetrics(assignment).unassigned,0);assert.equal(assignment.entries().find(t=>t.id==='unassigned').created,unassigned.created);
    const guestDayIds=new Set(assignment.rows('guest').filter(t=>t.kind==='day').map(t=>t.id));assignment.click({unit:'brl'});assignment.ctx.currentUser={id:'alice'};assignment.ctx.bt.authChanged();assert.equal(assignment.entries('alice').length,0);
    assignment.node('btImportLocal').onclick();assignment.ctx.offline=true;await assignment.node('btSync').onclick();assert.match(assignment.node('btStatus').textContent,/offline/);assert.ok(assignment.rows('alice').some(t=>t.dirty));
    assignment.ctx.offline=false;await assignment.node('btSync').onclick();assert.ok(assignment.rows('alice').every(t=>!t.dirty));
    const ownedDays=assignment.rows('alice').filter(t=>t.kind==='day'),ownedIds=new Set(ownedDays.map(t=>t.id));assert.ok(ownedDays.every(t=>!guestDayIds.has(t.id)));assert.ok(assignment.entries('alice').every(t=>ownedIds.has(t.dayId)));
    const ownedSession=assignment.rows('alice').find(t=>t.kind==='session');assert.ok(ownedIds.has(ownedSession.currentDay));assert.equal(ownedSession.unit,'brl');
    const cloudTrades=[...assignment.cloud.values()].filter(t=>t.payload.kind==='trade');assert.ok(cloudTrades.every(t=>typeof t.payload.stopCash==='number'&&typeof t.payload.targetCash==='number'&&typeof t.payload.r==='number'&&typeof t.payload.cashPnl==='number'));
    const cloudOnly=boot(new Map(),assignment.cloud);cloudOnly.ctx.currentUser={id:'alice'};cloudOnly.ctx.bt.authChanged();await cloudOnly.node('btSync').onclick();cloudOnly.click({open:ownedSession.id});assert.equal(cloudOnly.entries('alice').length,assignment.entries('alice').length,'A second device restores all paired results from cloud JSON');assert.equal(cloudOnly.node('btPendingValues').hidden,true);
    cloudOnly.click({edit:cloudOnly.entries('alice')[0].id});cloudOnly.ctx.currentUser={id:'bob'};cloudOnly.ctx.bt.authChanged();assert.equal(cloudOnly.node('btCancelEdit').hidden,true);assert.equal(cloudOnly.entries('bob').length,0,'Accounts remain isolated');
    cloudOnly.ctx.currentUser={id:'alice'};cloudOnly.ctx.bt.authChanged();cloudOnly.click({open:ownedSession.id});const removed=cloudOnly.entries('alice')[0];cloudOnly.click({remove:removed.id});await cloudOnly.node('btSync').onclick();assert.ok(cloudOnly.rows('alice').find(t=>t.id===removed.id).deleted);
    cloudOnly.click({delete:ownedSession.id});await cloudOnly.node('btSync').onclick();assert.ok(cloudOnly.rows('alice').every(t=>t.deleted),'Deleting a session also deletes all trades and day markers');
    const stale=boot(new Map([['diarioBacktests_v1_alice',JSON.stringify(assignment.rows('alice'))]]),assignment.cloud);stale.ctx.currentUser={id:'alice'};stale.ctx.bt.authChanged();await stale.node('btSync').onclick();assert.equal(stale.entries('alice').length,0,'Stale clients do not revive cloud deletion markers');
    const corrupt=boot(new Map([['diarioBacktests_v1_guest','broken']]));corrupt.node('btStrategy').value='test';corrupt.submit('btCreate');assert.equal(corrupt.storage.get('diarioBacktests_v1_guest'),'broken');
    new vm.Script(fs.readFileSync(__dirname+'/diario-core.js','utf8'));const html=fs.readFileSync(__dirname+'/diario-pro-plus.html','utf8');for(const match of html.matchAll(/<script>([\s\S]*?)<\/script>/g))new vm.Script(match[1]);assert.equal((html.match(/data-view="backtests"/g)||[]).length,1);
    console.log('PASS: paired stop/target inputs, automatic arbitrary R, unified R/BRL history, chart-only units, legacy warnings/completion, unknown-value gaps/partial means, cent precision, editing/quota, day grouping/resume/reassignment, cloud restore/import/isolation/deletion and syntax.');
})().catch(error=>{console.error(error);process.exitCode=1;});
