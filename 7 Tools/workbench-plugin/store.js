'use strict';

// A deliberately small, local-only history store. Git is used only as a
// content-addressed object database; the vault itself is never a Git worktree.
const fs = require('node:fs/promises');
const path = require('node:path');
const crypto = require('node:crypto');
const { execFile, spawn } = require('node:child_process');
const { promisify } = require('node:util');

const run = promisify(execFile);
const NORMALIZATION_VERSION = 3;

class StoreError extends Error {
  constructor(message, code = 'STORE_ERROR') {
    super(message);
    this.name = 'StoreError';
    this.code = code;
  }
}

const clone = (value) => JSON.parse(JSON.stringify(value));
const now = () => new Date().toISOString();
const id = (prefix) => `${prefix}-${crypto.randomUUID()}`;
const sha = (content) => crypto.createHash('sha256').update(String(content)).digest('hex');
const safeName = (name) => String(name).trim().toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 48);

// Native filenames are presentation-independent. Keep source identities and paths
// in the store; disambiguate visible sibling names with ordinary numeric suffixes.
function readablePaths(entries, root, flattenedFolder) {
  const result={}, nodes=new Map(), used=new Set();
  const relative=e=>{if(e.renamedFrom)return e.workspacePath.replace(/^1 Working files\//,'');let value=e.path.replace(/^1 Sources\//,'');const prefix='Confluence/'+flattenedFolder+'/';if(flattenedFolder&&value.startsWith(prefix))value='Confluence/'+value.slice(prefix.length);return value;};
  const titles=new Map(entries.filter(e=>e.pageId).map(e=>[relative(e).replace(/\.md$/,''),String(e.title||'').replace(/[\\/:*?"<>|\[\]#^\x00-\x1f]/g,'-').trim().replace(/^[ .]+|[ .]+$/g,'').slice(0,120)]));
  for(const e of entries.filter(e=>!e.pageId||e.renamedFrom)) {
    const value=e.workspacePath?.startsWith(root+'/')?e.workspacePath.slice(root.length+1):relative(e);
    result[e.key]=root+'/'+safeRelative(value,'Invalid working path');
    used.add(value.replace(/\.md$/,'').toLowerCase());
  }
  for(const e of entries.filter(e=>e.pageId&&!e.renamedFrom).sort((a,b)=>a.path.localeCompare(b.path)||a.key.localeCompare(b.key))) {
    const parts=safeRelative(relative(e),'Invalid source path').replace(/\.md$/,'').split('/');
    let raw='',parent='';
    for(const part of parts) {
      raw=raw?raw+'/'+part:part;
      if(!nodes.has(raw)) {
        const base=titles.get(raw)||part.replace(/ -- \d+$/,'')||'Untitled';
        let name=base,candidate=parent?parent+'/'+name:name,n=2;
        while(used.has(candidate.toLowerCase())){name=base+' ('+(n++)+')';candidate=parent?parent+'/'+name:name;}
        nodes.set(raw,candidate);used.add(candidate.toLowerCase());
      }
      parent=nodes.get(raw);
    }
    result[e.key]=root+'/'+parent+'.md';
  }
  return result;
}

// Importer provenance is operational metadata, not requirement content. Keep
// all other YAML (including business fields) intact for comparisons and export.
function normalizeContent(content, keepIdentity = false) {
  return String(content)
    .replace(/^---\r?\n([\s\S]*?)\r?\n---\r?\n?/, (whole, yaml) => {
      const kept = [];
      for (const line of yaml.split(/\r?\n/)) {
        const match = line.match(/^\s*([^:#]+?)\s*:\s*(.*?)\s*$/);
        if (!match) {
          kept.push(line);
          continue;
        }
        const key = match[1].trim().toLowerCase().replace(/_/g, '-');
        const value = match[2].trim().replace(/^['"]|['"]$/g, '').toLowerCase();
        if (!keepIdentity && ['rewb-id', 'rewb-source', 'rewb-import-warning'].includes(key)) continue;
        if (['imported-at', 'imported', 'retrieved-at', 'abgerufen', 'quellen-version', 'confluence-version', 'quellen-id', 'confluence-url'].includes(key)) continue;
        if (key === 'typ' && ['quelle', 'source', 'confluence'].includes(value)) continue;
        if (key === 'cssclasses' && /(^|[\s,\["'])rewb-source($|[\s,\]"'])/i.test(match[2])) {
          const raw = match[2].trim();
          if (/^\[[\s\S]*\]$/.test(raw)) {
            const classes = raw.slice(1, -1).split(',').map((item) => item.trim()).filter((item) => item && item.replace(/^['"]|['"]$/g, '').toLowerCase() !== 'rewb-source');
            if (classes.length) kept.push(`${match[1].trim()}: [${classes.join(', ')}]`);
          } else {
            const classes = raw.split(/\s+/).filter((item) => item.toLowerCase() !== 'rewb-source');
            if (classes.length) kept.push(`${match[1].trim()}: ${classes.join(' ')}`);
          }
          continue;
        }
        kept.push(line);
      }
      return kept.length ? `---\n${kept.join('\n')}\n---\n` : '';
    })
    .replace(/(?:^|\n)[ \t]*> \[!abstract\][ \t]*(?:source|quelle)\s*[·•\-|:]\s*confluence(?:\s+v(?:ersion)?\.?\s*[0-9]+)?[^\r\n]*\r?\n(?:>[^\r\n]*(?:\r?\n|$))*(?:\r?\n|$)/i, '\n');
}

function invalidPath(value) {
  return typeof value !== 'string'
    || !value
    || value.includes('\0')
    || value.includes('\\')
    || path.posix.isAbsolute(value)
    || path.win32.isAbsolute(value)
    || /^[A-Za-z]:/.test(value)
    || value.split('/').some((part) => part === '..');
}

function safeRelative(value, message = 'A vault-relative path is required.') {
  if (invalidPath(value)) throw new StoreError(message, 'INVALID_PATH');
  const normalized = path.posix.normalize(value);
  if (!normalized || normalized === '.' || normalized === '..' || normalized.startsWith('../')) {
    throw new StoreError(message, 'INVALID_PATH');
  }
  return normalized;
}

function within(root, relative) {
  if (invalidPath(relative)) throw new StoreError('A vault-relative path is required.', 'INVALID_PATH');
  const resolvedRoot = path.resolve(root);
  const resolved = path.resolve(resolvedRoot, relative);
  if (resolved !== resolvedRoot && !resolved.startsWith(`${resolvedRoot}${path.sep}`)) {
    throw new StoreError('Path escapes the vault.', 'INVALID_PATH');
  }
  return resolved;
}

function sameEntries(a, b) {
  return JSON.stringify(a) === JSON.stringify(b);
}

function contentEquivalent(a, b) {
  if (!a || !b) return false;
  return (a.normalizedHash || a.contentHash) === (b.normalizedHash || b.contentHash);
}

function locationEquivalent(a,b) {
  return String(a?.path||'')===String(b?.path||'') &&
    String(a?.renamedFrom ? a.workspacePath : '')===String(b?.renamedFrom ? b.workspacePath : '');
}

function logicalEquivalent(a, b) {
  return !!a && !!b
    && contentEquivalent(a, b)
    && locationEquivalent(a,b)
    && String(a.title || '') === String(b.title || '')
    && String(a.parentId || '') === String(b.parentId || '')
    && !!a.missing === !!b.missing;
}

class WorkbenchStore {
  constructor(vaultPath) {
    this.vault = path.resolve(vaultPath);
    this.history = path.join(this.vault, '.rewb-history');
    this.statePath = path.join(this.history, 'state.json');
    this.state = null;
    this.serial = Promise.resolve();
  }

  async init() {
    return this._locked(async () => this._initialize());
  }

  async _initialize() {
    await fs.mkdir(this.history, { recursive: true });
    try {
      await run('git', ['init', '--bare', this.history]);
    } catch (error) {
      throw new StoreError(`Could not create the local object store: ${error.message}`);
    }
    this.state = await this._load();
    await this._migrateState();
    // Schema 1 variants did not have their own refs. Recreate one on load so
    // live overlay blobs, including deleted unsaved files, survive git gc.
    for (const variant of this.state.variants) {
      if (!variant.objectRef) variant.objectRef = await this._retainVariant(variant);
    }
    await this._save();
    return {
      sourceSnapshotId: this.state.currentSourceId || null,
      versionCount: this.state.versions.length,
      variantCount: this.state.variants.length,
    };
  }

  async captureSources(name) {
    return this._locked(async () => {
      await this._ready();
      const before = clone(this.state);
      const manifestPath = path.join(this.vault, '6 Import log/Confluence/manifest.json');
      let manifest;
      try {
        manifest = JSON.parse(await fs.readFile(manifestPath, 'utf8'));
      } catch (error) {
        const current = this._source(this.state.currentSourceId);
        const prior = current?.manifestBlob ? JSON.parse(await this._readBlob(current.manifestBlob)) : null;
        // A new starter has no import yet. Never hide a lost or malformed real manifest.
        if (error.code !== 'ENOENT' || (current && prior?.starterBootstrap !== true)) {
          throw new StoreError('The Confluence manifest is unavailable or invalid.', 'MANIFEST_UNAVAILABLE');
        }
        manifest = { pages: [], starterBootstrap: true };
      }
      if (!Array.isArray(manifest.pages)) throw new StoreError('The Confluence manifest has no pages.', 'MANIFEST_INVALID');

      const previous = this._source(this.state.currentSourceId);
      const previousManifest=previous?.manifestBlob?JSON.parse(await this._readBlob(previous.manifestBlob)):null;
      const changedScope=!!manifest.scope_id && manifest.scope_id!==previousManifest?.scope_id;
      const entries = [];
      for (const page of manifest.pages) {
        if (!page || page.id == null || !page.path) throw new StoreError('A manifest page needs an id and path.', 'MANIFEST_INVALID');
        const sourcePath = String(page.path);
        if (!sourcePath.startsWith('1 Sources/') || invalidPath(sourcePath)) {
          throw new StoreError('Manifest paths must stay in 1 Sources.', 'INVALID_PATH');
        }
        let content;
        const sourceFile = within(this.vault, sourcePath);
        try {
          const sourceRoot = within(this.vault, '1 Sources');
          await this._assertNoSymlinks(sourceFile, { allowMissing: false });
          const sourceRootReal = await fs.realpath(sourceRoot);
          const sourceReal = await fs.realpath(sourceFile);
          if (sourceReal !== sourceRootReal && !sourceReal.startsWith(`${sourceRootReal}${path.sep}`)) throw new Error('symlink escape');
          content = await fs.readFile(sourceReal, 'utf8');
        } catch {
          throw new StoreError(`Imported source is missing or unsafe: ${sourcePath}`, 'SOURCE_UNAVAILABLE');
        }
        if (page.sha256 && sha(content) !== page.sha256) throw new StoreError(`Source checksum mismatch: ${sourcePath}`, 'SOURCE_CHANGED');
        entries.push({
          key: manifest.source_namespace ? `page:${manifest.source_namespace}:${page.id}` : `page:${page.id}`,
          pageId: String(page.id),
          path: sourcePath,
          title: page.remote_title || page.title || String(page.id),
          parentId: page.parent_id || null,
          sourceOrder: manifest.ordering==='source' && Array.isArray(page.source_order) ? page.source_order : null,
          contentHash: await this._writeBlob(content),
          normalizedHash: sha(normalizeContent(content)),
          missing: !!page.not_seen_at,
          origin: 'source',
        });
      }

      const present = new Set(entries.map((entry) => entry.key));
      const missingKeys = [];
      if (previous && !changedScope) {
        for (const entry of previous.entries) {
          if (!present.has(entry.key)) {
            entries.push({ ...entry, missing: true });
            missingKeys.push(entry.key);
          }
        }
      }
      entries.sort((a, b) => a.key.localeCompare(b.key));
      const normalized = entries.map(({ key, contentHash, normalizedHash, missing, path: entryPath, title, parentId, sourceOrder }) => ({
        key, contentHash, normalizedHash, missing, path: entryPath, title, parentId, sourceOrder: sourceOrder || null,
      }));
      const previousNormalized = previous?.entries.map(({ key, contentHash, normalizedHash, missing, path: entryPath, title, parentId, sourceOrder }) => ({
        key, contentHash, normalizedHash, missing, path: entryPath, title, parentId, sourceOrder: sourceOrder || null,
      }));
      if (previous && !changedScope && !!previousManifest?.starterBootstrap === !!manifest.starterBootstrap && sameEntries(normalized, previousNormalized)) {
        return {
          id: previous.id,
          name: previous.name,
          createdAt: previous.createdAt,
          unchanged: true,
          entryCount: entries.length,
          missingKeys,
        };
      }

      const manifestBlob = await this._writeBlob(JSON.stringify(manifest));
      const snapshot = {
        id: id('source'),
        name: name || `Sources ${now()}`,
        automatic: !name,
        createdAt: now(),
        manifestBlob,
        entries,
      };
      try {
        snapshot.objectRef = await this._retain(snapshot.id, entries, 'source snapshot', manifestBlob);
        this.state.sources.push(snapshot);
        this.state.currentSourceId = snapshot.id;
        await this._save();
      } catch (error) {
        this.state = before;
        try { await this._save(); } catch { /* retain the original failure */ }
        throw error;
      }
      return {
        id: snapshot.id,
        name: snapshot.name,
        createdAt: snapshot.createdAt,
        unchanged: false,
        entryCount: entries.length,
        missingKeys,
      };
    });
  }

  async pruneAutomaticHistory(limit) {
    return this._locked(async()=>{
      await this._ready();
      if(!Number.isInteger(limit)||limit<1)throw new StoreError('Keep at least one automatic version.','INVALID_RETENTION');
      const before=clone(this.state),protectedIds=new Set([this.state.currentSourceId]);
      for(const v of this.state.variants){protectedIds.add(v.baseId);protectedIds.add(String(v.derivedFrom||'').replace(/^(source|version):/,''));for(const key of Object.keys(v.reviews||{}))protectedIds.add(key);}
      const recent=items=>new Set(items.filter(x=>x.automatic===true).slice(-limit).map(x=>x.id));
      const keepVersions=recent(this.state.versions);
      const versions=this.state.versions.filter(v=>v.automatic!==true||keepVersions.has(v.id)||protectedIds.has(v.id));
      for(const v of versions)protectedIds.add(v.sourceSnapshotId);
      const keepSources=recent(this.state.sources);
      const sources=this.state.sources.filter(v=>v.automatic!==true||keepSources.has(v.id)||protectedIds.has(v.id));
      const retained=new Set([...sources,...versions].map(x=>x.id));
      const removed=[...this.state.sources,...this.state.versions].filter(x=>!retained.has(x.id));
      if(!removed.length)return {removed:0,retainedAutomatic:[...sources,...versions].filter(x=>x.automatic===true).length};
      await fs.writeFile(path.join(this.history,'retention-backup.json'),JSON.stringify(before,null,2)+'\n');
      this.state.sources=sources;this.state.versions=versions;
      try{await this._save();}catch(e){this.state=before;throw e;}
      const pending=[];
      for(const record of removed){try{await run('git',['--git-dir',this.history,'update-ref','-d','refs/rewb/'+record.id]);}catch{pending.push(record.id);}}
      // Object reclamation is left to Git maintenance; no aggressive prune during editing.
      return {removed:removed.length,pendingRefCleanup:pending,retainedAutomatic:[...sources,...versions].filter(x=>x.automatic===true).length};
    });
  }

  async listVersions() {
    return this._locked(async () => {
      await this._ready();
      return this.state.versions.map(({ id: versionId, name, createdAt, sourceSnapshotId, entries }) => ({
        id: versionId, name, createdAt, sourceSnapshotId, entryCount: entries.length,
      }));
    });
  }

  async createVariant(name, baseRef, options = {}) {
    return this._locked(async () => {
      await this._ready();
      if (!safeName(name)) throw new StoreError('Variant name is required.', 'INVALID_NAME');
      if (this.state.variants.some((variant) => variant.name.toLocaleLowerCase() === String(name).trim().toLocaleLowerCase())) {
        throw new StoreError('A variant with that name already exists.', 'DUPLICATE_NAME');
      }
      const requested = String(baseRef || this.state.currentSourceId || '');
      const sourceId = this._sourceForRef(requested) || requested;
      const base = this._source(sourceId);
      if (!base) throw new StoreError('Unknown source snapshot.', 'UNKNOWN_SNAPSHOT');

      const variant = {
        id: id('variant'),
        name: String(name).trim(),
        baseId: base.id,
        derivedFrom: requested,
        folder: '',
        contentFolder: '',
        createdAt: now(),
        overlays: {},
        reviews: {},
      };
      variant.folder = path.posix.join('3 Drafts/Variants', `${safeName(name)}-${variant.id.slice(-8)}`);
      variant.contentFolder = path.posix.join(variant.folder, 'Content');
      if (options.nativeWorking) {
        if (this.state.variants.some(v => v.contentFolder === '1 Working files')) throw new StoreError('Working files already configured.', 'PATH_CONFLICT');
        const target = within(this.vault, '1 Working files');
        try { if ((await fs.readdir(target)).length) throw new StoreError('Working folder is not empty.', 'PATH_CONFLICT'); } catch(error) { if(error.code !== 'ENOENT') throw error; }
        variant.contentFolder = '1 Working files'; variant.folder = '1 Working files'; variant.nativeWorking = true;
      }
      await this._ensureVariantContentRoot(variant);

      if (requested.startsWith('version:') || requested.startsWith('variant:')) {
        for (const item of await this._tree(requested, true, true)) {
          const entry = { ...item };
          delete entry.workspacePath;
          const original = base.entries.find((candidate) => candidate.key === entry.key);
          if (entry.deleted || !original || !logicalEquivalent(original, entry)) {
            entry.materialized = false;
            variant.overlays[entry.key] = entry;
          }
        }
      }
      variant.objectRef = await this._retainVariant(variant);
      this.state.variants.push(variant);
      await this._save();
      return this._variantInfo(variant);
    });
  }

  async flattenNativeConfluence(variantId, folderName) {
    return this._locked(async () => {
      await this._ready();
      const v = this._variant(variantId);
      if (!v?.nativeWorking) throw new StoreError('Not a native working folder.', 'INVALID_REF');
      if (v.flattenedSourceFolder) return;
      if (!folderName || /[\\/]/.test(folderName) || folderName === '..' || folderName === '.') throw new StoreError('Invalid folder.', 'INVALID_PATH');
      await this._syncOverlay(v, {persist:true});
      const transaction = await this._transaction(v);
      await transaction(async tx => {
        v.flattenedSourceFolder = folderName;
        for (const entry of Object.values(v.overlays)) {
          if (!entry.workspacePath) continue;
          const old = entry.workspacePath;
          const prefix = v.contentFolder + '/Confluence/' + folderName + '/';
          if (!old.startsWith(prefix)) continue;
          const target = v.contentFolder + '/Confluence/' + old.slice(prefix.length);
          const destination = await this._assertVariantPath(v, target, {allowMissing:true});
          try { await fs.lstat(destination); throw new StoreError('Destination already exists: '+target, 'PATH_CONFLICT'); } catch(e) { if(e.code !== 'ENOENT') throw e; }
          if (!entry.deleted && !entry.missing) { await tx.write(target, await fs.readFile(within(this.vault,old),'utf8')); await tx.unlink(old); }
          entry.workspacePath = target;
        }
        v.objectRef = await this._retainVariant(v);
        await this._save();
      });
    });
  }

  async useReadableNativePaths(variantId) {
    return this._locked(async()=>{
      await this._ready();const v=this._variant(variantId);
      if(!v?.nativeWorking)throw new StoreError('Not a native working folder.','INVALID_REF');
      if(v.readablePaths)return {moves:[]};
      const entries=await this._tree('variant:'+variantId,true,true);
      const targets=readablePaths(entries,v.contentFolder,v.flattenedSourceFolder);
      const moves=entries.filter(e=>!e.deleted&&!e.missing&&this._variantFilePath(v,e)!==targets[e.key]).map(e=>({key:e.key,from:this._variantFilePath(v,e),to:targets[e.key]}));
      for(const move of moves){
        const target=await this._assertVariantPath(v,move.to,{allowMissing:true});
        try{await fs.lstat(target);throw new StoreError('A working file already exists: '+move.to,'PATH_CONFLICT');}catch(e){if(e.code!=='ENOENT')throw e;}
      }
      if(moves.length)await this._saveVersion('variant:'+variantId,'Before readable filenames '+now(),true);
      const transaction=await this._transaction(v);
      return transaction(async tx=>{
        for(const move of moves){await tx.write(move.to,await fs.readFile(within(this.vault,move.from),'utf8'));await tx.unlink(move.from);}
        v.readablePaths=targets;
        for(const entry of entries){const overlay=v.overlays[entry.key];if(overlay)overlay.workspacePath=targets[entry.key];}
        v.objectRef=await this._retainVariant(v);await this._save();return {moves};
      });
    });
  }

  // Obsidian already moved the bytes. Record that event before the next scan.
  async recordNativeRename(variantId,oldPath,newPath) {
    return this._locked(async()=>{
      await this._ready();const v=this._variant(variantId);
      if(!v?.nativeWorking)throw new StoreError('Not a native working folder.','INVALID_REF');
      if(!oldPath.startsWith(v.contentFolder+'/')||!newPath.startsWith(v.contentFolder+'/'))return {renamed:0};
      const matches=Object.values(v.overlays).filter(e=>e.workspacePath===oldPath||e.workspacePath?.startsWith(oldPath+'/'));
      if(!matches.length)return {renamed:0};
      const transaction=await this._transaction(v);
      return transaction(async()=>{
        for(const e of matches){
          const from=e.workspacePath,to=newPath+from.slice(oldPath.length);
          await this._assertVariantPath(v,to,{allowMissing:true});
          const occupant=Object.values(v.overlays).find(x=>x.key!==e.key&&x.workspacePath===to);
          if(occupant?.pageId)throw new StoreError('Another source owns this path.','PATH_CONFLICT');
          if(occupant)delete v.overlays[occupant.key];
          const initial=e.renamedFrom||from;
          e.workspacePath=to;
          if(to===initial){delete e.renamedFrom;e.title=this._source(v.baseId).entries.find(x=>x.key===e.key)?.title||path.posix.basename(to,'.md');}
          else {e.renamedFrom=initial;e.title=path.posix.basename(to,'.md');}
          if(!e.pageId){e.path=to.slice(v.contentFolder.length+1);delete e.renamedFrom;}
          try{const content=await fs.readFile(within(this.vault,to),'utf8');e.contentHash=await this._writeBlob(content);e.normalizedHash=sha(normalizeContent(content));e.deleted=false;e.missing=false;e.materialized=true;}catch(error){if(error.code!=='ENOENT')throw error;}
        }
        v.objectRef=await this._retainVariant(v);await this._save();return {renamed:matches.length};
      });
    });
  }

  async resolveNativeRenames(variantId,expectedToken) {
    return this._locked(async()=>{
      await this._ready();const v=this._variant(variantId);
      if(!v?.nativeWorking)throw new StoreError('Not a native working folder.','INVALID_REF');
      const entries=await this._tree('variant:'+variantId,true,true),token=sha(JSON.stringify(entries));
      const removed=entries.filter(e=>e.pageId&&e.deleted),added=entries.filter(e=>!e.pageId&&!e.deleted&&!e.missing);
      const pairs=[];
      for(const old of removed){
        const matches=added.filter(e=>e.contentHash===old.contentHash);
        if(matches.length===1&&removed.filter(e=>e.contentHash===old.contentHash).length===1)pairs.push({key:old.key,localKey:matches[0].key,from:old.workspacePath,to:matches[0].workspacePath});
      }
      if(expectedToken===undefined)return {token,pairs,unresolved:removed.length-pairs.length};
      if(token!==expectedToken)throw new StoreError('Files changed. Review the matches again.','STALE_REVIEW');
      if(!pairs.length)return {reconnected:0};
      await this._saveVersion('variant:'+variantId,'Before reconnecting files '+now(),true);
      const transaction=await this._transaction(v);
      return transaction(async()=>{
        for(const pair of pairs){
          const old=v.overlays[pair.key],local=v.overlays[pair.localKey];
          v.overlays[pair.key]={...old,workspacePath:pair.to,renamedFrom:old.renamedFrom||pair.from,title:local.title,contentHash:local.contentHash,normalizedHash:local.normalizedHash,deleted:false,missing:false,materialized:true};
          delete v.overlays[pair.localKey];
        }
        v.objectRef=await this._retainVariant(v);await this._save();return {reconnected:pairs.length};
      });
    });
  }

  async applySourceOrder(variantId) {
    return this._locked(async()=>{
      await this._ready();const v=this._variant(variantId);
      if(!v?.nativeWorking)throw new StoreError('Not a native working folder.','INVALID_REF');
      const current=this._source(this.state.currentSourceId);
      const keys=new Set(this._source(v.baseId).entries.map(e=>e.key));
      v.sourceOrderByKey ||= {};
      for(const e of current?.entries||[])if(keys.has(e.key))v.sourceOrderByKey[e.key]=e.sourceOrder||null;
      await this._save();
    });
  }

  async nativeWorkingToken(variantId) {
    return this._locked(async () => {
      await this._ready();
      const v = this._variant(variantId);
      if (!v?.nativeWorking) throw new StoreError('Not a native working folder.', 'INVALID_REF');
      return sha(JSON.stringify(await this._tree('variant:' + variantId, true, true)));
    });
  }

  async replaceNativeWorking(variantId, targetRef, expectedToken, options = {}) {
    return this._locked(async () => {
      await this._ready();
      const v = this._variant(variantId);
      if (!v?.nativeWorking) throw new StoreError('Not a native working folder.', 'INVALID_REF');
      const entries = await this._tree('variant:' + variantId, true, true);
      if (sha(JSON.stringify(entries)) !== expectedToken) throw new StoreError('Working files changed. Review the reset again.', 'STALE_REVIEW');
      const target = clone(await this._tree(targetRef, true, true));
      if (target.some(e => e.missing)) throw new StoreError('Target includes unavailable files; reset cancelled.', 'WORKING_FILE_MISSING');
      const baseId = this._sourceForRef(targetRef);
      const recovery = await this._saveVersion('variant:' + variantId, 'Recovery ' + new Date().toISOString().replace('T', ' ').replace('Z', ''),true);
      let archivePath = null;
      if (options.archive !== false) {
        const folder = validateArchiveFolder(options.archiveFolder || '5 Archive/Working changes');
        const base = new Map(this._source(v.baseId).entries.map(e=>[e.key,e]));
        const changes = entries.filter(e=>e.deleted || !base.has(e.key) || (!contentEquivalent(base.get(e.key),e)||!locationEquivalent(base.get(e.key),e)));
        if(changes.length) {
          const parent = within(this.vault, folder);
          await this._assertNoSymlinks(parent,{allowMissing:true});
          await fs.mkdir(parent,{recursive:true});
          const dir = await fs.mkdtemp(path.join(parent,new Date().toISOString().replace(/[:.]/g,'-')+'-'));
          archivePath = path.relative(this.vault,dir).split(path.sep).join('/');
          for(const entry of changes) {
            if(entry.deleted)continue;
            if(entry.missing)throw new StoreError('Cannot archive an unavailable working file.','WORKING_FILE_MISSING');
            const relative=this._variantFilePath(v,entry).slice(v.contentFolder.length+1);
            const destination=within(dir,'Files/'+relative);
            await fs.mkdir(path.dirname(destination),{recursive:true});
            const content=await this._readBlob(entry.contentHash);
            await fs.writeFile(destination,content,{flag:'wx'});
            if(await fs.readFile(destination,'utf8')!==content)throw new StoreError('Archive verification failed.','ARCHIVE_FAILED');
          }
          await fs.writeFile(path.join(dir,'Changes.json'),JSON.stringify({createdAt:now(),recoveryVersionId:recovery.id,files:changes.map(e=>({path:e.path,status:e.deleted?'deleted':base.has(e.key)?'changed':'added'}))},null,2),{flag:'wx'});
        }
      }
      const transaction = await this._transaction(v);
      return transaction(async tx => {
        for (const entry of Object.values(v.overlays)) if (entry.workspacePath) await tx.unlink(entry.workspacePath);
        v.baseId = baseId; v.overlays = {}; v.reviews = {};
        v.sourceOrderByKey=Object.fromEntries(target.map(e=>[e.key,e.sourceOrder||null]));
        if(v.readablePaths||target.some(e=>e.renamedFrom))v.readablePaths=readablePaths(target,v.contentFolder,v.flattenedSourceFolder);
        for (const entry of target) {
          if (entry.deleted) { v.overlays[entry.key] = {...entry, materialized:false}; continue; }
          delete entry.workspacePath;
          const relative = this._variantFilePath(v, entry);
          const content = normalizeContent(await this._readBlob(entry.contentHash), true);
          await tx.write(relative, content);
          const contentHash = await this._writeBlob(content);
          v.overlays[entry.key] = {...entry, contentHash, normalizedHash:sha(content), workspacePath:relative, materialized:true, origin:'variant'};
        }
        v.objectRef = await this._retainVariant(v);
        await this._save();
        return { recoveryVersionId:recovery.id, archivePath };
      });
    });
  }

  async listVariants() {
    return this._locked(async () => {
      await this._ready();
      return this.state.variants.map((variant) => this._variantInfo(variant));
    });
  }

  async getTree(ref) {
    return this._locked(async () => {
      await this._ready();
      return this._publicTree(await this._tree(ref, true));
    });
  }

  async getRemovedFiles(variantId) {
    return this._locked(async () => {
      await this._ready();
      const variant = this._variant(variantId);
      if (!variant) throw new StoreError('Unknown variant.', 'UNKNOWN_VARIANT');
      await this._syncOverlay(variant, { persist: true });
      const removed = await Promise.all(Object.values(variant.overlays)
        .filter((entry) => entry.deleted)
        .map(async (entry) => ({
          ...this._publicEntry(entry),
          content: entry.contentHash ? await this._readBlob(entry.contentHash) : null,
        })));
      return removed.sort((a, b) => a.key.localeCompare(b.key));
    });
  }

  async readFile(ref, key) {
    return this._locked(async () => {
      await this._ready();
      const entry = (await this._tree(ref, true)).find((item) => item.key === key);
      if (!entry) throw new StoreError('Unknown file key.', 'UNKNOWN_FILE');
      const content = entry.missing && entry.origin === 'variant' ? null : await this._readBlob(entry.contentHash);
      return { ...this._publicEntry(entry), content };
    });
  }

  async editInVariant(variantId, key) {
    return this._locked(async () => {
      await this._ready();
      const variant = this._variant(variantId);
      if (!variant) throw new StoreError('Unknown variant.', 'UNKNOWN_VARIANT');
      const entry = (await this._tree(`variant:${variantId}`, true)).find((item) => item.key === key);
      if (!entry) throw new StoreError('Unknown file key.', 'UNKNOWN_FILE');
      const relative = this._variantFilePath(variant, entry);
      const transaction = await this._transaction(variant);
      return transaction(async (tx) => {
        const target = await this._assertVariantPath(variant, relative, { allowMissing: true });
        let created = false;
        let materializedHash = entry.contentHash;
        let materializedNormalizedHash = entry.normalizedHash || sha(await this._readBlob(entry.contentHash));
        try {
          const stat = await fs.lstat(target);
          if (stat.isSymbolicLink()) throw new StoreError('Variant path contains a symlink.', 'UNSAFE_PATH');
          if (!stat.isFile()) throw new StoreError('Variant path is not a file.', 'PATH_CONFLICT');
        } catch (error) {
          if (error.code !== 'ENOENT') throw error;
          const content = normalizeContent(await this._readBlob(entry.contentHash), true);
          await tx.write(relative, content);
          materializedHash = await this._writeBlob(content);
          materializedNormalizedHash = sha(normalizeContent(content));
          created = true;
        }
        variant.overlays[key] = {
          ...entry,
          key,
          workspacePath: relative,
          contentHash: materializedHash,
          normalizedHash: materializedNormalizedHash,
          missing: false,
          deleted: false,
          materialized: true,
          origin: 'variant',
        };
        variant.objectRef = await this._retainVariant(variant);
        await this._save();
        return { key, path: relative, created };
      });
    });
  }

  async addFile(variantId, relativePath, content = '') {
    return this._locked(async () => {
      await this._ready();
      const variant = this._variant(variantId);
      if (!variant) throw new StoreError('Unknown variant.', 'UNKNOWN_VARIANT');
      if (typeof relativePath !== 'string' || !/\.md$/i.test(relativePath)) {
        throw new StoreError('New files must be Markdown.', 'INVALID_PATH');
      }
      const clean = safeRelative(relativePath, 'New files must stay below the variant Content folder.');
      const relative = path.posix.join(variant.contentFolder, clean);
      const target = await this._assertVariantPath(variant, relative, { allowMissing: true });
      try {
        const stat = await fs.lstat(target);
        if (stat.isSymbolicLink()) throw new StoreError('Variant path contains a symlink.', 'UNSAFE_PATH');
        if (stat.isDirectory()) throw new StoreError('A directory already exists there.', 'DUPLICATE_PATH');
        if (stat.isFile()) throw new StoreError('A file already exists there.', 'DUPLICATE_PATH');
      } catch (error) {
        if (error.code !== 'ENOENT') throw error;
      }
      if (Object.values(variant.overlays).some((overlay) => overlay.workspacePath === relative)) {
        throw new StoreError('A file already exists there.', 'DUPLICATE_PATH');
      }
      const transaction = await this._transaction(variant);
      return transaction(async (tx) => {
        await tx.write(relative, String(content));
        const key = `local:${crypto.randomUUID()}`;
        variant.overlays[key] = {
          key,
          pageId: null,
          path: clean,
          workspacePath: relative,
          title: path.posix.basename(clean, '.md'),
          contentHash: await this._writeBlob(String(content)),
          normalizedHash: sha(normalizeContent(String(content))),
          missing: false,
          deleted: false,
          origin: 'variant',
          materialized: true,
        };
        variant.objectRef = await this._retainVariant(variant);
        await this._save();
        return { key, path: relative };
      });
    });
  }

  async markRemoved(variantId, key) {
    return this._setRemoved(variantId, key, true);
  }

  async restore(variantId, key) {
    return this._setRemoved(variantId, key, false);
  }

  async saveVersion(ref, name) {
    return this._locked(async () => {
      const before = this.state ? clone(this.state) : null;
      try {
        return await this._saveVersion(ref, name);
      } catch (error) {
        if (before) {
          this.state = before;
          try { await this._save(); } catch { /* retain the original failure */ }
        }
        throw error;
      }
    });
  }

  async _saveVersion(ref, name, automatic = false) {
    await this._ready();
    if (!safeName(name)) throw new StoreError('Version name is required.', 'INVALID_NAME');
    if (this.state.versions.some((version) => version.name.toLocaleLowerCase() === String(name).trim().toLocaleLowerCase())) {
      throw new StoreError('A version with that name already exists.', 'DUPLICATE_NAME');
    }
    const entries = clone(await this._tree(ref, true, true));
    const unavailable = entries.find(entry => entry.origin === 'variant' && entry.missing && !entry.deleted);
    if (unavailable) throw new StoreError('A working file is unavailable: ' + unavailable.path + '. Restore it or mark it removed before saving a version.', 'WORKING_FILE_MISSING');
    const sourceSnapshotId = this._sourceForRef(ref);
    const version = {
      id: id('version'),
      name: String(name).trim(),
      automatic,
      createdAt: now(),
      sourceSnapshotId,
      entries,
    };
    version.objectRef = await this._retain(version.id, entries, 'saved version');
    this.state.versions.push(version);
    await this._save();
    return {
      id: version.id,
      name: version.name,
      createdAt: version.createdAt,
      sourceSnapshotId,
      entryCount: entries.length,
    };
  }

  async compare(left, right) {
    return this._locked(async () => {
      await this._ready();
      const a = await this._tree(left, true);
      const b = left === right ? a : await this._tree(right, true);
      const am = new Map(a.map((entry) => [entry.key, entry]));
      const bm = new Map(b.map((entry) => [entry.key, entry]));
      const result = {
        left,
        right,
        added: [],
        removed: [],
        changed: [],
        unchanged: [],
        renamed: [],
        missing: [],
      };
      for (const key of new Set([...am.keys(), ...bm.keys()])) {
        if (!am.has(key)) result.added.push(key);
        else if (!bm.has(key)) result.removed.push(key);
        else {
          const from = am.get(key);
          const to = bm.get(key);
          if (from.missing || to.missing) result.missing.push(key);
          const sameTitle=String(from.title||'')===String(to.title||'');
          if (!locationEquivalent(from,to)||!sameTitle) result.renamed.push(key);
          if (contentEquivalent(from, to)&&locationEquivalent(from,to)&&sameTitle) result.unchanged.push(key);
          else result.changed.push(key);
        }
      }
      for (const list of Object.values(result)) if (Array.isArray(list)) list.sort();
      return result;
    });
  }

  async reviewUpdates(variantId, sourceSnapshotId) {
    return this._locked(async () => {
      await this._ready();
      const variant = this._variant(variantId);
      if (!variant) throw new StoreError('Unknown variant.', 'UNKNOWN_VARIANT');
      const latest = this._source(sourceSnapshotId || this.state.currentSourceId);
      if (!latest) throw new StoreError('Unknown source snapshot.', 'UNKNOWN_SNAPSHOT');
      return this._review(variant, latest);
    });
  }

  async _review(variant, latest) {
    const base = this._source(variant.baseId);
    if (!base) throw new StoreError('Unknown source snapshot.', 'UNKNOWN_SNAPSHOT');
    const mine = await this._tree(`variant:${variant.id}`, true);
    const mineAll = await this._tree(`variant:${variant.id}`, true, true);
    const bm = new Map(base.entries.map((entry) => [entry.key, entry]));
    const tm = new Map(latest.entries.map((entry) => [entry.key, entry]));
    const mm = new Map(mine.map((entry) => [entry.key, entry]));
    const items = [];
    for (const key of new Set([...bm.keys(), ...tm.keys(), ...mm.keys()])) {
      const b = bm.get(key);
      const t = tm.get(key);
      const m = mm.get(key);
      const sourceChanged = !!b && (!t || !logicalEquivalent(b, t));
      const mineChanged = !b ? !!m : !m || !!m.deleted || !!m.missing !== !!b.missing || !contentEquivalent(b, m) || !locationEquivalent(b,m);
      let status = 'unchanged';
      if (b && (!t || t.missing)) status = 'missing';
      else if (!b && t) status = 'added';
      else if (sourceChanged && mineChanged) status = 'both-changed';
      else if (sourceChanged) status = 'source-changed';
      else if (mineChanged) status = 'mine-changed';
      items.push({
        key,
        status,
        base: this._brief(b),
        mine: this._brief(m),
        theirs: this._brief(t),
        decision: variant.reviews[latest.id]?.[key] || null,
      });
    }
    await Promise.all(items.map(async (item) => {
      item.baseContent = item.base && !item.base.missing ? await this._readBlob(item.base.contentHash) : null;
      item.mineContent = item.mine && !item.mine.missing ? await this._readBlob(item.mine.contentHash) : null;
      item.theirsContent = item.theirs && !item.theirs.missing ? await this._readBlob(item.theirs.contentHash) : null;
    }));
    const sorted = items.sort((a, b) => a.key.localeCompare(b.key));
    const fingerprint = mineAll
      .map((entry) => [entry.key, entry.contentHash, entry.normalizedHash, !!entry.missing, !!entry.deleted, entry.path, entry.title, entry.parentId, entry.workspacePath])
      .sort((a, b) => a[0].localeCompare(b[0]));
    return {
      variantId: variant.id,
      sourceSnapshotId: latest.id,
      baseId: base.id,
      reviewToken: sha(JSON.stringify({ source: latest.id, mine: fingerprint })),
      items: sorted,
    };
  }

  async applyReviewedUpdates(variantId, sourceSnapshotId, choices, reviewToken) {
    return this._locked(async () => {
      await this._ready();
      const initialVariant = this._variant(variantId);
      const source = this._source(sourceSnapshotId);
      if (!initialVariant) throw new StoreError('Unknown variant.', 'UNKNOWN_VARIANT');
      if (!source || this.state.currentSourceId !== sourceSnapshotId) {
        throw new StoreError('The source changed after review. Review it again before applying decisions.', 'STALE_REVIEW');
      }
      if (!choices || typeof choices !== 'object') throw new StoreError('Choices are required.', 'INVALID_CHOICES');

      // Validate the supplied token before creating the recovery checkpoint.
      const initialReview = await this._review(initialVariant, source);
      if (!reviewToken || reviewToken !== initialReview.reviewToken) {
        throw new StoreError('The variant changed after review. Review it again before applying decisions.', 'STALE_REVIEW');
      }
      const affectedInitial = initialReview.items.filter((item) => ['source-changed', 'both-changed', 'added', 'missing'].includes(item.status));
      for (const item of affectedInitial) {
        if (!['keep-mine', 'take-source', 'mark-reviewed'].includes(choices[item.key])) {
          throw new StoreError(`A decision is required for ${item.key}.`, 'MISSING_DECISION');
        }
        if (item.status === 'missing' && choices[item.key] === 'take-source') {
          throw new StoreError(`The source for ${item.key} is missing; it cannot be taken as content.`, 'INVALID_CHOICE');
        }
      }

      // A recovery version is deliberately created before the first accepted
      // source choice. It remains in state if the transaction later rolls back.
      const recovery = await this._saveVersion(`variant:${variantId}`, `Recovery ${initialVariant.name} ${now()}`,true);
      const runTransaction = await this._transaction(this._variant(variantId));
      return runTransaction(async (tx) => {
        const variant = this._variant(variantId);
        const freshReview = await this._review(variant, source);
        if (!reviewToken || reviewToken !== freshReview.reviewToken) {
          throw new StoreError('The variant changed after review. Review it again before applying decisions.', 'STALE_REVIEW');
        }
        const affected = freshReview.items.filter((item) => ['source-changed', 'both-changed', 'added', 'missing'].includes(item.status));
        for (const item of affected) {
          if (!['keep-mine', 'take-source', 'mark-reviewed'].includes(choices[item.key])) {
            throw new StoreError(`A decision is required for ${item.key}.`, 'MISSING_DECISION');
          }
          if (item.status === 'missing' && choices[item.key] === 'take-source') {
            throw new StoreError(`The source for ${item.key} is missing; it cannot be taken as content.`, 'INVALID_CHOICE');
          }
        }
        const mineAll = new Map((await this._tree(`variant:${variantId}`, true, true)).map((entry) => [entry.key, entry]));
        const latestByKey = new Map(source.entries.map((entry) => [entry.key, entry]));
        const oldOverlays = clone(variant.overlays);
        variant.reviews[sourceSnapshotId] ||= {};
        let applied = 0;
        let skipped = 0;
        for (const item of affected) {
          const choice = choices[item.key];
          variant.reviews[sourceSnapshotId][item.key] = choice;
          if (choice !== 'take-source') {
            skipped += 1;
            continue;
          }
          const incoming = latestByKey.get(item.key);
          const oldOverlay = oldOverlays[item.key];
          const workspacePath = oldOverlay?.workspacePath;
          let materializedContent = null;
          let materializedHash = incoming?.contentHash;
          let materializedNormalizedHash = incoming?.normalizedHash;
          if (workspacePath) {
            if (incoming && !incoming.missing) {
              materializedContent = normalizeContent(await this._readBlob(incoming.contentHash), true);
              await tx.write(workspacePath, materializedContent);
              materializedHash = await this._writeBlob(materializedContent);
              materializedNormalizedHash = sha(normalizeContent(materializedContent));
            }
            else await tx.unlink(workspacePath);
          }
          if (!incoming) {
            delete variant.overlays[item.key];
          } else if (incoming.missing) {
            // With an old base, accepting a missing source is a deletion
            // overlay. A later base advance can then drop this tombstone.
            variant.overlays[item.key] = {
              ...incoming,
              key: item.key,
              workspacePath,
              deleted: true,
              materialized: false,
              missing: false,
              origin: 'variant',
            };
          } else {
            variant.overlays[item.key] = {
              ...incoming,
              key: item.key,
              workspacePath,
              deleted: false,
              contentHash: materializedHash,
              normalizedHash: materializedNormalizedHash || sha(normalizeContent(await this._readBlob(incoming.contentHash))),
              materialized: !!workspacePath,
              missing: false,
              origin: 'variant',
            };
          }
          applied += 1;
        }

        const baseAdvanced = !affected.some((item) => choices[item.key] === 'mark-reviewed');
        if (baseAdvanced) {
          const base = this._source(variant.baseId);
          const rebased = {};
          const allKeys = new Set([...mineAll.keys(), ...latestByKey.keys()]);
          for (const key of allKeys) {
            const item = freshReview.items.find((candidate) => candidate.key === key);
            const latestEntry = latestByKey.get(key);
            const mineEntry = mineAll.get(key);
            const choice = item && affected.includes(item) ? choices[key] : null;
            let desired = choice === 'take-source' ? latestEntry : mineEntry;
            if (choice === 'keep-mine' && !desired && latestEntry) {
              const prior = base?.entries.find((entry) => entry.key === key) || latestEntry;
              desired = {
                ...prior,
                key,
                deleted: true,
                materialized: false,
                missing: false,
                origin: 'variant',
              };
            }
            if (!desired) continue;
            const oldOverlay = oldOverlays[key];
            if (desired.deleted) {
              // Keep every tombstone, including a local-only addition. The
              // public removed-files view needs its retained blob to restore
              // the file after a source base advances.
              rebased[key] = {
                ...desired,
                ...(latestEntry || {}),
                key,
                workspacePath: oldOverlay?.workspacePath || desired.workspacePath,
                deleted: true,
                materialized: false,
                missing: false,
                origin: 'variant',
              };
              continue;
            }
            const keepWorkspace = oldOverlay?.workspacePath || desired.workspacePath;
            const needsOverlay = !latestEntry || !logicalEquivalent(desired, latestEntry) || !!keepWorkspace;
            if (needsOverlay) {
              rebased[key] = {
                ...desired,
                key,
                workspacePath: keepWorkspace,
                deleted: false,
                materialized: !!keepWorkspace && !desired.missing,
                origin: 'variant',
              };
            }
          }
          variant.baseId = sourceSnapshotId;
          variant.derivedFrom = sourceSnapshotId;
          variant.overlays = rebased;
        }
        variant.objectRef = await this._retainVariant(variant);
        await this._save();
        return {
          variantId,
          sourceSnapshotId,
          applied,
          skipped,
          recoveryVersionId: recovery.id,
          baseAdvanced,
        };
      });
    });
  }

  async exportChanges(ref) {
    return this._locked(async () => {
      await this._ready();
      const entries = await this._tree(ref, true);
      const baseId = this._sourceForRef(ref);
      const base = this._source(baseId);
      const baseMap = new Map((base?.entries || []).map((entry) => [entry.key, entry]));
      const files = [];
      for (const entry of entries) {
        const prior = baseMap.get(entry.key);
        if (entry.missing) {
          if (!prior || !prior.missing) files.push({ key: entry.key, path: entry.path, content: null, status: 'missing' });
        } else if (!prior) {
          files.push({ key: entry.key, path: entry.path, content: await this._readBlob(entry.contentHash), status: 'added' });
        } else if (!contentEquivalent(prior, entry) || !locationEquivalent(prior,entry) || !!entry.missing !== !!prior.missing) {
          files.push({ key: entry.key, path: entry.path, ...(entry.renamedFrom?{previousPath:entry.renamedFrom,currentPath:entry.workspacePath}:{}), content: await this._readBlob(entry.contentHash), status: 'changed' });
        }
      }
      if (String(ref).startsWith('variant:')) {
        const variant = this._variant(String(ref).slice(8));
        for (const [key, entry] of Object.entries(variant.overlays)) {
          if (entry.deleted && baseMap.has(key)) files.push({ key, path: entry.path, content: null, status: 'deleted' });
        }
      }
      return { ref, files };
    });
  }

  async _ready() {
    if (!this.state) await this._initialize();
  }

  _locked(fn) {
    const next = this.serial.then(fn, fn);
    this.serial = next.catch(() => {});
    return next;
  }

  async _load() {
    try {
      const value = JSON.parse(await fs.readFile(this.statePath, 'utf8'));
      if (!value || typeof value !== 'object') throw new Error('state is not an object');
      return { schema: 1, sources: [], versions: [], variants: [], currentSourceId: null, ...value };
    } catch (error) {
      if (error.code === 'ENOENT') return { schema: 1, sources: [], versions: [], variants: [], currentSourceId: null };
      throw new StoreError('History state is invalid.', 'STATE_INVALID');
    }
  }

  async _migrateState() {
    if (!Array.isArray(this.state.sources) || !Array.isArray(this.state.versions) || !Array.isArray(this.state.variants)) {
      throw new StoreError('History state is invalid.', 'STATE_INVALID');
    }
    for (const source of this.state.sources) {
      if (!Array.isArray(source.entries)) source.entries = [];
      for (const entry of source.entries) {
        if (this.state.normalizationVersion !== NORMALIZATION_VERSION && entry.contentHash) {
          try { entry.normalizedHash = sha(normalizeContent(await this._readBlob(entry.contentHash))); } catch { /* retain fallback */ }
        }
      }
    }
    for (const version of this.state.versions) {
      if (!Array.isArray(version.entries)) version.entries = [];
      for (const entry of version.entries) {
        if (this.state.normalizationVersion !== NORMALIZATION_VERSION && entry.contentHash) {
          try { entry.normalizedHash = sha(normalizeContent(await this._readBlob(entry.contentHash))); } catch { /* retain fallback */ }
        }
      }
    }
    for (const variant of this.state.variants) {
      variant.overlays ||= {};
      variant.reviews ||= {};
      if (!variant.contentFolder && variant.folder) variant.contentFolder = path.posix.join(variant.folder, 'Content');

      for (const entry of Object.values(variant.overlays)) {
        if (this.state.normalizationVersion !== NORMALIZATION_VERSION && entry.contentHash) {
          try { entry.normalizedHash = sha(normalizeContent(await this._readBlob(entry.contentHash))); } catch { /* retain fallback */ }
        }
      }
    }
    if (this.state.normalizationVersion !== NORMALIZATION_VERSION) this.state.normalizationVersion = NORMALIZATION_VERSION;
  }

  async _save() {
    const temporary = `${this.statePath}.${process.pid}.${crypto.randomUUID()}.tmp`;
    await fs.writeFile(temporary, `${JSON.stringify(this.state, null, 2)}\n`, 'utf8');
    await fs.rename(temporary, this.statePath);
  }

  async _writeBlob(content) {
    return (await this._gitInput(['--git-dir', this.history, 'hash-object', '-w', '--stdin'], String(content))).trim();
  }

  async _readBlob(hash) {
    const { stdout } = await run('git', ['--git-dir', this.history, 'cat-file', 'blob', hash], {
      encoding: 'utf8',
      maxBuffer: 10 * 1024 * 1024,
    });
    return stdout;
  }

  async _retainVariant(variant) {
    const entries = Object.values(variant.overlays || {}).filter((entry) => entry && entry.contentHash);
    return this._retain(variant.id, entries, 'variant overlays');
  }

  async _retain(recordId, entries, message, manifestBlob) {
    const kept = entries.filter((entry) => entry.contentHash);
    const lines = kept
      .map((entry, index) => `100644 blob ${entry.contentHash}\t${String(index).padStart(6, '0')}-${String(entry.key).replace(/[^a-zA-Z0-9._-]/g, '_')}`)
      .concat(manifestBlob ? [`100644 blob ${manifestBlob}\tmanifest.json`] : [])
      .join('\n') + (kept.length || manifestBlob ? '\n' : '');
    const tree = await this._gitInput(['--git-dir', this.history, 'mktree'], lines);
    const env = {
      PATH: '/usr/bin:/bin',
      GIT_AUTHOR_NAME: 'RE Workbench',
      GIT_AUTHOR_EMAIL: 'store@localhost',
      GIT_COMMITTER_NAME: 'RE Workbench',
      GIT_COMMITTER_EMAIL: 'store@localhost',
    };
    const commit = await this._gitInput(['--git-dir', this.history, 'commit-tree', tree.trim(), '-m', message], '', env);
    const ref = `refs/rewb/${recordId}`;
    await run('git', ['--git-dir', this.history, 'update-ref', ref, commit.trim()], { encoding: 'utf8', env: { PATH: '/usr/bin:/bin' } });
    return ref;
  }

  _gitInput(args, input, env = { PATH: '/usr/bin:/bin' }) {
    return new Promise((resolve, reject) => {
      const child = spawn('git', args, { env });
      let out = '';
      let err = '';
      child.stdout.on('data', (chunk) => { out += chunk; });
      child.stderr.on('data', (chunk) => { err += chunk; });
      child.on('error', reject);
      child.on('close', (code) => code === 0
        ? resolve(out)
        : reject(new StoreError(err.trim() || `git exited ${code}`, 'GIT_ERROR')));
      child.stdin.end(input);
    });
  }

  async _setRemoved(variantId, key, removed) {
    return this._locked(async () => {
      await this._ready();
      const variant = this._variant(variantId);
      if (!variant) throw new StoreError('Unknown variant.', 'UNKNOWN_VARIANT');
      const beforeSync = clone(this.state);
      try {
        await this._syncOverlay(variant, { persist: false });
      } catch (error) {
        this.state = beforeSync;
        throw error;
      }
      const current = variant.overlays[key] || this._source(variant.baseId)?.entries.find((entry) => entry.key === key);
      if (!current) throw new StoreError('Unknown file key.', 'UNKNOWN_FILE');
      const workspacePath = current.workspacePath || this._variantFilePath(variant, current);
      const transaction = await this._transaction(variant);
      return transaction(async (tx) => {
        if (removed) {
          await tx.unlink(workspacePath);
          variant.overlays[key] = {
            ...current,
            key,
            workspacePath,
            deleted: true,
            materialized: false,
            missing: false,
            origin: 'variant',
          };
        } else {
          const sourceEntry = this._source(variant.baseId)?.entries.find((entry) => entry.key === key);
          const rawContent = await this._readBlob(current.contentHash);
          const content = sourceEntry && sourceEntry.contentHash === current.contentHash
            ? normalizeContent(rawContent, true)
            : rawContent;
          await tx.write(workspacePath, content);
          const contentHash = await this._writeBlob(content);
          variant.overlays[key] = {
            ...current,
            key,
            workspacePath,
            contentHash,
            deleted: false,
            materialized: true,
            missing: false,
            normalizedHash: sha(normalizeContent(content)),
            origin: 'variant',
          };
        }
        variant.objectRef = await this._retainVariant(variant);
        await this._save();
        return { key, removed };
      });
    });
  }

  _source(sourceId) {
    return this.state.sources.find((source) => source.id === sourceId);
  }

  _variant(variantId) {
    return this.state.variants.find((variant) => variant.id === variantId);
  }

  _sourceForRef(ref) {
    const reference = String(ref || '');
    if (reference === 'sources') return this.state.currentSourceId;
    if (reference.startsWith('source:')) return reference.slice(7);
    if (reference.startsWith('version:')) return this.state.versions.find((version) => version.id === reference.slice(8))?.sourceSnapshotId;
    if (reference.startsWith('variant:')) return this._variant(reference.slice(8))?.baseId;
    return null;
  }

  async _tree(ref, sync, includeDeleted = false) {
    const reference = String(ref || '');
    if (reference === 'sources' || reference.startsWith('source:')) {
      const source = this._source(reference === 'sources' ? this.state.currentSourceId : reference.slice(7));
      if (!source) throw new StoreError('No source snapshot exists yet.', 'NO_SOURCES');
      return clone(source.entries);
    }
    if (reference.startsWith('version:')) {
      const version = this.state.versions.find((candidate) => candidate.id === reference.slice(8));
      if (!version) throw new StoreError('Unknown version.', 'UNKNOWN_VERSION');
      return clone(includeDeleted ? version.entries : version.entries.filter((entry) => !entry.deleted));
    }
    if (reference.startsWith('variant:')) {
      const variant = this._variant(reference.slice(8));
      if (!variant) throw new StoreError('Unknown variant.', 'UNKNOWN_VARIANT');
      if (sync) await this._syncOverlay(variant, { persist: true });
      const base = this._source(variant.baseId);
      if (!base) throw new StoreError('Unknown source snapshot.', 'UNKNOWN_SNAPSHOT');
      const entries = new Map(base.entries.map((entry) => [entry.key, clone(entry)]));
      for (const [key, overlay] of Object.entries(variant.overlays)) {
        if (overlay.deleted) {
          if (includeDeleted) entries.set(key, clone(overlay));
          else entries.delete(key);
        } else entries.set(key, clone(overlay));
      }
      if(variant.nativeWorking&&variant.sourceOrderByKey)for(const e of entries.values())if(Object.prototype.hasOwnProperty.call(variant.sourceOrderByKey,e.key))e.sourceOrder=variant.sourceOrderByKey[e.key];
      return [...entries.values()].sort((a, b) => a.key.localeCompare(b.key));
    }
    throw new StoreError('Invalid reference.', 'INVALID_REF');
  }

  async _syncOverlay(variant, { persist = true } = {}) {
    const before = persist ? clone(this.state) : null;
    try {
      const root = within(this.vault, variant.contentFolder);
      await this._assertNoSymlinks(root, { allowMissing: true });
      const files = [];
      const walk = async (directory) => {
        let children;
        try {
          children = await fs.readdir(directory, { withFileTypes: true });
        } catch (error) {
          if (error.code === 'ENOENT') return;
          throw error;
        }
        for (const child of children) {
          const full = path.join(directory, child.name);
          if (child.isSymbolicLink()) throw new StoreError('Variant Content contains a symlink.', 'UNSAFE_PATH');
          if (child.isDirectory()) await walk(full);
          else if (child.isFile() && child.name.endsWith('.md')) files.push(full);
        }
      };
      await walk(root);

      const base = this._source(variant.baseId);
      if (!base) throw new StoreError('Unknown source snapshot.', 'UNKNOWN_SNAPSHOT');
      const byRelative = new Map(base.entries.map((entry) => [this._variantFilePath(variant, entry), entry]));
      let changed = false;
      for (const file of files) {
        const relative = path.relative(this.vault, file).split(path.sep).join('/');
        await this._assertVariantPath(variant, relative, { allowMissing: false });
        const existing = Object.entries(variant.overlays).find(([, entry]) => entry.workspacePath === relative);
        let key = existing?.[0];
        let prior = existing?.[1];
        if (!key) {
          const baseEntry = byRelative.get(relative);
          if (baseEntry && (!variant.overlays[baseEntry.key] || variant.overlays[baseEntry.key].workspacePath === relative)) {
            key = baseEntry.key;
            prior = baseEntry;
          } else {
            key = 'local:' + crypto.randomUUID();
            const logicalPath = relative.slice(variant.contentFolder.length + 1);
            prior = { key, path: logicalPath, title: path.posix.basename(logicalPath, '.md'), origin: 'variant' };
          }
        }
        const content = await fs.readFile(file, 'utf8');
        const hash = await this._writeBlob(content);
        const normalizedHash = sha(normalizeContent(content));
        if (!variant.overlays[key]
          || variant.overlays[key].contentHash !== hash
          || variant.overlays[key].normalizedHash !== normalizedHash
          || variant.overlays[key].missing
          || variant.overlays[key].deleted
          || !variant.overlays[key].materialized) {
          variant.overlays[key] = {
            ...prior,
            key,
            workspacePath: relative,
            contentHash: hash,
            normalizedHash,
            missing: false,
            deleted: false,
            origin: 'variant',
            materialized: true,
          };
          changed = true;
        }
      }

      // An editor can remove a materialized file without going through the
      // store. Surface that absence and retain the old blob for recovery/export
      // diagnostics instead of silently serving stale content.
      for (const [key, overlay] of Object.entries(variant.overlays)) {
        if (overlay.deleted || !overlay.materialized || !overlay.workspacePath) continue;
        const target = await this._assertVariantPath(variant, overlay.workspacePath, { allowMissing: true });
        let stat;
        try { stat = await fs.lstat(target); } catch (error) {
          if (error.code === 'ENOENT') {
            if (!overlay.missing) {
              variant.overlays[key] = variant.nativeWorking ? { ...overlay, deleted: true, missing: false, materialized: false } : { ...overlay, missing: true, materialized: false };
              changed = true;
            }
            continue;
          }
          throw error;
        }
        if (stat.isSymbolicLink()) throw new StoreError('Variant path contains a symlink.', 'UNSAFE_PATH');
        if (!stat.isFile()) throw new StoreError('Variant path is not a file.', 'PATH_CONFLICT');
      }
      if (changed && persist) {
        variant.objectRef = await this._retainVariant(variant);
        await this._save();
      }
    } catch (error) {
      if (persist && before) {
        this.state = before;
        try { await this._save(); } catch { /* retain the original failure */ }
      }
      throw error;
    }
  }

  async _transaction(variant) {
    const stateBefore = clone(this.state);
    const backups = new Map();
    const currentVariant = () => this._variant(variant.id) || variant;
    const backup = async (relative) => {
      if (backups.has(relative)) return;
      const target = await this._assertVariantPath(currentVariant(), relative, { allowMissing: true });
      backups.set(relative, { target, snapshot: await this._snapshotFile(target) });
    };
    return async (operation) => {
      const tx = {
        write: async (relative, content) => {
          await backup(relative);
          const target = await this._assertVariantPath(currentVariant(), relative, { allowMissing: true });
          await fs.mkdir(path.dirname(target), { recursive: true });
          await this._assertVariantPath(currentVariant(), relative, { allowMissing: true });
          await fs.writeFile(target, String(content), 'utf8');
        },
        unlink: async (relative) => {
          await backup(relative);
          const target = await this._assertVariantPath(currentVariant(), relative, { allowMissing: true });
          try {
            const stat = await fs.lstat(target);
            if (stat.isSymbolicLink()) throw new StoreError('Variant path contains a symlink.', 'UNSAFE_PATH');
            if (!stat.isFile()) throw new StoreError('Variant path is not a file.', 'PATH_CONFLICT');
            await fs.unlink(target);
          } catch (error) {
            if (error.code !== 'ENOENT') throw error;
          }
        },
      };
      try {
        return await operation(tx);
      } catch (error) {
        this.state = stateBefore;
        let rollbackError = null;
        for (const [relative, item] of [...backups.entries()].reverse()) {
          try {
            await this._restoreFile(currentVariant(), relative, item.snapshot);
          } catch (restoreError) {
            rollbackError ||= restoreError;
          }
        }
        try { await this._save(); } catch (saveError) { rollbackError ||= saveError; }
        if (rollbackError) error.rollbackError = rollbackError.message;
        throw error;
      }
    };
  }

  async _snapshotFile(target) {
    try {
      const stat = await fs.lstat(target);
      if (stat.isSymbolicLink()) throw new StoreError('Variant path contains a symlink.', 'UNSAFE_PATH');
      if (!stat.isFile()) throw new StoreError('Variant path is not a file.', 'PATH_CONFLICT');
      return { exists: true, content: await fs.readFile(target), mode: stat.mode };
    } catch (error) {
      if (error.code === 'ENOENT') return { exists: false };
      throw error;
    }
  }

  async _restoreFile(variant, relative, snapshot) {
    const target = await this._assertVariantPath(variant, relative, { allowMissing: true });
    if (snapshot.exists) {
      await fs.mkdir(path.dirname(target), { recursive: true });
      await this._assertVariantPath(variant, relative, { allowMissing: true });
      await fs.writeFile(target, snapshot.content);
      if (snapshot.mode) await fs.chmod(target, snapshot.mode & 0o7777);
    } else {
      try {
        const stat = await fs.lstat(target);
        if (stat.isSymbolicLink()) throw new StoreError('Variant path contains a symlink.', 'UNSAFE_PATH');
        if (stat.isFile()) await fs.unlink(target);
      } catch (error) {
        if (error.code !== 'ENOENT') throw error;
      }
    }
  }

  async _assertNoSymlinks(target, { allowMissing = false } = {}) {
    const resolvedTarget = path.resolve(target);
    const resolvedVault = path.resolve(this.vault);
    if (resolvedTarget !== resolvedVault && !resolvedTarget.startsWith(`${resolvedVault}${path.sep}`)) {
      throw new StoreError('Path escapes the vault.', 'INVALID_PATH');
    }
    const relative = path.relative(resolvedVault, resolvedTarget);
    let current = resolvedVault;
    const parts = relative ? relative.split(path.sep) : [];
    for (const part of parts) {
      const stat = await fs.lstat(current).catch((error) => {
        if (error.code === 'ENOENT' && allowMissing) return null;
        throw error;
      });
      if (!stat) return;
      if (stat.isSymbolicLink()) throw new StoreError('Variant path contains a symlink.', 'UNSAFE_PATH');
      if (!stat.isDirectory()) throw new StoreError('A path ancestor is not a directory.', 'PATH_CONFLICT');
      current = path.join(current, part);
    }
    const finalStat = await fs.lstat(current).catch((error) => {
      if (error.code === 'ENOENT' && allowMissing) return null;
      throw error;
    });
    if (finalStat?.isSymbolicLink()) throw new StoreError('Variant path contains a symlink.', 'UNSAFE_PATH');
  }

  async _assertVariantPath(variant, relative, { allowMissing = false } = {}) {
    const root = within(this.vault, variant.contentFolder);
    const target = within(this.vault, relative);
    const relativeToContent = path.relative(root, target);
    if (relativeToContent === '..' || relativeToContent.startsWith(`..${path.sep}`) || path.isAbsolute(relativeToContent)) {
      throw new StoreError('Writes must stay inside the owning variant Content folder.', 'INVALID_PATH');
    }
    await this._assertNoSymlinks(target, { allowMissing });
    return target;
  }

  async _ensureVariantContentRoot(variant) {
    const root = within(this.vault, variant.contentFolder);
    await this._assertNoSymlinks(root, { allowMissing: true });
    await fs.mkdir(root, { recursive: true });
    await this._assertNoSymlinks(root, { allowMissing: false });
    return root;
  }

  _variantFilePath(variant, entry) {
    if (entry.workspacePath) return entry.workspacePath;
    if (variant.nativeWorking && variant.readablePaths?.[entry.key]) return variant.readablePaths[entry.key];
    const entryPath = String(entry.path || entry.key || '');
    let relative = entryPath.startsWith('1 Sources/') ? entryPath.slice('1 Sources/'.length) : entryPath;
    const prefix = 'Confluence/' + variant.flattenedSourceFolder + '/';
    if (variant.nativeWorking && variant.flattenedSourceFolder && relative.startsWith(prefix)) relative = 'Confluence/' + relative.slice(prefix.length);
    const clean = safeRelative(relative, 'Variant paths must be relative Markdown paths.');
    return path.posix.join(variant.contentFolder, clean);
  }

  _brief(entry) {
    return entry ? this._publicEntry(entry) : null;
  }

  _publicEntry(entry) {
    const {
      key, pageId, parentId, sourceOrder, workspacePath, renamedFrom, path: entryPath, title, contentHash, normalizedHash, missing, origin,
    } = entry;
    return {
      key,
      pageId,
      parentId: parentId || null,
      ...(sourceOrder ? {sourceOrder} : {}),
      ...(workspacePath ? {workspacePath} : {}),
      ...(renamedFrom ? {renamedFrom} : {}),
      path: entryPath,
      title,
      contentHash,
      normalizedHash,
      missing: !!missing,
      origin,
    };
  }

  _publicTree(entries) {
    return entries.map((entry) => this._publicEntry(entry));
  }

  _variantInfo(variant) {
    return {
      id: variant.id,
      name: variant.name,
      baseId: variant.baseId,
      derivedFrom: variant.derivedFrom || variant.baseId,
      folder: variant.folder,
      contentFolder: variant.contentFolder,
      flattenedSourceFolder: variant.flattenedSourceFolder || null,
      createdAt: variant.createdAt,
      updateStatus: variant.baseId === this.state.currentSourceId ? 'current' : 'source-updated',
    };
  }
}

function createStore(vaultPath) {
  return new WorkbenchStore(vaultPath);
}

function validateArchiveFolder(value) {
  const folder=String(value).trim().replace(/\/$/,'');
  const parts=folder.split('/');
  if(!folder||folder.includes('\\')||folder.includes(':')||parts.some(p=>!p||p.startsWith('.'))||['1 sources','1 working files','2 saved versions','3 drafts','7 tools','6 import log'].includes(parts[0].toLowerCase()))throw new StoreError('Choose a relative archive folder outside sources, working files and tools.','INVALID_PATH');
  return folder;
}
module.exports = { createStore, StoreError, normalizeContent, validateArchiveFolder };

module.exports.readablePaths=readablePaths;
