const test=require('node:test');
const assert=require('node:assert/strict');
const {selectTopLevel}=require('./native');
test('Open working files chooses imported parent over first child or local note',()=>{
 const root={key:'root',pageId:'1',parentId:null,title:'Z Home',path:'1 Sources/Confluence/Z Home.md'};
 const child={key:'child',pageId:'2',parentId:'1',title:'A Child',path:'1 Sources/Confluence/A Child.md'};
 const local={key:'local',title:'A Local',path:'1 Sources/A Local.md'};
 assert.equal(selectTopLevel([child,local,root]),root);
});
test('multiple roots use a stable title order and absent external parent counts as root',()=>{
 const a={key:'a',pageId:'1',parentId:'outside',title:'A',path:'1 Sources/Confluence/A.md'};
 const b={key:'b',pageId:'2',parentId:null,title:'B',path:'1 Sources/Confluence/B.md'};
 assert.equal(selectTopLevel([b,a]),a);assert.equal(selectTopLevel([a,b]),a);
 assert.equal(selectTopLevel([]),undefined);
});

test('replacement summary uses local-to-source direction and counts renames once',()=>{
 const {summarizeReplacement:s}=require('./native');
 const result=s({changed:['a'],renamed:['a'],added:['remote'],removed:['local'],missing:[]});
 assert.equal(result.different,1);assert.equal(result.remoteOnly,1);assert.equal(result.localOnly,1);assert.equal(result.matches,false);
 assert.equal(s({}).matches,true);const missing=s({missing:['unknown']});assert.equal(missing.matches,false);assert.equal(missing.unavailable,1);assert.match(missing.lines.at(-1),/no longer returned as current/);
});
