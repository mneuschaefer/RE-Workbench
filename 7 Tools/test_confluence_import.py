import unittest,importlib.util,tempfile,json,urllib.error
from unittest import mock
from pathlib import Path
spec=importlib.util.spec_from_file_location('importer',Path(__file__).with_name('update-confluence.py'));m=importlib.util.module_from_spec(spec);spec.loader.exec_module(m)
class Selection(unittest.TestCase):
 def setUp(self):self.saved=(m.req,m.CONFIG,m.API_MODE,m.ORIGIN);self.tmp=tempfile.TemporaryDirectory();m.CONFIG=Path(self.tmp.name)/'config.json'
 def tearDown(self):m.req,m.CONFIG,m.API_MODE,m.ORIGIN=self.saved;self.tmp.cleanup()
 def page(self,i,parent=None):return {'id':str(i),'title':'Page '+str(i),'spaceId':'10','parentId':parent,'version':{'number':1}}
 def fake(self,path):
  if path.startswith('/spaces?keys='):return {'results':[{'id':'10'}]}
  if path=='/spaces/10/pages?limit=250&status=current':return {'results':[self.page(1)],'_links':{'next':'/wiki/api/v2/spaces/10/pages?cursor=next'}}
  if path=='/spaces/10/pages?cursor=next':return {'results':[self.page(2,'1')]}
  if '/descendants?' in path:return {'results':[{'id':'2','type':'page','title':'Page 2','parentId':'1'}] if path.startswith('/pages/1/') else []}
  if path=='/pages/1':return self.page(1)
  if path=='/pages/2':return self.page(2,'1')
  raise AssertionError(path)
 def fake_server(self,path):
   if path=='/space/demo':return {'id':'10','key':'demo'}
   if path.startswith('/content?spaceKey=') and 'type=page' in path:return {'results':[self.page_server(1),self.page_server(2,'1')], '_links':{}}
   if path.startswith('/content/1/child/page'):return {'results':[self.page_server(2,'1')], '_links':{}}
   if path.startswith('/content/2/child/page'):return {'results':[], '_links':{}}
   if path.startswith('/content/1') and 'expand' in path:return self.page_server(1)
   if path.startswith('/content/2') and 'expand' in path:return self.page_server(2,'1')
   raise AssertionError(path)
 def page_server(self,i,parent=None):return {'id':str(i),'title':'Page '+str(i),'space':{'id':'10'},'version':{'number':1},'ancestors':[{'id':parent}] if parent else []}
 def test_scopes(self):
  m.req=self.fake
  m.API_MODE='cloud'  # Make sure we're in cloud mode
  for mode,ids,expected in [('trees',['1'],{'1','2'}),('trees',['1','2'],{'1','2'}),('pages',['1'],{'1'}),('space',[],{'1','2'})]:
   nodes,pages,skipped=m.collect({'spaceKey':'demo','scope':{'mode':mode,'pageIds':ids}});self.assertEqual(set(pages),expected)
 def test_scopes_server(self):
  m.req=self.fake_server
  m.API_MODE='server'
  for mode,ids,expected in [('trees',['1'],{'1','2'}),('trees',['1','2'],{'1','2'}),('pages',['1'],{'1'}),('space',[],{'1','2'})]:
   nodes,pages,skipped=m.collect({'spaceKey':'demo','scope':{'mode':mode,'pageIds':ids}});self.assertEqual(set(pages),expected)
 def test_server_space_uses_child_list_order_when_positions_are_negative(self):
  root=self.page_server(1);second=self.page_server(2,'1');second['title']='Second';second['position']=-1;first=self.page_server(3,'1');first['title']='First';first['position']=-1
  def request(path):
   if path=='/space/demo':return {'id':'10','key':'demo'}
   if path.startswith('/content?spaceKey='):return {'results':[root,second,first],'_links':{}}
   if path.startswith('/content/1/child/page'):return {'results':[second,first],'_links':{}}
   raise AssertionError(path)
  m.req=request;m.API_MODE='server';nodes,pages,_=m.collect({'spaceKey':'demo','scope':{'mode':'space','pageIds':[]}})
  self.assertEqual(nodes['2']['position'],0);self.assertEqual(nodes['3']['position'],1)
  self.assertEqual(m.source_order(nodes,'2'),[0]);self.assertEqual(m.source_order(nodes,'3'),[1])
 def test_reject_other_space(self):
  def req(path):
   d=self.fake(path)
   if path=='/pages/1':d['spaceId']='99'
   return d
  m.req=req
  m.API_MODE='cloud'  # Make sure we're in cloud mode
  with self.assertRaisesRegex(RuntimeError,'another space'):m.collect({'spaceKey':'demo','scope':{'mode':'pages','pageIds':['1']}})
 def test_reject_other_space_server(self):
  def req(path):
   d=self.fake_server(path)
   if path.startswith('/content/1') and 'expand' in path:
    d['space']['id']='99'
   return d
  m.req=req
  m.API_MODE='server'
  with self.assertRaisesRegex(RuntimeError,'another space'):m.collect({'spaceKey':'demo','scope':{'mode':'pages','pageIds':['1']}})
 def test_reject_offsite_pagination(self):
  m.req=lambda _: {'results':[],'_links':{'next':'https://other.example/wiki/api/v2/pages'}}
  with self.assertRaisesRegex(RuntimeError,'pagination'):m.listing('/pages')
 def test_reject_offsite_pagination_server(self):
  m.req=lambda _: {'results':[],'_links':{'next':'https://other.example/rest/api/content'}}
  m.API_MODE='server'
  with self.assertRaisesRegex(RuntimeError,'pagination'):m.listing('/content')
 def test_server_pagination_accepts_configured_context_path(self):
  m.API_MODE='server';m.ORIGIN='https://wiki.example.com/confluence';calls=[]
  def request(path):
   calls.append(path)
   if path=='/content':return {'results':[{'id':'1'}],'_links':{'next':'/confluence/rest/api/content?start=1'}}
   if path=='/content?start=1':return {'results':[{'id':'2'}],'_links':{}}
   raise AssertionError(path)
  m.req=request
  self.assertEqual([item['id'] for item in m.listing('/content')],['1','2'])
 def test_config(self):
   m.CONFIG.write_text(json.dumps({'siteUrl':'https://demo.atlassian.net','spaceKey':'X','scope':{'mode':'trees','pageIds':['2','1','2']}}));config=m.load_config();self.assertEqual(config['scope']['pageIds'],['1','2']);self.assertEqual(config['apiMode'],'cloud')
   m.CONFIG.write_text(json.dumps({'siteUrl':'https://wiki.example.com/confluence/','spaceKey':'X','scope':{'mode':'pages','pageIds':['1']},'apiMode':'auto'}));config=m.load_config();self.assertEqual(config['siteUrl'],'https://wiki.example.com/confluence');self.assertEqual(config['apiMode'],'server')
   m.CONFIG.write_text(json.dumps({'siteUrl':'https://user:secret@wiki.example.com','spaceKey':'X','scope':{'mode':'space'}}))
   with self.assertRaises(RuntimeError):m.load_config()
 def test_config_server(self):
   m.CONFIG.write_text(json.dumps({'siteUrl':'https://confluence.example.com','spaceKey':'X','scope':{'mode':'trees','pageIds':['2','1','2']},'apiMode':'server'}))
   config = m.load_config()
   self.assertEqual(config['scope']['pageIds'],['1','2'])
   self.assertEqual(config['apiMode'],'server')
   # Test that server mode allows http urls (this would fail)
   m.CONFIG.write_text(json.dumps({'siteUrl':'http://confluence.example.com','spaceKey':'X','scope':{'mode':'space'},'apiMode':'server'}))
   with self.assertRaises(RuntimeError):m.load_config()  # Should reject non-https URLs
