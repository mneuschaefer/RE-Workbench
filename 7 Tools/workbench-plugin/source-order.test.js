const test=require('node:test'),assert=require('node:assert/strict');
const {buildSpec}=require('./source-order');
test('source order overrides alphabetic names, follows renamed paths, and pairs folder notes',()=>{
 const entries=[{workspacePath:'1 Working files/Confluence/Z.md',sourceOrder:[0]}, {workspacePath:'1 Working files/Confluence/A renamed.md',sourceOrder:[1]}, {workspacePath:'1 Working files/Confluence/A renamed/Child.md',sourceOrder:[1,0]}, {workspacePath:'1 Working files/Confluence/New.md'}];
 const {text}=buildSpec([{root:'1 Working files',entries}]);
 assert.ok(text.indexOf('/:files Z')<text.indexOf('/:files A renamed'));assert.ok(text.indexOf('/:files A renamed')<text.indexOf('/folders A renamed'));assert.ok(!text.includes('/:files New'));assert.ok(text.includes('...\n    < a-z'));
});
test('unordered sources use normal sorting and names cannot inject sorting rules',()=>{
 let r=buildSpec([{root:'1 Working files',entries:[{workspacePath:'1 Working files/A.md'}]}]);assert.ok(r.text.includes('sorting: standard'));
 r=buildSpec([{root:'1 Working files',entries:[{workspacePath:'1 Working files/Confluence/A....md',sourceOrder:[0]}]}]);assert.ok(r.warnings.length);assert.ok(!r.text.includes('/:files A..'));
});
