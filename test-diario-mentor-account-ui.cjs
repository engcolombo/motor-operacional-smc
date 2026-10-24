/* Isolated Chrome only. Account storage is simulated; no real key or cloud writes. */
const fs=require('node:fs'),path=require('node:path'),assert=require('node:assert/strict');
const [port,base,out]=process.argv.slice(2);if(!port||!base||!out)throw Error('Usage: node test-diario-mentor-account-ui.cjs DEBUG_PORT BASE_URL ARTIFACT_DIR');
fs.mkdirSync(out,{recursive:true});
(async()=>{
 const targets=await(await fetch(`http://127.0.0.1:${port}/json/list`)).json();
 const target=targets.find(t=>t.type==='page'),socket=new WebSocket(target.webSocketDebuggerUrl),pending=new Map(),errors=[];let id=0;
 await new Promise((resolve,reject)=>{socket.onopen=resolve;socket.onerror=reject;});
 socket.onmessage=e=>{const m=JSON.parse(e.data);if(m.method==='Runtime.exceptionThrown')errors.push(m.params.exceptionDetails);if(m.id){const p=pending.get(m.id);pending.delete(m.id);m.error?p.reject(Error(JSON.stringify(m.error))):p.resolve(m.result);}};
 const send=(method,params={})=>new Promise((resolve,reject)=>{const n=++id;pending.set(n,{resolve,reject});socket.send(JSON.stringify({id:n,method,params}));});
 const ev=async expression=>{const r=await send('Runtime.evaluate',{expression,returnByValue:true,awaitPromise:true,userGesture:true});if(r.exceptionDetails)throw Error(JSON.stringify(r.exceptionDetails));return r.result.value;};
 const wait=async expression=>{for(let i=0;i<140;i++){if(await ev(expression))return;await new Promise(r=>setTimeout(r,50));}throw Error('Timed out: '+expression);};
 const click=selector=>ev('document.querySelector('+JSON.stringify(selector)+').click()');
 const shot=async name=>{const r=await send('Page.captureScreenshot',{format:'png'});fs.writeFileSync(path.join(out,name+'.png'),Buffer.from(r.data,'base64'));};
 try {
  await send('Page.enable');await send('Runtime.discardConsoleEntries');await send('Runtime.enable');await send('Network.enable');
  await send('Network.setBlockedURLs',{urls:['*supabase.co*','*generativelanguage.googleapis.com*']});
  await send('Page.navigate',{url:base+'/diario-pro-plus.html'});await wait("typeof DiaryMentorAccount!=='undefined' && typeof state!=='undefined' && document.querySelector('#pfMentorKey')");
  await ev(`window.qaRows={};window.qaFailure=false;
    supabaseClient={from:()=>{let kind='load',row,id;const run=async()=>{if(qaFailure)return {error:{code:'42501'}};if(kind==='save'){qaRows[row.user_id]=row;return {data:{user_id:row.user_id}};}if(kind==='remove'){delete qaRows[id];return {data:[]};}return {data:qaRows[id]||null};};return {select(){return kind==='remove'?run():this},eq(k,v){id=v;return this},maybeSingle:run,upsert(v){kind='save';row=v;return this},single:run,delete(){kind='remove';return this}}}};
    currentUser={id:'qa-user-a'};currentSession={user:currentUser};psychologyLoadedUser='qa-user-a';cloudBusy=false;ProfitTrades.authChanged();switchView('profit');`);
  await wait("document.querySelector('.mentor-config').textContent.includes('Nenhuma chave salva')");
  await ev("document.querySelector('#pfMentorKey').value='fake-private-account-key-123456789';document.querySelector('[data-mentor=save-key]').click()");
  await wait("document.querySelector('.mentor-config').textContent.includes('Chave sincronizada')");
  assert.equal(await ev('qaRows["qa-user-a"].api_key'),'fake-private-account-key-123456789');
  assert.equal(await ev("JSON.stringify(localStorage).includes('fake-private-account-key')"),false);
  assert.equal(await ev("document.body.innerHTML.includes('fake-private-account-key')"),false);
  await ev("currentUser=null;currentSession=null;ProfitTrades.authChanged()");
  assert.equal(await ev("document.querySelector('[data-mentor=save-key]').disabled"),true);
  await ev("currentUser={id:'qa-user-b'};ProfitTrades.authChanged()");
  await wait("document.querySelector('.mentor-config').textContent.includes('Nenhuma chave salva')");
  await ev("currentUser={id:'qa-user-a'};ProfitTrades.authChanged()");
  await wait("document.querySelector('.mentor-config summary').textContent.includes('salva na conta')");
  await ev('qaFailure=true');await click('[data-mentor=remove-key]');
  await wait("document.querySelector('.mentor-config').textContent.includes('Não foi possível')");
  assert.ok(await ev('qaRows["qa-user-a"]'));
  await ev('qaFailure=false');await click('[data-mentor=remove-key]');
  await wait("document.querySelector('.mentor-config').textContent.includes('Chave removida da conta')");
  assert.equal(await ev('!!qaRows["qa-user-a"]'),false);
  assert.equal(errors.length,0,JSON.stringify(errors));
  console.log('PASS: actual UI save, no key in DOM/localStorage, logout, other user isolation, login reload, delete failure and successful removal.');
 }finally{socket.close();}
})().catch(e=>{console.error(e);process.exitCode=1;});
