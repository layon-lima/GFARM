"""GFARM — painel WEB TEMPORÁRIO para backup do PC antigo (somente localhost).

Nunca altera banco/schema, uploads originais, Cloudflare ou versão do aplicativo.
O backend precisa estar parado durante a coleta; PostgreSQL fica ligado.
"""
from __future__ import annotations
import hashlib, json, os, secrets, shutil, socket, subprocess, sys, tempfile
import threading, time, webbrowser, zipfile
from datetime import datetime
from http.server import ThreadingHTTPServer, BaseHTTPRequestHandler
from pathlib import Path

PROJETO = Path(r"C:\Users\User\Documents\Layon\PROJETOS PYTHON\PROJETO")
GITHUB = "https://github.com/layon-lima/GFARM.git"
BACKUPS = Path.home() / "Documents" / "GFARM_BACKUP_TRANSFERENCIA"
PART_SIZE = 48 * 1024 * 1024
MAX_SIZE = 2 * 1024 * 1024 * 1024

def checksum(file):
    h=hashlib.sha256()
    with Path(file).open("rb") as f:
        for chunk in iter(lambda:f.read(4*1024*1024),b""): h.update(chunk)
    return h.hexdigest()

def command(argv, cwd=None, env=None, timeout=3600):
    try:
        p=subprocess.run([str(v) for v in argv],cwd=str(cwd) if cwd else None,
            env=env,text=True,encoding="utf-8",errors="replace",capture_output=True,
            timeout=timeout,creationflags=getattr(subprocess,"CREATE_NO_WINDOW",0))
    except (OSError,subprocess.TimeoutExpired) as e:
        raise RuntimeError(f"Erro ao executar {Path(str(argv[0])).name}: {e}") from e
    if p.returncode:
        raise RuntimeError(f"{Path(str(argv[0])).name}: {(p.stderr or p.stdout)[-1000:]}")
    return p.stdout.strip()

def port(port):
    try:
        with socket.create_connection(("127.0.0.1",port),timeout=.7): return True
    except OSError: return False

def dotenv(project):
    f=project/"backend"/".env"
    if not f.is_file(): raise RuntimeError("backend/.env ausente. Verifique a pasta original.")
    d={}
    for raw in f.read_text(encoding="utf-8-sig").splitlines():
        s=raw.strip()
        if not s or s.startswith("#"):continue
        if s.startswith("export "): s=s[7:]
        if "=" not in s: continue
        k,v=s.split("=",1);v=v.strip()
        if len(v)>1 and v[0]==v[-1] and v[0] in "'\"":v=v[1:-1]
        else:v=v.split(" #",1)[0].strip()
        d[k.strip()]=v
    for k in ("DB_NAME","DB_USER","DB_PASSWORD"):
        if not d.get(k):raise RuntimeError(f"{k} ausente no backend/.env.")
    if d.get("DB_HOST","127.0.0.1").lower() not in ("localhost","127.0.0.1","::1"):
        raise RuntimeError("Este painel opera somente com o PostgreSQL local.")
    return d

def pg_bin(name):
    candidates=[]
    for root in (os.environ.get("ProgramFiles"),r"C:\Program Files",os.environ.get("ProgramW6432")):
        if root:
            p=Path(root)/"PostgreSQL"
            if p.is_dir(): candidates.extend(p.glob(f"*/bin/{name}.exe"))
    local=shutil.which(name)
    if local:candidates.append(Path(local))
    candidates=[p for p in candidates if p.is_file()]
    if not candidates:raise RuntimeError(f"{name} não encontrado. Verifique PostgreSQL no Windows.")
    def version(x):
        try:return int(x.parent.parent.name)
        except ValueError:return 0
    return max(candidates,key=version)

def xml_dir(project,cfg):
    if cfg.get("ESTQ_XML_TICKET_DIR"):
        d=Path(cfg["ESTQ_XML_TICKET_DIR"]).expanduser()
        if not d.is_dir():raise RuntimeError("Pasta XML configurada não encontrada. Backup cancelado.")
        return d
    opts=[Path.home()/"Documents"/"XML ERP",
          Path.home()/"Documents"/"INDEX ERP DATA"/"xml-inbox",
          project/"xml_inbox"]
    live=[p for p in opts if p.is_dir() and any(p.glob("*.xml"))]
    if len(live)>1:raise RuntimeError("Mais de uma pasta com XML pendente; indique ESTQ_XML_TICKET_DIR no .env.")
    return (live or [next((p for p in opts if p.is_dir()),None)])[0]

