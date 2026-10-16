"""Operacoes locais do GFARM Control. Nao remove nem recria bancos existentes."""
from __future__ import annotations

import hashlib
import tempfile
import json
import os
import shutil
import socket
import subprocess
import sys
import tempfile
import threading
import time
import urllib.request
import zipfile
from datetime import datetime
from pathlib import Path

ROOT = Path(os.environ.get("GFARM_HOME") or
            (Path(os.environ.get("PROGRAMDATA", str(Path.home()))) / "GFARM"))
DATA = ROOT / "data"
APP = ROOT / "installed" / "GFARM APP"
RELEASES = ROOT / "releases"
BACKUPS = ROOT / "backups"
CONFIG = ROOT / "control.json"
LOG = ROOT / "control.log"
REPO = "git@github.com:layon-lima/GFARM.git"
LOCK = threading.RLock()
PROCESS = None
LAST_START = 0.0
CONTROL_UPGRADE_PENDING = False
CONTROL_VERSION_FILE = ROOT / "control-version.json"


def write_log(message):
    ROOT.mkdir(parents=True, exist_ok=True)
    with LOG.open("a", encoding="utf-8") as out:
        out.write(datetime.now().isoformat(timespec="seconds") + " | " + str(message) + "\n")


def load():
    if not CONFIG.is_file():
        return {"app_path": str(APP), "version": "pacote-inicial",
                "automatic": True, "desired_running": False, "remote_host": "127.0.0.1"}
    return json.loads(CONFIG.read_text(encoding="utf-8"))


def save(data):
    ROOT.mkdir(parents=True, exist_ok=True)
    target = CONFIG.with_suffix(".json.tmp")
    target.write_text(json.dumps(data, indent=2, ensure_ascii=False), encoding="utf-8")
    os.replace(target, CONFIG)


def project():
    return Path(load()["app_path"])


def env_values():
    path = DATA / "backend.env"
    result = {}
    if path.is_file():
        for line in path.read_text(encoding="utf-8-sig").splitlines():
            if "=" in line and not line.lstrip().startswith("#"):
                key, value = line.split("=", 1)
                raw = value.strip()
                if raw.startswith('"') and raw.endswith('"'):
                    try:
                        result[key.strip()] = json.loads(raw)
                    except ValueError:
                        result[key.strip()] = raw[1:-1]
                elif raw.startswith("'") and raw.endswith("'"):
                    result[key.strip()] = raw[1:-1]
                else:
                    result[key.strip()] = raw
    return result

def backend_port():
    return int(env_values().get("APP_PORT", "8000"))


def running_health():
    try:
        with urllib.request.urlopen(
            "http://127.0.0.1:%d/api/health" % backend_port(), timeout=2
        ) as r:
            return r.status == 200 and json.load(r).get("status") == "online"
    except (OSError, ValueError, TimeoutError):
        return False


def port_busy(port):
    try:
        with socket.create_connection(("127.0.0.1", port), timeout=0.4):
            return True
    except OSError:
        return False


def owned():
    return PROCESS is not None and PROCESS.poll() is None


def executable(root):
    candidates = [
        root / "backend" / ".venv" / "Scripts" / "python.exe",
        root / ".venv" / "Scripts" / "python.exe",
        root / "backend" / ".venv" / "bin" / "python",
    ]
    for item in candidates:
        if item.is_file():
            return item
    raise RuntimeError("Python do GFARM nao instalado. Execute o reparo no instalador.")


def _program_paths():
    """Caminhos instalados no Windows mesmo quando o Control roda como SYSTEM.

    O Agendador nao herda o PATH atualizado da sessao interativa do Windows.
    Preferir binarios existentes conhecidos, sem alterar o PATH do computador.
    """
    paths = []
    if os.name != "nt":
        return paths
    for variable in ("ProgramFiles", "ProgramW6432", "ProgramFiles(x86)"):
        base = os.environ.get(variable)
        if base:
            parent = Path(base)
            paths.extend((parent / "Git" / "cmd",
                          parent / "Git" / "bin",
                          parent / "Git" / "usr" / "bin",
                          parent / "nodejs",
                          parent / "Python313",
                          parent / "Python314"))
    root = os.environ.get("SystemRoot", "C:/Windows")
    paths.extend((Path(root) / "System32",
                  Path(root) / "System32" / "OpenSSH"))
    # Git e Node instalados pelo winget para o administrador podem ficar em
    # seu perfil em vez de Program Files; detectar somente caminhos conhecidos.
    public = os.environ.get("PUBLIC")
    if public:
        users = Path(public).parent
        if users.is_dir():
            for profile in users.iterdir():
                if profile.is_dir() and profile.name.lower() not in (
                        "public", "default", "default user", "all users"):
                    local = profile / "AppData" / "Local"
                    paths.extend((
                        local / "Programs" / "Git" / "cmd",
                        local / "Programs" / "Git" / "bin",
                        local / "Programs" / "nodejs",
                        local / "Programs" / "Python" / "Python313",
                        local / "Programs" / "Python" / "Python314",
                    ))
    return [str(path) for path in paths if path.is_dir()]


