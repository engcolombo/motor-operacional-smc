/* Isolated browser only: node test-diario-archives-ui.cjs DEBUG_PORT BASE_URL ARTIFACT_DIR */
const fs=require('node:fs'), path=require('node:path'), assert=require('node:assert/strict');
const [port,base,out]=process.argv.slice(2);
if(!port||!base||!out)throw Error('Provide isolated Chrome DEBUG_PORT, BASE_URL, ARTIFACT_DIR.');
fs.mkdirSync(out,{recursive:true});
async function connect(url) {
    const socket=new WebSocket(url), pending=new Map(), errors=[];let id=0;
    await new Promise((resolve,reject)=>{socket.onopen=resolve;socket.onerror=reject;});
    socket.onmessage=e=>{const m=JSON.parse(e.data);if(m.method==='Runtime.exceptionThrown')errors.push(m.params.exceptionDetails);if(m.id){const p=pending.get(m.id);pending.delete(m.id);m.error?p.reject(Error(JSON.stringify(m.error))):p.resolve(m.result);}};
    const send=(method,params={})=>new Promise((resolve,reject)=>{const n=++id;pending.set(n,{resolve,reject});socket.send(JSON.stringify({id:n,method,params}));});
    const ev=async expression=>{const r=await send('Runtime.evaluate',{expression,returnByValue:true,awaitPromise:true,userGesture:true});if(r.exceptionDetails)throw Error(JSON.stringify(r.exceptionDetails));return r.result.value;};
    const wait=async expression=>{for(let i=0;i<160;i++){if(await ev(expression))return;await new Promise(r=>setTimeout(r,75));}throw Error('Timed out: '+expression);};
    return {send,ev,wait,errors,close:()=>socket.close()};
}
(async()=>{
    const targets=await(await fetch(`http://127.0.0.1:${port}/json/list`)).json();
    const c=await connect(targets.find(t=>t.type==='page').webSocketDebuggerUrl);
    try {
        await c.send('Page.enable');await c.send('Runtime.discardConsoleEntries');await c.send('Runtime.enable');await c.send('Network.enable');
        await c.send('Network.setCacheDisabled',{cacheDisabled:true});
        await c.send('Network.setBlockedURLs',{urls:['*supabase.co*']});
        await c.send('Emulation.setDeviceMetricsOverride',{width:1440,height:1000,deviceScaleFactor:1,mobile:false});
        const navigate=async()=>{await c.send('Page.navigate',{url:base+'/diario-pro-plus.html'});await c.wait("typeof DiaryArchives!=='undefined' && typeof state!=='undefined' && document.querySelector('#archiveSelect').options.length>1");};
        await navigate();
        await c.ev("localStorage.clear()");await navigate();
        await c.ev(`window.confirm=()=>true;window.qaAlerts=[];window.alert=m=>qaAlerts.push(m);
            currentUser=null;currentSession=null;psychologyLoadedUser=null;cloudBusy=false;
            state.trades=[
             {id:'qa-one',symbol:'WIN',side:'long',status:'target',date:'2026-10-20T12:00:00Z',dateLocal:'2026-10-20T09:00',pnl:200,r:2,qty:2,initQty:2,stopMoney:100,targetMoney:200,notes:'Plano antigo: antecipação da entrada. Revisar confirmação.',tags:['POI'],mistakes:['Antecipação'],attachment:{path:'qa/chart.png',name:'Gráfico do trade'}},
             {id:'qa-two',symbol:'EURUSD',side:'short',status:'stop',date:'2026-10-21T12:00:00Z',dateLocal:'2026-10-21T09:00',pnl:-100,r:-1,qty:1,notes:'Stop respeitado.'},
             {id:'qa-robot',source:'robo_smc',symbol:'WIN',pnl:999,r:9,date:'2026-10-20T12:00:00Z'}];
            state.fees={win:5,wdo:0,cripto:0};saveTrades();
            localStorage.setItem('diarioProfit_v1_guest',JSON.stringify({version:1,trades:[],imports:[],journalLinks:{},accounts:{'account:__diary__':{reviews:{'2026-10-20':{before:'anxious',good:'Respeitei meu stop',lesson:'Esperar confirmação',desk:{thought:'Preciso recuperar',alternative:'Esperar o reteste',action:'Pausar'}}}}}}));
            state.archiveView='all';ProfitTrades.authChanged();state.archiveView='active';ProfitTrades.authChanged();renderAll();`);
        const shot=async(name,conn=c)=>{const image=await conn.send('Page.captureScreenshot',{format:'png'});fs.writeFileSync(path.join(out,name+'.png'),Buffer.from(image.data,'base64'));};
        await shot('archives-before');
        await c.ev("document.querySelector('#btnArchiveCycle').click()");
        assert.equal(await c.ev("document.querySelector('#archiveDialog').open"),true);
        await shot('archives-confirm');
        await c.ev("document.querySelector('#archiveName').value='Backtest live · plano antigo';document.querySelector('#archiveForm').requestSubmit()");
        await c.wait("!document.querySelector('#archiveDialog').open");
        assert.equal(await c.ev('filteredManualTrades().length'),0);
        assert.equal(await c.ev('state.trades.length'),3);
        for(const view of ['dashboard','trades','calendar','stats','journal','profit']) {
            await c.ev(`switchView('${view}')`);
            assert.equal(await c.ev('filteredManualTrades().length'),0);
            assert.equal(await c.ev("document.querySelector('#archiveToolbar').hidden"),false);
        }
        assert.equal(await c.ev('psychologyDiarySnapshot().rows.length'),0);
        assert.equal(await c.ev("document.querySelector('#view-profit').textContent.includes('Ansiedade antes da entrada')"),false);
        assert.deepEqual(await c.ev('state.fees'),{win:5,wdo:0,cripto:0});
        assert.equal(await c.ev('robotTrades()[0].pnl'),999);
        await c.ev("switchView('dashboard')");await shot('archives-new-cycle');
        const archiveId=await c.ev('state.trades[0].archive.id');
        await c.ev(`document.querySelector('#archiveSelect').value=${JSON.stringify(archiveId)};document.querySelector('#archiveSelect').dispatchEvent(new Event('change'))`);
        assert.equal(await c.ev('filteredManualTrades().length'),2);
        await c.ev("switchView('profit');document.querySelector('[data-tab=day]').click()");
        assert.ok(await c.ev("document.querySelector('#view-profit').textContent.includes('Psicologia arquivada')"));
        // The latest day may be a trade without a review: explicitly inspect the reviewed day.
        await c.ev("document.querySelector('#pfDay').value='2026-10-20';document.querySelector('#pfDay').dispatchEvent(new Event('change',{bubbles:true}))");
        assert.equal(await c.ev("document.querySelector('[data-review=before]').value"),'anxious');
        assert.equal(await c.ev("document.querySelector('[data-review=before]').disabled"),true);
        await shot('archives-psychology');
        await c.ev("switchView('dashboard')");
        await shot('archives-history');
        await navigate();
        assert.equal(await c.ev('filteredManualTrades().length'),0,'Reload opens current cycle');
        assert.equal(await c.ev('DiaryArchives.groups().length'),1);
        await c.ev(`(async()=>{window.confirm=()=>true;window.qaAlerts=[];window.alert=m=>qaAlerts.push(m);DiaryArchives.select(${JSON.stringify(archiveId)});
            currentUser={id:'qa'};currentSession={};psychologyLoadedUser='qa';
            localStorage.setItem('diarioProfit_v1_qa',localStorage.getItem('diarioProfit_v1_guest'));
            var canvas=document.createElement('canvas');canvas.width=1000;canvas.height=450;var ctx=canvas.getContext('2d');ctx.fillStyle='#141b26';ctx.fillRect(0,0,1000,450);ctx.fillStyle='#e4e8ed';ctx.font='28px sans-serif';ctx.fillText('Gráfico fictício · trade QA',30,50);ctx.strokeStyle='#82bea5';ctx.lineWidth=4;ctx.beginPath();ctx.moveTo(30,380);ctx.lineTo(220,280);ctx.lineTo(420,330);ctx.lineTo(600,180);ctx.lineTo(780,220);ctx.lineTo(970,90);ctx.stroke();
            var qaImage=await new Promise(resolve=>canvas.toBlob(resolve,'image/png'));
            supabaseClient={storage:{from:()=>({download:async()=>({data:qaImage,error:null})})},from:()=>({upsert:async()=>({error:null})})};
            renderAll();document.querySelector('#btnArchivePDF').click();})()`);
        let reportTarget;
        for(let i=0;i<80;i++){
            const all=await(await fetch(`http://127.0.0.1:${port}/json/list`)).json();
            reportTarget=all.find(t=>t.type==='page'&&t.id!==targets.find(t=>t.type==='page').id);
            if(reportTarget)break;
            await new Promise(r=>setTimeout(r,75));
        }
        assert.ok(reportTarget,'PDF report opens');
        const r=await connect(reportTarget.webSocketDebuggerUrl);
        try {
            await r.send('Page.enable');await r.send('Runtime.enable');
            await r.wait("!!document.querySelector('#printReport') && !document.querySelector('#printReport').disabled");
            assert.equal(await r.ev('document.images.length'),1);
            assert.ok(await r.ev("document.images[0].src.startsWith('data:image/png;base64,') && document.images[0].naturalWidth===1000"));
            assert.equal(await r.ev("document.querySelectorAll('main > article').length"),2);
            assert.match(await r.ev("document.querySelector('.psychology-report').textContent"),/Respeitei meu stop/);
            assert.match(await r.ev("document.querySelector('.psychology-report').textContent"),/Preciso recuperar/);
            assert.match(await r.ev('document.body.textContent'),/Antecipação/);
            await r.send('Emulation.setDeviceMetricsOverride',{width:1100,height:1300,deviceScaleFactor:1,mobile:false});
            await shot('archives-pdf-report',r);
            await r.ev("document.querySelector('.psychology-report').scrollIntoView()");
            await shot('archives-pdf-psychology',r);
            const pdf=await r.send('Page.printToPDF',{printBackground:true,preferCSSPageSize:true});
            fs.writeFileSync(path.join(out,'archives-report.pdf'),Buffer.from(pdf.data,'base64'));
            assert.equal(r.errors.length,0);
        } finally {r.close();}
        await c.send('Emulation.setDeviceMetricsOverride',{width:390,height:844,deviceScaleFactor:1,mobile:true});
        await c.ev("document.querySelector('#archiveToolbar').scrollIntoView()");await shot('archives-mobile');
        assert.equal(await c.ev('document.documentElement.scrollWidth <= innerWidth'),true,'No mobile page overflow');
        await c.ev("document.querySelector('#btnArchiveRestore').click()");
        await c.wait('!DiaryArchives.busy');
        assert.equal(await c.ev('filteredManualTrades().length'),2,'Restore through UI works');
        assert.equal(await c.ev('state.trades[0].attachment.path'),'qa/chart.png');
        assert.deepEqual(await c.ev('qaAlerts'),[]);
        assert.equal(c.errors.length,0,JSON.stringify(c.errors));
        console.log('PASS: desktop/mobile, six reset views including psychology, archived review, history/reload, restore, unchanged fees/robot, embedded image and psychology in printed PDF.');
    } finally {if(c.errors.length)console.error(JSON.stringify(c.errors));c.close();}
})().catch(error=>{console.error(error);process.exitCode=1;});
