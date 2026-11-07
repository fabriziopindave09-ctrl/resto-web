'use strict';
/* Resto: servidor de red local. Sin dependencias, solo Node.js 18 o superior. */
const http=require('http'),fs=require('fs'),path=require('path'),os=require('os'),crypto=require('crypto');
const Core=require('./core.js');
const PORT=+process.env.PORT||3000,DIR=__dirname,DATA=process.env.RESTO_DATA||path.join(DIR,'data');
const HIST=path.join(DATA,'history'),BAK=path.join(DATA,'backups'),STATEF=path.join(DATA,'state.json');
fs.mkdirSync(HIST,{recursive:true});fs.mkdirSync(BAK,{recursive:true});

const pad=n=>String(n).padStart(2,'0');
const ds=t=>{const d=new Date(t);return d.getFullYear()+'-'+pad(d.getMonth()+1)+'-'+pad(d.getDate())};
const log=(...a)=>console.log(new Date().toLocaleTimeString('es-AR'),...a);

let S=null;
try{S=JSON.parse(fs.readFileSync(STATEF,'utf8'))}catch(e){if(fs.existsSync(STATEF))log('ATENCIÓN: no se pudo leer data/state.json, se usan datos de ejemplo. Hay copias en data/backups.')}
if(!S||!S.menu)S=Core.demo();
Core.fix(S);
let ver=Date.now();/* monótono también entre reinicios */

function persist(){
 const tmp=STATEF+'.tmp';fs.writeFileSync(tmp,JSON.stringify(S));fs.renameSync(tmp,STATEF);
 const b=path.join(BAK,'state-'+ds(Date.now())+'.json');
 if(!fs.existsSync(b)){fs.copyFileSync(STATEF,b);const all=fs.readdirSync(BAK).filter(f=>f.startsWith('state-')).sort();all.slice(0,Math.max(0,all.length-30)).forEach(f=>fs.unlinkSync(path.join(BAK,f)))}
}
function archive(o){
 const rec={id:o.id,table:o.table,paidAt:o.paidAt,sub:o.sub,tipAmt:o.tipAmt||0,tipPct:o.tipPct||0,total:o.total,method:o.method,pays:o.pays,mozo:o.mozo||'',cobro:o.cobro||'',split:o.split||1,items:o.items.map(i=>({name:i.name,qty:i.qty,price:i.price}))};
 fs.appendFileSync(path.join(HIST,ds(o.paidAt).slice(0,7)+'.jsonl'),JSON.stringify(rec)+'\n');
}
const prune=()=>{const t=ds(Date.now());S.orders=S.orders.filter(o=>o.status!=='paid'||ds(o.paidAt)===t)};
prune();persist();

/* sesiones y control de intentos */
const sessions=new Map(),fails=new Map(),DAY=24*3600e3;
const userOf=req=>{const h=req.headers.authorization||'',q=new URL(req.url,'http://x').searchParams.get('t'),t=h.startsWith('Bearer ')?h.slice(7):q;const s=t&&sessions.get(t);if(!s||s.exp<Date.now())return null;return S.users.find(u=>u.id===s.uid)||null};
const pub=u=>({id:u.id,name:u.name,role:u.role});
const view=u=>{const s=Object.assign({},S);s.users=S.users.map(x=>u.role==='admin'?x:pub(x));return{v:ver,now:Date.now(),state:s}};

/* tiempo real (SSE) */
const clients=new Set();
const broadcast=()=>{for(const r of clients)r.write(`data: {"v":${ver}}\n\n`)};
setInterval(()=>{for(const r of clients)r.write(': ping\n\n')},25000);

const TYPES={'.html':'text/html; charset=utf-8','.js':'text/javascript; charset=utf-8','.webmanifest':'application/manifest+json','.svg':'image/svg+xml','.png':'image/png'};
const FILES={'/':'index.html','/index.html':'index.html','/core.js':'core.js','/sw.js':'sw.js','/manifest.webmanifest':'manifest.webmanifest','/icon.svg':'icon.svg','/icon-192.png':'icon-192.png','/icon-512.png':'icon-512.png'};
const json=(res,code,obj)=>{const b=JSON.stringify(obj);res.writeHead(code,{'Content-Type':'application/json; charset=utf-8','Cache-Control':'no-store'});res.end(b)};
const body=req=>new Promise((ok,no)=>{let d='';req.on('data',c=>{d+=c;if(d.length>2e5){no(new Error('grande'));req.destroy()}});req.on('end',()=>{try{ok(d?JSON.parse(d):{})}catch(e){no(e)}});req.on('error',no)});