def resolve_program(program):
    """Localiza comando sem depender do PATH da tarefa agendada do Windows."""
    command = str(program)
    if Path(command).is_file():
        return command
    # Comandos qualificados devem falhar de forma explicita.
    if Path(command).is_absolute() or "/" in command or "\\" in command:
        raise RuntimeError("Programa nao encontrado: " + command)
    if command.lower() == "python":
        try:
            return str(executable(project()))
        except (RuntimeError, OSError, KeyError):
            pass
    locations = _program_paths()
    found = shutil.which(command, path=os.pathsep.join(
        [os.environ.get("PATH", ""), *locations]))
    if found:
        return found
    raise RuntimeError(
        "Dependencia do GFARM Control nao encontrada no Windows: " + command
        + ". Confirme a instalacao do programa (Git, Node.js ou Python)."
    )


def run(args, *, cwd=None, timeout=1800, env=None):
    cmd = [str(a) for a in args]
    if not cmd:
        raise RuntimeError("Comando vazio.")
    cmd[0] = resolve_program(cmd[0])
    options = os.environ.copy()
    options["GIT_TERMINAL_PROMPT"] = "0"
    options["PATH"] = os.pathsep.join([
        options.get("PATH", ""), *_program_paths()
    ])
    if env:
        options.update(env)
    try:
        p = subprocess.run(cmd, cwd=str(cwd) if cwd else None,
                           env=options, text=True, encoding="utf-8", errors="replace",
                           capture_output=True, timeout=timeout,
                           creationflags=getattr(subprocess, "CREATE_NO_WINDOW", 0))
    except OSError as exc:
        raise RuntimeError(
            "Nao foi possivel iniciar " + str(args[0]) + ": " + str(exc)
        ) from exc
    if p.returncode:
        raise RuntimeError("%s falhou: %s" %
                           (Path(str(args[0])).name, (p.stderr or p.stdout)[-1200:]))
    return p.stdout.strip()


def ensure_configured():
    p = project()
    if not (DATA / "backend.env").is_file():
        raise RuntimeError("Conexao PostgreSQL ainda nao configurada.")
    if not (p / "backend" / "run_production.py").is_file():
        raise RuntimeError("GFARM nao instalado corretamente.")
    if not (p / "dist" / "index.html").is_file():
        raise RuntimeError("Interface GFARM ausente. Conclua instalacao/reparo.")
    return p


def start():
    global PROCESS, LAST_START
    with LOCK:
        p = ensure_configured()
        cfg = load()
        cfg["desired_running"] = True
        save(cfg)
        if owned():
            return "Servidor ja esta iniciado pelo Control."
        if port_busy(backend_port()):
            raise RuntimeError("Porta do GFARM ja ocupada. Nao iniciaremos outra API.")
        py = executable(p)
        log = ROOT / "backend.log"
        out = log.open("ab")
        try:
            PROCESS = subprocess.Popen(
                [str(py), str(p / "backend" / "run_production.py")],
                cwd=str(p / "backend"), stdin=subprocess.DEVNULL,
                stdout=out, stderr=subprocess.STDOUT,
                creationflags=getattr(subprocess, "CREATE_NO_WINDOW", 0),
                close_fds=True)
        finally:
            out.close()
        LAST_START = time.monotonic()
        write_log("Iniciando GFARM, PID %d" % PROCESS.pid)
    for _ in range(50):
        if running_health():
            return "GFARM iniciado e validado."
        if PROCESS.poll() is not None:
            raise RuntimeError("Backend encerrou; confira control.log/backend.log.")
        time.sleep(1)
    raise RuntimeError("GFARM nao respondeu em 50 segundos; confira o log.")


def stop(temporary=False):
    global PROCESS
    with LOCK:
        if not temporary:
            cfg = load()
            cfg["desired_running"] = False
            save(cfg)
        if not owned():
            if port_busy(backend_port()):
                raise RuntimeError("API pertence a outro processo. Control nao vai encerra-lo.")
            return "GFARM ja esta parado."
        PROCESS.terminate()
        try:
            PROCESS.wait(timeout=25)
        except subprocess.TimeoutExpired:
            # Nunca mata processos nao identificados; so o filho iniciado por nos.
            PROCESS.kill()
            PROCESS.wait(timeout=10)
        PROCESS = None
        write_log("GFARM parado pelo Control.")
        return "GFARM desligado."


def restart():
    stop(temporary=True)
    return start()


