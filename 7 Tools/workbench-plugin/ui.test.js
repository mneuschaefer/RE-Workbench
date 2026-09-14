'use strict';
// App-boundary regressions: selection, command context and editor lifecycle.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
function loadUI() {
  class Plugin {}
  class ItemView { constructor(leaf) { this.leaf = leaf; } }
  class Modal { constructor(app) { this.app = app; } }
  const notices = [];
  const context = { module: {exports:{}}, console, setTimeout, clearTimeout, URL, decodeURIComponent,
    require: name => name === 'obsidian' ? {Plugin,ItemView,Modal,Notice:class {constructor(text){notices.push(text);}},PluginSettingTab:class{},Setting:class{},MarkdownRenderer:{},setIcon(){}} : require(name) };
  vm.runInNewContext(fs.readFileSync(path.join(__dirname,'main.js'),'utf8')+'\nmodule.exports = {Plugin:module.exports, WorkbenchView, normalizeConfluenceSite, confluencePageId};',context);
  return {...context.module.exports,notices};
}
test('Confluence deployment routes automatically from the site host',()=>{
 const {normalizeConfluenceSite}=loadUI();
 assert.equal(normalizeConfluenceSite('https://demo.atlassian.net','auto').apiMode,'cloud');
 const server=normalizeConfluenceSite('https://wiki.example.com/confluence/','auto');
 assert.equal(server.apiMode,'server');assert.equal(server.siteUrl,'https://wiki.example.com/confluence');
});
test('explicit Cloud routing rejects a self-hosted URL',()=>{
 const {normalizeConfluenceSite}=loadUI();
 assert.throws(()=>normalizeConfluenceSite('https://wiki.example.com','cloud'),/Confluence Cloud/);
});
test('page IDs are read from Cloud and self-hosted URL forms',()=>{
 const {normalizeConfluenceSite,confluencePageId}=loadUI();
 const cloud=normalizeConfluenceSite('https://demo.atlassian.net','auto');
 assert.equal(confluencePageId('https://demo.atlassian.net/wiki/spaces/X/pages/123456/Title',cloud),'123456');
 const server=normalizeConfluenceSite('https://wiki.example.com/confluence','auto');
 assert.equal(confluencePageId('https://wiki.example.com/confluence/pages/viewpage.action?pageId=654321',server),'654321');
 assert.throws(()=>confluencePageId('https://wiki.example.com/other/pages/123456',server),/outside/);
});
test('switching Sources and Versions retains the selected version, file and search',()=>{
 const {WorkbenchView}=loadUI();const view=new WorkbenchView({},{});
 view.setTab('Versions');view.ref='version:second';view.selectedKey='page:2';view.search='review';
 view.setTab('Sources');view.ref='sources';view.selectedKey='page:1';view.search='source';
 view.setTab('Versions');
 assert.equal(view.ref,'version:second');assert.equal(view.selectedKey,'page:2');assert.equal(view.search,'review');
 const restored=new WorkbenchView({},{lastViewState:JSON.parse(JSON.stringify(view.getState()))});
 restored.setTab('Sources');assert.equal(restored.selectedKey,'page:1');
 restored.setTab('Versions');assert.equal(restored.ref,'version:second');
});
test('native source and unrelated notes never use a hidden Workbench selection',()=>{
 const {Plugin}=loadUI();const p=new Plugin();let file={path:'1 Sources/Confluence/A.md'};
 p.variantInfo=new Map([['variant:v',{id:'v',contentFolder:'3 Drafts/Variants/V/Content'}]]);
 p.app={workspace:{activeLeaf:{view:{getViewType:()=> 'markdown'}},getActiveFile:()=>file}};
 p.activeView=()=>({tab:'Versions',ref:'version:wrong'});
 assert.equal(p.activeRef(),'sources');file={path:'Guide.md'};assert.equal(p.activeRef(),null);
 file={path:'3 Drafts/Variants/V/Content/A.md'};assert.equal(p.activeRef(),'variant:v');
 p.app.workspace.activeLeaf.view={getViewType:()=> 're-workbench-view',tab:'Compare',compareRight:'version:right'};
 assert.equal(p.activeRef(),'version:right');
});
test('opening the same working file reuses its editor instead of creating tabs',async()=>{
 const {Plugin}=loadUI();const p=new Plugin();const file={path:'3 Drafts/Variants/V/Content/A.md'};const leaf={view:{file}};let revealed=0,created=0;
 p.app={vault:{getAbstractFileByPath:()=>file},workspace:{getLeavesOfType:()=>[leaf],revealLeaf:async l=>{assert.equal(l,leaf);revealed++;},setActiveLeaf:l=>assert.equal(l,leaf),getLeaf:()=>{created++;return{openFile:async()=>{}};}}};
 await p.openVaultFile(file.path);await p.openVaultFile(file.path);assert.equal(revealed,2);assert.equal(created,0);
});
test('a failed action retains the open review instead of rebuilding and discarding decisions',async()=>{
 const {Plugin}=loadUI();const p=new Plugin();let renders=0;let busy;
 p.activeView=()=>({contentEl:{setAttribute:(_k,v)=>busy=v,removeAttribute:()=>busy=null},render:async()=>renders++});
 const result=await p.runBusy('Review failed',async()=>{throw Error('Stale review');});
 assert.equal(result,null);assert.equal(renders,0);assert.equal(p.busy,false);assert.equal(busy,null);assert.equal(p.lastActionError,'Stale review');
});
test('remembered navigation preserves other plugin settings and serializes saves',async()=>{
 const {Plugin}=loadUI();const p=new Plugin();p.settings={other:'keep'};const writes=[];p.saveData=async value=>writes.push(value);
 p.rememberViewState({tab:'Sources'});p.rememberViewState({tab:'Versions',ref:'version:second'});await p.viewSaveQueue;
 assert.equal(writes.length,2);assert.equal(writes[1].other,'keep');assert.equal(writes[1].viewState.ref,'version:second');
});