def backup_full(project,notice):
    if not (project/"backend"/"run_production.py").is_file():
        raise RuntimeError("O diretório selecionado não contém backend/run_production.py.")
    if port(8000):raise RuntimeError("A API está ligada (porta 8000). Pare somente a API no painel antigo; mantenha PostgreSQL ligado.")
    cfg=dotenv(project)
    uploads=project/"backend"/"uploads"
    if not uploads.is_dir():raise RuntimeError("backend/uploads ausente. Operação cancelada para não perder anexos.")
    xml=xml_dir(project,cfg)
    BACKUPS.mkdir(parents=True,exist_ok=True)
    filename="GFARM_COMPLETO_"+datetime.now().strftime("%Y%m%d_%H%M%S_%f")+".zip"
    dest=BACKUPS/filename
    partial=BACKUPS/(filename+".parcial")
    meta={"criado_em":datetime.now().isoformat(),"banco":cfg["DB_NAME"],
          "formato_banco":"pg_dump custom","inclui_uploads":True,"inclui_xml_inbox":bool(xml),
          "arquivos_uploads":0,"arquivos_xml":0}
    notice("Gerando backup do PostgreSQL  (o banco continua ligado)...")
    with tempfile.TemporaryDirectory(prefix="gfarm-dump-") as tmp:
        dump=Path(tmp)/"database.dump"
        env=os.environ.copy();env["PGPASSWORD"]=cfg["DB_PASSWORD"]
        command([pg_bin("pg_dump"),"--no-password","--format=custom","--no-owner",
             "--no-privileges","--host",cfg.get("DB_HOST","127.0.0.1"),
             "--port",cfg.get("DB_PORT","5432"),"--username",cfg["DB_USER"],
             "--file",dump,cfg["DB_NAME"]],env=env)
        if not dump.is_file() or not dump.stat().st_size:
            raise RuntimeError("Dump PostgreSQL ficou vazio.")
        command([pg_bin("pg_restore"),"--list",dump],timeout=300)
        if port(8000):raise RuntimeError("API reiniciou durante o dump. Operação cancelada.")
        notice("Copiando fotos, documentos e XMLs...")
        try:
            with zipfile.ZipFile(partial,"w",compression=zipfile.ZIP_DEFLATED,compresslevel=5,allowZip64=True) as z:
                z.write(dump,"database.dump")
                for p in sorted(uploads.rglob("*")):
                    if p.is_file() and not p.is_symlink():
                        z.write(p,"uploads/"+p.relative_to(uploads).as_posix())
                        meta["arquivos_uploads"]+=1
                if xml:
                    for p in sorted(xml.glob("*.xml")):
                        if p.is_file() and not p.is_symlink():
                            z.write(p,"xml_inbox/"+p.name);meta["arquivos_xml"]+=1
                z.writestr("manifest.json",json.dumps(meta,ensure_ascii=False,indent=2))
            if port(8000):raise RuntimeError("API reiniciou durante a coleta de uploads. Backup cancelado.")
            notice("Validando ZIP e gerando SHA-256...")
            with zipfile.ZipFile(partial) as z:
                if z.testzip() is not None or not {"manifest.json","database.dump"}.issubset(z.namelist()):
                    raise RuntimeError("ZIP corrompido ou incompleto.")
            partial.replace(dest)
            Path(str(dest)+".sha256").write_text(checksum(dest)+"  "+dest.name+"\n",encoding="ascii")
        finally:
            partial.unlink(missing_ok=True)
    return dest,meta