def pg_binary(name):
    found = shutil.which(name)
    if found:
        return found
    base = Path(os.environ.get("ProgramFiles", "C:/Program Files")) / "PostgreSQL"
    candidates = list(base.glob("*/bin/%s.exe" % name)) if base.is_dir() else []
    candidates.sort(key=lambda p: int(p.parent.parent.name)
                    if p.parent.parent.name.isdigit() else 0, reverse=True)
    if candidates:
        return str(candidates[0])
    raise RuntimeError(name + " nao encontrado; PostgreSQL deve permanecer instalado.")


def db_args():
    e = env_values()
    needed = ("DB_HOST", "DB_PORT", "DB_NAME", "DB_USER", "DB_PASSWORD")
    if not all(e.get(k) for k in needed):
        raise RuntimeError("Dados PostgreSQL incompletos na configuracao.")
    return e, ["-h", e["DB_HOST"], "-p", e["DB_PORT"], "-U", e["DB_USER"]]


def validate_archive(path):
    with zipfile.ZipFile(path) as z:
        names = z.namelist()
        if len(names) != len(set(names)) or not {"database.dump", "manifest.json"}.issubset(names):
            raise RuntimeError("Backup incompleto ou entradas duplicadas.")
        for item in names:
            if item.startswith("/") or "\\" in item or ".." in item.split("/"):
                raise RuntimeError("Caminho inseguro no backup.")
            if item not in ("database.dump", "manifest.json") and not item.startswith(("uploads/", "xml_inbox/")):
                raise RuntimeError("Entrada inesperada no backup.")
        if z.testzip() is not None:
            raise RuntimeError("CRC do ZIP invalido.")
        m = json.loads(z.read("manifest.json"))
        if m.get("formato_banco") != "pg_dump custom":
            raise RuntimeError("Formato de banco nao reconhecido.")
        with z.open("database.dump") as backup_dump:
            dump_header = backup_dump.read(5)
        if dump_header != b"PGDMP":
            raise RuntimeError("Dump PostgreSQL invalido.")
        return {"uploads": sum(n.startswith("uploads/") and not n.endswith("/") for n in names),
                "xmls": sum(n.startswith("xml_inbox/") and not n.endswith("/") for n in names)}


def create_backup():
    with LOCK:
        # A API pode continuar ativa ate aqui; bloqueio de escrita e prioridade.
        # Para manter banco e anexos coerentes, paramos a API CONTROLADA.
        was_running = owned()
        if port_busy(backend_port()) and not was_running:
            raise RuntimeError("API nao controlada detectada; pare-a antes do backup.")
        if was_running:
            stop(temporary=True)
        try:
            e, args = db_args()
            BACKUPS.mkdir(parents=True, exist_ok=True)
            timestamp = datetime.now().strftime("%Y%m%d_%H%M%S")
            dest = BACKUPS / ("GFARM_COMPLETO_%s.zip" % timestamp)
            if dest.exists():
                raise RuntimeError("Ja existe um backup com este nome.")
            with tempfile.TemporaryDirectory(dir=str(ROOT)) as tmp:
                dump = Path(tmp) / "database.dump"
                env = {"PGPASSWORD": e["DB_PASSWORD"]}
                run([pg_binary("pg_dump"), *args, "-Fc", "-f", str(dump), e["DB_NAME"]],
                    timeout=3600, env=env)
                run([pg_binary("pg_restore"), "--list", str(dump)], timeout=120)
                uploads = project() / "backend" / "uploads"
                inbox = Path(e.get("ESTQ_XML_TICKET_DIR") or (DATA / "xml-inbox"))
                meta = {"formato_banco": "pg_dump custom", "gerado_em": timestamp,
                        "inclui_uploads": uploads.is_dir(), "inclui_xml_inbox": inbox.is_dir(),
                        "db_name": e["DB_NAME"]}
                partial = dest.with_suffix(".zip.partial")
                try:
                    with zipfile.ZipFile(partial, "w", zipfile.ZIP_DEFLATED, compresslevel=5) as z:
                        z.write(dump, "database.dump")
                        for folder, prefix in ((uploads, "uploads"), (inbox, "xml_inbox")):
                            if folder.is_dir():
                                for item in folder.rglob("*"):
                                    if item.is_file() and not item.is_symlink():
                                        z.write(item, prefix + "/" + item.relative_to(folder).as_posix())
                        z.writestr("manifest.json", json.dumps(meta, ensure_ascii=False))
                    details = validate_archive(partial)
                    os.replace(partial, dest)
                finally:
                    partial.unlink(missing_ok=True)
            digest = hashlib.sha256()
            with dest.open("rb") as inp:
                for block in iter(lambda: inp.read(4 * 1024 * 1024), b""):
                    digest.update(block)
            dest.with_suffix(".zip.sha256").write_text(
                digest.hexdigest() + "  " + dest.name + "\n", encoding="ascii")
            write_log("Backup validado: %s (%s)" % (dest.name, details))
            return {"arquivo": dest.name, "bytes": dest.stat().st_size, **details}
        finally:
            if was_running:
                try:
                    start()
                except Exception as ex:
                    write_log("ALERTA: backup terminou mas GFARM nao reiniciou: %s" % ex)
                    raise