test('editor status distinguishes an opened copy from changed and added content', async()=>{
 const {Plugin}=loadUI(); const p=new Plugin(); let result={changed:[],added:[]};let text='';
 const banner={dataset:{},querySelector:()=>({setText:v=>text=v})};
 p.store={getTree:async()=>[{key:'p',path:'1 Sources/Confluence/A.md'}],compare:async()=>result};
 const variant={id:'v',baseId:'b',contentFolder:'3 Drafts/Variants/V/Content'};
 const file={path:variant.contentFolder+'/Confluence/A.md'};
 await p.updateEditorStatus(banner,variant,file);assert.equal(banner.dataset.status,'unchanged');assert.match(text,/unchanged/);
 result={changed:['p'],added:[]};await p.updateEditorStatus(banner,variant,file);assert.equal(banner.dataset.status,'changed');assert.match(text,/differs from starting version/);
 result={changed:[],added:['p']};await p.updateEditorStatus(banner,variant,file);assert.equal(banner.dataset.status,'added');
});

test('native comparison fixes current sources and working files and selects the active file',async()=>{
 const {Plugin}=loadUI();const p=new Plugin();p.nativeWorking={id:'working'};
 const view={compareLeft:'version:old',compareRight:'version:older',render:async()=>{}};
 p.app={workspace:{getActiveFile:()=>({path:'1 Working files/Confluence/Topic/A.md'})}};
 p.store={getTree:async()=>[{key:'page:1',path:'1 Sources/Confluence/RE Workbench/Topic/A.md'}]};
 p.openView=async()=>{};p.activeView=()=>view;
 await p.openComparison();assert.equal(view.compareLeft,'sources');assert.equal(view.compareRight,'variant:working');assert.equal(view.selectedKey,'page:1');
});
test('file export UI is removed',()=>{const {Plugin}=loadUI();assert.equal(Plugin.prototype.exportChanges,undefined);assert.equal(Plugin.prototype.writeExport,undefined);});

test('named archive copies a full immutable tree, adds a date and refuses overwrite',async()=>{
 const fs=require('node:fs/promises'),os=require('node:os');
 const root=await fs.mkdtemp(path.join(os.tmpdir(),'rewb-archive-'));
 try{
  const {Plugin}=loadUI(),p=new Plugin();p.settings={archiveDateSuffix:true,archiveDateFormat:'YYYY-MM-DD'};
  p.app={vault:{adapter:{basePath:root}}};p.nativeWorking={id:'working'};p.normalizeContent=x=>x;
  let saved=0;p.store={saveVersion:async(ref,name)=>{assert.equal(ref,'variant:working');saved++;return {id:'fixed'};},getTree:async ref=>{assert.equal(ref,'version:fixed');return [{key:'1',workspacePath:'1 Working files/Confluence/Parent.md'},{key:'2',workspacePath:'1 Working files/Confluence/Parent/Child.md'}];},readFile:async(ref,key)=>({content:'# '+key})};
  const folder=await p.archiveWorkingVersion('Review');assert.match(folder,/Review \d{4}-\d{2}-\d{2}$/);
  assert.equal(await fs.readFile(path.join(root,folder,'Confluence/Parent/Child.md'),'utf8'),'# 2');
  await assert.rejects(()=>p.archiveWorkingVersion('Review'));assert.equal(saved,1);
  await assert.rejects(()=>p.archiveWorkingVersion('../bad'));
 }finally{await fs.rm(root,{recursive:true,force:true});}
});

