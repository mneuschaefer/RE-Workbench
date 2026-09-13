const test=require('node:test'),assert=require('node:assert/strict');
const {setup,projectionPath}=require('./history-view');
function fixture(){
 const entries=[{key:'1',title:'A',path:'1 Sources/Confluence/RE Workbench/Topic/A.md'},{key:'2',title:'B',path:'New/B.md'}];
 const files=new Map();const versions=[{id:'v',name:'Before workshop'},{id:'w',name:'After workshop'}];
 const p={settings:{},normalizeContent:s=>s,saveData:async()=>{},registerView(){},registerEvent(){},addCommand(){},register(){},
 store:{listVersions:async()=>versions,getTree:async()=>entries,readFile:async(ref,key)=>({content:ref+' content '+key})}};
 p.app={vault:{getAbstractFileByPath(path){const n=files.get(path);return n&&{...n,children:[...files.values()].filter(f=>f.path.substring(0,f.path.lastIndexOf('/'))===path)};},createFolder:async path=>files.set(path,{path}),create:async(path,content)=>{assert.ok(!files.has(path));files.set(path,{path,content});},trash:async file=>files.delete(file.path)},workspace:{getLeaf:()=>({setViewState:async()=>{}}),revealLeaf:async()=>{},getLeavesOfType:()=>[],detachLeavesOfType(){},on(){}}};
 return {p,files,versions};
}
test('show exposes the entire saved tree; switching and hiding remove projections but preserve versions',async()=>{
 const {p,files,versions}=fixture();await setup(p,{ItemView:class{},Notice:class{}});
 await p.showSavedVersion('version:v');assert.equal(p.settings.sidebarVersion.entries.length,2);
 assert.equal(files.get('2 Saved versions/Before workshop/Confluence/Topic/A.md').content,'version:v content 1');
 await p.showSavedVersion('version:w');assert.ok(!files.has('2 Saved versions/Before workshop/Confluence/Topic/A.md'));
 assert.equal(files.get('2 Saved versions/After workshop/New/B.md').content,'version:w content 2');
 files.set('2 Saved versions/After workshop/Personal.md',{path:'2 Saved versions/After workshop/Personal.md',content:'keep'});
 await p.hideSavedVersion();assert.ok(files.has('2 Saved versions/After workshop/Personal.md'));assert.equal(versions.length,2);assert.equal(p.settings.sidebarVersion,undefined);
});
test('unsafe snapshot paths and projection collisions do not overwrite local files',async()=>{
 assert.throws(()=>projectionPath('Version',{path:'../escape.md'}));
 const {p,files}=fixture();await setup(p,{ItemView:class{},Notice:class{}});
 const path='2 Saved versions/Before workshop/Confluence/Topic/A.md';files.set(path,{path,content:'mine'});
 await assert.rejects(p.showSavedVersion('version:v'),/already exists/);assert.equal(files.get(path).content,'mine');
});