def list_backups():
    BACKUPS.mkdir(parents=True, exist_ok=True)
    return [{"nome": p.name, "bytes": p.stat().st_size,
             "modificado": datetime.fromtimestamp(p.stat().st_mtime).isoformat()}
            for p in sorted(BACKUPS.glob("GFARM_COMPLETO_*.zip"),
                            key=lambda v: v.stat().st_mtime, reverse=True)]


def verify_backup(name):
    if Path(name).name != name or not name.startswith("GFARM_COMPLETO_") or not name.endswith(".zip"):
        raise RuntimeError("Nome de backup invalido.")
    file = BACKUPS / name
    if not file.is_file():
        raise RuntimeError("Backup nao encontrado.")
    shafile = file.with_suffix(".zip.sha256")
    if shafile.is_file():
        expected = shafile.read_text(encoding="ascii").split()[0]
        sha = hashlib.sha256()
        with file.open("rb") as fp:
            for block in iter(lambda: fp.read(4 * 1024 * 1024), b""):
                sha.update(block)
        if sha.hexdigest() != expected:
            raise RuntimeError("SHA-256 nao corresponde ao backup.")
    info = validate_archive(file)
    with tempfile.TemporaryDirectory(dir=str(ROOT)) as tmp:
        with zipfile.ZipFile(file) as z, z.open("database.dump") as src:
            dump = Path(tmp) / "database.dump"
            with dump.open("wb") as output:
                shutil.copyfileobj(src, output)
        run([pg_binary("pg_restore"), "--list", str(dump)], timeout=120)
    return {"valido": True, **info}




# Recepcao em blocos do arquivo ZIP escolhido pelo navegador.
# O backup nao e carregado inteiro em RAM nem toca no PostgreSQL.
MAX_BROWSER_BACKUP = 2 * 1024 ** 3


def receive_browser_backup(stream, length):
    """Salva temporariamente e valida um backup enviado pelo navegador."""
    if not isinstance(length, int) or not 0 < length <= MAX_BROWSER_BACKUP:
        raise RuntimeError("Backup ZIP deve ter entre 1 byte e 2 GB.")
    if owned() or port_busy(backend_port()):
        raise RuntimeError("Desligue o GFARM na aba Servidor antes de recuperar fotos.")
    incoming = ROOT / "incoming"
    incoming.mkdir(parents=True, exist_ok=True)
    staged = None
    try:
        with tempfile.NamedTemporaryFile(prefix="gfarm-assets-", suffix=".zip",
                                         dir=str(incoming), delete=False) as output:
            staged = Path(output.name)
            remaining = length
            while remaining:
                block = stream.read(min(1024 * 1024, remaining))
                if not block:
                    raise RuntimeError("Envio do arquivo ZIP incompleto.")
                output.write(block)
                remaining -= len(block)

        # Checar expansao potencial do ZIP antes da verificacao completa do CRC.
        with zipfile.ZipFile(staged) as archive:
            files = [i for i in archive.infolist()
                     if not i.is_dir() and
                     i.filename.startswith(("uploads/", "xml_inbox/"))]
            if (len(files) > 100000 or
                    sum(i.file_size for i in files) > 8 * 1024 ** 3 or
                    any(i.file_size > 2 * 1024 ** 3 for i in files)):
                raise RuntimeError("Backup excede limite seguro de arquivos.")
        validate_archive(staged)
        write_log("Backup recebido e validado pelo seletor de arquivos do navegador.")
        return staged
    except Exception:
        if staged is not None:
            staged.unlink(missing_ok=True)
        raise


