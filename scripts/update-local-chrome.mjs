// Uses only the installed extension's normal settings page and runtime.reload.
// No desktop automation, profile writes, credentials, or browser restart.
import http from 'node:http';
import {randomBytes} from 'node:crypto';
import {execFile} from 'node:child_process';
import {mkdir,writeFile,readFile} from 'node:fs/promises';
const expectedVersion=JSON.parse(await readFile(new URL('../dist/manifest.json',import.meta.url),'utf8')).version;
const id='iblllgfoeeoojmaceejcifkaeldmkepk',token=randomBytes(24).toString('hex');
let resolveReceipt;
const receipt=new Promise(resolve=>{resolveReceipt=resolve;});
const server=http.createServer(async(req,res)=>{
 if(req.headers.origin!==`chrome-extension://${id}`){res.writeHead(403);res.end();return;}
 res.setHeader('Access-Control-Allow-Origin',`chrome-extension://${id}`);res.setHeader('Access-Control-Allow-Headers','Content-Type');
 if(req.method==='OPTIONS'){res.writeHead(204);res.end();return;}
 if(req.method!=='POST'||req.url!==`/clearling-install/${token}`){res.writeHead(404);res.end();return;}
 let body='';for await(const chunk of req){body+=chunk;if(body.length>1000){res.writeHead(413);res.end();return;}}
 try{const value=JSON.parse(body);if(value.id!==id||value.version!==expectedVersion)throw new Error('INVALID_RECEIPT');res.end('{}');resolveReceipt(value);}catch{res.writeHead(400);res.end();}
});
await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
const url=`chrome-extension://${id}/options.html?install-check=${token}&port=${server.address().port}`;
const open=()=>new Promise((resolve,reject)=>execFile('/usr/bin/open',['-g','-a','/Applications/Google Chrome.app',url],e=>e?reject(e):resolve()));
let retry,timer;
try{
 await open();retry=setTimeout(()=>void open().catch(()=>{}),3000);
 const result=await Promise.race([receipt,new Promise((_,reject)=>{timer=setTimeout(()=>reject(new Error('DAILY_CHROME_RECEIPT_TIMEOUT')),20000);})]);
 const report={browser:'daily Chrome',...result,method:'normal runtime.reload and origin-checked loopback receipt',time:new Date().toISOString()};
 await mkdir('artifacts',{recursive:true});await writeFile(`artifacts/daily-chrome-${expectedVersion}.json`,JSON.stringify(report,null,2));console.log(JSON.stringify(report));
}finally{clearTimeout(retry);clearTimeout(timer);server.closeAllConnections();server.close();}
