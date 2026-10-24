/* Private account credentials: never included in journal storage or exports. */
(function(root,factory){
    const api=factory();
    if(typeof module==='object'&&module.exports)module.exports=api;
    else root.DiaryMentorAccount=api;
})(typeof globalThis!=='undefined'?globalThis:this,()=>{
    'use strict';
    function create({getClient,getUser,onChange=()=>{}}){
        let owner=null,epoch=0,key='',model='',saved=false,busy=false,message='',status='idle',verifiedAt='';
        const snapshot=()=>({key,model,saved,busy,message,owner,status,verifiedAt});
        const emit=()=>onChange(snapshot());
        function clear(){epoch++;key='';model='';saved=false;busy=false;message='';status='idle';verifiedAt='';}
        async function run(kind,input){
            const user=getUser(),client=getClient();
            if(!user||!client){message='Entre na sua conta do Diário para sincronizar a chave.';emit();return false;}
            if(busy)return false;
            if(kind==='save'&&(!input||typeof input.key!=='string'||input.key.length<20||input.key.length>300||/\s/.test(input.key)||!/^gemini-[a-z0-9.-]{2,70}$/.test(input.model))){
                message='Confira a chave e o identificador do modelo Gemini.';emit();return false;
            }
            const token=++epoch;owner=user;busy=true;message=kind==='load'?'Carregando a chave da sua conta…':'Salvando a configuração da conta…';emit();
            const current=()=>epoch===token&&getUser()===user;
            try{
                const table=client.from('mentor_credentials');
                let result;
                if(kind==='load')result=await table.select('api_key,model').eq('user_id',user).maybeSingle();
                else if(kind==='save')result=await table.upsert({user_id:user,api_key:input.key,model:input.model,updated_at:new Date().toISOString()}).select('user_id').single();
                else result=await table.delete().eq('user_id',user).select('user_id');
                if(!current())return false;
                if(result.error)throw result.error;
                if(kind==='save'&&result.data?.user_id!==user)throw Error('save');
                key=kind==='save'?input.key:kind==='load'?result.data?.api_key||'':'';
                model=kind==='save'?input.model:kind==='load'?result.data?.model||'':'';
                saved=!!key;
                status=saved?'saved':'empty';verifiedAt=new Date().toISOString();
                message=kind==='remove'?'Chave removida da conta.':saved?'Chave sincronizada com sua conta. Será carregada ao entrar em outro computador.':'Nenhuma chave salva nesta conta.';
                return true;
            }catch(error){
                if(current())status='error';
                if(current())message=['42P01','PGRST205'].includes(error?.code)
                    ?'Ative o armazenamento executando supabase-mentor.sql no SQL Editor do Supabase.'
                    :'Não foi possível sincronizar a chave. Confira a conexão e o login e tente novamente. A configuração anterior foi preservada.';
                return false;
            }finally{if(current()){busy=false;emit();}}
        }
        function sync(){
            const user=getUser();if(user===owner)return;
            clear();owner=user;emit();
            // Defer requests outside Supabase's synchronous auth callback.
            if(user)Promise.resolve().then(()=>{if(owner===user&&getUser()===user)return run('load');});
        }
        return {snapshot,sync,reload:()=>run('load'),save:input=>run('save',input),remove:()=>run('remove'),clear:()=>{clear();owner=null;emit();}};
    }
    return {create};
});
