"""Explicit GET-only Confluence import. Source selection: confluence-source.json."""
import os,json,re,hashlib,base64,urllib.request,urllib.parse,sys,shutil,tempfile
from pathlib import Path
from datetime import datetime,timezone
from bs4 import BeautifulSoup
from markdownify import markdownify
ROOT=Path(__file__).resolve().parents[1]
MP=ROOT/'6 Import log/Confluence/manifest.json'
CONFIG=ROOT/'7 Tools/confluence-source.json'
PREFIX='1 Sources/Confluence/'
ORIGIN=''
CONTENT_FORMAT=6
def digest(b):return hashlib.sha256(b).hexdigest()
def load_config():
 c=json.loads(CONFIG.read_text());site=urllib.parse.urlsplit(c['siteUrl'])
 if site.scheme!='https' or not re.fullmatch(r'[a-z0-9-]+\.atlassian\.net',site.netloc):raise RuntimeError('Use an HTTPS Atlassian site URL')
 if site.path not in ('','/'):raise RuntimeError('Site URL must contain only the site address')
 scope=c['scope'];mode=scope['mode']
 if mode not in ('space','trees','pages'):raise RuntimeError('Scope mode must be space, trees or pages')
 ids=scope.get('pageIds',[])
 if not isinstance(ids,list) or any(not re.fullmatch(r'[0-9]+',str(i)) for i in ids):raise RuntimeError('Page IDs must be a list of numeric IDs')
 if mode!='space' and not ids:raise RuntimeError('Select at least one page ID')
 if not c.get('spaceKey'):raise RuntimeError('Set the Confluence space key')
 return {'siteUrl':site.scheme+'://'+site.netloc,'spaceKey':str(c['spaceKey']),'scope':{'mode':mode,'pageIds':sorted(set(map(str,ids))) if mode!='space' else []}}
def confined(rel):
 p=(ROOT/rel).resolve()
 if not p.is_relative_to((ROOT/'1 Sources/Confluence').resolve()):raise RuntimeError('Source path is outside the allowed directory')
 return p
class NoRedirect(urllib.request.HTTPRedirectHandler):
 def redirect_request(self,*a,**k):return None
opener=urllib.request.build_opener(NoRedirect)
def req(path):
 if not re.match(r'^/(pages|folders|spaces)(?:/[0-9]+)?(?:[/?]|$)',path) or '..' in path:raise RuntimeError('Unexpected API path')
 auth=base64.b64encode((os.environ['REWB_EMAIL']+':'+os.environ['REWB_TOKEN']).encode()).decode()
 q=urllib.request.Request(ORIGIN+'/wiki/api/v2'+path,headers={'Authorization':'Basic '+auth,'Accept':'application/json'})
 with opener.open(q,timeout=30) as f:
  result=json.load(f)
  if not result.get('_links',{}).get('next'):
   match=re.search(r'<([^>]+)>;\s*rel="next"',f.headers.get('Link',''))
   if match:result.setdefault('_links',{})['next']=match[1]
  return result
def listing(path):
 seen=set();result=[]
 while path:
  if path in seen:raise RuntimeError('Repeated pagination')
  seen.add(path);d=req(path);result.extend(d['results']);path=d.get('_links',{}).get('next')
  if path:
   if path.startswith(ORIGIN):path=path[len(ORIGIN):]
   if not path.startswith('/wiki/api/v2/'):raise RuntimeError('Unexpected pagination URL')
   path=path[len('/wiki/api/v2'):]
 return result