class ImportLifecycle(unittest.TestCase):
 def test_incremental_import_and_explicit_scope_switch(self):
  import io,contextlib
  with tempfile.TemporaryDirectory() as tmp:
   saved=(m.ROOT,m.MP,m.CONFIG,m.req,m.ORIGIN,m.API_MODE)
   try:
    m.ROOT=Path(tmp);m.MP=m.ROOT/'6 Import log/Confluence/manifest.json';m.CONFIG=m.ROOT/'config.json'
    fake=Selection()
    def request(path):
     d=fake.fake(path.split('?')[0] if path.startswith('/pages/') and 'body-format' in path else path)
     if 'body-format' in path:d['body']={'storage':{'value':'<p>Requirement text</p>'}}
     if path.startswith('/content/') and 'expand' in path and 'body.storage' in path:
      d['body']={'storage':{'value':'<p>Requirement text</p>'}}
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
    # Upgrade a pre-apiMode Cloud manifest without changing the selection.
    legacy=json.loads(m.MP.read_text());legacy['scope_id']=m.digest(json.dumps(cfg,sort_keys=True).encode());legacy['selection']=cfg;m.MP.write_text(json.dumps(legacy))
    result=run();self.assertFalse(result['scope_changed']);self.assertIsNone(result['archive']);self.assertEqual(result['updated'],0)
    cfg['scope']={'mode':'pages','pageIds':['2']};m.CONFIG.write_text(json.dumps(cfg));result=run()
    self.assertTrue(result['scope_changed']);self.assertTrue((m.ROOT/result['archive']/'manifest.json').exists())
    self.assertEqual(len(json.loads(m.MP.read_text())['pages']),1)
    self.assertEqual(len(list((m.ROOT/'1 Sources').rglob('*.md'))),1)
   finally:m.ROOT,m.MP,m.CONFIG,m.req,m.ORIGIN,m.API_MODE=saved

 def test_server_mode_dry_run(self):
  import io,contextlib
  with tempfile.TemporaryDirectory() as tmp:
   saved=(m.ROOT,m.MP,m.CONFIG,m.req,m.ORIGIN,m.API_MODE)
   try:
    m.ROOT=Path(tmp);m.MP=m.ROOT/'6 Import log/Confluence/manifest.json';m.CONFIG=m.ROOT/'config.json'
    def request(path):
     if path=='/space/X':return {'id':'10','key':'X'}
     if path.startswith('/content?spaceKey=') and 'type=page' in path:
      return {'results':[{'id':'1','title':'Page 1','space':{'id':'10'},'version':{'number':1},'ancestors':[]},{'id':'2','title':'Page 2','space':{'id':'10'},'version':{'number':1},'ancestors':[{'id':'1'}]}], '_links':{}}
     if path.startswith('/content/1/child/page'):
      return {'results':[{'id':'2','title':'Page 2','space':{'id':'10'},'version':{'number':1},'ancestors':[{'id':'1'}]}], '_links':{}}
     if path.startswith('/content/2/child/page'):return {'results':[], '_links':{}}
     if path.startswith('/content/1') and 'expand' in path:
      return {'id':'1','title':'Page 1','space':{'id':'10'},'version':{'number':1},'ancestors':[],'body':{'storage':{'value':'<p>Requirement text</p>'}}}
     if path.startswith('/content/2') and 'expand' in path:
      return {'id':'2','title':'Page 2','space':{'id':'10'},'version':{'number':1},'ancestors':[{'id':'1'}],'body':{'storage':{'value':'<p>More requirement text</p>'}}}
     raise AssertionError(path)
    m.req=request
    cfg={'siteUrl':'https://confluence.example.com','spaceKey':'X','scope':{'mode':'trees','pageIds':['1']},'apiMode':'server'}
    m.CONFIG.write_text(json.dumps(cfg))
    def run():
     out=io.StringIO()
     with contextlib.redirect_stdout(out):m.main()
     return json.loads(out.getvalue())
    # Test dry run for server mode
    argv=m.sys.argv
    try:
     m.sys.argv=['update-confluence.py','--dry-run']
     result = run()
     self.assertEqual(result['updated'],2)
     self.assertIn('titles',result)
    finally:m.sys.argv=argv
   finally:m.ROOT,m.MP,m.CONFIG,m.req,m.ORIGIN,m.API_MODE=saved

 def test_unchanged_version_moves_source_file_to_current_hierarchy(self):
  import io,contextlib
  with tempfile.TemporaryDirectory() as tmp:
   saved=(m.ROOT,m.MP,m.CONFIG,m.collect,m.ORIGIN,m.API_MODE)
   try:
    m.ROOT=Path(tmp);m.MP=m.ROOT/'6 Import log/Confluence/manifest.json';m.CONFIG=m.ROOT/'config.json'
    cfg={'siteUrl':'https://demo.atlassian.net','spaceKey':'X','scope':{'mode':'space','pageIds':[]},'apiMode':'auto'};m.CONFIG.write_text(json.dumps(cfg))
    old_rel='1 Sources/Confluence/Old parent -- 2/Child -- 3.md';old=m.ROOT/old_rel;old.parent.mkdir(parents=True);content=b'Existing imported content\n';old.write_bytes(content)
    resolved=m.load_config();scope_id=m.digest(json.dumps(resolved,sort_keys=True).encode());m.MP.parent.mkdir(parents=True)
    m.MP.write_text(json.dumps({'content_format':m.CONTENT_FORMAT,'scope_id':scope_id,'pages':[{'id':'3','title':'Child','remote_title':'Child','version':1,'parent_id':'2','source_order':[1,1],'path':old_rel,'sha256':m.digest(content),'warnings':[]}]}))
    nodes={'1':{'id':'1','title':'Home','type':'page','parentId':None,'sourceParentId':None,'position':0},'3':{'id':'3','title':'Child','type':'page','parentId':'1','sourceParentId':'1','position':1}}
    pages={'3':{'id':'3','title':'Child','spaceId':'10','version':{'number':1},'parentId':'1','position':1}}
    m.collect=lambda _: (nodes,pages,[])
    out=io.StringIO()
    with contextlib.redirect_stdout(out):m.main()
    result=json.loads(out.getvalue());new=m.ROOT/'1 Sources/Confluence/Child -- 3.md'
    self.assertEqual(result['updated'],1);self.assertFalse(old.exists());self.assertEqual(new.read_bytes(),content)
    self.assertEqual(json.loads(m.MP.read_text())['pages'][0]['path'],'1 Sources/Confluence/Child -- 3.md')
   finally:m.ROOT,m.MP,m.CONFIG,m.collect,m.ORIGIN,m.API_MODE=saved

 def test_moved_targets_rewrite_cached_links_and_reject_unowned_destinations(self):
  import io,contextlib
  for api_mode in ['cloud','server']:
   with self.subTest(api_mode=api_mode), tempfile.TemporaryDirectory() as tmp:
    saved=(m.ROOT,m.MP,m.CONFIG,m.collect,m.ORIGIN,m.API_MODE)
    try:
     m.ROOT=Path(tmp);m.CONFIG=m.ROOT/'config.json';m.MP=m.ROOT/'6 Import log/Confluence/manifest.json'
     cfg={'siteUrl':'https://demo.atlassian.net' if api_mode=='cloud' else 'https://wiki.example.com/confluence','spaceKey':'X','scope':{'mode':'space','pageIds':[]},'apiMode':api_mode}
     m.CONFIG.write_text(json.dumps(cfg));resolved=m.load_config()
     paths={'1':'1 Sources/Confluence/Referrer -- 1.md','2':'1 Sources/Confluence/Old -- 2.md'}
     contents={'1':b'[[1 Sources/Confluence/Old -- 2#Section|Link]] and unchanged prose','2':b'Target'};items=[]
     for cid in paths:
      p=m.ROOT/paths[cid];p.parent.mkdir(parents=True,exist_ok=True);p.write_bytes(contents[cid]);items.append({'id':cid,'title':'Referrer' if cid=='1' else 'Old','version':1,'path':paths[cid],'sha256':m.digest(contents[cid]),'warnings':[]})
     m.MP.parent.mkdir(parents=True);m.MP.write_text(json.dumps({'content_format':m.CONTENT_FORMAT,'scope_id':m.digest(json.dumps(resolved,sort_keys=True).encode()),'pages':items}))
     nodes={cid:{'id':cid,'title':'Referrer' if cid=='1' else 'New','type':'page','parentId':None,'position':int(cid)} for cid in paths}
     pages={cid:{'id':cid,'title':nodes[cid]['title'],'version':{'number':1}} for cid in paths};m.collect=lambda c:(nodes,pages,[])
     target=m.ROOT/'1 Sources/Confluence/New -- 2.md';target.write_bytes(b'Unowned file')
     original_manifest=m.MP.read_bytes()
     for version in [1,2]:
      pages['2']['version']['number']=version
      with self.assertRaisesRegex(RuntimeError,'target already exists'):m.main()
      self.assertEqual(target.read_bytes(),b'Unowned file');self.assertEqual(m.MP.read_bytes(),original_manifest)
     pages['2']['version']['number']=1;target.unlink()
     with contextlib.redirect_stdout(io.StringIO()):m.main()
     self.assertFalse((m.ROOT/paths['2']).exists());self.assertEqual(target.read_bytes(),contents['2'])
     self.assertEqual((m.ROOT/paths['1']).read_bytes(),b'[[1 Sources/Confluence/New -- 2#Section|Link]] and unchanged prose')
     manifest=json.loads(m.MP.read_text())
     for item in manifest['pages']:self.assertEqual(item['sha256'],m.digest((m.ROOT/item['path']).read_bytes()))
    finally:m.ROOT,m.MP,m.CONFIG,m.collect,m.ORIGIN,m.API_MODE=saved

