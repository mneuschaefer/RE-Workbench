'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const crypto = require('node:crypto');
const { createStore, normalizeContent } = require('./store');
const { execFile } = require('node:child_process');
const { promisify } = require('node:util');
const run = promisify(execFile);
const hash = text => crypto.createHash('sha256').update(text).digest('hex');

async function fixture(pages) {
  const vault = await fs.mkdtemp(path.join(os.tmpdir(), 'rewb-store-'));
  await fs.mkdir(path.join(vault, '6 Import log/Confluence'), { recursive: true });
  for (const page of pages) { await fs.mkdir(path.dirname(path.join(vault, page.path)), { recursive: true }); await fs.writeFile(path.join(vault, page.path), page.content); }
  await fs.writeFile(path.join(vault, '6 Import log/Confluence/manifest.json'), JSON.stringify({ pages: pages.map(p => ({ id:p.id, title:p.title, path:p.path, sha256:hash(p.content) })) }));
  return vault;
}
async function updateManifest(vault, pages) { for(const page of pages){await fs.mkdir(path.dirname(path.join(vault,page.path)),{recursive:true});await fs.writeFile(path.join(vault,page.path),page.content);} await fs.writeFile(path.join(vault,'6 Import log/Confluence/manifest.json'),JSON.stringify({pages:pages.map(p=>({id:p.id,title:p.title,path:p.path,sha256:hash(p.content)}))})); }

test('snapshots are immutable, deduplicate Git blobs, and retain stable ids across renames', async t => {
  const a={id:'7',title:'A',path:'1 Sources/Confluence/A.md',content:'same'}; const vault=await fixture([a]); t.after(()=>fs.rm(vault,{recursive:true,force:true})); const store=createStore(vault); const first=await store.captureSources('first');
  await updateManifest(vault,[{...a,title:'Renamed',path:'1 Sources/Confluence/Renamed.md'}]); const second=await store.captureSources('renamed'); assert.notEqual(first.id,second.id); assert.equal((await store.getTree('sources'))[0].key,'page:7'); assert.equal((await store.getTree('sources'))[0].contentHash,(await store.getTree(`version:${(await store.saveVersion('sources','frozen')).id}`))[0].contentHash);
  const current=(await store.getTree('sources'))[0]; const objects=await fs.readdir(path.join(vault,'.rewb-history','objects', current.contentHash.slice(0,2))); assert.equal(objects.filter(x=>x===current.contentHash.slice(2)).length,1);
});

test('variants materialize only overlays, keep notes out, and review stale source/mine changes', async t => {
  const a={id:'1',title:'A',path:'1 Sources/Confluence/A.md',content:'base'}, b={id:'2',title:'B',path:'1 Sources/Confluence/B.md',content:'old'}; const vault=await fixture([a,b]); t.after(()=>fs.rm(vault,{recursive:true,force:true})); const store=createStore(vault); const initial=await store.captureSources(); const variant=await store.createVariant('Option',initial.id); const edit=await store.editInVariant(variant.id,'page:1'); await fs.writeFile(path.join(vault,edit.path),'mine'); await fs.writeFile(path.join(vault,variant.folder,'note.md'),'local note'); await store.getTree(`variant:${variant.id}`); assert.equal((await store.exportChanges(`variant:${variant.id}`)).files.length,1);
  await updateManifest(vault,[{...a,content:'theirs'},{id:'3',title:'New',path:'1 Sources/Confluence/New.md',content:'new'}]); const latest=await store.captureSources(); const review=await store.reviewUpdates(variant.id,latest.id); assert.equal(review.items.find(i=>i.key==='page:1').status,'both-changed'); await fs.writeFile(path.join(vault,edit.path),'mine later'); await assert.rejects(store.applyReviewedUpdates(variant.id,latest.id,Object.fromEntries(review.items.filter(i=>i.status!=='unchanged').map(i=>[i.key,'keep-mine'])),review.reviewToken),{code:'STALE_REVIEW'});
});

test('missing source pages are retained and local additions have stable local keys', async t => {
  const a={id:'1',title:'A',path:'1 Sources/Confluence/A.md',content:'a'}; const vault=await fixture([a]); t.after(()=>fs.rm(vault,{recursive:true,force:true})); const store=createStore(vault); const source=await store.captureSources(); const variant=await store.createVariant('Extra',source.id); const local=await store.addFile(variant.id,'Ideas/New.md','idea'); await updateManifest(vault,[]); const latest=await store.captureSources(); assert.deepEqual(latest.missingKeys,['page:1']); const tree=await store.getTree(`variant:${variant.id}`); assert.ok(tree.some(e=>e.key===local.key)); await store.markRemoved(variant.id,'page:1'); assert.ok(!(await store.getTree(`variant:${variant.id}`)).some(e=>e.key==='page:1'));
});

