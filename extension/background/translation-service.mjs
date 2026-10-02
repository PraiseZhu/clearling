import { cacheKey, fingerprint } from '../shared/core.mjs';

/** Paragraph work outlives its initiating caller while another reader still needs it. */
export class TranslationService {
  constructor(cache) { this.cache=cache;this.inflight=new Map();this.batches=new Map();this.serial=0; }
  enqueue(entry,config,context) {
    const batchKey=JSON.stringify([fingerprint(config),context.revision,Boolean(context.private),(context.priority?.()??0)>=10000,entry.block.text.length>900]);
    let group=this.batches.get(batchKey);
    if(!group || group.controller.signal.aborted || group.entries.length>=2 || group.size+entry.block.text.length>3600) {
      group={entries:[],size:0,controller:new AbortController(),context};
      this.batches.set(batchKey,group);
      setTimeout(()=>{if(this.batches.get(batchKey)===group)this.batches.delete(batchKey);void this.dispatch(group);},8);
    }
    group.entries.push(entry);group.size+=entry.block.text.length;entry.group=group;
  }
  async dispatch(group) {
    const {entries,context}=group;
    const valid=()=>{if(!context.isCurrent())throw new Error('CONFIG_CHANGED');if(group.controller.signal.aborted || !entries.some(e=>e.consumers.size))throw new Error('CANCELLED');};
    const priority=()=>Math.min(...entries.flatMap(e=>[...e.consumers].map(c=>c.priority())),Infinity);
    try {
      valid();const active=entries.filter(e=>e.consumers.size);
      // Excluded entries will never receive this batch's response. A later
      // reader must create new work instead of subscribing to an orphan.
      for(const entry of entries)if(!entry.consumers.size && this.inflight.get(entry.requestKey)===entry)this.inflight.delete(entry.requestKey);
      const notifyDispatch=()=>{group.dispatched=true;for(const entry of active)for(const consumer of entry.consumers)consumer.onDispatch?.();};
      const response=await context.dispatch(active.map(e=>e.block),valid,group.controller.signal,priority,notifyDispatch);
      valid();
      for(const entry of active) {
        const value=response.translations.find(t=>t.id===entry.block.id);
        if(!value)throw new Error('RESPONSE_INCOMPLETE');
        void this.cache.put(entry.key,value.text,context.private).catch(()=>{});
        for(const consumer of [...entry.consumers])consumer.finish(null,value.text);
      }
    }catch(error){for(const entry of entries)for(const consumer of [...entry.consumers])consumer.finish(error);}
    finally{for(const entry of entries)if(this.inflight.get(entry.requestKey)===entry)this.inflight.delete(entry.requestKey);}
  }
  async translate(config,blocks,context) {
    const subscriptions=[];let failed=false;
    const check=()=>{if(!context.isCurrent())throw new Error('CONFIG_CHANGED');if(failed || context.signal?.aborted)throw new Error('CANCELLED');};
    check();
    try {
      return await Promise.all(blocks.map(async block=>{
        const key=await cacheKey(config,block,context.hostname);
        const text=await this.cache.get(key,context.cacheDays,context.private);check();
        if(text){context.onCacheHit?.();const value={id:block.id,text,sourceHash:block.sourceHash};context.onTranslation?.(value);return value;}
        const requestKey=`${context.private?'private':'normal'}:${context.revision}:${key}`;
        let entry=this.inflight.get(requestKey),fresh=false;
        if(!entry){entry={block:{...block,id:`w${++this.serial}`},key,requestKey,consumers:new Set(),group:null};this.inflight.set(requestKey,entry);fresh=true;}
        const result=new Promise((resolve,reject)=>{
          const finish=(error,value)=>{
            if(!entry.consumers.delete(consumer))return;
            context.signal?.removeEventListener('abort',consumer.abort);
            if(error)reject(error);
            else try{check();const output={id:block.id,text:value,sourceHash:block.sourceHash};context.onTranslation?.(output);resolve(output);}catch(e){reject(e);}
          };
          const consumer={priority:()=>context.priority?.()??0,onDispatch:context.onDispatch,finish,abort:null};
          consumer.abort=()=>{
            finish(new Error('CANCELLED'));
            const group=entry.group;
            if(group && group.entries.every(e=>!e.consumers.size)){
              group.controller.abort();
              for(const e of group.entries)if(this.inflight.get(e.requestKey)===e)this.inflight.delete(e.requestKey);
            }
          };
          entry.consumers.add(consumer);subscriptions.push(consumer);
          if(entry.group?.dispatched)consumer.onDispatch?.();
          context.signal?.addEventListener('abort',consumer.abort,{once:true});
        });
        if(fresh)this.enqueue(entry,config,context);
        return result;
      }));
    }catch(error){failed=true;for(const consumer of subscriptions)consumer.abort();throw error;}
  }
}