def collect(c):
 spaces=listing('/spaces?keys='+urllib.parse.quote(c['spaceKey'])+'&limit=100')
 if len(spaces)!=1:raise RuntimeError('Confluence space not found or ambiguous')
 space_id=str(spaces[0]['id']);mode=c['scope']['mode'];nodes={};pages={};skipped=[]
 if mode=='space':
  for item in listing('/spaces/'+space_id+'/pages?limit=250&status=current'):
   pages[str(item['id'])]=req('/pages/'+str(item['id']))
 else:
  for cid in c['scope']['pageIds']:
   pages[cid]=req('/pages/'+cid)
  if mode=='trees':
   queue=[('page',i) for i in pages];seen=set()
   while queue:
    kind,cid=queue.pop(0)
    if cid in seen:continue
    seen.add(cid)
    for n in listing('/'+('pages' if kind=='page' else 'folders')+'/'+cid+'/descendants?depth=1&limit=100'):
     nid=str(n['id'])
     if str(n['parentId'])!=cid:raise RuntimeError('Unsupported hierarchy')
     if n['type'] not in ('page','folder'):skipped.append({'id':nid,'type':n['type']});continue
     nodes[nid]={'id':nid,'type':n['type'],'title':n['title'],'parentId':str(n['parentId']),'position':n.get('childPosition')}
     queue.append((n['type'],nid))
     if n['type']=='page' and nid not in pages:pages[nid]=req('/pages/'+nid)
 for cid,p in pages.items():
  if str(p['spaceId'])!=space_id:raise RuntimeError('Selected page belongs to another space')
  nodes[cid]={'id':cid,'type':'page','title':p['title'],'parentId':str(p['parentId']) if p.get('parentId') else None,'position':nodes.get(cid,{}).get('position') if nodes.get(cid,{}).get('position') is not None else p.get('position')}
 # Space selection may contain folder ancestors not returned by the pages endpoint.
 if mode=='space':
  for p in list(pages.values()):
   parent=p.get('parentId');kind=p.get('parentType');visited=set()
   while parent and kind=='folder' and str(parent) not in nodes:
    parent=str(parent)
    if parent in visited:raise RuntimeError('Cyclic folder hierarchy')
    visited.add(parent);f=req('/folders/'+parent)
    nodes[parent]={'id':parent,'type':'folder','title':f['title'],'parentId':str(f['parentId']) if f.get('parentId') else None,'position':f.get('position')}
    parent=f.get('parentId');kind=f.get('parentType')
 for n in nodes.values():
  n['sourceParentId']=n['parentId']
  if mode=='pages' or n['parentId'] not in nodes:n['parentId']=None
 return nodes,pages,skipped
def source_order(nodes,cid):
 # The single selected root is shown first, without an extra wrapper folder.
 roots=[key for key,n in nodes.items() if n['parentId'] is None]
 unrelated_roots=len({nodes[key].get('sourceParentId') for key in roots})>1
 def chain(key,seen):
  if key in seen:raise RuntimeError('Cyclic source order')
  n=nodes[key];parent=n['parentId'];position=n.get('position')
  if roots==[key]:return []
  if key in roots and unrelated_roots:position=None
  token=position if isinstance(position,int) and not isinstance(position,bool) else n['title'].casefold()
  return (chain(parent,seen|{key}) if parent in nodes else [])+[token]
 if roots==[cid]:return [-1]
 if cid in roots and unrelated_roots:return None
 if not isinstance(nodes[cid].get('position'),int):return None
 return chain(cid,set())

def safe(s):return re.sub(r'[\\/:*?"<>|\[\]#^\x00-\x1f]','-',s).strip(' .')[:120] or 'Untitled'
def page_paths(nodes,pages,old):
 # A page and its child folder share a basename: Parent.md beside Parent/.
 # Keep established paths stable; IDs disambiguate equal/sanitized titles.
 paths={cid:item['path'] for cid,item in old.items() if cid in pages}
 dirs={};visiting=set()
 roots=[cid for cid,n in nodes.items() if n['parentId'] is None]
 def note(cid):
  if cid not in paths:
   n=nodes[cid]
   parent=Path(PREFIX) if n['parentId'] is None else directory(n['parentId'])
   paths[cid]=(parent/(safe(n['title'])+' -- '+cid+'.md')).as_posix()
  return Path(paths[cid])
 def directory(cid):
  if cid in dirs:return dirs[cid]
  if cid in visiting:raise RuntimeError('Cyclic page hierarchy')
  visiting.add(cid);n=nodes[cid]
  if n['type']=='page':
   # A single selected root stays directly under Confluence, without a wrapper.
   result=Path(PREFIX) if roots==[cid] else note(cid).with_suffix('')
  else:
   parent=Path(PREFIX) if n['parentId'] is None else directory(n['parentId'])
   result=parent/(safe(n['title'])+' -- '+cid)
  dirs[cid]=result;visiting.remove(cid);return result
 for cid in pages:note(cid)
 if len({p.casefold() for p in paths.values()})!=len(paths):raise RuntimeError('Import paths collide')
 return paths