test('legacy saved-version view renders only the fixed comparison',async()=>{
 const {WorkbenchView}=loadUI();const view=new WorkbenchView({},{});
 view.tab='Versions';let compared=0;
 const root={empty(){},addClass(){},createDiv(){return root;}};
 view.contentEl=root;view.renderSkeleton=()=>{};view.rememberState=()=>{};
 view.renderCompare=async()=>{compared++;};view.renderBrowser=()=>{throw Error('Legacy browser must not render');};
 await view.render();assert.equal(view.tab,'Compare');assert.equal(compared,1);assert.equal(view.getDisplayText(),'Compare with sources');
});

test('comparison puts changed page titles in their respective columns before article text',()=>{
 const {WorkbenchView}=loadUI(),view=new WorkbenchView({},{}),items=[];
 const node={createEl(tag,opts={}){items.push({tag,...opts});return node;},createDiv(opts={}){items.push({tag:'div',...opts});return node;},createSpan(opts={}){items.push({tag:'span',...opts});return node;}};
 view.renderPlainSide(node,'Left','Source',{title:'Old title'},[{kind:'same',text:'Body'}],true);
 view.renderPlainSide(node,'Right','Local',{title:'New title'},[{kind:'same',text:'Body'}],true);
 assert.ok(!items.some(x=>x.text==='Left'||x.text==='Right'));
 assert.ok(items.some(x=>x.text==='− Old title'));assert.ok(items.some(x=>x.text==='+ New title'));
 assert.ok(items.findIndex(x=>x.text==='− Old title')<items.findIndex(x=>x.tag==='pre'));
 assert.ok(items.some(x=>x.cls?.includes('is-removed')));assert.ok(items.some(x=>x.cls?.includes('is-added')));
});

test('publish prompt lists current changes once and authorizes only listed updates with consistency checks',async()=>{
 const {Plugin}=loadUI(),p=new Plugin();p.nativeWorking={id:'working'};p.app={vault:{adapter:{basePath:'/demo'}}};
 p.store={compare:async()=>({changed:['same'],renamed:['same'],added:['new'],removed:['old']}),getTree:async ref=>ref==='sources'?[{key:'same',pageId:'1',title:'Before'},{key:'old',pageId:'2',title:'Removed'}]:[{key:'same',title:'After',workspacePath:'1 Working files/After.md'},{key:'new',title:'New',workspacePath:'1 Working files/New.md'}]};
 const result=await p.buildPublishPrompt();assert.equal(result.files.length,3);assert.equal(result.files[0].pageId,'1');assert.equal(result.files[1].status,'Added locally');assert.equal(result.files[2].status,'Removed locally');
 assert.match(result.prompt,/do not ask for another approval/);assert.match(result.prompt,/Process only the listed existing pages/);assert.match(result.prompt,/workingContentHash/);assert.match(result.prompt,/server-enforced version checks/);assert.match(result.prompt,/6 Import log/);
 p.store.compare=async()=>({changed:[],added:[],removed:[],renamed:[]});assert.equal((await p.buildPublishPrompt()).files.length,0);
});

test('publish instructions support save and restore without changing other settings',async()=>{
 const {Plugin}=loadUI(),p=new Plugin();p.settings={archiveFolder:'5 Archive/Custom'};p.saveData=async data=>{p.persisted={...data};};
 const original=p.getPublishInstructions();assert.match(original,/Pages updated: X of Y/);assert.match(original,/not transferred exactly/);
 await p.savePublishInstructions('Use my reporting style.');assert.equal(p.getPublishInstructions(),'Use my reporting style.');assert.equal(p.persisted.publishPrompt,'Use my reporting style.');
 await assert.rejects(()=>p.savePublishInstructions('  '));
 await p.savePublishInstructions(null);assert.equal(p.getPublishInstructions(),original);assert.equal(p.persisted.archiveFolder,'5 Archive/Custom');assert.equal(p.persisted.publishPrompt,undefined);
});

test('publishing report folder is configurable without replacing custom instructions',async()=>{
 const {Plugin}=loadUI(),p=new Plugin();p.settings={publishPrompt:'Custom instruction'};p.saveData=async()=>{};
 await p.saveReportFolder('Reports/Publishing');assert.equal(p.settings.publishReportFolder,'Reports/Publishing');assert.equal(p.getPublishInstructions(),'Custom instruction');
 await assert.rejects(()=>p.saveReportFolder('../elsewhere'));await assert.rejects(()=>p.saveReportFolder('1 Working files/Reports'));
 await p.savePublishInstructions(null);assert.equal(p.settings.publishReportFolder,'Reports/Publishing');
});
