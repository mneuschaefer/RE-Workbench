import unittest,importlib.util,tempfile,json
from pathlib import Path
spec=importlib.util.spec_from_file_location('importer',Path(__file__).with_name('update-confluence.py'));m=importlib.util.module_from_spec(spec);spec.loader.exec_module(m)
class Selection(unittest.TestCase):
 def setUp(self):self.req=m.req;self.tmp=tempfile.TemporaryDirectory();self.config=m.CONFIG;m.CONFIG=Path(self.tmp.name)/'config.json'
 def tearDown(self):m.req=self.req;m.CONFIG=self.config;self.tmp.cleanup()
 def page(self,i,parent=None):return {'id':str(i),'title':'Page '+str(i),'spaceId':'10','parentId':parent,'version':{'number':1}}
 def fake(self,path):
  if path.startswith('/spaces?'):return {'results':[{'id':'10'}]}
  if path=='/spaces/10/pages?limit=250&status=current':return {'results':[self.page(1)],'_links':{'next':'/wiki/api/v2/spaces/10/pages?cursor=next'}}
  if path=='/spaces/10/pages?cursor=next':return {'results':[self.page(2,'1')]}
  if '/descendants?' in path:return {'results':[{'id':'2','type':'page','title':'Page 2','parentId':'1'}] if path.startswith('/pages/1/') else []}
  if path=='/pages/1':return self.page(1)
  if path=='/pages/2':return self.page(2,'1')
  raise AssertionError(path)
 def test_scopes(self):
  m.req=self.fake
  for mode,ids,expected in [('trees',['1'],{'1','2'}),('trees',['1','2'],{'1','2'}),('pages',['1'],{'1'}),('space',[],{'1','2'})]:
   nodes,pages,skipped=m.collect({'spaceKey':'demo','scope':{'mode':mode,'pageIds':ids}});self.assertEqual(set(pages),expected)
 def test_reject_other_space(self):
  def req(path):
   d=self.fake(path)
   if path=='/pages/1':d['spaceId']='99'
   return d
  m.req=req
  with self.assertRaisesRegex(RuntimeError,'another space'):m.collect({'spaceKey':'demo','scope':{'mode':'pages','pageIds':['1']}})
 def test_reject_offsite_pagination(self):
  m.req=lambda _: {'results':[],'_links':{'next':'https://other.example/wiki/api/v2/pages'}}
  with self.assertRaisesRegex(RuntimeError,'pagination'):m.listing('/pages')
 def test_config(self):
  m.CONFIG.write_text(json.dumps({'siteUrl':'https://demo.atlassian.net','spaceKey':'X','scope':{'mode':'trees','pageIds':['2','1','2']}}));self.assertEqual(m.load_config()['scope']['pageIds'],['1','2'])
  m.CONFIG.write_text(json.dumps({'siteUrl':'https://evil.example','spaceKey':'X','scope':{'mode':'space'}}))
  with self.assertRaises(RuntimeError):m.load_config()
class ImportLifecycle(unittest.TestCase):
 def test_incremental_import_and_explicit_scope_switch(self):
  import io,contextlib
  with tempfile.TemporaryDirectory() as tmp:
   saved=(m.ROOT,m.MP,m.CONFIG,m.req,m.ORIGIN)
   try:
    m.ROOT=Path(tmp);m.MP=m.ROOT/'6 Import log/Confluence/manifest.json';m.CONFIG=m.ROOT/'config.json'
    fake=Selection()
    def request(path):
     d=fake.fake(path.split('?')[0] if path.startswith('/pages/') and 'body-format' in path else path)
     if 'body-format' in path:d['body']={'storage':{'value':'<p>Requirement text</p>'}}
     return d
    m.req=request
    cfg={'siteUrl':'https://demo.atlassian.net','spaceKey':'X','scope':{'mode':'trees','pageIds':['1']}}
    m.CONFIG.write_text(json.dumps(cfg))
    def run():
     out=io.StringIO()
     with contextlib.redirect_stdout(out):m.main()
     return json.loads(out.getvalue())
    # Setup must exercise conversion without creating imports or changing files.
    before_setup={f.relative_to(m.ROOT):f.read_bytes() for f in m.ROOT.rglob('*') if f.is_file()}
    argv=m.sys.argv
    try:
     m.sys.argv=['update-confluence.py','--dry-run']
     self.assertEqual(run()['updated'],2)
     self.assertEqual({f.relative_to(m.ROOT):f.read_bytes() for f in m.ROOT.rglob('*') if f.is_file()},before_setup)
     self.assertFalse(m.MP.exists())
    finally:m.sys.argv=argv
    self.assertEqual(run()['updated'],2)
    before={f:f.read_bytes() for f in (m.ROOT/'1 Sources').rglob('*.md')}
    self.assertTrue(all(b'\n# Page ' not in b for b in before.values()))
    self.assertEqual(run()['updated'],0)
    self.assertTrue(all(f.read_bytes()==b for f,b in before.items()))
    cfg['scope']={'mode':'pages','pageIds':['2']};m.CONFIG.write_text(json.dumps(cfg));result=run()
    self.assertTrue(result['scope_changed']);self.assertTrue((m.ROOT/result['archive']/'manifest.json').exists())
    self.assertEqual(len(json.loads(m.MP.read_text())['pages']),1)
    self.assertEqual(len(list((m.ROOT/'1 Sources').rglob('*.md'))),1)
   finally:m.ROOT,m.MP,m.CONFIG,m.req,m.ORIGIN=saved