def publish_backup(archive,notice):
    archive=Path(archive)
    sha=Path(str(archive)+".sha256")
    if not archive.is_file() or not sha.is_file() or sha.read_text(encoding="ascii").split()[0]!=checksum(archive):
        raise RuntimeError("Verificação SHA-256 do backup falhou.")
    if archive.stat().st_size>MAX_SIZE:raise RuntimeError("Backup maior que 2 GiB: não enviar ao Git sem armazenamento adequado.")
    git=shutil.which("git")
    if not git:raise RuntimeError("Git for Windows não encontrado. É necessário para o envio ao repositório privado.")
    notice("Conectando ao GitHub (pode abrir login no navegador)...")
    with tempfile.TemporaryDirectory(prefix="gfarm-repo-") as tmp:
        repo=Path(tmp)/"clone"
        command([git,"clone","--depth","1","--filter=blob:none","--sparse",
                 "--branch","main",GITHUB,repo],timeout=1800)
        command([git,"sparse-checkout","set","BACKUPS"],cwd=repo,timeout=600)
        relative="BACKUPS/"+archive.stem
        target=repo/relative
        if target.exists():raise RuntimeError("Já existe um backup com este nome no GitHub.")
        target.mkdir(parents=True)
        parts=[]
        notice("Dividindo o ZIP em partes de 48 MiB...")
        with archive.open("rb") as input_file:
            index=1
            while True:
                block=input_file.read(PART_SIZE)
                if not block:break
                name=archive.name+f".part{index:04d}"
                (target/name).write_bytes(block)
                parts.append({"arquivo":name,"bytes":len(block),"sha256":hashlib.sha256(block).hexdigest()})
                index+=1
        (target/"importacao.json").write_text(json.dumps({
            "formato":"GFARM-GITHUB-PARTES-v1","zip":archive.name,
            "bytes":archive.stat().st_size,"sha256":checksum(archive),"partes":parts
        },indent=2,ensure_ascii=False),encoding="utf-8")
        notice("Registrando backup em GFARM/BACKUPS...")
        command([git,"add","-f","--",relative],cwd=repo,timeout=300)
        command([git,"-c","user.name=GFARM Backup","-c","user.email=gfarm-backup@localhost",
            "commit","-m","backup: "+archive.stem],cwd=repo,timeout=600)
        notice("Enviando arquivos ao GitHub privado...")
        command([git,"push","origin","HEAD:main"],cwd=repo,timeout=3600)
        commit=command([git,"rev-parse","HEAD"],cwd=repo)
    return {"url":f"https://github.com/layon-lima/GFARM/tree/main/{relative}",
            "commit":commit[:12],"partes":len(parts)}

CSS="""<style>
*{box-sizing:border-box}body{background:#0c1016;color:#edf3f9;font-family:'Segoe UI',Arial,sans-serif;margin:0;padding:35px 18px}
main{max-width:1030px;margin:auto}header{display:flex;align-items:center;justify-content:space-between;gap:20px}
h1{font-size:24px;margin:0 0 6px}h2{font-size:16px;margin:0 0 18px}p{color:#9baab9;font-size:13px;line-height:1.6}
.grid{display:grid;grid-template-columns:repeat(3,1fr);gap:14px;margin:25px 0}
.card,.panel{background:#141a22;border:1px solid #303946;border-radius:19px;padding:20px}
.card{min-height:150px}.label{color:#99a8b8;font-weight:700;font-size:11px;letter-spacing:1.2px}
.value{font-size:18px;font-weight:700;margin:14px 0 10px}.small{font-size:11px;overflow-wrap:anywhere}
.tag{border:1px solid #3b4856;padding:5px 9px;border-radius:20px;font-size:11px;float:right}
.ok{background:#102a20;border-color:#1b6b43;color:#8af3b7}.err{background:#361c1d;border-color:#914041;color:#ffb5b5}
.warn{background:#3a2a10;border-color:#906019;color:#f9d088}.actions{display:flex;gap:12px;margin:22px 0}
button{border:0;border-radius:12px;color:#fff;padding:15px;flex:1;font-weight:700;background:#216740;cursor:pointer}
button.blue{background:#23468e}button.secondary{background:#26313d}button:disabled{opacity:.35;cursor:not-allowed}
.notice{background:#322511;border:1px solid #7a561a;color:#f5cf8b;border-radius:12px;padding:15px;font-size:13px}
.step{margin:16px 0;font-size:14px}.step p{margin:6px 0 0 22px}
.status{padding:17px;background:#0e141c;border-radius:12px;font-size:14px;overflow-wrap:anywhere}
a{color:#98bfff}a:not([href]){display:none}.error{color:#ffaaaa;white-space:pre-wrap;overflow-wrap:anywhere}
pre{white-space:pre-wrap;word-break:break-all;font-size:11px;color:#9baab9}
@media(max-width:740px){.grid{grid-template-columns:1fr}.actions{flex-direction:column}header{display:block}}
</style>"""