// Variant lifecycle at the filesystem/history boundary.
async function variantFixture(t){
 const root=await fs.mkdtemp(path.join(os.tmpdir(),'rewb-integration-'));
 t.after(()=>fs.rm(root,{recursive:true,force:true}));
 const file='1 Sources/Confluence/Project/Requirement.md';
 const manifestPath=path.join(root,'6 Import log/Confluence/manifest.json');
 await fs.mkdir(path.dirname(manifestPath),{recursive:true});
 await fs.mkdir(path.dirname(path.join(root,file)),{recursive:true});
 const write=async(content,version=1,extra={})=>{
  await fs.writeFile(path.join(root,file),content);
  await fs.writeFile(manifestPath,JSON.stringify({origin:'https://example.invalid',root_id:'1',pages:[{id:'1',path:file,title:'Requirement',version,sha256:crypto.createHash('sha256').update(content).digest('hex'),...extra}]}));
 };
 await write('# Requirement\n\nA review needs one reviewer.\n');
 const store=createStore(root);await store.init();await store.captureSources();
 const version=await store.saveVersion('sources','Baseline');
 const variant=await store.createVariant('Option A',`version:${version.id}`);
 return {root,store,variant,version,write,key:'page:1'};
}
test('editing the same variant file twice opens the same working copy',async t=>{
 const f=await variantFixture(t);const one=await f.store.editInVariant(f.variant.id,f.key);
 await fs.writeFile(path.join(f.root,one.path),'# My proposal\n');
 const two=await f.store.editInVariant(f.variant.id,f.key);
 assert.equal(two.path,one.path);assert.equal((await f.store.readFile(`variant:${f.variant.id}`,f.key)).content,'# My proposal\n');
});
test('taking a source update persists across a new store and editor reopen',async t=>{
 const f=await variantFixture(t);const edited=await f.store.editInVariant(f.variant.id,f.key);
 await fs.writeFile(path.join(f.root,edited.path),'# Requirement\n\nMy draft.\n');
 await f.write('# Requirement\n\nNew source.\n',2);await f.store.captureSources();
 const review=await f.store.reviewUpdates(f.variant.id);
 await f.store.applyReviewedUpdates(f.variant.id,review.sourceSnapshotId,{[f.key]:'take-source'},review.reviewToken);
 const reopened=createStore(f.root);await reopened.init();
 assert.match((await reopened.readFile(`variant:${f.variant.id}`,f.key)).content,/New source/);
 const edit=await reopened.editInVariant(f.variant.id,f.key);
 assert.match(await fs.readFile(path.join(f.root,edit.path),'utf8'),/New source/);
 assert.match((await reopened.readFile(`version:${f.version.id}`,f.key)).content,/one reviewer/);
});
test('removed working file stays removed, exports deletion, and can be restored',async t=>{
 const f=await variantFixture(t);await f.store.editInVariant(f.variant.id,f.key);await f.store.markRemoved(f.variant.id,f.key);
 assert.equal((await f.store.getTree(`variant:${f.variant.id}`)).length,0);
 assert.ok((await f.store.exportChanges(`variant:${f.variant.id}`)).files.some(x=>x.key===f.key&&['removed','deleted'].includes(x.status)));
 await f.store.restore(f.variant.id,f.key);
 assert.equal((await f.store.getTree(`variant:${f.variant.id}`)).length,1);
});
test('a variant created from a saved deletion does not resurrect the deleted source',async t=>{
 const f=await variantFixture(t);await f.store.markRemoved(f.variant.id,f.key);
 const saved=await f.store.saveVersion(`variant:${f.variant.id}`,'Without requirement');
 const derived=await f.store.createVariant('Option B',`version:${saved.id}`);
 assert.equal((await f.store.getTree(`variant:${derived.id}`)).length,0);
});
test('import metadata alone does not count as a changed requirement',async t=>{
 const f=await variantFixture(t);
 await f.write('---\nabgerufen: "2026-01-01"\nquellen_version: 1\n---\n# Requirement\n\nSame content.\n',1);await f.store.captureSources();
 const old=await f.store.saveVersion('sources','Metadata baseline');
 await f.write('---\nabgerufen: "2026-01-02"\nquellen_version: 2\n---\n# Requirement\n\nSame content.\n',2);await f.store.captureSources();
 assert.equal((await f.store.compare(`version:${old.id}`,'sources')).changed.length,0);
});
test('a derived variant cannot edit the original variant working file',async t=>{
 const f=await variantFixture(t);const first=await f.store.editInVariant(f.variant.id,f.key);
 await fs.writeFile(path.join(f.root,first.path),'# First alternative\n');
 const saved=await f.store.saveVersion(`variant:${f.variant.id}`,'First checkpoint');
 const derived=await f.store.createVariant('Second alternative',`version:${saved.id}`);
 const second=await f.store.editInVariant(derived.id,f.key);
 assert.notEqual(first.path,second.path);assert.ok(second.path.startsWith(derived.contentFolder+'/'));
 await fs.writeFile(path.join(f.root,second.path),'# Second alternative\n');
 assert.equal((await f.store.readFile(`variant:${f.variant.id}`,f.key)).content,'# First alternative\n');
});
test('saved version comparison treats deliberate deletion as removed',async t=>{
 const f=await variantFixture(t);await f.store.markRemoved(f.variant.id,f.key);
 const saved=await f.store.saveVersion(`variant:${f.variant.id}`,'Removed checkpoint');
 assert.equal((await f.store.getTree(`version:${saved.id}`)).length,0);
 assert.deepEqual((await f.store.compare(`version:${f.version.id}`,`version:${saved.id}`)).removed,[f.key]);
});
test('remove then restore retains the latest editor content',async t=>{
 const f=await variantFixture(t);const file=await f.store.editInVariant(f.variant.id,f.key);
 await fs.writeFile(path.join(f.root,file.path),'# Last edit before removing\n');
 await f.store.markRemoved(f.variant.id,f.key);await f.store.restore(f.variant.id,f.key);
 assert.equal((await f.store.readFile(`variant:${f.variant.id}`,f.key)).content,'# Last edit before removing\n');
});
test('importer retained-missing metadata stays visible as missing',async t=>{
 const f=await variantFixture(t);await f.write('# Requirement\n\nA review needs one reviewer.\n',1,{not_seen_at:'2026-09-13'});await f.store.captureSources();
 assert.equal((await f.store.getTree('sources'))[0].missing,true);
});
test('real importer provenance is hidden while business metadata stays meaningful',async t=>{
 const f=await variantFixture(t);
 const imported=(v,priority)=>`---\ntyp: "Quelle"\nquellen_id: "1"\nquellen_version: ${v}\nconfluence-version: ${v}\nabgerufen: "2026-09-${v}"\npriority: ${priority}\n---\n\n> [!abstract] Source · Confluence v${v}\n> Imported content. Keep working copies in 3 Drafts.\n\n# Requirement\n\nSame requirement.\n`;
 await f.write(imported(1,'high'),1);await f.store.captureSources();const saved=await f.store.saveVersion('sources','Imported baseline');
 await f.write(imported(2,'high'),2);await f.store.captureSources();assert.equal((await f.store.compare(`version:${saved.id}`,'sources')).changed.length,0);
 await f.write(imported(3,'low'),3);await f.store.captureSources();assert.equal((await f.store.compare(`version:${saved.id}`,'sources')).changed.length,1);
});

// Recovery, import identity and persistence failures.
async function historyFixture(t, pages = [{ id: '1', title: 'A', path: '1 Sources/Confluence/A.md', content: '# A\n\nBase.\n' }]) {
  const vault = await fs.mkdtemp(path.join(os.tmpdir(), 'rewb-hardening-'));
  t.after(() => fs.rm(vault, { recursive: true, force: true }));
  await fs.mkdir(path.join(vault, '6 Import log/Confluence'), { recursive: true });
  const writeManifest = async (nextPages) => {
    for (const page of nextPages) {
      await fs.mkdir(path.dirname(path.join(vault, page.path)), { recursive: true });
      await fs.writeFile(path.join(vault, page.path), page.content);
    }
    await fs.writeFile(path.join(vault, '6 Import log/Confluence/manifest.json'), JSON.stringify({
      pages: nextPages.map((page) => ({
        id: page.id,
        title: page.title,
        path: page.path,
        sha256: hash(page.content),
        ...(page.parentId ? { parent_id: page.parentId } : {}),
        ...(page.notSeenAt ? { not_seen_at: page.notSeenAt } : {}),
      })),
    }));
  };
  await writeManifest(pages);
  const store = createStore(vault);
  await store.init();
  const source = await store.captureSources('Initial');
  return { vault, store, source, writeManifest, pages };
}

