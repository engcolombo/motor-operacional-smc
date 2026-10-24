const assert=require('node:assert/strict');
const {create}=require('./diario-mentor-account.js');
const tick=()=>new Promise(r=>setImmediate(r));
(async()=>{
    let user='user-a',failure=null,hold=null,calls=0;
    const rows=new Map(),fakeKey='fake-key-for-unit-testing-only',model='gemini-test';
    const client={from(name){
        assert.equal(name,'mentor_credentials');calls++;
        let kind='load',payload,id;
        const execute=async()=>{
            if(hold)await hold;
            if(failure)return {error:{code:failure,message:fakeKey}};
            if(kind==='save'){rows.set(payload.user_id,{...payload});return {data:{user_id:payload.user_id}};}
            if(kind==='remove'){rows.delete(id);return {data:[]};}
            return {data:rows.get(id)||null};
        };
        return {select(){if(kind==='remove')return execute();return this;},eq(_,value){id=value;return this;},maybeSingle:execute,
            upsert(value){kind='save';payload=value;return this;},single:execute,delete(){kind='remove';return this;}};
    }};
    const make=()=>create({getClient:()=>client,getUser:()=>user});
    const a=make();a.sync();await tick();assert.equal(a.snapshot().saved,false);
    assert.equal(await a.save({key:fakeKey,model}),true);assert.equal(a.snapshot().saved,true);
    const b=make();b.sync();await tick();assert.equal(b.snapshot().key,fakeKey,'Another device loads the same account key');
    user='user-b';b.sync();assert.equal(b.snapshot().key,'','Account change immediately clears key');await tick();assert.equal(b.snapshot().saved,false);
    failure='PGRST205';await b.reload();assert.match(b.snapshot().message,/supabase-mentor.sql/);assert.ok(!b.snapshot().message.includes(fakeKey));failure=null;
    user='user-a';b.sync();await tick();failure='42501';assert.equal(await b.remove(),false);assert.equal(b.snapshot().key,fakeKey,'Failed deletion preserves previous key');failure=null;
    assert.equal(await b.remove(),true);assert.equal(rows.has('user-a'),false);assert.equal(b.snapshot().key,'');
    await b.save({key:fakeKey,model});
    let release;hold=new Promise(r=>release=r);const request=b.reload();user='user-b';b.sync();release();hold=null;await request;await tick();assert.equal(b.snapshot().key,'','Old account response cannot leak after switch');
    user=null;b.sync();const count=calls;assert.equal(await b.save({key:fakeKey,model}),false);assert.equal(calls,count,'Guest never writes');
    user='user-a';b.sync();await tick();let done;hold=new Promise(r=>done=r);const first=b.save({key:fakeKey,model});const n=calls;await b.save({key:fakeKey,model});assert.equal(calls,n,'No duplicate requests');b.clear();done();hold=null;await first;assert.equal(b.snapshot().key,'','Late save cannot repopulate a cleared page');
    const sql=require('node:fs').readFileSync(require('node:path').join(__dirname,'supabase-mentor.sql'),'utf8');
    assert.match(sql,/enable row level security/i);assert.match(sql,/revoke all .* from public, anon, authenticated/i);assert.match(sql,/using \(\(select auth.uid\(\)\) = user_id\)/i);assert.match(sql,/with check \(\(select auth.uid\(\)\) = user_id\)/i);
    console.log('PASS: account reload, cross-account isolation, guest denial, errors without secrets, failed delete, removal, stale response, duplicate save, SQL policy guardrails.');
})().catch(e=>{console.error(e);process.exitCode=1;});