def import_assets_only(zip_path):
    """Recupera uploads e XMLs sem tocar em qualquer tabela PostgreSQL.

    Usar apos reinstalacao conectada ao mesmo banco existente. Nao substitui
    um anexo atual; recusa caminhos suspeitos e ZIPs sem o dump esperado.
    """
    with LOCK:
        if owned() or port_busy(backend_port()):
            raise RuntimeError("Desligue a API GFARM para importar anexos com seguranca.")
        selected = Path(str(zip_path)).expanduser().resolve(strict=True)
        if selected.suffix.lower() != ".zip" or not selected.is_file():
            raise RuntimeError("Selecione o ZIP completo do backup GFARM.")
        details = validate_archive(selected)
        destinations = {
            "uploads/": DATA / "uploads",
            "xml_inbox/": Path(env_values().get("ESTQ_XML_TICKET_DIR") or
                               (DATA / "xml-inbox")),
        }
        all_items = []
        with zipfile.ZipFile(selected) as archive:
            for info in archive.infolist():
                if info.is_dir():
                    continue
                for prefix, root in destinations.items():
                    if info.filename.startswith(prefix):
                        relative = info.filename[len(prefix):]
                        target = root.joinpath(*relative.split("/"))
                        if not relative or any(p in ("", ".", "..") for p in relative.split("/")):
                            raise RuntimeError("Caminho invalido no pacote.")
                        if target.is_symlink():
                            raise RuntimeError("Anexo aponta para link simbolico; operacao bloqueada.")
                        if info.file_size > 2 * 1024 ** 3:
                            raise RuntimeError("Anexo grande demais no pacote.")
                        all_items.append((info, root, target))
                        break
            total = sum(item.file_size for item, _, _ in all_items)
            if total > 8 * 1024 ** 3 or len(all_items) > 100000:
                raise RuntimeError("Backup excede limites de seguranca para anexos.")
            # Conferir conflitos ANTES de escrever qualquer arquivo.
            for info, root, target in all_items:
                if target.exists():
                    if not target.is_file() or target.stat().st_size != info.file_size:
                        raise RuntimeError("Arquivo ja existe e difere: " + str(target))
                    digest_zip = hashlib.sha256()
                    with archive.open(info) as inp:
                        for chunk in iter(lambda: inp.read(1024 * 1024), b""):
                            digest_zip.update(chunk)
                    digest_local = hashlib.sha256()
                    with target.open("rb") as inp:
                        for chunk in iter(lambda: inp.read(1024 * 1024), b""):
                            digest_local.update(chunk)
                    if digest_zip.digest() != digest_local.digest():
                        raise RuntimeError("Arquivo ja existe com conteudo diferente: " + str(target))
            imported = 0
            for info, root, target in all_items:
                if target.exists():
                    continue
                # Nao seguir links simbolicos em caminhos intermediarios.
                if any(node.is_symlink() for node in [root, *target.parents]
                       if node != target):
                    raise RuntimeError("Destino contem link simbolico: " + str(target))
                target.parent.mkdir(parents=True, exist_ok=True)
                try:
                    with archive.open(info) as inp, target.open("xb") as out:
                        shutil.copyfileobj(inp, out)
                    imported += 1
                except Exception:
                    target.unlink(missing_ok=True)
                    raise
        write_log("Anexos recuperados de %s: %d novos; %d uploads; %d XMLs. Banco intocado." %
                  (selected.name, imported, details["uploads"], details["xmls"]))
        return {"importados": imported, **details, "banco_alterado": False}


def restore_empty(name, confirmation):
    # NUNCA restaura sobre banco real preenchido.
    if confirmation != "RESTAURAR EM BANCO VAZIO":
        raise RuntimeError("Confirme o texto exato de restauracao.")
    e, args = db_args()
    if port_busy(backend_port()):
        raise RuntimeError("Pare o GFARM antes da restauracao.")
    info = verify_backup(name)
    query = ("SELECT COUNT(*) FROM information_schema.tables "
             "WHERE table_schema NOT IN ('pg_catalog','information_schema')")
    env = {"PGPASSWORD": e["DB_PASSWORD"]}
    out = run([pg_binary("psql"), *args, "-d", e["DB_NAME"], "-AtX",
               "-v", "ON_ERROR_STOP=1", "-c", query], env=env)
    if out.strip() != "0":
        raise RuntimeError("Banco possui tabelas: restauracao bloqueada.")
    uploads = project() / "backend" / "uploads"
    inbox = Path(e.get("ESTQ_XML_TICKET_DIR") or (DATA / "xml-inbox"))
    for folder in (uploads, inbox):
        if folder.exists() and any(folder.iterdir()):
            raise RuntimeError("Arquivos de destino nao estao vazios: %s" % folder)
    file = BACKUPS / name
    with tempfile.TemporaryDirectory(dir=str(ROOT)) as tmp:
        with zipfile.ZipFile(file) as z:
            d = Path(tmp) / "database.dump"
            with z.open("database.dump") as src, d.open("wb") as dest:
                shutil.copyfileobj(src, dest)
            # O dump e aplicado numa unica transacao; nenhum drop/cascade.
            run([pg_binary("pg_restore"), *args, "-d", e["DB_NAME"],
                 "--exit-on-error", "--single-transaction", "--no-owner", "--no-privileges",
                 str(d)], env=env, timeout=3600)
            for member in z.infolist():
                if member.is_dir():
                    continue
                if member.filename.startswith("uploads/"):
                    root = uploads
                    part = member.filename[len("uploads/"):]
                elif member.filename.startswith("xml_inbox/"):
                    root = inbox
                    part = member.filename[len("xml_inbox/"):]
                else:
                    continue
                target = root / part
                target.parent.mkdir(parents=True, exist_ok=True)
                with z.open(member) as inp, target.open("xb") as out:
                    shutil.copyfileobj(inp, out)
    write_log("Restauracao no banco vazio concluida: " + name)
    return {"restaurado": True, **info}