class HierarchyPaths(unittest.TestCase):
 def test_parent_content_and_children_use_matching_sibling_folder(self):
  nodes={i:{'title':title,'parentId':parent,'type':'page'} for i,title,parent in [('1','Home',None),('2','Checkout','1'),('3','Payment','2'),('4','Checkout','1')]}
  paths=m.page_paths(nodes,nodes,{})
  self.assertEqual(paths['1'],'1 Sources/Confluence/Home -- 1.md')
  self.assertEqual(paths['2'],'1 Sources/Confluence/Checkout -- 2.md')
  self.assertEqual(Path(paths['3']).parent,Path(paths['2']).with_suffix(''))
  self.assertNotEqual(paths['2'],paths['4'])
 def test_existing_page_becomes_parent_without_renaming(self):
  nodes={'1':{'title':'Home','parentId':None,'type':'page'},'2':{'title':'New title','parentId':'1','type':'page'},'3':{'title':'Child','parentId':'2','type':'page'}}
  old={'2':{'path':'1 Sources/Confluence/Old title -- 2.md'}}
  paths=m.page_paths(nodes,nodes,old)
  self.assertEqual(paths['2'],old['2']['path'])
  self.assertEqual(Path(paths['3']).parent,Path(paths['2']).with_suffix(''))
 def test_multiple_roots_keep_children_separate(self):
  nodes={i:{'title':title,'parentId':parent,'type':'page'} for i,title,parent in [('1','A',None),('2','B',None),('3','Child','1'),('4','Child','2')]}
  paths=m.page_paths(nodes,nodes,{})
  for parent,child in [('1','3'),('2','4')]:self.assertEqual(Path(paths[child]).parent,Path(paths[parent]).with_suffix(''))

class SourceOrder(unittest.TestCase):
 def test_positions_and_hierarchy_not_api_iteration_define_order(self):
  nodes={'root':{'title':'Home','parentId':None},'b':{'title':'A','parentId':'root','position':20},'a':{'title':'Z','parentId':'root','position':10},'child':{'title':'Child','parentId':'a','position':5}}
  self.assertEqual(m.source_order(nodes,'root'),[-1])
  self.assertEqual(m.source_order(nodes,'a'),[10])
  self.assertEqual(m.source_order(nodes,'child'),[10,5])
  self.assertEqual(m.source_order(nodes,'b'),[20])
 def test_absent_position_does_not_invent_a_source_order(self):
  nodes={'r':{'title':'Home','parentId':None},'x':{'title':'X','parentId':'r'}}
  self.assertIsNone(m.source_order(nodes,'x'))

class Callouts(unittest.TestCase):
 def test_info_preserves_title_body_and_link_and_leaves_unknown_macros(self):
  soup=m.BeautifulSoup('<ac:structured-macro ac:name="info"><ac:parameter ac:name="title">Source</ac:parameter><ac:rich-text-body><p><strong>Credit</strong> <a href="https://example.com">Original</a></p></ac:rich-text-body></ac:structured-macro><ac:structured-macro ac:name="unknown"><ac:rich-text-body>Keep me</ac:rich-text-body></ac:structured-macro>','html.parser')
  m.convert_callouts(soup)
  md=m.markdownify(str(soup),heading_style='ATX')
  self.assertIn('> [!info] Source',md)
  self.assertIn('> **Credit** [Original](https://example.com)',md)
  self.assertEqual(soup.find('ac:structured-macro').get('ac:name'),'unknown')
  self.assertIn('Keep me',md)

class CompactCallouts(unittest.TestCase):
 def test_untitled_panel_starts_on_icon_line_without_duplicate_paragraph(self):
  soup=m.BeautifulSoup('<ac:structured-macro ac:name="info"><ac:rich-text-body><p><strong>Source:</strong> <a href="https://example.com">link</a></p><p>Second paragraph.</p></ac:rich-text-body></ac:structured-macro>','html.parser')
  m.convert_callouts(soup)
  md=m.markdownify(str(soup),heading_style='ATX')
  self.assertIn('> [!info] **Source:** [link](https://example.com)',md)
  self.assertEqual(md.count('**Source:**'),1)
  self.assertIn('> Second paragraph.',md)

if __name__=='__main__':unittest.main()
