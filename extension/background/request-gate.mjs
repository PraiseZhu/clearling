/** Global priority queue. Prefetch leaves one network slot for visible work. */
export class RequestGate {
  constructor({ limit = 4, intervalMs = 250 } = {}) {
    this.limit=limit;this.intervalMs=intervalMs;this.nextDispatch=0;this.cooldownUntil=0;this.paused=new Map();this.queue=[];this.active=0;this.prefetchActive=0;this.timer=null;
  }
  keys(config) { return [`connection:${config.connectionId}:${config.connectionRevision}`, `model:${config.connectionId}:${config.connectionRevision}:${config.selection.modelId}`]; }
  resume(config) { for(const key of this.keys(config))this.paused.delete(key);this.pump(); }
  run(config, operation, signal, priority = () => 0) {
    if(signal?.aborted)return Promise.reject(new Error('CANCELLED'));
    return new Promise((resolve,reject)=>{
      const job={config,operation,signal,priority,resolve,reject,abort:null};
      job.abort=()=>{const i=this.queue.indexOf(job);if(i>=0){this.queue.splice(i,1);reject(new Error('CANCELLED'));this.pump();}};
      signal?.addEventListener('abort',job.abort,{once:true});this.queue.push(job);this.pump();
    });
  }
  pump() {
    clearTimeout(this.timer);this.timer=null;
    for(const job of [...this.queue]) {
      const paused=this.keys(job.config).map(k=>this.paused.get(k)).find(Boolean);
      if(paused || job.signal?.aborted) {this.queue.splice(this.queue.indexOf(job),1);job.signal?.removeEventListener('abort',job.abort);job.reject(new Error(paused || 'CANCELLED'));}
    }
    if(!this.queue.length || this.active>=this.limit)return;
    this.queue.sort((a,b)=>a.priority()-b.priority());
    const job=this.queue.find(j=>j.priority()<10000 || this.prefetchActive<Math.max(0,this.limit-1));
    if(!job)return;
    const due=Math.max(this.nextDispatch,this.cooldownUntil)-Date.now();
    if(due>0){this.timer=setTimeout(()=>this.pump(),due);return;}
    this.queue.splice(this.queue.indexOf(job),1);job.signal?.removeEventListener('abort',job.abort);
    const prefetch=job.priority()>=10000;
    this.active++;if(prefetch)this.prefetchActive++;this.nextDispatch=Date.now()+this.intervalMs;
    void Promise.resolve().then(()=>{if(job.signal?.aborted)throw new Error('CANCELLED');return job.operation();}).then(job.resolve,error=>{
      const [connection,model]=this.keys(job.config);
      if(error.message==='HTTP_401')this.paused.set(connection,'HTTP_401');
      if(error.message==='HTTP_403')this.paused.set(model,'HTTP_403');
      if(error.message==='HTTP_429')this.cooldownUntil=Math.max(this.cooldownUntil,Date.now()+(error.retryAfterMs||2000));
      job.reject(error);
    }).finally(()=>{this.active--;if(prefetch)this.prefetchActive--;this.pump();});
    this.pump();
  }
}