function history(from,to){
 const out=[];let [y,m]=from.split('-').map(Number);const [y2,m2]=to.split('-').map(Number);
 for(;y<y2||(y===y2&&m<=m2);m++){if(m>12){m=1;y++}
  const f=path.join(HIST,`${y}-${pad(m)}.jsonl`);if(!fs.existsSync(f))continue;
  for(const l of fs.readFileSync(f,'utf8').split('\n')){if(!l)continue;try{const r=JSON.parse(l),d=ds(r.paidAt);if(d>=from&&d<=to)out.push(r)}catch(e){}}}
 return out;
}

const server=http.createServer(async(req,res)=>{
 try{
  const url=new URL(req.url,'http://x'),p=url.pathname;
  if(p.startsWith('/api/')){
   if(p==='/api/ping')return json(res,200,{resto:true,name:S.cfg.name});
   if(p==='/api/users')return json(res,200,{users:S.users.map(pub),dflt:S.users.some(u=>u.role==='admin'&&u.pin==='1234')});
   if(p==='/api/login'&&req.method==='POST'){
    const b=await body(req),k=req.socket.remoteAddress,f=fails.get(k)||{n:0,until:0};
    if(f.until>Date.now())return json(res,429,{err:'Demasiados intentos. Esperá un minuto.'});
    const u=S.users.find(x=>x.id===+b.id);
    if(!u||String(b.pin)!==String(u.pin)){f.n++;if(f.n>=5){f.n=0;f.until=Date.now()+60e3}fails.set(k,f);return json(res,401,{err:'PIN incorrecto'})}
    fails.delete(k);const token=crypto.randomBytes(24).toString('hex');sessions.set(token,{uid:u.id,exp:Date.now()+DAY});
    return json(res,200,{token,user:pub(u)});
   }
   const u=userOf(req);if(!u)return json(res,401,{err:'Sesión vencida'});
   if(p==='/api/logout'){const h=req.headers.authorization||'';sessions.delete(h.slice(7));return json(res,200,{})}
   if(p==='/api/state')return json(res,200,view(u));
   if(p==='/api/events'){res.writeHead(200,{'Content-Type':'text/event-stream','Cache-Control':'no-cache',Connection:'keep-alive'});res.write('retry: 2000\n\n');clients.add(res);req.on('close',()=>clients.delete(res));return}
   if(p==='/api/act'&&req.method==='POST'){
    const b=await body(req);const r=Core.apply(S,String(b.a),b.p,u);
    if(r.err)return json(res,400,{err:r.err});
    if(r.rc){const o=S.orders.find(x=>x.id===r.rc);if(o)archive(o);log(`Mesa ${o.table} cobrada: $${o.total} (${o.method}) por ${u.name}`)}
    prune();ver++;persist();broadcast();
    const v=view(u);return json(res,200,{result:r,state:v.state,now:v.now,v:v.v});
   }
   if(p==='/api/history'){
    if(u.role!=='admin')return json(res,403,{err:'Sin permiso'});
    const from=url.searchParams.get('from')||'',to=url.searchParams.get('to')||'',re=/^\d{4}-\d{2}-\d{2}$/;
    if(!re.test(from)||!re.test(to)||from>to)return json(res,400,{err:'Fechas inválidas'});
    if((new Date(to)-new Date(from))/864e5>400)return json(res,400,{err:'Máximo 400 días por consulta'});
    return json(res,200,{rows:history(from,to)});
   }
   return json(res,404,{err:'No existe'});
  }
  const f=FILES[p];
  if(!f||req.method!=='GET'){res.writeHead(404);return res.end('No encontrado')}
  const buf=fs.readFileSync(path.join(DIR,f));
  res.writeHead(200,{'Content-Type':TYPES[path.extname(f)]||'application/octet-stream','Cache-Control':'no-cache'});res.end(buf);
 }catch(e){log('Error:',e.message);try{json(res,500,{err:'Error del servidor'})}catch(_){}}
});
server.on('error',e=>{if(e.code==='EADDRINUSE')console.log(`\nEl puerto ${PORT} ya está en uso. ¿Ya hay un servidor Resto abierto? Cerralo o usá otro puerto (set PORT=3001).`);else console.log(e);process.exit(1)});
server.listen(PORT,'0.0.0.0',()=>{
 console.log('\n  RESTO: servidor iniciado\n');
 console.log('  En esta PC:      http://localhost:'+PORT);
 for(const [n,a] of Object.entries(os.networkInterfaces()))for(const i of a||[])if(i.family==='IPv4'&&!i.internal)console.log(`  Otros equipos:   http://${i.address}:${PORT}   (${n})`);
 console.log('\n  Datos en: '+DATA+'\n  Dejá esta ventana abierta mientras el local trabaja.\n');
});