HTML="""<!doctype html><html lang="pt-BR"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>GFARM Backup de transferência</title>"""+CSS+"""</head><body><main><header><div>
<h1>GFARM • Backup de transferência</h1><p>Ferramenta temporária para a instalação atual do estoque.</p></div>
<div>● <span id="time">Conectando...</span></div></header>
<div class="grid">
<div class="card"><div class="label">INSTALAÇÃO ATUAL</div><div class="value">GFARM <span class="tag" id="p">...</span></div><p class="small" id="path"></p></div>
<div class="card"><div class="label">BANCO DE DADOS</div><div class="value">PostgreSQL <span class="tag" id="db">...</span></div><p>A porta 5432 deve estar respondendo.</p></div>
<div class="card"><div class="label">APLICAÇÃO</div><div class="value">Backend / API <span class="tag" id="api">...</span></div><p>A API deve estar parada durante o backup.</p></div>
</div>
<section class="panel"><h2>Backup completo para GFARM / BACKUPS</h2>
<div class="notice">⚠ Antes de começar: no painel antigo clique em <b>Parar API</b>, não em “Desligar tudo”.
Deixe o PostgreSQL ligado e não utilize o estoque até a coleta terminar.</div>
<div class="step"><b>1 — Gerar backup completo</b><p>PostgreSQL, fotos, documentos, XMLs e verificação SHA-256. ZIP salvo fora da pasta antiga.</p></div>
<div class="step"><b>2 — Enviar ao GitHub privado</b><p>As partes vão para BACKUPS com manifesto de importação. Login do Git pode abrir no navegador.</p></div>
<div class="step"><b>3 — Conferir o backup</b><p>Não exclua a pasta antiga antes de validar a restauração em outro computador.</p></div>
<div class="actions"><button id="backup">⬇ Gerar backup completo</button><button class="blue" id="upload" disabled>↥ Enviar ao GitHub</button></div>
<p id="local"></p><a id="github" target="_blank" rel="noopener">Abrir backup no GitHub ↗</a></section>
<section class="panel"><h2>Andamento</h2><div class="status" id="status">Pronto.</div><div class="error" id="error"></div>
<div class="actions"><button class="secondary" id="folder">📁 Abrir pasta de backup</button></div><pre id="folderpath"></pre></section>
<p>Backup sem criptografia, conforme solicitado. Acesso apenas neste computador. Este painel não atualiza nem altera o ERP.</p>
</main><script>
const tok='@@TOKEN@@';let data=null;
function setTag(id,txt,kind){let e=document.getElementById(id);e.textContent=txt;e.className='tag '+kind;}
async function poll(){try{let r=await fetch('/status',{cache:'no-store'}),s=await r.json();data=s;
setTag('p',s.project_valid?'OK':'NÃO ENCONTRADO',s.project_valid?'ok':'err');
setTag('db',s.db_online?'LIGADO':'DESLIGADO',s.db_online?'ok':'err');
setTag('api',s.api_online?'LIGADA':'PARADA',s.api_online?'warn':'ok');
document.getElementById('path').textContent=s.project;
document.getElementById('time').textContent=new Date().toLocaleTimeString('pt-BR');
document.getElementById('status').textContent=s.status+(s.busy?' (aguarde...)':'');
document.getElementById('error').textContent=s.error;
document.getElementById('folderpath').textContent=s.dir;
document.getElementById('backup').disabled=s.busy||s.api_online||!s.db_online||!s.project_valid;
document.getElementById('upload').disabled=s.busy||!s.zip;
document.getElementById('local').textContent=s.zip?'Backup local: '+s.zip+' ('+(s.bytes/1048576).toFixed(1)+' MB)':'';
if(s.github){document.getElementById('github').href=s.github.url;
document.getElementById('github').textContent='Abrir '+s.github.partes+' partes no GitHub ↗';}
}catch(e){document.getElementById('time').textContent='Conexão perdida';}}
async function act(which){
let r=await fetch('/'+which,{method:'POST',headers:{'X-GFARM-Token':tok}});
let j=await r.json();if(!r.ok)alert(j.error||'Falha');poll();}
document.getElementById('backup').onclick=()=>{
if(confirm('Confirma: API parada, PostgreSQL ligado e ninguém usando o estoque?'))act('backup');};
document.getElementById('upload').onclick=()=>{
if(confirm('Enviar backup COMPLETO e SEM CRIPTOGRAFIA ao GitHub privado GFARM/BACKUPS?'))act('upload');};
document.getElementById('folder').onclick=()=>act('folder');
poll();setInterval(poll,1500);
</script></body></html>"""