class HierarchyPaths(unittest.TestCase):
 def test_parent_content_and_children_use_matching_sibling_folder(self):
  nodes={i:{'title':title,'parentId':parent,'type':'page'} for i,title,parent in [('1','Home',None),('2','Checkout','1'),('3','Payment','2'),('4','Checkout','1')]}
  paths=m.page_paths(nodes,nodes,{})
  self.assertEqual(paths['1'],'1 Sources/Confluence/Home -- 1.md')
  self.assertEqual(paths['2'],'1 Sources/Confluence/Checkout -- 2.md')
  self.assertEqual(Path(paths['3']).parent,Path(paths['2']).with_suffix(''))
  self.assertNotEqual(paths['2'],paths['4'])
 def test_existing_page_path_follows_current_title_and_hierarchy(self):
  nodes={'1':{'title':'Home','parentId':None,'type':'page'},'2':{'title':'New title','parentId':'1','type':'page'},'3':{'title':'Child','parentId':'2','type':'page'}}
  old={'2':{'path':'1 Sources/Confluence/Old title -- 2.md'}}
  paths=m.page_paths(nodes,nodes,old)
  self.assertEqual(paths['2'],'1 Sources/Confluence/New title -- 2.md')
  self.assertEqual(Path(paths['3']).parent,Path(paths['2']).with_suffix(''))
 def test_moved_page_leaves_an_unavailable_old_parent(self):
  nodes={'1':{'title':'Home','parentId':None,'type':'page'},'3':{'title':'Child','parentId':'1','type':'page'}}
  old={'3':{'path':'1 Sources/Confluence/Old parent -- 2/Child -- 3.md'}}
  self.assertEqual(m.page_paths(nodes,nodes,old)['3'],'1 Sources/Confluence/Child -- 3.md')
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