function byKey(items, key) {
  return items.find((item) => item.key === key);
}

test('public sources ref works and new working copies use the source prefix once', async (t) => {
  const content = '---\ntyp: "Quelle"\nkind: requirement\nsource: customer-origin\nquellen_id: "1"\nquellen_version: 4\nconfluence-url: https://example.invalid/1\ncssclasses: ["rewb-source", "business-class"]\npriority: high\n---\n\n> [!abstract] Quelle · Confluence v4\n> Imported provenance.\n\n> [!abstract] Business summary\n> Keep this business callout.\n\n# Requirement\n\nKeep this.\n';
  const f = await historyFixture(t, [{ id: '1', title: 'A', path: '1 Sources/Confluence/A.md', content }]);
  const variant = await f.store.createVariant('Option', 'sources');
  const opened = await f.store.editInVariant(variant.id, 'page:1');
  assert.equal(opened.path, `${variant.contentFolder}/Confluence/A.md`);
  assert.ok(!opened.path.includes('/Content/1 Sources/'));
  const materialized = await fs.readFile(path.join(f.vault, opened.path), 'utf8');
  assert.doesNotMatch(materialized, /typ: "Quelle"|quellen_version|confluence-url|rewb-source|Quelle · Confluence/i);
  assert.match(materialized, /kind: requirement/);
  assert.match(materialized, /source: customer-origin/);
  assert.match(materialized, /business-class/);
  assert.match(materialized, /Business summary/);
  assert.match(materialized, /priority: high/);
  assert.match(materialized, /# Requirement/);
});

test('base advance preserves a keep-mine absence for a newly added source page', async (t) => {
  const f = await historyFixture(t);
  await f.writeManifest([...f.pages, { id: '2', title: 'B', path: '1 Sources/Confluence/B.md', content: '# B\n\nNew.\n' }]);
  const latest = await f.store.captureSources('Added');
  const variant = await f.store.createVariant('Option', f.source.id);
  const review = await f.store.reviewUpdates(variant.id, latest.id);
  assert.equal(byKey(review.items, 'page:2').status, 'added');
  const result = await f.store.applyReviewedUpdates(variant.id, latest.id, { 'page:2': 'keep-mine' }, review.reviewToken);
  assert.equal(result.baseAdvanced, true);
  assert.equal((await f.store.listVariants())[0].baseId, latest.id);
  assert.equal(byKey(await f.store.getTree(`variant:${variant.id}`), 'page:2'), undefined);
  assert.equal(f.store._variant(variant.id).overlays['page:2'].deleted, true);
});

test('base advance preserves an existing deletion tombstone', async (t) => {
  const f = await historyFixture(t);
  const variant = await f.store.createVariant('Option', 'sources');
  await f.store.markRemoved(variant.id, 'page:1');
  await f.writeManifest([...f.pages, { id: '2', title: 'B', path: '1 Sources/Confluence/B.md', content: '# B\n\nNew.\n' }]);
  const latest = await f.store.captureSources('Added');
  const review = await f.store.reviewUpdates(variant.id, latest.id);
  const result = await f.store.applyReviewedUpdates(variant.id, latest.id, { 'page:2': 'take-source' }, review.reviewToken);
  assert.equal(result.baseAdvanced, true);
  assert.equal(byKey(await f.store.getTree(`variant:${variant.id}`), 'page:1'), undefined);
  assert.equal(f.store._variant(variant.id).overlays['page:1'].deleted, true);
});

test('missing source cannot be selected as source content', async (t) => {
  const f = await historyFixture(t);
  const variant = await f.store.createVariant('Option', 'sources');
  const opened = await f.store.editInVariant(variant.id, 'page:1');
  await fs.writeFile(path.join(f.vault, opened.path), 'mine survives\n');
  await f.writeManifest([]);
  const latest = await f.store.captureSources('Missing');
  const review = await f.store.reviewUpdates(variant.id, latest.id);
  assert.equal(byKey(review.items, 'page:1').status, 'missing');
  await assert.rejects(
    f.store.applyReviewedUpdates(variant.id, latest.id, { 'page:1': 'take-source' }, review.reviewToken),
    { code: 'INVALID_CHOICE' },
  );
  assert.equal(await fs.readFile(path.join(f.vault, opened.path), 'utf8'), 'mine survives\n');
  assert.equal((await f.store.listVersions()).length, 0);
});

test('a removed local addition remains restorable after advancing the source base', async (t) => {
  const f = await historyFixture(t);
  const variant = await f.store.createVariant('Option', 'sources');
  const local = await f.store.addFile(variant.id, 'Ideas/Keep tombstone.md', 'tombstone content');
  await f.store.markRemoved(variant.id, local.key);
  await f.writeManifest([...f.pages, { id: '2', title: 'B', path: '1 Sources/Confluence/B.md', content: '# B\n' }]);
  const latest = await f.store.captureSources('Added');
  const review = await f.store.reviewUpdates(variant.id, latest.id);
  await f.store.applyReviewedUpdates(variant.id, latest.id, { 'page:2': 'take-source' }, review.reviewToken);
  const removed = await f.store.getRemovedFiles(variant.id);
  assert.equal(byKey(removed, local.key).content, 'tombstone content');
  await f.store.restore(variant.id, local.key);
  assert.equal((await f.store.readFile(`variant:${variant.id}`, local.key)).content, 'tombstone content');
});

test('local-only additions are mine-changed and survive an update review', async (t) => {
  const f = await historyFixture(t);
  const variant = await f.store.createVariant('Option', 'sources');
  const local = await f.store.addFile(variant.id, 'Ideas/Local.md', 'local idea');
  const review = await f.store.reviewUpdates(variant.id, f.source.id);
  assert.equal(byKey(review.items, local.key).status, 'mine-changed');
  assert.notEqual(byKey(review.items, local.key).status, 'missing');
  const result = await f.store.applyReviewedUpdates(variant.id, f.source.id, {}, review.reviewToken);
  assert.equal(result.baseAdvanced, true);
  assert.equal((await f.store.readFile(`variant:${variant.id}`, local.key)).content, 'local idea');
});

test('metadata-only source changes stay unchanged while rename and missing are explicit', async (t) => {
  const initial = { id: '1', title: 'A', path: '1 Sources/Confluence/A.md', content: '---\nabgerufen: one\nquellen_version: 1\npriority: high\n---\n\n# A\n\nSame.\n' };
  const f = await historyFixture(t, [initial]);
  const variant = await f.store.createVariant('Option', 'sources');
  const metadata = { ...initial, content: initial.content.replace('one', 'two').replace('1\npriority', '2\npriority') };
  await f.writeManifest([metadata]);
  const metadataSource = await f.store.captureSources('Metadata');
  const metadataReview = await f.store.reviewUpdates(variant.id, metadataSource.id);
  assert.equal(byKey(metadataReview.items, 'page:1').status, 'unchanged');
  assert.deepEqual((await f.store.compare(`source:${f.source.id}`, `source:${metadataSource.id}`)).changed, []);

  const renamed = { ...metadata, title: 'Renamed', path: '1 Sources/Confluence/Renamed.md' };
  await f.writeManifest([renamed]);
  const renamedSource = await f.store.captureSources('Renamed');
  const renamedReview = await f.store.reviewUpdates(variant.id, renamedSource.id);
  assert.equal(byKey(renamedReview.items, 'page:1').status, 'source-changed');
  const comparison = await f.store.compare(`source:${metadataSource.id}`, `source:${renamedSource.id}`);
  assert.deepEqual(comparison.renamed, ['page:1']);
  assert.deepEqual(comparison.changed, ['page:1']);

  await f.writeManifest([]);
  const missingSource = await f.store.captureSources('Missing');
  const missingReview = await f.store.reviewUpdates(variant.id, missingSource.id);
  assert.equal(byKey(missingReview.items, 'page:1').status, 'missing');
  assert.deepEqual((await f.store.compare(`source:${renamedSource.id}`, `source:${missingSource.id}`)).missing, ['page:1']);
});

test('schema 1 normalized hashes are recalculated once for the current normalizer', async (t) => {
  const content = '---\ntyp: "Quelle"\nquellen_id: "1"\nquellen_version: 1\nconfluence-url: https://example.invalid/1\ncssclasses: ["rewb-source"]\n---\n\n# A\n\nSame.\n';
  const f = await historyFixture(t, [{ id: '1', title: 'A', path: '1 Sources/Confluence/A.md', content }]);
  const version = await f.store.saveVersion('sources', 'Old history');
  const statePath = path.join(f.vault, '.rewb-history', 'state.json');
  const state = JSON.parse(await fs.readFile(statePath, 'utf8'));
  delete state.normalizationVersion;
  state.sources[0].entries[0].normalizedHash = hash(content);
  state.versions[0].entries[0].normalizedHash = hash(content);
  await fs.writeFile(statePath, `${JSON.stringify(state)}\n`);
  const reopened = createStore(f.vault);
  await reopened.init();
  assert.equal((await reopened.compare(`version:${version.id}`, 'sources')).changed.length, 0);
  const migrated = JSON.parse(await fs.readFile(statePath, 'utf8'));
  assert.equal(migrated.normalizationVersion, 3);
  assert.equal(migrated.sources[0].entries[0].normalizedHash, hash(normalizeContent(content)));
});

test('variant refs retain an unsaved removed blob through aggressive garbage collection', async (t) => {
  const f = await historyFixture(t);
  const variant = await f.store.createVariant('Option', 'sources');
  const local = await f.store.addFile(variant.id, 'Ideas/Unsaved.md', 'keep through gc');
  await f.store.markRemoved(variant.id, local.key);
  await run('git', ['--git-dir', path.join(f.vault, '.rewb-history'), 'gc', '--prune=now']);
  await f.store.restore(variant.id, local.key);
  assert.equal((await f.store.readFile(`variant:${variant.id}`, local.key)).content, 'keep through gc');
});

test('removed local additions remain publicly restorable with their retained content', async (t) => {
  const f = await historyFixture(t);
  const variant = await f.store.createVariant('Option', 'sources');
  const local = await f.store.addFile(variant.id, 'Ideas/Restore.md', 'restore me');
  await f.store.markRemoved(variant.id, local.key);
  assert.equal(byKey(await f.store.getTree(`variant:${variant.id}`), local.key), undefined);
  const removed = await f.store.getRemovedFiles(variant.id);
  assert.deepEqual(byKey(removed, local.key), {
    key: local.key,
    pageId: null,
    parentId: null,
    workspacePath: local.path,
    path: 'Ideas/Restore.md',
    title: 'Restore',
    contentHash: removed.find((entry) => entry.key === local.key).contentHash,
    normalizedHash: removed.find((entry) => entry.key === local.key).normalizedHash,
    missing: false,
    origin: 'variant',
    content: 'restore me',
  });
  await f.store.restore(variant.id, local.key);
  assert.equal((await f.store.readFile(`variant:${variant.id}`, local.key)).content, 'restore me');
});

test('writes reject absolute, traversal, and symlinked variant paths', async (t) => {
  const f = await historyFixture(t);
  const variant = await f.store.createVariant('Option', 'sources');
  for (const value of ['/tmp/escape.md', '../escape.md', 'a/../../escape.md', 'C:\\tmp\\escape.md', 'a\\b.md']) {
    await assert.rejects(f.store.addFile(variant.id, value), { code: 'INVALID_PATH' });
  }
  const outside = await fs.mkdtemp(path.join(os.tmpdir(), 'rewb-outside-'));
  t.after(() => fs.rm(outside, { recursive: true, force: true }));
  const contentRoot = path.join(f.vault, variant.contentFolder);
  await fs.rm(contentRoot, { recursive: true, force: true });
  await fs.symlink(outside, contentRoot, 'dir');
  await assert.rejects(f.store.addFile(variant.id, 'Nested/New.md'), { code: 'UNSAFE_PATH' });
  assert.equal(await fs.readdir(outside).then((items) => items.length), 0);
});

test('sync normalizes materialized content and reports an editor-deleted file', async (t) => {
  const f = await historyFixture(t);
  const variant = await f.store.createVariant('Option', 'sources');
  const opened = await f.store.editInVariant(variant.id, 'page:1');
  const metadataOnly = '---\nabgerufen: later\nquellen_version: 9\n---\n\n# A\n\nBase.\n';
  await fs.writeFile(path.join(f.vault, opened.path), metadataOnly);
  const materialized = byKey(await f.store.getTree(`variant:${variant.id}`), 'page:1');
  assert.equal(materialized.normalizedHash, hash(normalizeContent(metadataOnly)));
  await fs.unlink(path.join(f.vault, opened.path));
  const missing = byKey(await f.store.getTree(`variant:${variant.id}`), 'page:1');
  assert.equal(missing.missing, true);
  assert.equal((await f.store.readFile(`variant:${variant.id}`, 'page:1')).content, null);
  const exported = await f.store.exportChanges(`variant:${variant.id}`);
  assert.deepEqual(exported.files.find((file) => file.key === 'page:1'), {
    key: 'page:1', path: '1 Sources/Confluence/A.md', content: null, status: 'missing',
  });
});

test('apply rollback keeps the recovery version and restores every touched file', async (t) => {
  const f = await historyFixture(t, [
    { id: '1', title: 'A', path: '1 Sources/Confluence/A.md', content: 'A old\n' },
    { id: '2', title: 'B', path: '1 Sources/Confluence/B.md', content: 'B old\n' },
  ]);
  const variant = await f.store.createVariant('Option', 'sources');
  const a = await f.store.editInVariant(variant.id, 'page:1');
  const b = await f.store.editInVariant(variant.id, 'page:2');
  await fs.writeFile(path.join(f.vault, a.path), 'A mine\n');
  await fs.writeFile(path.join(f.vault, b.path), 'B mine\n');
  await f.writeManifest([
    { id: '1', title: 'A', path: '1 Sources/Confluence/A.md', content: 'A new\n' },
    { id: '2', title: 'B', path: '1 Sources/Confluence/B.md', content: 'B new\n' },
  ]);
  const latest = await f.store.captureSources('Updated');
  const review = await f.store.reviewUpdates(variant.id, latest.id);
  const originalSave = f.store._save.bind(f.store);
  let saveCount = 0;
  f.store._save = async function failingSave() {
    saveCount += 1;
    if (saveCount >= 2) throw new Error('forced final save failure');
    return originalSave();
  };
  await assert.rejects(
    f.store.applyReviewedUpdates(variant.id, latest.id, { 'page:1': 'take-source', 'page:2': 'take-source' }, review.reviewToken),
    /forced final save failure/,
  );
  f.store._save = originalSave;
  assert.equal(await fs.readFile(path.join(f.vault, a.path), 'utf8'), 'A mine\n');
  assert.equal(await fs.readFile(path.join(f.vault, b.path), 'utf8'), 'B mine\n');
  assert.ok((await f.store.listVersions()).some((version) => version.name.startsWith('Recovery Option')));
  const reopened = createStore(f.vault);
  await reopened.init();
  assert.ok((await reopened.listVersions()).some((version) => version.name.startsWith('Recovery Option')));
});

test('markRemoved rollback restores the file and prior state on save failure', async (t) => {
  const f = await historyFixture(t);
  const variant = await f.store.createVariant('Option', 'sources');
  const opened = await f.store.editInVariant(variant.id, 'page:1');
  await fs.writeFile(path.join(f.vault, opened.path), 'mine\n');
  await f.store.getTree(`variant:${variant.id}`);
  const originalSave = f.store._save.bind(f.store);
  f.store._save = async () => { throw new Error('forced save failure'); };
  await assert.rejects(f.store.markRemoved(variant.id, 'page:1'), /forced save failure/);
  f.store._save = originalSave;
  assert.equal(await fs.readFile(path.join(f.vault, opened.path), 'utf8'), 'mine\n');
  assert.ok(byKey(await f.store.getTree(`variant:${variant.id}`), 'page:1'));
  const reopened = createStore(f.vault);
  await reopened.init();
  assert.ok(byKey(await reopened.getTree(`variant:${variant.id}`), 'page:1'));
});

test('native Markdown notes inside Content are included automatically while private notes stay outside',async t=>{
 const f=await historyFixture(t);const v=await f.store.createVariant('Native notes','sources');
 await fs.mkdir(path.join(f.vault,v.contentFolder,'Ideas'),{recursive:true});
 await fs.writeFile(path.join(f.vault,v.contentFolder,'Ideas/New requirement.md'),'# New requirement\n\nVisible in this variant.\n');
 await fs.writeFile(path.join(f.vault,v.folder,'Private notes.md'),'Private context');
 const first=await f.store.getTree('variant:'+v.id);const added=first.filter(e=>e.key.startsWith('local:'));
 assert.equal(added.length,1);assert.equal(added[0].path,'Ideas/New requirement.md');
 const key=added[0].key;assert.equal((await f.store.getTree('variant:'+v.id)).filter(e=>e.key===key).length,1);
 const version=await f.store.saveVersion('variant:'+v.id,'Native note saved');
 assert.equal((await f.store.getTree('version:'+version.id)).length,2);
 const exported=await f.store.exportChanges('variant:'+v.id);assert.equal(exported.files.length,1);assert.equal(exported.files[0].key,key);
});
test('comparing a variant to itself does not register a native note twice',async t=>{
 const f=await historyFixture(t);const v=await f.store.createVariant('One identity','sources');
 await fs.writeFile(path.join(f.vault,v.contentFolder,'New.md'),'one new note');
 const c=await f.store.compare('variant:'+v.id,'variant:'+v.id);
 assert.equal(c.unchanged.length,2);assert.equal((await f.store.getTree('variant:'+v.id)).length,2);
});
test('saving rejects a missing working file instead of creating an incomplete checkpoint',async t=>{
 const f=await historyFixture(t);const v=await f.store.createVariant('Missing edit','sources');
 const edit=await f.store.editInVariant(v.id,'page:1');await fs.unlink(path.join(f.vault,edit.path));
 await assert.rejects(f.store.saveVersion('variant:'+v.id,'Incomplete'),{code:'WORKING_FILE_MISSING'});
 assert.equal((await f.store.listVersions()).length,0);
});

test('native working files reset preserves a recoverable version and rejects stale confirmation',async t=>{
 const f=await variantFixture(t);const v=await f.store.createVariant('Working files','sources',{nativeWorking:true});
 const edit=await f.store.editInVariant(v.id,f.key);assert.ok(edit.path.startsWith('1 Working files/'));
 await fs.writeFile(path.join(f.root,edit.path),'My changed requirement');
 const added=await f.store.addFile(v.id,'Extra.md','new local file');
 let token=await f.store.nativeWorkingToken(v.id);
 await fs.writeFile(path.join(f.root,edit.path),'My latest change');
 await assert.rejects(f.store.replaceNativeWorking(v.id,'sources',token),{code:'STALE_REVIEW'});
 token=await f.store.nativeWorkingToken(v.id);
 const result=await f.store.replaceNativeWorking(v.id,'sources',token);
 assert.equal((await f.store.compare('sources','variant:'+v.id)).changed.length,0);
 await assert.rejects(fs.access(path.join(f.root,added.path)));
 assert.equal((await f.store.readFile('version:'+result.recoveryVersionId,f.key)).content,'My latest change');
 await f.store.replaceNativeWorking(v.id,'version:'+result.recoveryVersionId,await f.store.nativeWorkingToken(v.id));
 assert.equal(await fs.readFile(path.join(f.root,edit.path),'utf8'),'My latest change');
 assert.equal(await fs.readFile(path.join(f.root,added.path),'utf8'),'new local file');
});
test('native deletion is explicit in export and recovered by resetting without editing sources',async t=>{
 const f=await variantFixture(t);const v=await f.store.createVariant('Working','sources',{nativeWorking:true});
 const edit=await f.store.editInVariant(v.id,f.key);await fs.unlink(path.join(f.root,edit.path));
 const changes=await f.store.exportChanges('variant:'+v.id);assert.equal(changes.files[0].status,'deleted');
 const token=await f.store.nativeWorkingToken(v.id);await f.store.replaceNativeWorking(v.id,'sources',token);
 assert.match(await fs.readFile(path.join(f.root,edit.path),'utf8'),/one reviewer/);
});

test('native reset rolls back touched files when persistence fails',async t=>{
 const f=await variantFixture(t),v=await f.store.createVariant('Working','sources',{nativeWorking:true});
 const edit=await f.store.editInVariant(v.id,f.key);await fs.writeFile(path.join(f.root,edit.path),'Keep my work');
 const token=await f.store.nativeWorkingToken(v.id);const save=f.store._save.bind(f.store);let calls=0;
 f.store._save=async()=>{if(++calls===2)throw Error('Simulated failure');return save();};
 await assert.rejects(f.store.replaceNativeWorking(v.id,'sources',token),/Simulated failure/);
 assert.equal(await fs.readFile(path.join(f.root,edit.path),'utf8'),'Keep my work');
 const fresh=createStore(f.root);await fresh.init();assert.equal((await fresh.readFile('variant:'+v.id,f.key)).content,'Keep my work');
 assert.ok((await fresh.listVersions()).some(v=>v.name.startsWith('Recovery ')));
});

test('flattening native Confluence folder preserves edits, identity and future resets',async t=>{
 const page={id:'1',title:'A',path:'1 Sources/Confluence/RE Workbench/Topic/A.md',content:'original'};
 const vault=await fixture([page]);t.after(()=>fs.rm(vault,{recursive:true,force:true}));const store=createStore(vault);await store.captureSources();
 const v=await store.createVariant('Working','sources',{nativeWorking:true});const edit=await store.editInVariant(v.id,'page:1');
 await fs.writeFile(path.join(vault,edit.path),'my edit');
 await store.flattenNativeConfluence(v.id,'RE Workbench');
 const target=path.join(vault,'1 Working files/Confluence/Topic/A.md');assert.equal(await fs.readFile(target,'utf8'),'my edit');
 assert.deepEqual((await store.compare('sources','variant:'+v.id)).changed,['page:1']);
 const result=await store.replaceNativeWorking(v.id,'sources',await store.nativeWorkingToken(v.id));assert.equal(await fs.readFile(target,'utf8'),'original');
 await store.replaceNativeWorking(v.id,'version:'+result.recoveryVersionId,await store.nativeWorkingToken(v.id));assert.equal(await fs.readFile(target,'utf8'),'my edit');
 assert.equal(await fs.readFile(path.join(vault,page.path),'utf8'),'original');
});

test('reload archives changed and added files by default; explicit opt out makes no file archive',async t=>{
 const f=await variantFixture(t),v=await f.store.createVariant('Working','sources',{nativeWorking:true});
 const edit=await f.store.editInVariant(v.id,f.key);await fs.writeFile(path.join(f.root,edit.path),'my current edit');
 await f.store.addFile(v.id,'Extra.md','new content');
 const result=await f.store.replaceNativeWorking(v.id,'sources',await f.store.nativeWorkingToken(v.id),{archiveFolder:'5 Archive/My changes'});
 assert.ok(result.archivePath.startsWith('5 Archive/My changes/'));
 assert.equal(await fs.readFile(path.join(f.root,result.archivePath,'Files/Confluence/Project/Requirement.md'),'utf8'),'my current edit');
 assert.equal(await fs.readFile(path.join(f.root,result.archivePath,'Files/Extra.md'),'utf8'),'new content');
 await fs.writeFile(path.join(f.root,edit.path),'another edit');
 const skipped=await f.store.replaceNativeWorking(v.id,'sources',await f.store.nativeWorkingToken(v.id),{archive:false});assert.equal(skipped.archivePath,null);
});
test('archive failure leaves working content intact and unsafe archive paths are rejected',async t=>{
 const f=await variantFixture(t),v=await f.store.createVariant('Working','sources',{nativeWorking:true});
 const edit=await f.store.editInVariant(v.id,f.key);await fs.writeFile(path.join(f.root,edit.path),'keep');
 const token=await f.store.nativeWorkingToken(v.id);
 await assert.rejects(f.store.replaceNativeWorking(v.id,'sources',token,{archiveFolder:'1 Working files/Archive'}),{code:'INVALID_PATH'});
 await fs.writeFile(path.join(f.root,'blocked'),'not a folder');
 await assert.rejects(f.store.replaceNativeWorking(v.id,'sources',token,{archiveFolder:'blocked/Archive'}));
 assert.equal(await fs.readFile(path.join(f.root,edit.path),'utf8'),'keep');
});

test('switching configured source scopes does not retain old pages as missing',async t=>{
 const f=await variantFixture(t);const old=(await f.store.getTree('sources'))[0];
 const file='1 Sources/Confluence/New.md';await fs.writeFile(path.join(f.root,file),'new site content');
 await fs.writeFile(path.join(f.root,'6 Import log/Confluence/manifest.json'),JSON.stringify({origin:'https://new.atlassian.net',scope_id:'new-scope',source_namespace:'new-site',pages:[{id:'1',title:'New',path:file,sha256:hash('new site content')}]}));
 await f.store.captureSources();const tree=await f.store.getTree('sources');assert.equal(tree.length,1);assert.equal(tree[0].key,'page:new-site:1');assert.notEqual(tree[0].key,old.key);
 assert.equal((await f.store.getTree('version:'+f.version.id))[0].key,old.key);
});

test('readable native filenames preserve local edits, identity, deletions and history across reload',async t=>{
 const pages=[{id:'7',title:'A',path:'1 Sources/Confluence/A -- 7.md',content:'source A'}, {id:'8',title:'B',path:'1 Sources/Confluence/B -- 8.md',content:'source B'}];
 const vault=await fixture(pages);t.after(()=>fs.rm(vault,{recursive:true,force:true}));const store=createStore(vault);await store.captureSources();
 const v=await store.createVariant('Working','sources',{nativeWorking:true});
 for(const e of await store.getTree('sources'))await store.editInVariant(v.id,e.key);
 await fs.writeFile(path.join(vault,'1 Working files/Confluence/A -- 7.md'),'my edit');
 await fs.unlink(path.join(vault,'1 Working files/Confluence/B -- 8.md'));
 const saved=await store.saveVersion('variant:'+v.id,'Before filenames');
 const result=await store.useReadableNativePaths(v.id);assert.equal(result.moves.length,1);
 assert.equal(await fs.readFile(path.join(vault,'1 Working files/Confluence/A.md'),'utf8'),'my edit');
 assert.equal((await store.readFile('sources','page:7')).content,'source A');
 assert.equal((await store.readFile('version:'+saved.id,'page:7')).path,pages[0].path);
 const tree=await store.getTree('variant:'+v.id);assert.equal(tree[0].workspacePath,'1 Working files/Confluence/A.md');
 assert.ok(!(tree.some(e=>e.pageId==='8')));
 const diff=await store.compare('sources','variant:'+v.id);assert.deepEqual(diff.changed,['page:7']);assert.deepEqual(diff.removed,['page:8']);assert.deepEqual(diff.added,[]);
 assert.deepEqual((await store.useReadableNativePaths(v.id)).moves,[]);
 const token=await store.nativeWorkingToken(v.id);await store.replaceNativeWorking(v.id,'sources',token);
 assert.equal(await fs.readFile(path.join(vault,'1 Working files/Confluence/B.md'),'utf8'),'source B');
 assert.equal((await store.exportChanges('variant:'+v.id)).files.length,0);
});

test('readable names disambiguate imported siblings and retain folder-note pairing',()=>{
 const {readablePaths}=require('./store');
 const entries=[{key:'a',pageId:'1',path:'1 Sources/Confluence/Topic -- 1.md'}, {key:'b',pageId:'2',path:'1 Sources/Confluence/Topic -- 2.md'}, {key:'c',pageId:'3',path:'1 Sources/Confluence/Topic -- 2/Child -- 3.md'}];
 const result=readablePaths(entries,'1 Working files');
 assert.equal(result.a,'1 Working files/Confluence/Topic.md');assert.equal(result.b,'1 Working files/Confluence/Topic (2).md');
 assert.equal(result.c,'1 Working files/Confluence/Topic (2)/Child.md');
});

test('native rename preserves identity even after a scan; rename back clears change',async t=>{
 const vault=await fixture([{id:'7',title:'A',path:'1 Sources/Confluence/A.md',content:'original'}]);t.after(()=>fs.rm(vault,{recursive:true,force:true}));const store=createStore(vault);await store.captureSources();const v=await store.createVariant('Work','sources',{nativeWorking:true});await store.editInVariant(v.id,'page:7');
 const old='1 Working files/Confluence/A.md',next='1 Working files/Confluence/B.md';
 await fs.rename(path.join(vault,old),path.join(vault,next));await store.getTree('variant:'+v.id);
 await store.recordNativeRename(v.id,old,next);let diff=await store.compare('sources','variant:'+v.id);
 assert.deepEqual(diff.changed,['page:7']);assert.deepEqual(diff.added,[]);assert.deepEqual(diff.removed,[]);assert.deepEqual(diff.renamed,['page:7']);
 const saved=await store.saveVersion('variant:'+v.id,'Named');assert.equal((await store.readFile('version:'+saved.id,'page:7')).workspacePath,next);
 assert.equal((await store.exportChanges('variant:'+v.id)).files[0].currentPath,next);
 await fs.rename(path.join(vault,next),path.join(vault,old));await store.recordNativeRename(v.id,next,old);
 assert.equal((await store.exportChanges('variant:'+v.id)).files.length,0);
 await fs.writeFile(path.join(vault,old),'edited');await fs.rename(path.join(vault,old),path.join(vault,next));await store.recordNativeRename(v.id,old,next);
 assert.equal((await store.readFile('variant:'+v.id,'page:7')).content,'edited');
 const token=await store.nativeWorkingToken(v.id);await store.replaceNativeWorking(v.id,'version:'+saved.id,token);
 assert.equal(await fs.readFile(path.join(vault,next),'utf8'),'original');assert.equal((await store.getTree('variant:'+v.id))[0].key,'page:7');
});

test('folder rename retains each identity; copies stay added; unique repair rejects stale token',async t=>{
 const pages=[{id:'1',title:'A',path:'1 Sources/Group/A.md',content:'first'}, {id:'2',title:'B',path:'1 Sources/Group/B.md',content:'second'}];
 const vault=await fixture(pages);t.after(()=>fs.rm(vault,{recursive:true,force:true}));const store=createStore(vault);await store.captureSources();const v=await store.createVariant('Work','sources',{nativeWorking:true});for(const e of await store.getTree('sources'))await store.editInVariant(v.id,e.key);
 await fs.rename(path.join(vault,'1 Working files/Group'),path.join(vault,'1 Working files/Moved'));await store.recordNativeRename(v.id,'1 Working files/Group','1 Working files/Moved');assert.deepEqual((await store.compare('sources','variant:'+v.id)).changed,['page:1','page:2']);
 await fs.copyFile(path.join(vault,'1 Working files/Moved/A.md'),path.join(vault,'1 Working files/Moved/Copy.md'));assert.equal((await store.compare('sources','variant:'+v.id)).added.length,1);
 await fs.rename(path.join(vault,'1 Working files/Moved/B.md'),path.join(vault,'1 Working files/Moved/Renamed.md'));
 const preview=await store.resolveNativeRenames(v.id);assert.equal(preview.pairs.length,1);
 await fs.writeFile(path.join(vault,'1 Working files/Moved/Renamed.md'),'different');await assert.rejects(store.resolveNativeRenames(v.id,preview.token),{code:'STALE_REVIEW'});
 await fs.writeFile(path.join(vault,'1 Working files/Moved/Renamed.md'),'second');const current=await store.resolveNativeRenames(v.id);await store.resolveNativeRenames(v.id,current.token);
 assert.equal((await store.getTree('variant:'+v.id)).find(e=>e.workspacePath.endsWith('/Renamed.md')).key,'page:2');assert.equal((await store.compare('sources','variant:'+v.id)).added.length,1);
});

test('a copy at the old name cannot steal a renamed source identity; ambiguous repairs stay unresolved',async t=>{
 const vault=await fixture([{id:'1',title:'A',path:'1 Sources/A.md',content:'same'}]);t.after(()=>fs.rm(vault,{recursive:true,force:true}));const store=createStore(vault);await store.captureSources();const v=await store.createVariant('Work','sources',{nativeWorking:true});await store.editInVariant(v.id,'page:1');
 const old=path.join(vault,'1 Working files/A.md'),next=path.join(vault,'1 Working files/B.md');await fs.rename(old,next);await store.recordNativeRename(v.id,'1 Working files/A.md','1 Working files/B.md');await fs.copyFile(next,old);
 let tree=await store.getTree('variant:'+v.id);assert.equal(tree.find(e=>e.key==='page:1').workspacePath,'1 Working files/B.md');assert.ok(tree.find(e=>e.workspacePath==='1 Working files/A.md').key.startsWith('local:'));
 await fs.copyFile(next,path.join(vault,'1 Working files/C.md'));await fs.unlink(next);const preview=await store.resolveNativeRenames(v.id);assert.equal(preview.pairs.length,0);assert.equal(preview.unresolved,1);
});

test('source ordering refreshes independently of content and is frozen in saved versions',async t=>{
 const vault=await fixture([{id:'1',title:'A',path:'1 Sources/A.md',content:'a'}]);t.after(()=>fs.rm(vault,{recursive:true,force:true}));const store=createStore(vault);await store.captureSources();const v=await store.createVariant('Work','sources',{nativeWorking:true});await store.editInVariant(v.id,'page:1');
 const file=path.join(vault,'6 Import log/Confluence/manifest.json'),manifest=JSON.parse(await fs.readFile(file,'utf8'));manifest.ordering='source';manifest.pages[0].source_order=[3];await fs.writeFile(file,JSON.stringify(manifest));
 const first=await store.captureSources();await store.applySourceOrder(v.id);const saved=await store.saveVersion('variant:'+v.id,'Ordered');
 manifest.pages[0].source_order=[1];await fs.writeFile(file,JSON.stringify(manifest));const next=await store.captureSources();assert.notEqual(next.id,first.id);await store.applySourceOrder(v.id);
 assert.deepEqual((await store.getTree('variant:'+v.id))[0].sourceOrder,[1]);assert.deepEqual((await store.getTree('version:'+saved.id))[0].sourceOrder,[3]);assert.deepEqual((await store.compare('source:'+first.id,'sources')).changed,[]);assert.equal((await store.exportChanges('variant:'+v.id)).files.length,0);
 const token=await store.nativeWorkingToken(v.id);await store.replaceNativeWorking(v.id,'version:'+saved.id,token);assert.deepEqual((await store.getTree('variant:'+v.id))[0].sourceOrder,[3]);
 delete manifest.ordering;await fs.writeFile(file,JSON.stringify(manifest));await store.captureSources();await store.applySourceOrder(v.id);assert.equal((await store.getTree('variant:'+v.id))[0].sourceOrder,undefined);
});

test('native identity properties stay visible but do not change article comparison',()=>{
 const source='---\nrewb-id: "site:123"\nrewb-import-warning: "Check conversion: ac:structured-macro"\nrewb-source: "https://demo.atlassian.net/wiki/pages/123"\nquellen_id: "123"\n---\n\n# Original heading\n\n**Domain:** example\n';
 const working=normalizeContent(source,true);
 assert.match(working,/rewb-id:/);
 assert.doesNotMatch(working,/quellen_id:/);
 assert.doesNotMatch(normalizeContent(working),/rewb-import-warning:/);
 assert.equal(normalizeContent(working),normalizeContent(source));
 assert.match(normalizeContent(working),/# Original heading\n\n\*\*Domain:\*\* example/);
});

test('source title-only update is a rename and replacement updates native filename',async t=>{
 const a={id:'7',title:'Old title',path:'1 Sources/Confluence/Old title -- 7.md',content:'# Body unchanged'};
 const vault=await fixture([a]);t.after(()=>fs.rm(vault,{recursive:true,force:true}));const store=createStore(vault);await store.captureSources();
 const v=await store.createVariant('Working files','sources',{nativeWorking:true});await store.editInVariant(v.id,'page:7');await store.useReadableNativePaths(v.id);
 await updateManifest(vault,[{...a,title:'New title'}]);const latest=await store.captureSources();
 const diff=await store.compare('sources','variant:'+v.id);assert.deepEqual(diff.changed,['page:7']);assert.deepEqual(diff.renamed,['page:7']);assert.deepEqual(diff.added,[]);
 const before=(await store.getTree('variant:'+v.id))[0];assert.match(before.workspacePath,/Old title\.md$/);
 await store.replaceNativeWorking(v.id,'source:'+latest.id,await store.nativeWorkingToken(v.id),{archive:true});
 const after=(await store.getTree('variant:'+v.id))[0];assert.equal(after.key,'page:7');assert.match(after.workspacePath,/New title\.md$/);assert.equal(await fs.readFile(path.join(vault,after.workspacePath),'utf8'),'# Body unchanged');
 assert.deepEqual((await store.compare('sources','variant:'+v.id)).changed,[]);
});

test('automatic retention keeps named versions, active baselines and newest automatic entries',async t=>{
 const a={id:'1',title:'Page',path:'1 Sources/Confluence/Page.md',content:'v0'};
 const vault=await fixture([a]);t.after(()=>fs.rm(vault,{recursive:true,force:true}));const store=createStore(vault);
 const first=await store.captureSources();const variant=await store.createVariant('Work','sources');
 const named=await store.saveVersion('sources','Recovery is a user chosen name');
 for(let n=1;n<=5;n++){await updateManifest(vault,[{...a,content:'v'+n}]);await store.captureSources();await store._saveVersion('sources','Auto '+n,true);}
 const result=await store.pruneAutomaticHistory(2);assert.ok(result.removed>0);
 assert.equal(store.state.versions.filter(v=>v.automatic===true).length,2);
 assert.ok(store.state.sources.some(v=>v.id===first.id));assert.ok(store.state.versions.some(v=>v.id===named.id));
 assert.equal((await store.readFile('version:'+named.id,'page:1')).content,'v0');
 assert.equal((await store.readFile('variant:'+variant.id,'page:1')).content,'v0');
 assert.equal((await store.readFile('sources','page:1')).content,'v5');
 await assert.rejects(()=>store.pruneAutomaticHistory(-1));
});


test('empty starter opens repeatedly without a manifest; a lost real manifest still fails', async t => {
  const vault = await fs.mkdtemp(path.join(os.tmpdir(), 'rewb-starter-'));
  t.after(() => fs.rm(vault, {recursive:true, force:true}));
  const store = createStore(vault);
  await store.captureSources();
  const working = await store.createVariant('Working files', 'sources', {nativeWorking:true});
  assert.deepEqual(await store.getTree('variant:' + working.id), []);
  const reopened = createStore(vault);
  await reopened.captureSources();
  const manifest = path.join(vault, '6 Import log/Confluence/manifest.json');
  await fs.mkdir(path.dirname(manifest), {recursive:true});
  await fs.writeFile(manifest, 'invalid json');
  await assert.rejects(reopened.captureSources(), {code:'MANIFEST_UNAVAILABLE'});
  await updateManifest(vault, []);
  await reopened.captureSources();
  await fs.unlink(manifest);
  await assert.rejects(reopened.captureSources(), {code:'MANIFEST_UNAVAILABLE'});
  await updateManifest(vault, [{id:'1',title:'First page',path:'1 Sources/Confluence/First page.md',content:'Imported'}]);
  await reopened.captureSources();
  assert.equal((await reopened.getTree('sources')).length, 1);
  assert.deepEqual(await reopened.getTree('variant:' + working.id), []);
  await fs.unlink(manifest);
  await assert.rejects(reopened.captureSources(), {code:'MANIFEST_UNAVAILABLE'});
});
