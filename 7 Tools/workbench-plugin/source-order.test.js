const test=require('node:test'),assert=require('node:assert/strict');
const {buildSpec}=require('./source-order');
test('source order overrides alphabetic names, follows renamed paths, and pairs folder notes',()=>{
 const entries=[{workspacePath:'1 Working files/Confluence/Z.md',sourceOrder:[0]}, {workspacePath:'1 Working files/Confluence/A renamed.md',sourceOrder:[1]}, {workspacePath:'1 Working files/Confluence/A renamed/Child.md',sourceOrder:[1,0]}, {workspacePath:'1 Working files/Confluence/New.md'}];
 const {text}=buildSpec([{root:'1 Working files',entries}]);
 assert.ok(text.indexOf('/:files Z')<text.indexOf('\n  A renamed'));assert.equal((text.match(/\n  A renamed\n/g)||[]).length,1);assert.ok(!text.includes('/:files New'));assert.ok(text.includes('...\n    < a-z'));
});
test('same-position siblings keep the supplied order and note-folder pairs stay adjacent',()=>{
 const entries=[{workspacePath:'1 Working files/P.md',sourceOrder:[0]},{workspacePath:'1 Working files/P/Second.md',sourceOrder:[0,1]},{workspacePath:'1 Working files/P/Second/Child.md',sourceOrder:[0,1,0]},{workspacePath:'1 Working files/P/First.md',sourceOrder:[0,2]},{workspacePath:'1 Working files/P/First/Child.md',sourceOrder:[0,2,0]}];
 const {text}=buildSpec([{root:'1 Working files',entries}]);
 assert.ok(text.indexOf('\n  Second\n')<text.indexOf('\n  First\n'));assert.equal((text.match(/\n  Second\n/g)||[]).length,1);assert.equal((text.match(/\n  First\n/g)||[]).length,1);
});
test('unordered sources use normal sorting and names cannot inject sorting rules',()=>{
 let r=buildSpec([{root:'1 Working files',entries:[{workspacePath:'1 Working files/A.md'}]}]);assert.ok(r.text.includes('sorting: standard'));
 r=buildSpec([{root:'1 Working files',entries:[{workspacePath:'1 Working files/Confluence/A....md',sourceOrder:[0]}]}]);assert.ok(r.warnings.length);assert.ok(!r.text.includes('/:files A..'));
});
