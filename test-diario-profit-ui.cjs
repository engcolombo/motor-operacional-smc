/* Optional browser integration test: node test-diario-profit-ui.cjs DEBUG_PORT BASE_URL CSV_PATH ARTIFACT_DIR */
const fs=require('node:fs'),assert=require('node:assert/strict'),path=require('node:path');
const [port,base,csvPath,out,tvPath]=process.argv.slice(2);
if(!port||!base||!csvPath||!out)throw Error('Provide DEBUG_PORT BASE_URL CSV_PATH ARTIFACT_DIR for an isolated Chrome profile.');
fs.mkdirSync(out,{recursive:true});
(async()=>{
 const targets=await(await fetch('http://127.0.0.1:'+port+'/json/list')).json();
 const socket=new WebSocket(targets.find(t=>t.type==='page').webSocketDebuggerUrl);
 await new Promise((resolve,reject)=>{socket.onopen=resolve;socket.onerror=reject;});
 let sequence=0;const pending=new Map(),errors=[];
 socket.onmessage=e=>{const m=JSON.parse(e.data);if(m.method==='Runtime.exceptionThrown')errors.push(m.params.exceptionDetails);if(m.id){const p=pending.get(m.id);pending.delete(m.id);m.error?p.reject(m.error):p.resolve(m.result);}};
 const send=(method,params={})=>new Promise((resolve,reject)=>{const id=++sequence;pending.set(id,{resolve,reject});socket.send(JSON.stringify({id,method,params}));});
 const ev=async expression=>{const r=await send('Runtime.evaluate',{expression,returnByValue:true,awaitPromise:true});if(r.exceptionDetails)throw Error(JSON.stringify(r.exceptionDetails));return r.result.value;};
 const wait=async expression=>{for(let i=0;i<100;i++){if(await ev(expression))return;await new Promise(r=>setTimeout(r,50));}throw Error('Timed out: '+expression);};
 const stored=()=>ev("JSON.parse(localStorage.getItem('diarioProfit_v1_guest')||'null')");
 const click=sel=>ev('document.querySelector('+JSON.stringify(sel)+').click()');
 const shot=async name=>{await ev('new Promise(r=>requestAnimationFrame(()=>requestAnimationFrame(r)))');const s=await send('Page.captureScreenshot',{format:'png'});fs.writeFileSync(path.join(out,name+'.png'),Buffer.from(s.data,'base64'));};
 const upload=async(selector,file)=>{const d=await send('DOM.getDocument');const q=await send('DOM.querySelector',{nodeId:d.root.nodeId,selector});await send('DOM.setFileInputFiles',{nodeId:q.nodeId,files:[file]});};
 const reload=async()=>{await send('Page.navigate',{url:base+'/diario-pro-plus.html'});await wait("typeof ProfitTrades!=='undefined' && !!document.querySelector('#pfCSV')");await click('[data-view="profit"]');await ev('window.confirm=()=>true');if(await ev("!!document.querySelector('[data-tab=day]')"))await click('[data-tab="day"]');};
 await send('Page.enable');await send('Runtime.enable');await send('DOM.enable');
 await send('Emulation.setDeviceMetricsOverride',{width:1440,height:1000,deviceScaleFactor:1,mobile:false});
 await reload();await ev("localStorage.removeItem('diarioProfit_v1_guest');localStorage.removeItem('diarioProTrades_v1')");await reload();
 await shot('profit-empty-desktop');
 assert.equal(await ev('document.querySelector("[data-view=profit]").previousElementSibling.textContent.trim()'),'Checklist de Trade');
 assert.equal(await ev('document.querySelector("[data-view=profit]").textContent.trim()'),'Psicologia · revisão diária e evolução');
 await ev('state.trades=[{id:"journal-only-qa",dateLocal:"2026-10-15T09:00",symbol:"WIN",side:"long",status:"target",pnl:200,r:2,setup:"POI",notes:"Estrutura registrada",stopMoney:100,targetMoney:200}];saveTrades();ProfitTrades.render(true);');
 await click('[data-tab="desk"]');
 assert.match(await ev("document.querySelector('.pf-diary-context').textContent"),/1 registros/);
 assert.equal(await ev("document.querySelector('#pfAccount').value"),'__diary__');
 await ev('state.trades=[];saveTrades();ProfitTrades.render(true);');

 await upload('#pfCSV',csvPath);await wait("!!document.querySelector('[data-action=\"confirm-import\"]')");
 assert.match(await ev("document.querySelector('.pf-import-preview').textContent"),/76 operações fechadas/);
 await click('[data-action="confirm-import"]');await click('[data-tab="day"]');assert.equal((await stored()).trades.length,76);
 assert.equal(await ev("document.querySelector('#pfDay').value"),'2026-10-15');
 await shot('profit-day-desktop');
 await upload('#pfCSV',csvPath);await wait("!!document.querySelector('[data-action=\"confirm-import\"]')");
 assert.match(await ev("document.querySelector('.pf-import-preview').textContent"),/76 repetidas ignoradas/);
 await click('[data-action="confirm-import"]');assert.equal((await stored()).trades.length,76);
 await ev('var n=document.querySelector("[data-review=good]");n.value="Pausa respeitada <img src=x onerror=alert(1)>";n.dispatchEvent(new Event("input",{bubbles:true}));');
 let saved=await stored();const key=Object.keys(saved.accounts)[0];
 assert.equal(saved.accounts[key].reviews['2026-10-15'].good,'Pausa respeitada <img src=x onerror=alert(1)>');
 await reload();assert.match(await ev("document.querySelector('[data-review=\"good\"]').value"),/Pausa respeitada/);
 assert.equal(await ev("document.querySelectorAll('#view-profit img').length"),0);
 await ev('document.querySelector(".pf-settings").open=true;document.querySelector("[name=maxTrades]").value="6";document.querySelector("[name=pauseMinutes]").value="10";document.querySelector("#pfRules").requestSubmit();');
 saved=await stored();assert.equal(saved.accounts[key].settings.maxTrades,6);assert.equal(saved.accounts[key].reviews['2026-10-15'].rules.maxTrades,8,'Historical review keeps original rules');
 assert.match(await ev("document.querySelector('.pf-promises').textContent"),/até 6 entradas/);
 await ev('document.querySelector("#pfPlanDate").value="2026-10-16";document.querySelector("#pfFocus").value="Se sentir urgência, rever checklist e esperar.";document.querySelector("#pfPriority").value="spacing";document.querySelector("#pfPlan").requestSubmit();');
 saved=await stored();assert.equal(saved.accounts[key].plans['2026-10-16'].rules.maxTrades,6);assert.equal(saved.accounts[key].plans['2026-10-16'].rules.pauseMinutes,10);
 await click('[data-tab="evolution"]');assert.match(await ev("document.querySelector('#view-profit').textContent"),/16\/10\/2026/);
 await shot('profit-evolution-desktop');
 const text=fs.readFileSync(csvPath).toString('latin1'),head=text.split(/\r?\n/).find(l=>l.startsWith('Ativo;'));
 const acct=saved.trades[0].account;
 const make=(o,c,pnl,side)=>['WINZ26','16/10/2026 '+o,'16/10/2026 '+c,'10min','1','1',side,'200.000,00','200.010,00','200.100,00','Não',pnl,'50',pnl,'50','10min','0,00','0,00'].join(';');
 const nextCsv=path.join(out,'next-session.csv');fs.writeFileSync(nextCsv,'Conta: '+acct+'\n'+head+'\n'+make('09:00:00','09:10:00','-100,00','C')+'\n'+make('09:11:00','09:20:00','-50,00','V'),'latin1');
 await upload('#pfCSV',nextCsv);await wait("!!document.querySelector('[data-action=\"confirm-import\"]')");await click('[data-action="confirm-import"]');await click('[data-tab="day"]');
 assert.match(await ev("document.querySelector('.pf-due').textContent"),/Compromissos para hoje/);
 assert.match(await ev("document.querySelector('.pf-due').textContent"),/1 entradas próximas/);
 await ev('document.querySelector(".pf-table-card").open=true;var n=document.querySelector("[data-field=exit]");n.value="stop";n.dispatchEvent(new Event("change",{bubbles:true}));');
 await ev('document.querySelector(".pf-table-card").open=true;var n=document.querySelectorAll("[data-field=exit]")[1];n.value="stop";n.dispatchEvent(new Event("change",{bubbles:true}));');
 assert.match(await ev("document.querySelector('.pf-kpis').textContent"),/2 stops consecutivos/);
 await ev('var n=document.querySelector("#pfReflection");n.value="yes";n.dispatchEvent(new Event("change",{bubbles:true}));');
 assert.equal((await stored()).accounts[key].plans['2026-10-16'].reflection,'yes');
 const before=JSON.stringify(await stored());
 await ev('window.originalSet=Storage.prototype.setItem;Storage.prototype.setItem=function(k,v){if(k.startsWith("diarioProfit"))throw Error("quota");return originalSet.call(this,k,v)};var n=document.querySelector("[data-review=good]");n.value="Must not persist";n.dispatchEvent(new Event("input",{bubbles:true}));');
 assert.match(await ev("document.querySelector('#pfStatus').textContent"),/Não foi possível salvar/);assert.equal(JSON.stringify(await stored()),before);
 await ev('Storage.prototype.setItem=originalSet');
 await ev("currentUser={id:'qa-other-profile'};ProfitTrades.authChanged()");assert.ok(await ev("!!document.querySelector('.pf-empty')"));
 await ev("currentUser=null;ProfitTrades.authChanged()");assert.equal((await stored()).trades.length,78);
 const downloads=path.join(out,'downloads-'+Date.now());fs.mkdirSync(downloads);
 await send('Browser.setDownloadBehavior',{behavior:'allow',downloadPath:path.resolve(downloads)});
 await click('[data-action="backup"]');
 let backupFile;for(let i=0;i<100;i++){backupFile=fs.readdirSync(downloads).find(x=>/^trades-profit-backup-.*\.json$/.test(x));if(backupFile)break;await new Promise(r=>setTimeout(r,50));}
 assert.ok(backupFile,'Backup download completes');const backup=JSON.parse(fs.readFileSync(path.join(downloads,backupFile),'utf8'));assert.equal(backup.trades.length,78);
 await ev("localStorage.removeItem('diarioProfit_v1_guest')");await reload();await upload('#pfBackup',path.join(downloads,backupFile));await wait("document.querySelector('#pfStatus').textContent.includes('Backup restaurado')");
 assert.equal((await stored()).trades.length,78);assert.equal((await stored()).accounts[key].plans['2026-10-16'].reflection,'yes');
 const bad=path.join(out,'bad-backup.json');fs.writeFileSync(bad,'{"version":999,"trades":[]}');await upload('#pfBackup',bad);await wait("document.querySelector('#pfStatus').textContent.includes('Não foi possível importar')");assert.equal((await stored()).trades.length,78);
 await ev('document.querySelector("#pfDay").value="2026-10-15";document.querySelector("#pfDay").dispatchEvent(new Event("change",{bubbles:true}));');

 // SMC review, tri-state evidence and future commitments.
 await click('[data-tab="day"]');
 const positive=(await stored()).trades.find(t=>t.day==='2026-10-15'&&t.grossCents>0);
 const openReview=()=>ev('Array.from(document.querySelectorAll("[data-edit-smc]")).find(b=>b.dataset.editSmc==='+JSON.stringify(positive.id)+').click()');
 const fillSMC=fields=>ev('Object.entries('+JSON.stringify(fields)+').forEach(([k,v])=>{var f=document.querySelector("#pfSMCForm [name="+k+"]");f.value=v;f.dispatchEvent(new Event("input",{bubbles:true}));})');
 await openReview();assert.equal(await ev("document.querySelector('#pfSMCDialog').open"),true);
 assert.match(await ev("document.querySelector('#pfSMCPreview').textContent"),/R pendente/);
 await fillSMC({riskCents:'200,00',targetCents:'300,00',plannedQty:'2',entryQty:'1',execution:'simple',newSetup:'no',emotion:'fear',stopBasis:'arbitrary',stopChange:'widened',note:'<img src=x onerror=alert(1)> Revisão SMC'});
 assert.match(await ev("document.querySelector('#pfSMCPreview').textContent"),/1,07R/);
 await shot('profit-smc-dialog-desktop');
 await ev("document.querySelector('#pfSMCForm').requestSubmit()");
 assert.equal(await ev("document.querySelector('#pfSMCDialog').open"),false);
 saved=await stored();let smcNote=saved.accounts[key].annotations[positive.id];
 assert.equal(smcNote.riskCents,20000);assert.equal(smcNote.plannedQty,2);assert.equal(smcNote.emotion,'fear');
 assert.match(await ev("document.querySelector('.pf-smc').textContent"),/1 ganhos|Ganhos abaixo/);
 assert.match(await ev("document.querySelector('#view-profit').textContent"),/Discrepância de contratos confirmada/);
 assert.match(await ev("document.querySelector('#view-profit').textContent"),/Stop fora do plano na revisão/);
 assert.equal(await ev("document.querySelectorAll('#view-profit img').length"),0);
 await click('[data-adopt-coach="1"]');
 assert.match(await ev("document.querySelector('#pfFocus').value"),/risco inicial total/);
 assert.deepEqual(await ev('Array.from(document.querySelectorAll("#pfPlan input:checked")).map(x=>x.value)'),['rr','exitR']);
 await ev("document.querySelector('#pfPlan').requestSubmit()");
 assert.ok((await stored()).accounts[key].plans['2026-10-16'].items.includes('rr'));
 await reload();
 assert.equal((await stored()).accounts[key].annotations[positive.id].riskCents,20000);
 await ev('document.querySelector("#pfDay").value="2026-10-15";document.querySelector("#pfDay").dispatchEvent(new Event("change",{bubbles:true}));');
 await openReview();const beforeInvalid=JSON.stringify(await stored());
 await fillSMC({riskCents:'-1'});await ev("document.querySelector('#pfSMCForm').requestSubmit()");
 assert.match(await ev("document.querySelector('#pfSMCError').textContent"),/positivos/);
 assert.equal(JSON.stringify(await stored()),beforeInvalid);
 await fillSMC({riskCents:'200,00',entryQty:'2'});await ev("document.querySelector('#pfSMCForm').requestSubmit()");
 assert.match(await ev("document.querySelector('#pfSMCError').textContent"),/quantidade confirmada/);
 assert.equal(JSON.stringify(await stored()),beforeInvalid);
 await click('#pfSMCDialog [data-action="close-smc"]');
 await send('Emulation.setDeviceMetricsOverride',{width:390,height:844,deviceScaleFactor:1,mobile:true});
 await openReview();await shot('profit-smc-dialog-390');
 assert.equal(await ev("document.querySelector('#pfSMCDialog').scrollWidth<=document.querySelector('#pfSMCDialog').clientWidth"),true,'SMC dialog fits mobile');
 await click('#pfSMCDialog [data-action="close-smc"]');
 // A CSV alone does not mark SMC promises fulfilled.
 await ev('document.querySelector("#pfDay").value="2026-10-16";document.querySelector("#pfDay").dispatchEvent(new Event("change",{bubbles:true}));');
 assert.match(await ev("document.querySelector('.pf-due').textContent"),/Pendente/);
 await click('[data-tab="evolution"]');
 assert.match(await ev("document.querySelector('#view-profit').textContent"),/Evolução da execução SMC/);
 assert.match(await ev("document.querySelector('#view-profit').textContent"),/critérios pendentes de revisão/);
 await click('[data-tab="day"]');
 await ev('document.querySelector("#pfDay").value="2026-10-15";document.querySelector("#pfDay").dispatchEvent(new Event("change",{bubbles:true}));');
 await send('Emulation.setDeviceMetricsOverride',{width:1440,height:1000,deviceScaleFactor:1,mobile:false});
 await shot('profit-smc-day-desktop');


 // Reconciliation is severe until the journal covers the executions.
 await click('[data-tab="desk"]');
 assert.match(await ev("document.querySelector('.pf-reconciliation').textContent"),/Falha grave/);
 await shot('psychology-missing-records');
 await ev('state.trades=JSON.parse(localStorage.getItem("diarioProfit_v1_guest")).trades.map((t,i)=>({id:"journal-"+i,qaProfitId:t.id,dateLocal:t.open.slice(0,16),date:t.open+"Z",symbol:t.symbol,side:t.side==="C"?"long":"short",status:t.grossCents>0?"target":t.grossCents<0?"stop":"breakeven",pnl:t.grossCents/100,r:t.grossCents>0?2:t.grossCents<0?-1:0,initQty:t.qty,setup:"Setup registrado",notes:"Estrutura e gatilho descritos no diário",mistakes:[]}));saveTrades();ProfitTrades.render(true);');

 // Desk report and accountability workflow.
 await click('[data-tab="desk"]');
 assert.match(await ev("document.querySelector('.pf-desk-verdict').textContent"),/Quebra de controle/);
 assert.equal(await ev("document.querySelector('[name=quickMinutes]').value"),'10');
 assert.equal(await ev("document.querySelectorAll('.pf-desk-chapter').length"),7);
 assert.match(await ev("document.querySelector('.pf-desk-episode').textContent"),/Antes da entrada/);
 await shot('profit-desk-desktop');
 await ev("document.querySelector('.pf-desk-chapter').scrollIntoView()");await shot('profit-desk-chapters-desktop');
 await ev("document.querySelector('#pfDeskForm').scrollIntoView()");await shot('profit-desk-debrief-desktop');
 await ev("document.querySelector('#pfDeskForm').requestSubmit()");
 assert.match(await ev("document.querySelector('#pfDeskError').textContent"),/Complete o episódio/);
 await click('[data-desk-episode="0"]');
 assert.ok((await stored()).accounts[key].reviews['2026-10-15'].desk.moment.length>20);
 await ev('Object.entries({thought:"Eu queria recuperar logo, conforme meu relato.",feeling:"Pressa e frustração percebidas.",choice:"Entrei antes do intervalo do meu plano.",alternative:"Esperar 10 minutos e um novo setup.",action:"Se sentir urgência, vou revisar o checklist antes de enviar a ordem.",proof:"Nenhum intervalo menor que 10 minutos e todas as entradas documentadas."}).forEach(([k,v])=>{var t=document.querySelector("#pfDeskForm [name="+k+"]");t.value=v;t.dispatchEvent(new Event("input",{bubbles:true}));})');
 await ev("document.querySelector('#pfDeskForm').requestSubmit()");
 assert.match(await ev("document.querySelector('#pfDeskError').textContent"),/Confirme/);
 await click('[data-action="desk-plan"]');await ev("document.querySelector('#pfPlan').requestSubmit()");
 assert.ok((await stored()).accounts[key].plans['2026-10-16'].items.includes('stop'));
 // A completed narrative cannot bypass a real reconciliation gap.
 await ev('window.qaSavedDiary=state.trades;state.trades=state.trades.filter((t,i)=>i!==state.trades.findIndex(x=>x.dateLocal.startsWith("2026-10-15")));ProfitTrades.render(true);document.querySelector("#pfDeskAck").checked=true;document.querySelector("#pfDeskForm").requestSubmit();');
 assert.match(await ev("document.querySelector('#pfDeskError').textContent"),/Conciliação obrigatória/);
 await ev('state.trades=window.qaSavedDiary;ProfitTrades.render(true);');

 await ev("document.querySelector('#pfDeskAck').checked=true;document.querySelector('#pfDeskForm').requestSubmit()");
 assert.match(await ev("document.querySelector('#pfDeskBadge').textContent"),/Debrief concluído/);
 assert.equal((await stored()).accounts[key].reviews['2026-10-15'].desk.completed,true);
 await reload();await click('[data-tab="desk"]');
 // Restore the date because the most recent imported date is Oct 16.
 await ev('document.querySelector("#pfDay").value="2026-10-15";document.querySelector("#pfDay").dispatchEvent(new Event("change",{bubbles:true}));');
 assert.match(await ev("document.querySelector('#pfDeskBadge').textContent"),/Debrief concluído/);
 assert.equal(await ev("document.querySelector('#pfDeskForm [name=proof]').value"),'Nenhum intervalo menor que 10 minutos e todas as entradas documentadas.');
 await click('[data-tab="day"]');
 await ev('var t=document.querySelector("[data-review=trigger]");t.value="Nova evidência de contexto <img src=x onerror=alert(1)>";t.dispatchEvent(new Event("input",{bubbles:true}));');
 await click('[data-tab="desk"]');
 assert.match(await ev("document.querySelector('#pfDeskBadge').textContent"),/reconferir/);
 assert.equal(await ev("document.querySelectorAll('#view-profit img').length"),0);
 for(const width of [390,320]){
  await send('Emulation.setDeviceMetricsOverride',{width,height:844,deviceScaleFactor:1,mobile:true});await ev('window.scrollTo(0,0)');
  await shot('profit-desk-'+width);
  await ev("document.querySelector('.pf-desk-chapter').scrollIntoView()");await shot('profit-desk-chapters-'+width);
  await ev("document.querySelector('#pfDeskForm').scrollIntoView()");await shot('profit-desk-debrief-'+width);
  assert.equal(await ev('document.documentElement.scrollWidth<=innerWidth'),true,'Desk report fits '+width);
 }
 await send('Emulation.setDeviceMetricsOverride',{width:1440,height:1000,deviceScaleFactor:1,mobile:false});
 await click('[data-tab="day"]');

 for(const width of [390,320]){
  await send('Emulation.setDeviceMetricsOverride',{width,height:844,deviceScaleFactor:1,mobile:true});await ev('window.scrollTo(0,0)');
  await shot('profit-day-'+width);
  assert.equal(await ev('document.documentElement.scrollWidth<=innerWidth'),true,'No page overflow at '+width);
  await click('[data-tab="evolution"]');await shot('profit-evolution-'+width);
  assert.equal(await ev('document.documentElement.scrollWidth<=innerWidth'),true,'No evolution page overflow at '+width);
  await click('[data-tab="day"]');
 }
 await send('Emulation.setDeviceMetricsOverride',{width:1440,height:1000,deviceScaleFactor:1,mobile:false});

 // Preparation, concrete priority, self-report and comparisons.
 await click('[data-tab="day"]');
 await ev('document.querySelector("#pfDay").value="2026-10-16";document.querySelector("#pfDay").dispatchEvent(new Event("change",{bubbles:true}));');
 await ev('var n=document.querySelector("[data-followup=noticed]");n.value="before";n.dispatchEvent(new Event("change",{bubbles:true}));var b=document.querySelector("[data-followup=barrier]");b.value="notused";b.dispatchEvent(new Event("change",{bubbles:true}));var t=document.querySelector("[data-followup=evidence]");t.value="Percebi a pressa <img src=x onerror=alert(1)>";t.dispatchEvent(new Event("input",{bubbles:true}));');
 assert.equal((await stored()).accounts[key].plans['2026-10-16'].contract.barrier,'notused');
 await click('[data-tab="preparation"]');
 await ev('document.querySelector("#pfPrepDate").value="2026-10-19";document.querySelector("#pfPrepDate").dispatchEvent(new Event("change",{bubbles:true}));');
 await ev('document.querySelector("#pfPrepForm").requestSubmit()');
 assert.match(await ev("document.querySelector('#pfPrepError').textContent"),/Preencha/);
 const prepValues={sleep:'rested',tension:'2',urge:'0',riskCents:'100,00',setups:'Estrutura e novo gatilho <img src=x onerror=alert(1)>',exceptions:'Somente minha exceção prevista',trigger:'Urgência de recuperar',response:'Cumprir a pausa e registrar novo setup antes da ordem'};
 await ev('Object.entries('+JSON.stringify(prepValues)+').forEach(([k,v])=>document.querySelector("#pfPrepForm [name="+k+"]").value=v);document.querySelector("#pfPrepForm").requestSubmit();');
 assert.equal((await stored()).accounts[key].preparations['2026-10-19'].riskCents,10000);
 assert.match(await ev("document.querySelector('#pfPrepState').textContent"),/aguardando operações/);
 const prepBefore=JSON.stringify((await stored()).accounts[key].preparations);
 await ev('document.querySelector("#pfPrepForm [name=riskCents]").value="-1";document.querySelector("#pfPrepForm").requestSubmit()');
 assert.match(await ev("document.querySelector('#pfPrepError').textContent"),/positivo/);
 assert.equal(JSON.stringify((await stored()).accounts[key].preparations),prepBefore);
 await reload();await click('[data-tab="preparation"]');
 await ev('document.querySelector("#pfPrepDate").value="2026-10-19";document.querySelector("#pfPrepDate").dispatchEvent(new Event("change",{bubbles:true}));');
 assert.equal(await ev("document.querySelector('#pfPrepForm [name=response]').value"),prepValues.response);
 assert.equal(await ev("document.querySelectorAll('#view-profit img').length"),0);
 await shot('profit-preparation-desktop');
 await ev('document.querySelector("#pfPrepDate").value="2026-10-15";document.querySelector("#pfPrepDate").dispatchEvent(new Event("change",{bubbles:true}));');
 await ev('Object.entries('+JSON.stringify(prepValues)+').forEach(([k,v])=>document.querySelector("#pfPrepForm [name="+k+"]").value=v);document.querySelector("#pfPrepForm").requestSubmit();');
 assert.match(await ev("document.querySelector('#pfPrepState').textContent"),/após a primeira entrada/);
 assert.equal(await ev("document.querySelector('#pfPrepForm fieldset').disabled"),true);
 const lockedPrep=JSON.stringify((await stored()).accounts[key].preparations['2026-10-15']);
 await ev("document.querySelector('#pfPrepForm').requestSubmit()");
 assert.match(await ev("document.querySelector('#pfPrepError').textContent"),/preservada/);
 assert.equal(JSON.stringify((await stored()).accounts[key].preparations['2026-10-15']),lockedPrep);
 await click('[data-tab="insights"]');
 assert.equal(await ev("document.querySelectorAll('.pf-comparison').length"),3);
 assert.match(await ev("document.querySelector('.pf-weekly').textContent"),/Ação não utilizada/);
 await ev('document.querySelector("#pfInsightAsset").value="WDOX26";document.querySelector("#pfInsightAsset").dispatchEvent(new Event("change",{bubbles:true}));');
 assert.equal(await ev("document.querySelector('#pfInsightAsset').value"),'WDOX26');
 await shot('profit-insights-desktop');
 for(const width of [390,320]){
  await send('Emulation.setDeviceMetricsOverride',{width,height:844,deviceScaleFactor:1,mobile:true});
  await ev("document.querySelector('.pf-comparison').scrollIntoView()");
  await shot('profit-insights-'+width);
  assert.equal(await ev('document.documentElement.scrollWidth<=innerWidth'),true,'Insights fit '+width);
  await click('[data-tab="preparation"]');
  await ev("document.querySelector('#pfPrepForm').scrollIntoView()");await shot('profit-preparation-'+width);
  assert.equal(await ev('document.documentElement.scrollWidth<=innerWidth'),true,'Preparation fits '+width);
  await click('[data-tab="insights"]');
 }
 await send('Emulation.setDeviceMetricsOverride',{width:1440,height:1000,deviceScaleFactor:1,mobile:false});


 // Confirmed journal links enrich absent data without duplicating PnL.
 const candidate=(await stored()).trades.find(t=>t.day==='2026-10-15'&&t.grossCents>0&&t.id!==positive.id);
 await ev('var t=state.trades.find(x=>x.qaProfitId==='+JSON.stringify(candidate.id)+');t.stopMoney=123;t.targetMoney=246;t.notes="Racional registrado <img src=x onerror=alert(1)>";saveTrades();');
 const diaryId=await ev('state.trades.find(x=>x.qaProfitId==='+JSON.stringify(candidate.id)+').id');
 await click('[data-tab="journal"]');
 await ev('document.querySelector("#pfDay").value="2026-10-15";document.querySelector("#pfDay").dispatchEvent(new Event("change",{bubbles:true}));');
 await ev('var row=Array.from(document.querySelectorAll("[data-profit-row]")).find(x=>x.dataset.profitRow==='+JSON.stringify(candidate.id)+');row.querySelector("[data-journal-choice]").value='+JSON.stringify(diaryId)+';row.querySelector("[data-journal-link]").click();');
 assert.equal((await stored()).journalLinks[candidate.id].diaryId,diaryId);
 assert.equal(await ev("document.querySelectorAll('#view-profit img').length"),0);
 await shot('psychology-journal-desktop');
 await click('[data-tab="day"]');
 await ev('Array.from(document.querySelectorAll("[data-edit-smc]")).find(x=>x.dataset.editSmc==='+JSON.stringify(candidate.id)+').click()');
 assert.equal(await ev("document.querySelector('#pfSMCForm [name=riskCents]').value"),'123,00');
 assert.equal(await ev("document.querySelector('#pfSMCForm [name=newSetup]').value"),'unknown');
 assert.equal(await ev("document.querySelector('#pfSMCForm [name=stopBasis]').value"),'unknown');
 await click('#pfSMCDialog [data-action="close-smc"]');
 assert.match(await ev("document.querySelector('.pf-kpis').textContent"),/332/);
 await click('[data-tab="journal"]');
 await ev('state.trades.find(x=>x.id==='+JSON.stringify(diaryId)+').notes="Contexto atualizado pelo diário";saveTrades();renderAll();');
 assert.match(await ev("document.querySelector('.pf-journal-links').textContent"),/Contexto atualizado pelo diário/);
 await reload();await click('[data-tab="journal"]');
 await ev('document.querySelector("#pfDay").value="2026-10-15";document.querySelector("#pfDay").dispatchEvent(new Event("change",{bubbles:true}));');
 assert.equal((await stored()).journalLinks[candidate.id].diaryId,diaryId);
 for(const width of [390,320]){
  await send('Emulation.setDeviceMetricsOverride',{width,height:844,deviceScaleFactor:1,mobile:true});
  await ev("document.querySelector('.pf-reconciliation').scrollIntoView()");await shot('psychology-journal-'+width);
  assert.equal(await ev('document.documentElement.scrollWidth<=innerWidth'),true,'Journal reconciliation fits '+width);
 }
 await send('Emulation.setDeviceMetricsOverride',{width:1440,height:1000,deviceScaleFactor:1,mobile:false});

 await click('[data-view="dashboard"]');assert.equal(await ev("document.querySelector('#view-dashboard').classList.contains('active')"),true);
 await click('[data-view="profit"]');

 if(tvPath){
  const beforeTV=await stored(),profitCount=beforeTV.trades.length,profitKey=key;
  assert.equal(await ev('document.querySelector("[data-action=import-tv]").textContent'),'Importar CSV do TradingView');
  await upload('#pfTVCSV',tvPath);await wait("!!document.querySelector('[data-action=\"confirm-import\"]')");
  assert.match(await ev("document.querySelector('.pf-import-preview').textContent"),/2 operações fechadas/);
  assert.match(await ev("document.querySelector('.pf-import-preview').textContent"),/1 abertas ignoradas/);
  await click('[data-action="confirm-import"]');await click('[data-tab="day"]');
  assert.equal((await stored()).trades.length,profitCount+2);
  assert.equal(await ev("document.querySelector('#pfAccount').value"),'tradingview:paper:USD');
  assert.match(await ev("document.querySelector('.pf-kpis').textContent"),/US\$.*4,76/);
  assert.doesNotMatch(await ev("document.querySelector('.pf-kpis').textContent"),/R\$/);
  assert.match(await ev("document.querySelector('#pfRules').textContent"),/USD/);
  assert.match(await ev("document.querySelector('#view-profit').textContent"),/Paper Trading/);
  await upload('#pfTVCSV',tvPath);await wait("!!document.querySelector('[data-action=\"confirm-import\"]')");
  assert.match(await ev("document.querySelector('.pf-import-preview').textContent"),/2 repetidas ignoradas/);
  await click('[data-action="confirm-import"]');assert.equal((await stored()).trades.length,profitCount+2);
  const tvTrade=(await stored()).trades.find(t=>t.source==='tradingview');
  await ev('state.trades.push({id:"tv-diary-qa",dateLocal:'+JSON.stringify(tvTrade.open)+',symbol:"BTCUSDT",side:"short",status:"stop",pnl:-20,stopMoney:100,targetMoney:200,initQty:0.01,setup:"POI simulado",notes:"Estrutura revisada no Paper Trading"});saveTrades();ProfitTrades.render(true);');
  await click('[data-tab="journal"]');
  assert.match(await ev("document.querySelector('.pf-reconciliation').textContent"),/Faltam pelo menos 2/);
  await ev('var row=Array.from(document.querySelectorAll("[data-profit-row]")).find(x=>x.dataset.profitRow==='+JSON.stringify(tvTrade.id)+');row.querySelector("[data-journal-choice]").value="tv-diary-qa";row.querySelector("[data-journal-link]").click();');
  assert.equal((await stored()).journalLinks[tvTrade.id].diaryId,'tv-diary-qa');
  assert.match(await ev("document.querySelector('.pf-reconciliation').textContent"),/Faltam pelo menos 1/);
  await click('[data-tab="day"]');
  await ev('Array.from(document.querySelectorAll("[data-edit-smc]")).find(x=>x.dataset.editSmc==='+JSON.stringify(tvTrade.id)+').click()');
  assert.equal(await ev("document.querySelector('#pfSMCForm [name=riskCents]').value"),'');
  assert.equal(await ev("document.querySelector('#pfSMCForm [name=entryQty]').value"),'0.01');
  await ev('document.querySelector("#pfSMCForm [name=riskCents]").value="1,00";document.querySelector("#pfSMCForm [name=plannedQty]").value="0.01";document.querySelector("#pfSMCForm").requestSubmit();');
  const tvKey='account:tradingview:paper:USD';
  assert.equal((await stored()).accounts[tvKey].annotations[tvTrade.id].riskCents,100);
  assert.equal((await stored()).accounts[tvKey].annotations[tvTrade.id].plannedQty,.01);
  assert.deepEqual((await stored()).accounts[profitKey],beforeTV.accounts[profitKey],'TV review does not change Profit plan');
  await shot('psychology-tradingview-desktop');
  for(const width of [390,320]){
   await send('Emulation.setDeviceMetricsOverride',{width,height:844,deviceScaleFactor:1,mobile:true});
   await ev('window.scrollTo(0,0)');await shot('psychology-tradingview-'+width);
   assert.equal(await ev('document.documentElement.scrollWidth<=innerWidth'),true,'TradingView fits '+width);
  }
  await reload();
  await ev('document.querySelector("#pfAccount").value="tradingview:paper:USD";document.querySelector("#pfAccount").dispatchEvent(new Event("change",{bubbles:true}));document.querySelector("#pfDay").value="2026-10-15";document.querySelector("#pfDay").dispatchEvent(new Event("change",{bubbles:true}));');
  assert.match(await ev("document.querySelector('.pf-kpis').textContent"),/US\$.*4,76/);
  assert.equal((await stored()).accounts[tvKey].annotations[tvTrade.id].plannedQty,.01);
 }

 assert.equal(errors.length,0,JSON.stringify(errors));
 console.log('Browser checks passed: CSV import, deduplication, persistent review, rule snapshots, next-day plan evaluation, confirmed stops, quota preservation, profile isolation, backup round-trip, corrupt backup rejection, mobile 390/320, navigation, desk narrative, evidence episodes, completed debrief, reload stability, stale-data detection, preparation, priority follow-up, historical insights, journal-only mode, required reconciliation, linked evidence and diary refresh.');
 socket.close();
})().catch(e=>{console.error(e);process.exit(1);});
