const assert=require('node:assert/strict'),M=require('./diario-mentor.js');
const key='fake-api-key-for-testing-only';
const packet=M.buildContext({day:'2026-10-20',diary:[],executions:[],meta:{reviews:{'2026-10-20':{lesson:'Rever o plano'}}}});
const ids=[packet.evidence[0].id];
const report={summary:'Rever a disciplina.',strengths:[],patterns:[],priority:{rule:'focus',focus:'Plano',action:'Revisar',trigger:'Antes',metric:'Registro',evidenceIds:ids},trainingPlan:[{session:1,exercise:'Rever',measurement:'Anotar',completionRule:'Revisado',evidenceIds:ids}],questions:[],limits:[]};
const listed=names=>({ok:true,json:async()=>({models:names.map(name=>({name:'models/'+name,supportedGenerationMethods:['generateContent']}))})});
const good=(value=report)=>({ok:true,json:async()=>({candidates:[{finishReason:'STOP',content:{parts:[{text:JSON.stringify(value)}]}}]})});
const setup=fn=>{const calls=[];return {calls,fetcher:async(url,options)=>{assert.equal(options.headers['x-goog-api-key'],key);assert.ok(!url.includes(key));if(url.includes('?pageSize'))return listed(M.MODEL_ORDER);const model=url.split('/').pop().split(':')[0];calls.push(model);return fn(model,options,calls);}};};
(async()=>{
 let t=setup((m,o,c)=>c.length===1?{ok:false,status:503}:good());
 let result=await M.analyzeWithFallback({key,packet,...t});assert.equal(result.model,M.MODEL_ORDER[1]);assert.deepEqual(t.calls,M.MODEL_ORDER.slice(0,2));
 t=setup((m,o,c)=>c.length===1?good({...report,priority:{...report.priority,evidenceIds:['FAKE']}}):good());
 result=await M.analyzeWithFallback({key,packet,...t});assert.equal(result.model,M.MODEL_ORDER[1],'Invalid evidence triggers another model, never saves invalid report');
 t=setup((m,o,c)=>c.length===1?new Promise(()=>{}):good());
 result=await M.analyzeWithFallback({key,packet,...t,timeoutMs:10});assert.equal(result.model,M.MODEL_ORDER[1],'Unresponsive request times out even when transport ignores abort');
 t=setup((m,o,c)=>c.length<6?{ok:false,status:429}:good());result=await M.analyzeWithFallback({key,packet,...t});assert.equal(result.model,'gemma-4-31b-it');assert.equal(t.calls.length,6);
 let gemmaBody;
 result=await M.analyzeWithFallback({key,packet,fetcher:async(url,o)=>{if(url.includes('?pageSize'))return listed(['gemma-4-31b-it']);gemmaBody=JSON.parse(o.body);return good();}});
 assert.equal(gemmaBody.generationConfig.responseFormat,undefined);assert.ok(gemmaBody.systemInstruction.parts[0].text.includes('"properties"'));assert.equal(result.model,'gemma-4-31b-it');
 let generation=0;await assert.rejects(M.analyzeWithFallback({key,packet,fetcher:async url=>{if(url.includes('?pageSize'))return listed(['unrelated-image']);generation++;return good();}}),/Nenhum dos modelos/);assert.equal(generation,0);
 for(const response of [{ok:false,status:401},{ok:true,json:async()=>({promptFeedback:{blockReason:'SAFETY'}})}]){t=setup(()=>response);await assert.rejects(M.analyzeWithFallback({key,packet,...t}));assert.equal(t.calls.length,1,'Fatal auth or safety refusal never cascades');}
 const controller=new AbortController();t=setup(()=>{controller.abort();return new Promise(()=>{});});await assert.rejects(M.analyzeWithFallback({key,packet,...t,signal:controller.signal}),/cancelada/);assert.equal(t.calls.length,1);
 t=setup(()=>({ok:false,status:429}));await assert.rejects(M.analyzeWithFallback({key,packet,...t}),/Nenhum modelo.*Cota/);assert.equal(t.calls.length,6);
 let listCalls=0;t=setup(()=>good());const transport=t.fetcher;result=await M.analyzeWithFallback({key,packet,fetcher:(url,o)=>{if(url.includes('?pageSize')){listCalls++;return Promise.resolve({ok:false,status:503});}return transport(url,o);}});assert.equal(result.model,M.DEFAULT_MODEL);assert.equal(listCalls,1);
 const saved={version:1,model:result.model,packet,report:result.report,signature:M.signature(packet),createdAt:new Date().toISOString()};assert.ok(M.renderReport(saved).includes('Modelo que realizou esta análise:</strong> '+result.model));
 console.log('PASS: ordered fallback, availability, timeout, quota, Gemma transport, invalid evidence, auth/safety stop, cancellation, finite exhaustion, catalog failure and model attribution.');
})().catch(e=>{console.error(e);process.exitCode=1;});