def ssh_environment():
    key = ROOT / "secrets" / "github_deploy"
    if not key.is_file():
        raise RuntimeError("Chave de leitura GitHub nao configurada. Autorize a deploy key do Control.")
    # Chave somente leitura. Nao e enviada ao GitHub em logs nem na linha de comando.
    ssh = resolve_program("ssh")
    env = {"GIT_SSH_COMMAND": '"%s" -i "%s" -o IdentitiesOnly=yes -o BatchMode=yes -o StrictHostKeyChecking=accept-new' % (ssh, key)}
    return env


def public_key():
    key = ROOT / "secrets" / "github_deploy"
    if not key.with_suffix(".pub").is_file():
        key.parent.mkdir(parents=True, exist_ok=True)
        run(["ssh-keygen", "-t", "ed25519", "-f", str(key), "-N", "",
             "-C", "GFARM-Control-readonly"], timeout=60)
    return key.with_suffix(".pub").read_text(encoding="utf-8").strip()


def link_uploads(folder):
    data_uploads = DATA / "uploads"
    data_uploads.mkdir(parents=True, exist_ok=True)
    dest = folder / "backend" / "uploads"
    if dest.exists() and not dest.is_symlink():
        if any(dest.iterdir()):
            raise RuntimeError("Novo release contem uploads nao vazios.")
        dest.rmdir()
    if os.name == "nt":
        run(["cmd", "/c", "mklink", "/J", str(dest), str(data_uploads)], timeout=20)
    else:
        dest.symlink_to(data_uploads, target_is_directory=True)




# O bootstrap GFARM-Control.exe fica estavel apos instalacao.
# O painel web (Python, JS e HTML) e atualizado como parte do codigo do app.
CONTROL_SOURCES = ("server.py", "engine.py", "app.js", "ui.html", "control_reload.py")


def control_fingerprint(folder):
    source = Path(folder) / "ops" / "gfarm_control"
    digest = hashlib.sha256()
    for name in CONTROL_SOURCES:
        file = source / name
        if not file.is_file():
            raise RuntimeError("Codigo do GFARM Control incompleto: " + name)
        digest.update(name.encode("utf-8") + b"\x00")
        digest.update(file.read_bytes())
    return digest.hexdigest()


def control_web_changed(before, after):
    try:
        return control_fingerprint(before) != control_fingerprint(after)
    except (OSError, RuntimeError):
        # Primeira atualizacao apos instalar bootstrap.
        return True


def schedule_web_control_reload(before, previous_version, after):
    """Reinicia bootstrap estavel, sem rebuild, nova Release ou troca de EXE."""
    global CONTROL_UPGRADE_PENDING
    if not getattr(sys, "frozen", False) or os.name != "nt":
        return False
    # O Control do installer sempre esta em Program Files/GFARM.
    current = Path(sys.executable).resolve()
    expected = Path(os.environ.get("ProgramFiles", "C:/Program Files")) / "GFARM" / "GFARM-Control.exe"
    if os.path.normcase(str(current)) != os.path.normcase(str(expected.resolve())):
        raise RuntimeError("GFARM Control nao esta no local oficial de instalacao.")
    helper = Path(after) / "ops" / "gfarm_control" / "control_reload.py"
    if not helper.is_file():
        raise RuntimeError("Helper de recarga do GFARM Control ausente no GitHub.")
    # Nao parar a API pertencente a outro processo.
    if port_busy(backend_port()) and not owned():
        raise RuntimeError("GFARM esta executando fora do Control; reinicio bloqueado.")
    python = executable(after)
    ready = ROOT / "control-reload" / "ready.txt"
    ready.parent.mkdir(parents=True, exist_ok=True)
    ready.unlink(missing_ok=True)
    flags = getattr(subprocess, "DETACHED_PROCESS", 0) | getattr(
        subprocess, "CREATE_NEW_PROCESS_GROUP", 0)
    child = subprocess.Popen([
        str(python), str(helper),
        "--home", str(ROOT), "--parent-pid", str(os.getpid()),
        "--ready", str(ready),
        "--previous-app", str(before),
        "--previous-version", str(previous_version),
        "--expected-app", str(after),
    ], cwd=str(helper.parent), stdin=subprocess.DEVNULL,
        stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL,
        close_fds=True, creationflags=flags)
    for _ in range(100):
        if ready.is_file() and ready.read_text(encoding="ascii") == str(os.getpid()):
            break
        if child.poll() is not None:
            raise RuntimeError("Reiniciador do Control falhou; executavel permanece ativo.")
        time.sleep(0.2)
    else:
        raise RuntimeError("Reiniciador do Control nao respondeu; executavel preservado.")
    if owned():
        stop(temporary=True)
    CONTROL_UPGRADE_PENDING = True
    write_log("Nova versao WEB do Control preparada. Reiniciando bootstrap existente.")
    return True


