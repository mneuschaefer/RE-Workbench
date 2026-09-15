module.exports = async function setup(p, {Modal, Notice}) {
const ROOT = '1 Working files';
class Confirm extends Modal {
  constructor(app, summary, action, archiveFolder, review) { super(app); Object.assign(this,{summary,action,archiveFolder,review}); }
  onOpen() {
    this.contentEl.createEl('h2',{text:'Replace local files with the latest Confluence version?'});
    this.contentEl.createEl('p',{text:'Compared with your local working files, the downloaded Confluence version contains:'});
    const list=this.contentEl.createEl('ul');
    for(const line of this.summary.lines)list.createEl('li',{text:line});
    if(this.summary.localOnly)this.contentEl.createEl('p',{text:'Local-only files will be removed when overwriting.'});
    if(this.summary.unavailable)this.contentEl.createEl('p',{text:this.summary.unavailable+' previously known Confluence page'+(this.summary.unavailable===1?' is':'s are')+' no longer returned as current and will be removed from the working files. The recovery checkpoint keeps the previous local copy.'});
    this.contentEl.createEl('p',{text:'This will overwrite your local Markdown files. Choose whether to archive your local changes first. Attachments are left unchanged.'});
    this.contentEl.createDiv({cls:'rewb-replace-review'}).createEl('button',{text:'Compare with sources'}).onclick=()=>{this.close();this.review();};
    const actions=this.contentEl.createDiv({cls:'rewb-replace-actions'});
    const buttons=[];
    const add=(text,archive,cls)=>{
      const button=actions.createEl('button',{text,cls});buttons.push(button);
      button.onclick=async()=>{buttons.forEach(b=>b.disabled=true);try{await this.action(archive);this.close();}catch(e){new Notice(e.message);buttons.forEach(b=>b.disabled=false);}};
    };
    add('Archive changes, then overwrite',true,'mod-cta');
    add('Overwrite without archiving',false,'mod-warning');
    const cancel=actions.createEl('button',{text:'Cancel',cls:'rewb-replace-cancel'});buttons.push(cancel);cancel.onclick=()=>this.close();
    this.contentEl.createEl('p',{text:'Cancel keeps your local files unchanged. Downloaded sources remain available for comparison.'});
    this.contentEl.createEl('p',{text:'Changed local files are archived under '+this.archiveFolder+'. An internal recovery checkpoint is retained in both cases.'});
  }

}

  const variants=await p.store.listVariants();
  let working=variants.find(v=>v.contentFolder===ROOT);
  if(!working) working=await p.store.createVariant('Working files','sources',{nativeWorking:true});
  // Full materialization is only needed on initial setup; resume an interrupted first setup.
  if(!p.settings.nativeWorkingReady) {
    for(const entry of await p.store.getTree('variant:'+working.id)) await p.store.editInVariant(working.id,entry.key);
    p.settings.nativeWorkingReady=true;await p.saveData(p.settings);
  }
  await p.store.flattenNativeConfluence(working.id, 'RE Workbench');
  working=(await p.store.listVariants()).find(v=>v.id===working.id);
  // Remove only empty directories left by the layout migration; preserve all other files.
  const fs=require('fs/promises'),path=require('path');
  const prune=async dir=>{try{if((await fs.lstat(dir)).isSymbolicLink())return;for(const item of await fs.readdir(dir,{withFileTypes:true}))if(item.isDirectory()&&!item.isSymbolicLink())await prune(path.join(dir,item.name));await fs.rmdir(dir);}catch(e){if(!['ENOENT','ENOTEMPTY','EEXIST'].includes(e.code))throw e;}};
  await prune(path.join(p.app.vault.adapter.basePath,ROOT,'Confluence','RE Workbench'));
  await p.store.useReadableNativePaths(working.id);
  p.nativeWorking=working;
  await p.refreshState();
  let statuses=new Map(), sourceUpdates=new Set(), workingPaths=new Map(), renameDetails=new Map(), renames=Promise.resolve(), timer, refreshing=false, again=false;
  const logicalPath=e=>{if(e.workspacePath)return e.workspacePath;if(workingPaths.has(e.path))return workingPaths.get(e.path);let relative=e.path.replace(/^1 Sources\//,'');const prefix='Confluence/'+working.flattenedSourceFolder+'/';if(working.flattenedSourceFolder&&relative.startsWith(prefix))relative='Confluence/'+relative.slice(prefix.length);return ROOT+'/'+relative;};
  const paint=()=>{
    document.body.classList.add('rewb-native-mode');
    document.querySelectorAll('.nav-file-title[data-path], .nav-folder-title[data-path]').forEach(el=>{
      const path=el.getAttribute('data-path');
      if(!path?.startsWith(ROOT+'/') && path!==ROOT)return;
      let status=statuses.get(path);
      if(el.classList.contains('nav-folder-title')) {
        const count=[...statuses].filter(([f,s])=>(f.startsWith(path+'/')||f===path+'.md')&&s!=='unchanged').length;
        status=count?count+(count===1?' changed file':' changed files'):null;
      }
      if(status==='unchanged')status=null;
      let label=status==='changed'?'Changed':status==='added'?'Added':status==='unknown'?'Checking…':status;
      if(sourceUpdates.has(path)||sourceUpdates.has(path+'.md'))label=label?label+' · Source updated':'Source updated';
      let badge=el.querySelector('.rewb-native-badge');
      if(!label){badge?.remove();el.removeAttribute('data-rewb-change');return;}
      el.setAttribute('data-rewb-change',status||'source-updated');
      if(!badge)badge=el.createSpan({cls:'rewb-native-badge'});
      if(badge.textContent!==label)badge.setText(label);
    });
    for(const leaf of p.app.workspace.getLeavesOfType('markdown')) {
      const view=leaf.view,file=view.file;if(!file?.path.startsWith(ROOT+'/'))continue;
      let bar=view.containerEl.querySelector('.rewb-native-bar');
      if(!bar){
        bar=document.createElement('div');bar.className='rewb-native-bar';
        bar.createSpan({cls:'rewb-native-status'});
        bar.createEl('button',{text:'Compare with sources'}).onclick=()=>p.openComparison();
        bar.createEl('button',{text:'Update from sources'}).onclick=()=>p.updateSources();
        view.containerEl.querySelector('.view-content')?.before(bar);
      }
      const status=statuses.get(file.path)||'unknown';bar.dataset.status=status;
      bar.querySelector('.rewb-native-status').setText(status==='changed'?'Local edits since last replacement':status==='added'?'Added locally':status==='unknown'?'Checking changes…':'No local edits since last replacement');
      if(renameDetails.has(file.path))bar.querySelector('.rewb-native-status').textContent += ' · '+renameDetails.get(file.path);
      if(sourceUpdates.has(file.path))bar.querySelector('.rewb-native-status').textContent += ' · Source updated';
    }
    document.querySelectorAll('.rewb-native-bar').forEach(bar=>{const leaf=p.app.workspace.getLeavesOfType('markdown').find(l=>l.view.containerEl.contains(bar));if(!leaf?.view.file?.path.startsWith(ROOT+'/'))bar.remove();});
  };
  const update=async()=>{
    if(refreshing){again=true;return;}refreshing=true;
    try{
      await renames;
      const ref='variant:'+working.id;
      working=(await p.store.listVariants()).find(v=>v.id===working.id);
      const tree=await p.store.getTree(ref), diff=await p.store.compare('source:'+working.baseId,ref);
      renameDetails=new Map(tree.filter(e=>e.renamedFrom).map(e=>[e.workspacePath,(e.workspacePath.slice(0,e.workspacePath.lastIndexOf('/'))!==e.renamedFrom.slice(0,e.renamedFrom.lastIndexOf('/'))?'Moved':'Renamed')+' locally · Previously: '+e.renamedFrom.replace(/^1 Working files\//,'').replace(/\.md$/,'')]));
      workingPaths=new Map(tree.filter(e=>e.workspacePath).map(e=>[e.path,e.workspacePath]));
      const external=await p.store.compare('source:'+working.baseId,'sources');
      const externalKeys=new Set([...external.changed,...external.added,...external.removed,...(external.missing||[])]);
      sourceUpdates=new Set(tree.filter(e=>externalKeys.has(e.key)).map(logicalPath));
      const changed=new Set(diff.changed),added=new Set(diff.added);
      statuses=new Map(tree.map(e=>[logicalPath(e),added.has(e.key)?'added':changed.has(e.key)?'changed':'unchanged']));
      paint();
      await p.refreshSourceSorting?.(tree);
    }catch(e){new Notice('Working file status unavailable: '+e.message);}
    finally{refreshing=false;if(again){again=false;schedule();}}
  };
  const schedule=()=>{clearTimeout(timer);timer=setTimeout(update,350);};
  p.refreshNative=update;
  p.updateSources=async()=>{
    if(p.updatingSources)return;
    p.updatingSources=true;
    try{await p.refreshSources();if(p.lastError)return;await p.requestNativeReset('source:'+p.state.sourceSnapshotId,true);}
    finally{p.updatingSources=false;}
  };
  p.requestNativeReset=async(targetRef,sourceUpdate=false)=>{
    if(!targetRef)return p.updateSources();
    const token=await p.store.nativeWorkingToken(working.id);
    const comparison=await p.store.compare('variant:'+working.id,targetRef);
    const summary=summarizeReplacement(comparison);
    if(summary.matches){new Notice('Your local files already match the downloaded Confluence version.');return;}
    const archiveFolder=p.settings.archiveFolder||'5 Archive/Working changes';
    new Confirm(p.app,summary,async(archive)=>{
        const result=await p.runBusy('Could not replace working files',()=>p.store.replaceNativeWorking(working.id,targetRef,token,{archive,archiveFolder}));
        if(!result)throw new Error(p.lastActionError||'Another action is running.');
        try{await p.pruneHistory();}catch(e){new Notice('Working files updated; history cleanup failed: '+e.message);}
        await p.refreshState();await update();new Notice(result.archivePath?'Local files replaced. Changes archived in '+result.archivePath:'Local files replaced with the downloaded Confluence version.');
        return result;
      },archiveFolder,()=>p.openComparison()).open();
  };
  const commands=[
    ['native-open','Open working files','folder-open',async()=>{
      const tree=await p.store.getTree('variant:'+working.id);if(!tree.length)return;
      const entry=selectTopLevel(tree);
      await p.openVaultFile(logicalPath(entry));
      const file=p.app.vault.getAbstractFileByPath(logicalPath(entry));
      const explorer=p.app.workspace.getLeavesOfType('file-explorer')[0];
      if(explorer){await p.app.workspace.revealLeaf(explorer);explorer.view.revealInFolder?.(file);}
    }],
  ];
  for(const [id,name,icon,callback]of commands){p.addCommand({id,name,callback});p.addRibbonIcon(icon,name,callback);}
  p.addRibbonIcon('archive','Archive working files',()=>p.promptSaveVersion());
  p.addRibbonIcon('refresh-cw','Update from sources',()=>p.updateSources());
  p.registerEvent(p.app.workspace.on('file-menu',(menu,file)=>{
    if(file.path!==ROOT&&!file.path.startsWith(ROOT+'/'))return;
    menu.addItem(item=>item.setTitle('Compare with sources').setIcon('git-compare').onClick(async()=>{await p.openView('Compare');const v=p.activeView();v.compareLeft='source:'+working.baseId;v.compareRight='variant:'+working.id;v.compareInitialized=true;await v.render();}));
  }));
  for(const event of ['modify','create','delete'])p.registerEvent(p.app.vault.on(event,(file,old)=>{if(file.path.startsWith(ROOT+'/')||old?.startsWith(ROOT+'/')){statuses.set(file.path,'unknown');paint();schedule();}}));
  p.registerEvent(p.app.vault.on('rename',(file,old)=>{
    if(!file.path.startsWith(ROOT+'/')&&!old.startsWith(ROOT+'/'))return;
    const destination=file.path;
    renames=renames.then(()=>p.store.recordNativeRename(working.id,old,destination)).catch(e=>new Notice('Could not track rename: '+e.message));
    statuses.set(destination,'unknown');paint();schedule();
  }));
  p.resolveFileChanges=async()=>{
    await renames;
    const preview=await p.store.resolveNativeRenames(working.id);
    const modal=new Modal(p.app);modal.contentEl.createEl('h2',{text:'Reconnect renamed files'});
    modal.contentEl.createEl('p',{text:preview.pairs.length+' unambiguous matches with identical content. '+preview.unresolved+' removed files have no unique match. No files will be moved or overwritten.'});
    for(const pair of preview.pairs)modal.contentEl.createEl('p',{text:pair.from.replace(ROOT+'/','')+' → '+pair.to.replace(ROOT+'/','')});
    modal.contentEl.createEl('button',{text:'Cancel'}).onclick=()=>modal.close();
    if(preview.pairs.length){const button=modal.contentEl.createEl('button',{text:'Confirm file connections',cls:'mod-cta'});button.onclick=async()=>{button.disabled=true;try{await p.store.resolveNativeRenames(working.id,preview.token);await update();await p.refreshState();modal.close();}catch(e){new Notice(e.message);button.disabled=false;}};}
    modal.open();
  };
  p.addCommand({id:'resolve-file-changes',name:'Reconnect renamed files',callback:()=>p.resolveFileChanges()});
  p.registerEvent(p.app.workspace.on('file-menu',(menu,file)=>{if(file.path===ROOT||file.path.startsWith(ROOT+'/'))menu.addItem(item=>item.setTitle('Reconnect renamed files').setIcon('link').onClick(()=>p.resolveFileChanges()));}));
  p.registerDomEvent(document,'click',event=>{
    const link=event.target.closest?.('a.internal-link');
    const leaf=p.app.workspace.getLeavesOfType('markdown').find(l=>l.view.containerEl.contains(link));
    if(!link||!leaf?.view.file?.path.startsWith(ROOT+'/'))return;
    const href=link.getAttribute('data-href')||link.getAttribute('href')||'';
    if(!href.startsWith('1 Sources/')||href.includes('#'))return;
    const target=logicalPath({path:href.replace(/\.md$/, '')+'.md'});
    if(p.app.vault.getAbstractFileByPath(target)){event.preventDefault();event.stopPropagation();p.openVaultFile(target);}
  },true);
  p.registerEvent(p.app.workspace.on('file-open',()=>{paint();schedule();}));
  const observer=new MutationObserver(records=>{if(records.some(r=>r.target.matches?.('.nav-file-title-content, .nav-folder-title-content')||[...r.addedNodes].some(n=>n.nodeType===1&&(n.matches?.('.nav-file,.nav-folder')||n.querySelector?.('.nav-file-title')))))paint();});
  observer.observe(document.body,{childList:true,subtree:true});
  p.register(()=>{clearTimeout(timer);observer.disconnect();document.body.classList.remove('rewb-native-mode');document.querySelectorAll('.rewb-native-bar,.rewb-native-badge').forEach(el=>el.remove());document.querySelectorAll('[data-rewb-change]').forEach(el=>el.removeAttribute('data-rewb-change'));});
  await update();
};

// Prefer the imported root, regardless of API order, title or local additions.
function selectTopLevel(tree) {
  const imported=tree.filter(e=>e.pageId);
  const ids=new Set(imported.map(e=>String(e.pageId)));
  const roots=imported.filter(e=>!e.parentId||!ids.has(String(e.parentId)));
  const candidates=roots.length?roots:imported.length?imported:tree;
  return [...candidates].sort((a,b)=>a.path.split('/').length-b.path.split('/').length||a.title.localeCompare(b.title)||a.key.localeCompare(b.key))[0];
}
module.exports.selectTopLevel=selectTopLevel;

function summarizeReplacement(c){
  const different=new Set([...(c.changed||[]),...(c.renamed||[])]).size;
  const remoteOnly=(c.added||[]).length,localOnly=(c.removed||[]).length,unavailable=(c.missing||[]).length;
  return {different,remoteOnly,localOnly,unavailable,matches:!different&&!remoteOnly&&!localOnly&&!unavailable,
    lines:[`${different} different file${different===1?'':'s'}`,`${remoteOnly} file${remoteOnly===1?'':'s'} only in Confluence`,`${localOnly} file${localOnly===1?'':'s'} only locally`,`${unavailable} previously known Confluence page${unavailable===1?' is':'s are'} no longer returned as current`]};
}
module.exports.summarizeReplacement=summarizeReplacement;