class AuthHeaders(unittest.TestCase):
 def test_bearer_header_in_server_mode(self):
  import os
  class Response:
   headers={}
   def __enter__(self):return self
   def __exit__(self,*_):pass
   def read(self):return b'{"id":"10","key":"X"}'
  class Opener:
   request=None
   def open(self,request,timeout):self.request=request;return Response()
  saved=(m.opener,m.ORIGIN,m.API_MODE,os.environ.get('REWB_TOKEN'),os.environ.get('REWB_EMAIL'))
  try:
   fake=Opener();m.opener=fake;m.ORIGIN='https://confluence.example.com';m.API_MODE='server'
   os.environ['REWB_TOKEN']='test-token';os.environ['REWB_EMAIL']='must-not-appear@example.com'
   m.req('/space/X')
   self.assertEqual(fake.request.get_header('Authorization'),'Bearer test-token')
   self.assertNotIn('must-not-appear',fake.request.get_header('Authorization'))
  finally:
   m.opener,m.ORIGIN,m.API_MODE=saved[:3]
   for key,value in [('REWB_TOKEN',saved[3]),('REWB_EMAIL',saved[4])]:
    if value is None:os.environ.pop(key,None)
    else:os.environ[key]=value

class RequestRetries(unittest.TestCase):
 def setUp(self):
  import os
  self.saved=(m.opener,m.ORIGIN,m.API_MODE,os.environ.get('REWB_TOKEN'))
  m.ORIGIN='https://wiki.example.com/confluence';m.API_MODE='server';os.environ['REWB_TOKEN']='test-token'
 def tearDown(self):
  import os
  m.opener,m.ORIGIN,m.API_MODE,token=self.saved
  if token is None:os.environ.pop('REWB_TOKEN',None)
  else:os.environ['REWB_TOKEN']=token
 def error(self,code,retry_after=None):
  headers={} if retry_after is None else {'Retry-After':retry_after}
  return urllib.error.HTTPError('https://wiki.example.com',code,'failed',headers,None)
 def test_rate_limit_retries_then_succeeds(self):
  class Response:
   headers={}
   def __enter__(self):return self
   def __exit__(self,*_):pass
   def read(self):return b'{"id":"10","key":"X"}'
  class Opener:
   calls=0
   def open(inner,request,timeout):
    inner.calls+=1
    if inner.calls==1:raise self.error(429,'0')
    return Response()
  m.opener=Opener()
  with mock.patch.object(m.time,'sleep') as sleep:
   self.assertEqual(m.req('/space/X')['id'],'10')
   self.assertEqual(m.opener.calls,2);sleep.assert_called_once_with(0)
 def test_persistent_rate_limit_has_controlled_error(self):
  class Opener:
   calls=0
   def open(inner,request,timeout):inner.calls+=1;raise self.error(429,'0')
  m.opener=Opener()
  with mock.patch.object(m.time,'sleep'):
   with self.assertRaisesRegex(RuntimeError,'rate limit remained active'):m.req('/space/X')
  self.assertEqual(m.opener.calls,m.MAX_ATTEMPTS)
 def test_auth_error_is_not_retried(self):
  class Opener:
   calls=0
   def open(inner,request,timeout):inner.calls+=1;raise self.error(401)
  m.opener=Opener()
  with mock.patch.object(m.time,'sleep') as sleep:
   with self.assertRaisesRegex(RuntimeError,'authentication failed.*API token'):m.req('/space/X')
   sleep.assert_not_called()
  self.assertEqual(m.opener.calls,1)

class CompactCallouts(unittest.TestCase):
 def test_untitled_panel_starts_on_icon_line_without_duplicate_paragraph(self):
  soup=m.BeautifulSoup('<ac:structured-macro ac:name="info"><ac:rich-text-body><p><strong>Source:</strong> <a href="https://example.com">link</a></p><p>Second paragraph.</p></ac:rich-text-body></ac:structured-macro>','html.parser')
  m.convert_callouts(soup)
  md=m.markdownify(str(soup),heading_style='ATX')
  self.assertIn('> [!info] **Source:** [link](https://example.com)',md)
  self.assertEqual(md.count('**Source:**'),1)
  self.assertIn('> Second paragraph.',md)

if __name__=='__main__':unittest.main()