def consume_control_restart():
    global CONTROL_UPGRADE_PENDING
    if CONTROL_UPGRADE_PENDING:
        CONTROL_UPGRADE_PENDING = False
        return True
    return False


def update(progress):
    with LOCK:
        cfg = load()
        before = project()
        previous_version = cfg.get("version", "pacote-inicial")
        ensure_configured()
        ssh = ssh_environment()
        progress("Consultando GitHub privado...")
        remote = run(["git", "ls-remote", REPO, "refs/heads/main"], timeout=90, env=ssh)
        revision = remote.split()[0]
        if len(revision) != 40:
            raise RuntimeError("Nao foi possivel confirmar a versao main.")
        if cfg.get("version") == revision:
            return "GFARM e GFARM Control ja estao na ultima versao."
        RELEASES.mkdir(parents=True, exist_ok=True)
        target = RELEASES / revision[:12]
        if target.exists():
            raise RuntimeError("Versao ja preparada. Reparo manual necessario.")
        progress("Baixando versao em pasta separada...")
        run(["git", "clone", "--depth", "1", "--filter=blob:none", "--sparse",
             "--branch", "main", REPO, str(target)], timeout=900, env=ssh)
        try:
            run(["git", "-C", str(target), "sparse-checkout", "set", "GFARM APP"], env=ssh)
            actual_revision = run(["git", "-C", str(target), "rev-parse", "HEAD"], env=ssh)
            if actual_revision.strip() != revision:
                raise RuntimeError("A branch main mudou durante o download; tente atualizar novamente.")
            release = target / "GFARM APP"
            if not (release / "backend" / "run_production.py").is_file():
                raise RuntimeError("Estrutura do GitHub inesperada.")
            # Atualizar com migrations nao verificadas pode alterar o banco ao iniciar.
            # Bloqueamos se o conjunto de migrations divergir da versao instalada.
            migrations = Path("backend/alembic/versions")
            old_set = {x.name: hashlib.sha256(x.read_bytes()).hexdigest()
                       for x in (before / migrations).glob("*.py")}
            new_set = {x.name: hashlib.sha256(x.read_bytes()).hexdigest()
                       for x in (release / migrations).glob("*.py")}
            if old_set != new_set:
                raise RuntimeError("Nova versao altera migrations do PostgreSQL: requer procedimento supervisionado.")
            progress("Preparando backend e interface...")
            (release / "backend" / ".env").write_bytes((DATA / "backend.env").read_bytes())
            link_uploads(release)
            run(["python", "-m", "venv", str(release / "backend" / ".venv")], timeout=180)
            py = executable(release)
            run([str(py), "-m", "pip", "install", "-r", str(release / "backend" / "requirements.txt")],
                timeout=1800)
            run(["npm.cmd" if os.name == "nt" else "npm", "ci", "--no-audit", "--no-fund"],
                cwd=release, timeout=1800)
            run(["npm.cmd" if os.name == "nt" else "npm", "run", "build"],
                cwd=release, timeout=1200)
            if not (release / "dist" / "index.html").is_file():
                raise RuntimeError("Compilacao do GFARM nao gerou dist/index.html.")
            # O Control e uma aplicacao WEB local: validar os modulos novos,
            # sem recompilar ou substituir o bootstrap EXE.
            changed_control = control_web_changed(before, release)
            if changed_control:
                progress("Validando novo codigo WEB do GFARM Control...")
                control_source = release / "ops" / "gfarm_control"
                run([str(py), "-m", "py_compile",
                     str(control_source / "server.py"),
                     str(control_source / "engine.py"),
                     str(control_source / "control_reload.py")], timeout=90)
            progress("Criando backup obrigatorio antes da atualizacao...")
            create_backup()
            progress("Publicando a nova versao e validando API...")
            was_running = owned()
            if port_busy(backend_port()) and not was_running:
                raise RuntimeError("Servidor iniciado fora do Control. Atualizacao bloqueada.")
            if was_running:
                stop(temporary=True)
            cfg["app_path"], cfg["version"] = str(release), revision
            save(cfg)
            try:
                # Nao faz copia/restauracao do banco: migrations identicas.
                result = start() if was_running else "Versao instalada (servidor permanece desligado)."
            except Exception:
                if owned():
                    try:
                        stop(temporary=True)
                    except Exception as x:
                        write_log("Falha parando nova versao: " + str(x))
                cfg["app_path"], cfg["version"] = str(before), previous_version
                save(cfg)
                if was_running:
                    try:
                        start()
                    except Exception as x:
                        write_log("CRITICO: rollback nao reiniciou backend: " + str(x))
                raise
            restarting_control = False
            if changed_control:
                progress("GFARM atualizado; reiniciando codigo WEB do Control...")
                restarting_control = schedule_web_control_reload(before, previous_version, release)
            progress("Nova versao do GFARM publicada; versao anterior preservada.")
            write_log("Atualizado: " + revision)
            return (result + (" Control web reiniciando." if restarting_control else "")
                    + " Commit: " + revision[:12])
        except Exception:
            # Pastas preparadas nao alteram a instalacao ativa.
            if project() != target / "GFARM APP":
                shutil.rmtree(target, ignore_errors=True)
            raise


