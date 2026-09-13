const ROOT = '2 Saved versions';
const {readablePaths}=require('./store');
function versionFolder(name) {
  const folder=String(name).replace(/[<>:"/\\|?*\x00-\x1f]/g,'-').replace(/^\.+|\.+$/g,'').trim();
  if(!folder)throw Error('Invalid version name');
  return ROOT+'/'+folder;
}
function projectionPath(name,entry) {
  const key=entry.key||'entry';
  return readablePaths([{...entry,key}],versionFolder(name),'RE Workbench')[key];
}
async function setup(p,{ItemView,MarkdownRenderer,Notice}) {
  const TYPE='rewb-saved-reader';
  class SavedReader extends ItemView {
    getViewType(){return TYPE;}
    getDisplayText(){return this.state?.title||'Saved version';}
    getIcon(){return 'history';}
    getState(){return this.state||{};}
    async setState(state){this.state=state;await this.render();}
    async onOpen(){if(this.state)await this.render();}
    async render(){
      const state=this.state;if(!state?.versionId||!state?.key)return;
      const root=this.contentEl;root.empty();root.addClass('rewb-saved-reader');
      root.createEl('h3',{text:'Saved version: '+state.name+' · Read only'});
      root.createEl('button',{text:'Hide from sidebar'}).onclick=()=>p.hideSavedVersion().catch(e=>new Notice(e.message));
      try{
        const file=await p.store.readFile('version:'+state.versionId,state.key);
        const body=root.createDiv({cls:'markdown-rendered'});
        await MarkdownRenderer.render(p.app,p.normalizeContent(file.content).replace(/!\[\[/g,'\\!\\[\\['),body,file.path,this);
        body.querySelectorAll('a.internal-link').forEach(link=>link.addEventListener('click',event=>{
          const href=(link.getAttribute('data-href')||link.getAttribute('href')||'').split('#')[0].replace(/\.md$/,'');
          const match=p.settings.sidebarVersion?.entries.find(e=>e.original.replace(/\.md$/,'')===href);
          if(match){event.preventDefault();event.stopPropagation();p.openSavedEntry(match);}
        }));
      }catch(e){root.createEl('p',{text:'Could not read saved version: '+e.message});}
    }
  }
  p.registerView(TYPE,leaf=>new SavedReader(leaf));
  const persist=async()=>{await p.viewSaveQueue;await p.saveData(p.settings);};
  const folders=async filePath=>{
    const parts=filePath.split('/');parts.pop();let current='';
    for(const part of parts){current=current?current+'/'+part:part;if(!p.app.vault.getAbstractFileByPath(current))await p.app.vault.createFolder(current);}
  };
  p.openSavedEntry=async(entry,leaf)=>{
    const saved=p.settings.sidebarVersion;if(!saved)return;
    const target=leaf||p.app.workspace.getLeaf('tab');
    await target.setViewState({type:TYPE,active:true,state:{versionId:saved.id,name:saved.name,key:entry.key,title:entry.title,path:entry.path}});
    await p.app.workspace.revealLeaf(target);
  };
  p.hideSavedVersion=async()=>{
    const saved=p.settings.sidebarVersion;if(!saved)return;
    // Trash only known projection files, never a whole directory containing unknown notes.
    for(const entry of saved.entries){
      if(!entry.path.startsWith(ROOT+'/'))throw Error('Invalid projection path');
      const file=p.app.vault.getAbstractFileByPath(entry.path);if(file)await p.app.vault.trash(file,false);
    }
    const dirs=new Set(saved.entries.flatMap(e=>{const bits=e.path.split('/');bits.pop();const out=[];while(bits.length>1){out.push(bits.join('/'));bits.pop();}return out;}));
    for(const dir of [...dirs].sort((a,b)=>b.length-a.length)){const folder=p.app.vault.getAbstractFileByPath(dir);if(folder?.children?.length===0)await p.app.vault.trash(folder,false);}
    const root=p.app.vault.getAbstractFileByPath(ROOT);if(root?.children?.length===0)await p.app.vault.trash(root,false);
    delete p.settings.sidebarVersion;await persist();await p.refreshSourceSorting?.();
    p.app.workspace.detachLeavesOfType(TYPE);
  };
  p.showSavedVersion=async(ref)=>{
    if(!ref?.startsWith('version:'))throw Error('Select a saved version first.');
    const version=(await p.store.listVersions()).find(v=>'version:'+v.id===ref);if(!version)throw Error('Saved version not found.');
    if(p.settings.sidebarVersion?.id===version.id){if(p.settings.sidebarVersion.entries.length)await p.openSavedEntry(p.settings.sidebarVersion.entries[0]);return;}
    const tree=await p.store.getTree(ref);
    const paths=readablePaths(tree,versionFolder(version.name),'RE Workbench');
    const entries=tree.map(e=>({key:e.key,title:e.title,path:paths[e.key],original:e.path}));
    if(new Set(entries.map(e=>e.path)).size!==entries.length)throw Error('Saved paths collide; cannot display this version.');
    for(const entry of entries)if(p.app.vault.getAbstractFileByPath(entry.path))throw Error('A file already exists at '+entry.path);
    const staged=[];
    try{
      for(const entry of entries){const file=await p.store.readFile(ref,entry.key);await folders(entry.path);await p.app.vault.create(entry.path,p.normalizeContent(file.content));staged.push(entry);}
    }catch(e){for(const entry of staged){const file=p.app.vault.getAbstractFileByPath(entry.path);if(file)await p.app.vault.trash(file,false);}throw e;}
    await p.hideSavedVersion();
    p.settings.sidebarVersion={id:version.id,name:version.name,entries};await persist();await p.refreshSourceSorting?.();
    if(entries.length){await p.openSavedEntry(entries[0]);const explorer=p.app.workspace.getLeavesOfType('file-explorer')[0];const file=p.app.vault.getAbstractFileByPath(entries[0].path);if(explorer){await p.app.workspace.revealLeaf(explorer);explorer.view.revealInFolder?.(file);}}
    new Notice('Complete saved tree shown in the sidebar.');
  };
  const redirect=()=>{
    const saved=p.settings.sidebarVersion;if(!saved)return;
    for(const leaf of p.app.workspace.getLeavesOfType('markdown')){
      const entry=saved.entries.find(e=>e.path===leaf.view.file?.path);
      if(entry&&!leaf._rewbOpening){leaf._rewbOpening=true;p.openSavedEntry(entry,leaf).finally(()=>{leaf._rewbOpening=false;});}
    }
  };
  p.registerEvent(p.app.workspace.on('file-open',redirect));
  p.registerEvent(p.app.workspace.on('layout-change',redirect));
  p.register(()=>p.app.workspace.detachLeavesOfType(TYPE));
  redirect();
}
module.exports={setup,projectionPath};