class State:
    def __init__(self,project):
        self.project=project;self.lock=threading.Lock();self.busy=False
        self.status="Pronto para backup.";self.error="";self.zip=None;self.github=None
    def info(self):
        with self.lock:
            return {"project":str(self.project),
                "project_valid":(self.project/"backend"/".env").is_file() and (self.project/"backend"/"run_production.py").is_file(),
                "api_online":port(8000),"db_online":port(5432),"busy":self.busy,
                "status":self.status,"error":self.error,"zip":self.zip.name if self.zip else None,
                "bytes":self.zip.stat().st_size if self.zip and self.zip.is_file() else 0,
                "github":self.github,"dir":str(BACKUPS)}
    def notice(self,value):
        with self.lock:self.status=value
    def start(self,action):
        with self.lock:
            if self.busy:raise RuntimeError("Outra operação está em andamento.")
            if action=="upload" and not self.zip:raise RuntimeError("Gere o backup primeiro.")
            self.busy=True;self.error="";self.status="Iniciando..."
        def worker():
            try:
                if action=="backup":
                    dest,_=backup_full(self.project,self.notice)
                    with self.lock:self.zip=dest;self.github=None;self.status="Backup completo validado no PC. Pronto para envio."
                else:
                    result=publish_backup(self.zip,self.notice)
                    with self.lock:self.github=result;self.status="Upload concluído. Confirme o backup no GitHub."
            except Exception as e:
                with self.lock:self.error=str(e);self.status="Falha. Dados originais não foram alterados."
            finally:
                with self.lock:self.busy=False
        threading.Thread(target=worker,daemon=True).start()

class Panel(BaseHTTPRequestHandler):
    state=None;token=None;origin=None
    def check(self):
        if self.headers.get("Host")!=self.origin.removeprefix("http://"):
            self.send_error(403);return False
        orig=self.headers.get("Origin")
        if orig and orig!=self.origin:self.send_error(403);return False
        return True
    def send_data(self,obj,code=200):
        raw=json.dumps(obj,ensure_ascii=False).encode()
        self.send_response(code);self.send_header("Content-Type","application/json; charset=utf-8")
        self.send_header("Cache-Control","no-store")
        self.send_header("Content-Length",str(len(raw)));self.end_headers();self.wfile.write(raw)
    def do_GET(self):
        if not self.check():return
        if self.path=="/":
            raw=HTML.replace("@@TOKEN@@",self.token).encode("utf-8")
            self.send_response(200);self.send_header("Content-Type","text/html; charset=utf-8")
            self.send_header("Content-Security-Policy","default-src 'self'; script-src 'self' 'unsafe-inline'; style-src 'self' 'unsafe-inline'; frame-ancestors 'none'")
            self.send_header("Cache-Control","no-store");self.send_header("Content-Length",str(len(raw)))
            self.end_headers();self.wfile.write(raw)
        elif self.path=="/status":self.send_data(self.state.info())
        else:self.send_error(404)
    def do_POST(self):
        if not self.check():return
        if self.headers.get("X-GFARM-Token")!=self.token:
            self.send_data({"error":"Não autorizado"},403);return
        try:
            if self.path=="/folder":
                BACKUPS.mkdir(parents=True,exist_ok=True)
                if os.name=="nt":os.startfile(str(BACKUPS))
            elif self.path in ("/backup","/upload"):self.state.start(self.path[1:])
            else:self.send_data({"error":"Comando inválido"},404);return
            self.send_data({"ok":True})
        except (RuntimeError,OSError) as e:self.send_data({"error":str(e)},409)
    def log_message(self,*args):pass

def main():
    project=Path(sys.argv[1]).resolve() if len(sys.argv)>1 else PROJETO
    with ThreadingHTTPServer(("127.0.0.1",0),Panel) as server:
        Panel.state=State(project);Panel.token=secrets.token_urlsafe(32)
        Panel.origin="http://127.0.0.1:"+str(server.server_address[1])
        threading.Timer(1,lambda:webbrowser.open(Panel.origin+"/")).start()
        print("GFARM Backup Web: "+Panel.origin,flush=True)
        server.serve_forever()

if __name__=="__main__":main()