def status():
    cfg = load()
    p = project()
    backups = list_backups()
    return {"app_online": running_health(), "app_own_process": owned(),
            "database_configured": (DATA / "backend.env").is_file(),
            "postgresql_port": env_values().get("DB_PORT", "5432"),
            "project": str(p), "project_exists": p.is_dir(),
            "version": cfg.get("version", "?"), "automatic": cfg.get("automatic", True),
            "remote_host": cfg.get("remote_host", "127.0.0.1"),
            "backup_count": len(backups), "latest_backup": backups[0]["nome"] if backups else None,
            "deploy_key_exists": (ROOT / "secrets" / "github_deploy.pub").is_file()}


def save_database(data):
    allowed = ("DB_HOST", "DB_PORT", "DB_NAME", "DB_USER", "DB_PASSWORD",
               "SECRET_KEY", "APP_HOST", "APP_PORT", "ESTQ_XML_TICKET_DIR")
    values = {name: str(data.get(name, "")).strip() for name in allowed}
    for key in ("DB_HOST", "DB_PORT", "DB_NAME", "DB_USER", "DB_PASSWORD", "SECRET_KEY"):
        if not values[key]:
            raise RuntimeError("Campo do banco obrigatorio: " + key)
    if values["APP_HOST"] not in ("", "127.0.0.1"):
        raise RuntimeError("APP_HOST deve ser 127.0.0.1 (Cloudflare faz acesso externo).")
    if values["DB_HOST"] not in ("localhost", "127.0.0.1"):
        raise RuntimeError("V1 aceita apenas PostgreSQL local ao servidor.")
    values["APP_HOST"] = "127.0.0.1"
    values["APP_PORT"] = values["APP_PORT"] or "8000"
    for key in ("DB_PORT", "APP_PORT"):
        if not values[key].isdigit() or not 1 <= int(values[key]) <= 65535:
            raise RuntimeError("Porta invalida: " + key)
    for v in values.values():
        if "\n" in v or "\r" in v:
            raise RuntimeError("Configuracao invalida.")
    if owned() or port_busy(backend_port()):
        raise RuntimeError("Pare o GFARM antes de alterar a conexao.")
    # Teste REAL de autenticacao antes de aceitar a configuracao.
    # Consulta de leitura, nao cria banco/tabela nem executa migration.
    result = run(
        [pg_binary("psql"), "-X", "-At", "-v", "ON_ERROR_STOP=1",
         "-h", values["DB_HOST"], "-p", values["DB_PORT"],
         "-U", values["DB_USER"], "-d", values["DB_NAME"],
         "-c", "SELECT 1"],
        timeout=15, env={"PGPASSWORD": values["DB_PASSWORD"]},
    )
    if result.strip() != "1":
        raise RuntimeError("O PostgreSQL nao confirmou a conexao. Nada foi salvo.")
    DATA.mkdir(parents=True, exist_ok=True)
    path = DATA / "backend.env"
    tmp = path.with_suffix(".tmp")
    tmp.write_text("\n".join(k + "=" + json.dumps(values[k], ensure_ascii=False) for k in allowed if values[k]) + "\n",
                   encoding="utf-8")
    os.replace(tmp, path)
    p = project()
    if (p / "backend").is_dir():
        (p / "backend" / ".env").write_bytes(path.read_bytes())
    write_log("Configuracao de banco atualizada; nenhuma tabela foi alterada.")
    return "Configuracao salva. O PostgreSQL nao foi modificado."


def watchdog():
    global LAST_START
    while True:
        try:
            if LOCK.acquire(blocking=False):
                try:
                    c = load()
                    if (c.get("automatic", True) and c.get("desired_running", True)
                            and not owned() and not port_busy(backend_port())):
                        if time.monotonic() - LAST_START > 90 and (DATA / "backend.env").is_file():
                            LAST_START = time.monotonic()
                            try:
                                start()
                            except Exception as err:
                                write_log("Reinicio automatico nao realizado: " + str(err))
                finally:
                    LOCK.release()
        except Exception as err:
            write_log("Falha no monitor: " + str(err))
        time.sleep(15)
