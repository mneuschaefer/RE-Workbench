// Local deployment only. No downloads and no plugin settings overwritten.
const fs=require('node:fs');
const path=require('node:path');
const root=path.resolve(__dirname,'../..');
const target=path.join(root,'.obsidian/plugins/re-workbench-local');
const files=['main.js','manifest.json','styles.css','store.js','refresh.js','native.js','history-view.js','source-order.js'];
for(const file of files) if(!fs.existsSync(path.join(__dirname,file)))throw new Error('Missing plugin file: '+file);
const manifest=JSON.parse(fs.readFileSync(path.join(__dirname,'manifest.json'),'utf8'));
if(manifest.id!=='re-workbench-local')throw new Error('Unexpected plugin id');
fs.mkdirSync(path.join(root,'1 Working files'),{recursive:true});
fs.mkdirSync(target,{recursive:true});
for(const file of files)fs.copyFileSync(path.join(__dirname,file),path.join(target,file));
console.log('Installed local files. Enable or reload re-workbench-local in Obsidian.');