def convert_callouts(soup):
 # Standard Confluence panels map to native Obsidian callouts; other macros stay flagged.
 kinds={'info':'info','note':'note','warning':'warning','tip':'tip'}
 for macro in reversed(soup.find_all('ac:structured-macro')):
  kind=kinds.get(macro.get('ac:name'))
  body=macro.find('ac:rich-text-body',recursive=False)
  if not kind or body is None:continue
  params=macro.find_all('ac:parameter',recursive=False)
  if any(p.get('ac:name') not in ('title','icon') for p in params):continue
  title=next((p.get_text(' ',strip=True) for p in params if p.get('ac:name')=='title'),'')
  quote=soup.new_tag('blockquote');label=soup.new_tag('p');label.string='[!'+kind+']'+(' '+title if title else '')
  # Untitled panels start beside the icon, not below a generated title row.
  first=body.find('p',recursive=False)
  if not title and first is not None and next((c for c in body.contents if str(c).strip()),None) is first:
   label.append(' ')
   for child in list(first.contents):label.append(child.extract())
   first.decompose()
  quote.append(label)
  for child in list(body.contents):quote.append(child.extract())
  macro.replace_with(quote)

def main():
 global ORIGIN
 c=load_config();ORIGIN=c['siteUrl'];scope_id=digest(json.dumps(c,sort_keys=True).encode())
 original=MP.read_bytes() if MP.exists() else None;prior=json.loads(original) if original else {'pages':[]}
 changed_scope=prior.get('scope_id')!=scope_id
 old_all={p['id']:p for p in prior['pages']};old={} if changed_scope else old_all;originals={}
 for p in old_all.values():
  path=confined(p['path']);b=path.read_bytes()
  if digest(b)!=p['sha256']:raise RuntimeError('Local source was edited. Save or compare it first: '+p['path'])
  originals[path]=b
 nodes,pages,skipped=collect(c)
 again,again_pages,_=collect(c)
 if nodes!=again or {i:p['version']['number'] for i,p in pages.items()}!={i:p['version']['number'] for i,p in again_pages.items()}:raise RuntimeError('Hierarchy changed during refresh')
 paths=page_paths(nodes,pages,old)
 now=datetime.now(timezone.utc).isoformat(timespec='seconds');writes={};items=[];updated=0
 for cid,p in pages.items():
  prev=old.get(cid);version=p['version']['number']
  if prev and prev['version']==version and prior.get('content_format')==CONTENT_FORMAT:
   item=dict(prev);item.pop('not_seen_at',None);item['title']=p['title'];item['remote_title']=p['title'];item['parent_id']=nodes[cid]['parentId'];item['source_order']=source_order(nodes,cid);items.append(item);continue
  detail=req('/pages/'+cid+'?body-format=storage')
  if detail['version']['number']!=version:raise RuntimeError('Source changed during refresh')
  raw=detail['body']['storage']['value'];path=confined(paths[cid])
  if not prev and path.exists() and path not in originals:raise RuntimeError('New import target already exists')
  soup=BeautifulSoup(raw,'html.parser');convert_callouts(soup);unsupported=sorted({t.name for t in soup.find_all() if ':' in t.name or t.name in ('img','iframe','object','script')})
  for a in soup.find_all('a',href=True):
   href=urllib.parse.urljoin(ORIGIN,a['href']);parsed=urllib.parse.urlsplit(href)
   if parsed.netloc!=urllib.parse.urlsplit(ORIGIN).netloc:continue
   match=re.search(r'/pages/(\d+)',parsed.path);target=match[1] if match else urllib.parse.parse_qs(parsed.query).get('pageId',[None])[0]
   if target in paths:a.replace_with('[[ '+paths[target].removesuffix('.md')+'|'+a.get_text()+' ]]')
  md=markdownify(str(soup),heading_style='ATX',bullets='-',table_infer_header=True,escape_underscores=False).strip().replace('[[ ','[[').replace(' ]]',']]').replace('\\[\\[','[[').replace('\\]\\]',']]')
  url=ORIGIN+'/wiki/spaces/'+urllib.parse.quote(c['spaceKey'])+'/pages/'+cid
  props={'rewb-id':digest(ORIGIN.encode())[:12]+':'+cid,'rewb-source':url,'typ':'Quelle','quellen_id':cid,'quellen_version':version,'confluence-url':url,'confluence-version':version,'abgerufen':now,'cssclasses':['rewb-source']}
  if unsupported:props['rewb-import-warning']='Check conversion: '+', '.join(unsupported)
  text='---\n'+''.join(k+': '+json.dumps(v,ensure_ascii=False)+'\n' for k,v in props.items())+'---\n\n'
  text+=f'> [!abstract] Source · Confluence v{version}\n> Imported content. Edit copies in 1 Working files.\n\n'+md+'\n'
  writes[path]=text.encode();updated+=1
  items.append({'id':cid,'title':p['title'],'version':version,'parent_id':nodes[cid]['parentId'],'source_order':source_order(nodes,cid),'path':paths[cid],'url':url,'sha256':digest(text.encode()),'warnings':unsupported})
 missing=sorted(set(old)-set(pages))
 for cid in missing:
  item=dict(old[cid]);item['not_seen_at']=now;items.append(item)
 manifest={'content_format':CONTENT_FORMAT,'ordering':'source','origin':ORIGIN,'scope_id':scope_id,'source_namespace':digest(ORIGIN.encode())[:12],'selection':c,'captured':prior.get('captured',now) if not changed_scope else now,'pages':items,'last_checked':now,'missing_retained':missing,'unsupported_content':skipped}
 writes[MP]=(json.dumps(manifest,ensure_ascii=False,indent=2)+'\n').encode()
 writes[ROOT/'6 Import log/Confluence/Latest refresh.md']=(f'# Latest source refresh\n\nChecked: {now}\n\n- Site: {ORIGIN}\n- Space: {c["spaceKey"]}\n- Selection: {c["scope"]["mode"]}\n- {len(pages)} pages available\n- {updated} pages added or updated\n- {len(missing)} missing pages retained\n- {len(skipped)} unsupported content items skipped\n\nWorking files were not replaced. Configuration: [[7 Tools/Confluence source]].\n').encode()
 if '--dry-run' in sys.argv:print(json.dumps({'checked':len(pages),'updated':updated,'scope_changed':changed_scope,'titles':[p['title'] for p in pages.values()],'unsupported':skipped}));return
 if (MP.read_bytes() if MP.exists() else None)!=original:raise RuntimeError('Manifest changed during refresh')
 for path,b in originals.items():
  if path.read_bytes()!=b:raise RuntimeError('Source was edited during refresh')
 if load_config()!=c:raise RuntimeError('Source configuration changed during refresh')
 archive=None
 if changed_scope and original:
  archive=Path(tempfile.mkdtemp(prefix=datetime.now().strftime('%Y-%m-%d-%H%M%S-'),dir=make_archive_parent()))
  (archive/'manifest.json').write_bytes(original)
  for path,b in originals.items():
   dest=archive/'Files'/path.relative_to((ROOT/'1 Sources/Confluence').resolve());dest.parent.mkdir(parents=True,exist_ok=True);dest.write_bytes(b)
 removals=[p for p in originals if changed_scope and p not in writes]
 backups={};done=[]
 try:
  for path,b in writes.items():
   backups[path]=path.read_bytes() if path.exists() else None;path.parent.mkdir(parents=True,exist_ok=True)
   staging=path.with_name(path.name+'.rewb-tmp');staging.write_bytes(b);os.replace(staging,path);done.append(path)
  for path in removals:backups[path]=path.read_bytes();path.unlink();done.append(path)
 except Exception:
  for path in reversed(done):
   if backups[path] is None:path.unlink(missing_ok=True)
   else:path.parent.mkdir(parents=True,exist_ok=True);path.write_bytes(backups[path])
  raise
 print(json.dumps({'checked':len(pages),'updated':updated,'missing_retained':missing,'scope_changed':changed_scope,'archive':str(archive.relative_to(ROOT)) if archive else None}))
def make_archive_parent():
 p=ROOT/'5 Archive/Previous sources';p.mkdir(parents=True,exist_ok=True);return p
if __name__=='__main__':
 try:main()
 except Exception as e:
  print('Refresh stopped: '+(str(e) if isinstance(e,RuntimeError) else type(e).__name__),file=sys.stderr);sys.exit(1)
