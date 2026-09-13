const test=require('node:test');
const assert=require('node:assert/strict');
const vm=require('node:vm');
const fs=require('node:fs');
const path=require('node:path');
function harness(run, config={email:'demo@example.invalid',secretHelper:'/helper.sh',keychainService:'service',keychainAccount:'account'}) {
 const context={module:{exports:{}},process:{env:{}},require(name){
  if(name==='fs')return {promises:{readFile:async()=>JSON.stringify(config)}};
  if(name==='child_process')return {execFile:run};
  return require(name);
 }};
 vm.runInNewContext(fs.readFileSync(path.join(__dirname,'refresh.js'),'utf8'),context);
 return {refresh:context.module.exports,context,app:{vault:{adapter:{basePath:'/demo'}}}};
}
test('refresh returns counts, uses explicit importer and never token arguments',async()=>{
 const h=harness((exe,args,opts,cb)=>{
  assert.equal(exe,'/bin/bash');assert.ok(args.includes('REWB-CONFLUENCE-API-TOKEN'));
  assert.equal(args.at(-1),'/demo/7 Tools/update-confluence.py');assert.equal(opts.env.REWB_EMAIL,'demo@example.invalid');
  cb(null,'{"checked":16,"updated":2}','');
 });
 const result=await h.refresh(h.app);assert.equal(result.checked,16);assert.equal(result.updated,2);
 assert.equal(h.context.rewbImportRunning,false);
});
test('arbitrary helper output is not exposed and busy state clears',async()=>{
 const h=harness((exe,args,opts,cb)=>cb({code:77},'secret-value','unexpected secret-value'));
 await assert.rejects(h.refresh(h.app),e=>!e.message.includes('secret-value')&&e.message.includes('Refresh failed'));
 assert.equal(h.context.rewbImportRunning,false);
});
test('overlapping refresh is rejected',async()=>{
 let finish;const h=harness((exe,args,opts,cb)=>{finish=cb});
 const first=h.refresh(h.app);await new Promise(r=>setImmediate(r));
 await assert.rejects(h.refresh(h.app),/already running/);
 finish(null,'{"checked":1,"updated":0}','');await first;
});
test('invalid response fails instead of claiming refresh success',async()=>{
 const h=harness((exe,args,opts,cb)=>cb(null,'{"updated":true}',''));
 await assert.rejects(h.refresh(h.app),/unexpected result/);
});
