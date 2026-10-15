"""Painel portátil do ESTQ para instalar, atualizar e transferir servidor Windows.

Código oficial: GitHub main. O EXE é gerado pelo CI, nunca contém credenciais.
Sem efeitos destrutivos: restauração apenas em banco novo e vazio.
"""
from __future__ import annotations

import json
import os
import queue
import secrets
import shutil
import signal
import socket
import subprocess
import sys
import threading
import time
import urllib.error
import urllib.request
import webbrowser
from pathlib import Path

import tkinter as tk
from tkinter import filedialog, messagebox, simpledialog, ttk

REPO = "https://github.com/layon-lima/gest-o-de-estoque-novo-horizonte.git"
REPO_SLUG = "layon-lima/gest-o-de-estoque-novo-horizonte"
REPO_BRANCH = "main"
PANEL_VERSION = "1.0"
DATA = Path(os.environ.get("LOCALAPPDATA", str(Path.home()))) / "ESTQ-Painel"
CONFIG = DATA / "painel.json"
LOG = DATA / "painel.log"
DEFAULT_PROJECT = Path.home() / "Documents" / "ESTQ_SERVIDOR"


def find_binary(name: str) -> Path | None:
    found = shutil.which(name)
    if found:
        return Path(found)
    program = Path(os.environ.get("ProgramFiles", "C:/Program Files"))
    local = Path(os.environ.get("LOCALAPPDATA", str(Path.home())))
    patterns = {
        "git": [program / "Git" / "cmd" / "git.exe", local / "Programs" / "Git" / "cmd" / "git.exe"],
        "npm": [program / "nodejs" / "npm.cmd"],
        "python": [local / "Programs" / "Python" / "Python313" / "python.exe"],
        "psql": [program / "PostgreSQL" / "17" / "bin" / "psql.exe"],
        "pg_dump": [program / "PostgreSQL" / "17" / "bin" / "pg_dump.exe"],
        "cloudflared": [
            program / "cloudflared" / "cloudflared.exe",
            Path(os.environ.get("ProgramFiles(x86)", "C:/Program Files (x86)")) / "cloudflared" / "cloudflared.exe",
        ],
    }
    return next((p for p in patterns.get(name, []) if p.is_file()), None)


def python_project(project: Path) -> Path:
    for p in [
        project / "backend" / ".venv" / "Scripts" / "python.exe",
        project / ".venv" / "Scripts" / "python.exe",
    ]:
        if p.is_file():
            return p
    raise RuntimeError("Python do backend não encontrado. Execute Preparar aplicativo.")


def api_ok() -> bool:
    try:
        with urllib.request.urlopen("http://127.0.0.1:8000/api/health", timeout=3) as res:
            return res.status == 200 and json.load(res).get("status") == "online"
    except (OSError, ValueError, TimeoutError, urllib.error.URLError):
        return False


def port_busy(port=8000) -> bool:
    try:
        with socket.create_connection(("127.0.0.1", port), timeout=1):
            return True
    except OSError:
        return False


def load_config() -> dict:
    if not CONFIG.is_file():
        return {}
    try:
        parsed = json.loads(CONFIG.read_text(encoding="utf-8"))
        return parsed if isinstance(parsed, dict) else {}
    except (OSError, ValueError):
        return {}


def save_config(c: dict) -> None:
    DATA.mkdir(parents=True, exist_ok=True)
    temporary = CONFIG.with_suffix(".tmp")
    temporary.write_text(json.dumps(c, ensure_ascii=False, indent=2), encoding="utf-8")
    temporary.replace(CONFIG)


def safe_project_folder(project: Path) -> None:
    if project.exists() and not project.is_dir():
        raise RuntimeError("O caminho escolhido é um arquivo, não uma pasta.")
    if (project / ".git").exists():
        return
    if project.exists() and any(project.iterdir()):
        raise RuntimeError("Para evitar sobrescrita, escolha uma pasta vazia ou o clone Git oficial existente.")


class Painel:
    def __init__(self):
        if os.name != "nt":
            raise RuntimeError("O painel portátil é destinado ao Windows.")
        DATA.mkdir(parents=True, exist_ok=True)
        self.config = load_config()
        self.events = queue.Queue()
        self.busy = False
        self.root = tk.Tk()
        self.root.title("ESTQ — Painel do Servidor | v" + PANEL_VERSION)
        self.root.geometry("920x720")
        self.root.minsize(760, 630)
        self.project_value = tk.StringVar(value=self.config.get("project", str(DEFAULT_PROJECT)))
        self.status_value = tk.StringVar(value="Verificando servidor...")
        self._layout()
        self.root.after(200, self._drain)

    def _layout(self):
        outer = ttk.Frame(self.root, padding=14)
        outer.pack(fill="both", expand=True)
        ttk.Label(outer, text="PAINEL DE CONTROLE DO SERVIDOR ESTQ",
                  font=("Segoe UI", 16, "bold")).pack(anchor="w")
        ttk.Label(outer, text="Instalação, GitHub, banco, migração, início automático e diagnóstico.",
                  foreground="#64748b").pack(anchor="w", pady=(0, 10))
        location = ttk.Frame(outer)
        location.pack(fill="x", pady=(0, 6))
        ttk.Label(location, text="Pasta do projeto:").pack(side="left")
        ttk.Entry(location, textvariable=self.project_value).pack(side="left", fill="x", expand=True, padx=8)
        ttk.Button(location, text="Escolher pasta", command=self.choose_project).pack(side="left")
        ttk.Label(outer, textvariable=self.status_value, foreground="#2563eb").pack(anchor="w", pady=(0, 10))

        boxes = ttk.Frame(outer)
        boxes.pack(fill="x")
        steps = [
            ("NOVO COMPUTADOR", [
                ("1. Instalar dependências", self.install_prerequisites),
                ("2. Baixar e preparar app do GitHub", self.prepare_app),
                ("3. Criar PostgreSQL vazio + configurar", self.setup_database),
                ("4. Restaurar dados do computador antigo", self.restore_backup),
            ]),
            ("SERVIDOR ATUAL / OPERAÇÃO", [
                ("Criar pacote completo de transferência", self.export_backup),
                ("Atualizar do GitHub e publicar", self.update_and_publish),
                ("Iniciar servidor", self.start_server),
                ("Parar servidor iniciado pelo painel", self.stop_server),
            ]),
            ("CONTINUIDADE / ACESSO", [
                ("Instalar início automático do Windows", self.install_autostart),
                ("Diagnosticar servidor", self.diagnose),
                ("Configurar acesso externo (Cloudflare)", self.cloudflare),
                ("Guia de transferência", self.guide),
            ]),
        ]
        self.buttons = []
        for i, (heading, commands) in enumerate(steps):
            box = ttk.LabelFrame(boxes, text=heading, padding=8)
            box.grid(row=0, column=i, padx=(0, 8), sticky="nsew")
            boxes.columnconfigure(i, weight=1, uniform="sections")
            for label, callback in commands:
                b = ttk.Button(box, text=label, command=callback)
                b.pack(fill="x", pady=4)
                self.buttons.append(b)

        ttk.Label(outer, text="ANDAMENTO E MENSAGENS", font=("Segoe UI", 10, "bold")).pack(
            anchor="w", pady=(14, 4)
        )
        frame = ttk.Frame(outer)
        frame.pack(fill="both", expand=True)
        self.output = tk.Text(frame, height=15, wrap="word", state="disabled",
                              bg="#f8fafc", fg="#111827", font=("Consolas", 10))
        bar = ttk.Scrollbar(frame, command=self.output.yview)
        self.output.configure(yscrollcommand=bar.set)
        self.output.pack(side="left", fill="both", expand=True)
        bar.pack(side="left", fill="y")
        ttk.Label(outer, text="Banco, fotos e dados NÃO ficam no GitHub. Para migrar, use o pacote seguro criado no PC antigo.",
                  foreground="#64748b").pack(anchor="w", pady=(8, 0))

    def _log(self, msg):
        self.events.put(("log", str(msg)))

    def _drain(self):
        try:
            while True:
                event, data = self.events.get_nowait()
                if event == "log":
                    self.output.configure(state="normal")
                    self.output.insert("end", data.rstrip() + "\n")
                    self.output.see("end")
                    self.output.configure(state="disabled")
                    with LOG.open("a", encoding="utf-8") as stream:
                        stream.write(data.rstrip() + "\n")
                elif event == "done":
                    self.busy = False
                    for button in self.buttons:
                        button.configure(state="normal")
                    self.status_value.set("Servidor online" if api_ok() else "Servidor indisponível no momento")
                    messagebox.showinfo("ESTQ", data)
                elif event == "fail":
                    self.busy = False
                    for button in self.buttons:
                        button.configure(state="normal")
                    self.status_value.set("Falha — veja as mensagens abaixo")
                    self._log("ERRO: " + data)
                    messagebox.showerror("ESTQ — Falha", data)
        except queue.Empty:
            pass
        self.root.after(200, self._drain)

    def run_background(self, title, fn, *args):
        if self.busy:
            return
        self.busy = True
        self.status_value.set("Executando: " + title)
        for b in self.buttons:
            b.configure(state="disabled")
        self._log("=== " + title + " ===")

        def work():
            try:
                final = fn(*args)
                self.events.put(("done", final or "Operação concluída."))
            except Exception as exc:
                self.events.put(("fail", f"{type(exc).__name__}: {exc}"))
        threading.Thread(target=work, daemon=True).start()

    def project(self) -> Path:
        p = Path(self.project_value.get()).expanduser().resolve()
        self.config["project"] = str(p)
        save_config(self.config)
        return p

    def choose_project(self):
        path = filedialog.askdirectory(title="Selecione a pasta do projeto no Windows")
        if path:
            self.project_value.set(path)
            self.project()

    def _run(self, command, cwd=None, env=None, input_text=None, timeout=2400):
        # O comando não é escrito no log, pois pode conter informações privadas.
        creationflags = getattr(subprocess, "CREATE_NO_WINDOW", 0)
        try:
            finished = subprocess.run(
                [str(x) for x in command], cwd=str(cwd) if cwd else None,
                env=env, input=input_text, capture_output=True, text=True,
                encoding="utf-8", errors="replace", timeout=timeout,
                creationflags=creationflags,
            )
        except subprocess.TimeoutExpired as exc:
            raise RuntimeError("Comando excedeu o tempo permitido.") from exc
        if finished.returncode:
            message = (finished.stderr or finished.stdout or "").strip()
            raise RuntimeError(
                "Comando falhou com código "
                + str(finished.returncode) + ": " + message[-1200:]
            )
        output = finished.stdout.strip()
        if output:
            self._log(output[-1600:])
        return output

    def _winget(self, package):
        winget = find_binary("winget")
        if not winget:
            raise RuntimeError("Winget ausente. Atualize 'Instalador de Aplicativos' pela Microsoft Store.")
        # Winget instala apenas pacotes oficiais conhecidos; nao executa comandos de fontes arbitrarias.
        self._log("Instalando/verificando " + package + " ...")
        self._run([winget, "install", "--id", package, "--exact", "--source", "winget",
                   "--accept-package-agreements", "--accept-source-agreements",
                   "--interactive"], timeout=3600)

    def install_prerequisites(self):
        if not messagebox.askyesno("Novo PC", "Instalar Git, Python 3.13, Node.js LTS e PostgreSQL 17 pelo Winget?\n\nO instalador do PostgreSQL pode pedir senha de administrador do banco e permissão do Windows."):
            return
        self.run_background("Instalando dependências Windows", self._install_prerequisites)

    def _install_prerequisites(self):
        for label, binary, package in [
            ("Git", "git", "Git.Git"),
            ("Node.js", "npm", "OpenJS.NodeJS.LTS"),
            ("Python 3.13", "python", "Python.Python.3.13"),
            ("PostgreSQL 17", "psql", "PostgreSQL.PostgreSQL.17"),
            ("Cloudflare Tunnel", "cloudflared", "Cloudflare.cloudflared"),
        ]:
            present = find_binary(binary)
            if present and (binary != "python" or "313" in str(present) or find_binary("py")):
                self._log(label + " detectado.")
                continue
            self._winget(package)
        return (
            "Dependências verificadas. Se algum instalador pedir reinicialização, "
            "reinicie e abra novamente o painel antes de preparar o aplicativo."
        )

    def _official_git(self, project):
        git = find_binary("git")
        if not git:
            raise RuntimeError("Git ausente. Instale as dependências primeiro.")
        safe_project_folder(project)
        if not (project / ".git").is_dir():
            project.parent.mkdir(parents=True, exist_ok=True)
            self._log("Clonando GitHub privado. Autorize a conta no navegador se solicitado.")
            self._run([git, "clone", "--branch", REPO_BRANCH, "--single-branch", REPO,
                       str(project)], timeout=1200)
        else:
            remote = self._run([git, "remote", "get-url", "origin"], cwd=project).lower()
            if REPO_SLUG not in remote:
                raise RuntimeError("O repositório existente não é o ESTQ oficial. Nada foi alterado.")
            if self._run([git, "status", "--porcelain"], cwd=project):
                raise RuntimeError("Há mudanças locais rastreadas. Protegido contra sobrescrita pelo Git.")
            self._run([git, "fetch", "origin", REPO_BRANCH], cwd=project, timeout=1200)
            self._run([git, "merge", "--ff-only", "origin/main"], cwd=project, timeout=300)
        return git

    def _python_for_venv(self):
        py = find_binary("py")
        if py:
            return [str(py), "-3.13"]
        python = find_binary("python")
        if python and "313" in str(python):
            return [str(python)]
        raise RuntimeError("Python 3.13 não localizado. Reabra painel após instalar Python.")

    def _prepare(self, project):
        self._official_git(project)
        backend = project / "backend"
        venv = backend / ".venv"
        if not (venv / "Scripts" / "python.exe").is_file():
            self._log("Criando ambiente Python do ESTQ ...")
            self._run([*self._python_for_venv(), "-m", "venv", str(venv)], cwd=project)
        python = python_project(project)
        self._log("Instalando bibliotecas do backend ...")
        self._run([python, "-m", "pip", "install", "-r", str(backend / "requirements.txt")],
                  cwd=project, timeout=2400)
        npm = find_binary("npm")
        if not npm:
            raise RuntimeError("Node.js/npm ausente. Instale as dependências primeiro.")
        self._log("Compilando frontend oficial do GitHub ...")
        self._run([npm, "ci"], cwd=project, timeout=1800)
        self._run([npm, "run", "build"], cwd=project, timeout=1200)
        if not (project / "dist" / "index.html").is_file():
            raise RuntimeError("A compilação não gerou dist/index.html.")
        return "Código do ESTQ e dependências preparados sem alterar banco e arquivos."

    def prepare_app(self):
        project = self.project()
        self.run_background("Preparar aplicativo oficial no novo PC", self._prepare, project)

    def _psql(self, sql, admin_password):
        psql = find_binary("psql")
        if not psql:
            raise RuntimeError("psql do PostgreSQL 17 ausente.")
        env = os.environ.copy()
        env["PGPASSWORD"] = admin_password
        # SQL com senha somente no stdin: não aparece na lista de argumentos nem no log.
        cmd = [psql, "-h", "127.0.0.1", "-p", "5432", "-U", "postgres", "-d", "postgres",
               "-X", "-v", "ON_ERROR_STOP=1", "-At", "-f", "-"]
        return self._run(cmd, env=env, input_text=sql, timeout=45)

    def setup_database(self):
        project = self.project()
        if not (project / "backend" / "run_production.py").is_file():
            messagebox.showerror("ESTQ", "Prepare o app do GitHub primeiro.")
            return
        if (project / "backend" / ".env").exists():
            messagebox.showwarning(
                "Proteção dos dados",
                "backend/.env já existe. O painel não troca credenciais nem recria banco existente."
            )
            return
        password = simpledialog.askstring(
            "PostgreSQL", "Informe a senha do usuário postgres definida na instalação do PostgreSQL:",
            show="*", parent=self.root,
        )
        if not password:
            return
        if messagebox.askyesno("Criar banco vazio", "Criar o banco exclusivo estq_novo_horizonte e usuário estq_app?\n\nSó faça isso no computador NOVO. Nunca no banco atual."):
            self.run_background("Preparar PostgreSQL vazio", self._setup_database, project, password)

    def _setup_database(self, project, admin_password):
        env_path = project / "backend" / ".env"
        if env_path.exists():
            raise RuntimeError("backend/.env existente. Operação cancelada.")
        if port_busy():
            raise RuntimeError("Existe algo usando porta 8000. Não crie banco com o ERP em funcionamento.")
        # Banco, usuario e senha são gerados sem reutilizar credenciais antigas.
        dbname, user = "estq_novo_horizonte", "estq_app"
        oldrole = self._psql("SELECT 1 FROM pg_roles WHERE rolname='estq_app';\n", admin_password)
        olddb = self._psql("SELECT 1 FROM pg_database WHERE datname='estq_novo_horizonte';\n", admin_password)
        if oldrole.strip() or olddb.strip():
            raise RuntimeError("O usuário ou banco de destino já existe. Recusado para proteger dados.")
        dbpassword = secrets.token_urlsafe(36)
        secret = secrets.token_urlsafe(48)
        self._psql(f"CREATE ROLE {user} LOGIN PASSWORD '{dbpassword}';\n", admin_password)
        self._psql(f"CREATE DATABASE {dbname} OWNER {user} ENCODING 'UTF8';\n", admin_password)
        config = "\n".join([
            "DB_HOST=127.0.0.1", "DB_PORT=5432", f"DB_NAME={dbname}",
            f"DB_USER={user}", f"DB_PASSWORD={dbpassword}", f"SECRET_KEY={secret}",
            "APP_HOST=127.0.0.1", "APP_PORT=8000", "",
        ])
        # O .env é apenas LOCAL. Não é enviado ao GitHub nem incluído no backup.
        env_path.write_text(config, encoding="utf-8")
        self._log("Banco e usuário do ESTQ criados. Credenciais guardadas só em backend/.env.")
        return "Banco NOVO criado. Agora restaure o backup do PC antigo. Não inicie o servidor antes de restaurar."

    def _pause_monitor(self):
        marker = Path(os.environ.get("LOCALAPPDATA", str(Path.home()))) / "ESTQ-Inicializacao" / "maintenance.flag"
        marker.parent.mkdir(parents=True, exist_ok=True)
        marker.touch(exist_ok=True)
        self._log("Monitor Windows pausado para migração.")

    def _resume_monitor(self):
        marker = Path(os.environ.get("LOCALAPPDATA", str(Path.home()))) / "ESTQ-Inicializacao" / "maintenance.flag"
        marker.unlink(missing_ok=True)

    def _migration(self, project, action, archive=None, folder=None):
        python = python_project(project)
        script = project / "ops" / "migrar_servidor.py"
        if not script.is_file():
            raise RuntimeError("Ferramenta oficial de migração não encontrada no GitHub.")
        cmd = [python, script, action]
        if action == "exportar":
            cmd += ["--destino", folder, "--operacoes-pausadas"]
        elif action == "verificar":
            cmd += ["--arquivo", archive]
        elif action == "restaurar":
            cmd += ["--arquivo", archive, "--destino-vazio-confirmado"]
        return self._run(cmd, cwd=project, timeout=3600)

    def export_backup(self):
        project = self.project()
        folder = filedialog.askdirectory(
            title="Pasta segura de destino do backup (preferencialmente pendrive criptografado)"
        )
        if not folder:
            return
        if not messagebox.askyesno(
            "ATENÇÃO — Backup final",
            "O backup deve ser criado sem ninguém usando o estoque.\n\n"
            "O painel pausará o monitor de reinício. Se o backend estiver aberto por outro "
            "inicializador, você precisará pará-lo primeiro.\n\n"
            "O PostgreSQL deve continuar ligado. Continuar?"
        ):
            return
        self.run_background("Criando backup completo de transferência", self._export, project, folder)

    def _export(self, project, folder):
        self._pause_monitor()
        pid = self.config.get("backend_pid")
        if pid and not self._process_running(pid):
            self.config.pop("backend_pid", None)
            save_config(self.config)
        elif pid:
            self._stop_owned_server()
        if port_busy():
            raise RuntimeError(
                "Backend ainda ativo. Pare-o no painel original e repita. "
                "Monitor continua pausado para segurança."
            )
        self._migration(project, "exportar", folder=folder)
        return (
            "Backup exportado com PostgreSQL, uploads e XMLs. "
            "Copie ZIP + ZIP.sha256 ao novo PC por pendrive criptografado. "
            "O monitor do PC antigo CONTINUA PAUSADO até decisão de corte."
        )

    def restore_backup(self):
        project = self.project()
        archive = filedialog.askopenfilename(
            title="Selecione o ZIP de transferência do PC antigo",
            filetypes=[("Backup ZIP do ESTQ", "*.zip")],
        )
        if not archive:
            return
        if not Path(str(archive) + ".sha256").is_file():
            messagebox.showerror("ESTQ", "Falta arquivo ZIP.sha256 no mesmo local do ZIP.")
            return
        if not messagebox.askyesno(
            "Restauração de dados",
            "Esta etapa permite restaurar SOMENTE para banco e pasta uploads vazios.\n\n"
            "O servidor NÃO será iniciado automaticamente. Deseja continuar?"
        ):
            return
        self.run_background("Verificar e restaurar dados do PC anterior", self._restore, project, archive)

    def _restore(self, project, archive):
        if port_busy():
            raise RuntimeError("A porta 8000 está ocupada. Desligue o servidor antes da restauração.")
        if not (project / "backend" / ".env").is_file():
            raise RuntimeError("Banco não configurado. Execute a criação do PostgreSQL primeiro.")
        self._migration(project, "verificar", archive=archive)
        self._migration(project, "restaurar", archive=archive)
        self.config["restore_completed"] = True
        save_config(self.config)
        return (
            "Restauração realizada. Confira os cadastros, saldos, tickets e fotos. "
            "Depois inicie o servidor e somente após validação habilite acesso externo."
        )

    def update_and_publish(self):
        project = self.project()
        if not (project / ".git").is_dir():
            messagebox.showwarning("ESTQ", "Ainda não existe clone Git neste PC. Use Preparar aplicativo.")
            return
        if not messagebox.askyesno(
            "Atualizar do GitHub e publicar",
            "Atualizar o código pela main e recompilar o aplicativo?\n\n"
            "Isso não altera o banco, mas pode ser preciso reiniciar o backend "
            "pelo próprio painel para ativar o código novo."
        ):
            return
        self.run_background("Atualizar do GitHub e publicar", self._prepare, project)

    def _process_running(self, pid):
        try:
            os.kill(int(pid), 0)
            return True
        except (OSError, ValueError, TypeError):
            return False

    def _stop_owned_server(self):
        pid = self.config.get("backend_pid")
        if not pid or not self._process_running(pid):
            self.config.pop("backend_pid", None)
            save_config(self.config)
            raise RuntimeError("Não há backend iniciado por este painel para parar.")
        self._log("Parando somente o processo registrado por este painel, PID " + str(pid))
        self._run(["taskkill", "/PID", str(pid), "/T"], timeout=20)
        self.config.pop("backend_pid", None)
        save_config(self.config)
        time.sleep(2)
        if port_busy():
            raise RuntimeError("O processo não liberou a porta. Verifique o servidor antes de prosseguir.")
        return "Backend do painel encerrado."

    def stop_server(self):
        if not self.config.get("backend_pid"):
            messagebox.showwarning(
                "Proteção", "Servidor não foi iniciado por este painel. "
                "Pare pelo painel anterior; não encerrarei processos desconhecidos."
            )
            return
        self.run_background("Parar backend do painel", self._stop_owned_server)

    def start_server(self):
        project = self.project()
        self.run_background("Iniciar backend do ESTQ", self._start, project)

    def _start(self, project):
        if api_ok():
            return "Backend já responde em http://127.0.0.1:8000. Nenhuma instância duplicada foi iniciada."
        if port_busy():
            raise RuntimeError("Porta 8000 já usada por outro processo. Não iniciamos servidor duplicado.")
        if not (project / "backend" / ".env").is_file():
            raise RuntimeError("backend/.env ausente. Configure banco e restaure antes de iniciar.")
        if not (project / "dist" / "index.html").is_file():
            raise RuntimeError("Frontend não compilado. Prepare aplicativo primeiro.")
        python = python_project(project)
        binary = python.with_name("pythonw.exe")
        if binary.is_file():
            python = binary
        backend = project / "backend"
        log_path = DATA / "servidor-startup.log"
        with log_path.open("a", encoding="utf-8") as logfile:
            proc = subprocess.Popen(
                [str(python), str(backend / "run_production.py")],
                cwd=str(backend), stdout=logfile, stderr=subprocess.STDOUT,
                stdin=subprocess.DEVNULL,
                creationflags=getattr(subprocess, "CREATE_NO_WINDOW", 0),
                close_fds=True,
            )
        self.config["backend_pid"] = proc.pid
        save_config(self.config)
        for _ in range(30):
            if api_ok():
                return "Servidor iniciado. Acesse http://127.0.0.1:8000"
            if proc.poll() is not None:
                raise RuntimeError("Servidor encerrou na inicialização. Consulte " + str(log_path))
            time.sleep(2)
        raise RuntimeError("Servidor demorou a responder. Consulte " + str(log_path))

    def install_autostart(self):
        project = self.project()
        if not (project / "backend" / ".env").exists():
            messagebox.showerror("ESTQ", "Configure o banco antes de instalar início automático.")
            return
        if not messagebox.askyesno(
            "Início automático", "Instalar monitor GitHub para manter backend online após login do Windows?"
        ):
            return
        self.run_background("Instalar início automático versionado", self._install_auto, project)

    def _install_auto(self, project):
        ps = project / "ops" / "windows" / "INSTALAR_INICIALIZACAO.ps1"
        if not ps.is_file():
            raise RuntimeError("Inicializador GitHub não encontrado.")
        self._run(["powershell.exe", "-NoProfile", "-ExecutionPolicy", "Bypass",
                   "-File", str(ps), "-Projeto", str(project)], timeout=80)
        return "Início automático instalado. Reinicie e faça login para testar."

    def diagnose(self):
        project = self.project()
        self.run_background("Diagnóstico de servidor", self._diagnose, project)

    def _diagnose(self, project):
        self._log("Git: " + str(find_binary("git")))
        self._log("Node/npm: " + str(find_binary("npm")))
        self._log("PostgreSQL: " + str(find_binary("psql")))
        self._log("Projeto: " + str(project))
        self._log("Banco configurado: " + str((project / "backend" / ".env").exists()))
        self._log("Frontend compilado: " + str((project / "dist" / "index.html").exists()))
        self._log("API responde: " + str(api_ok()))
        self._log("Porta 8000 ocupada: " + str(port_busy()))
        ps = project / "ops" / "windows" / "DIAGNOSTICAR_INICIALIZACAO.ps1"
        if ps.is_file():
            self._run(["powershell.exe", "-NoProfile", "-ExecutionPolicy", "Bypass",
                       "-File", str(ps), "-Projeto", str(project)], timeout=35)
        return "Diagnóstico finalizado. Consulte mensagens e log do painel."

    def cloudflare(self):
        if not api_ok():
            messagebox.showerror("ESTQ", "A API do ESTQ precisa estar online e validada antes de ativar acesso externo.")
            return
        if not find_binary("cloudflared"):
            if messagebox.askyesno(
                "Cloudflare Tunnel",
                "O Cloudflare Tunnel ainda não foi instalado. Instalar o programa oficial pelo Winget?"
            ):
                self.run_background("Instalar Cloudflare Tunnel", self._winget, "Cloudflare.cloudflared")
            return
        text = (
            "A troca do túnel é a última etapa. O servidor antigo NÃO pode "
            "continuar aceitando gravações enquanto o novo estiver público.\n\n"
            "Pelo painel Cloudflare, acesse Networking > Tunnels > Seu túnel > Add a replica "
            "e copie SOMENTE o token (string iniciada por eyJ).\n\n"
            "O painel instala como serviço, sem gravar token no GitHub. "
            "Se seu túnel atual for gerenciado localmente, primeiro converta/crie "
            "um túnel gerenciado remotamente no Cloudflare."
        )
        if not messagebox.askyesno("Ativar no novo servidor", text + "\n\nJá validou os dados e parou o servidor/túnel ANTIGO?"):
            webbrowser.open("https://one.dash.cloudflare.com/")
            return
        if not messagebox.askyesno("CONFIRMAÇÃO FINAL",
             "Confirma que o servidor ANTIGO foi desconectado e não receberá mais movimentações?"):
            return
        token = simpledialog.askstring(
            "Token do Cloudflare Tunnel", "Cole somente o token do túnel remoto (não será salvo no painel):",
            show="*", parent=self.root,
        )
        if not token:
            return
        token = token.strip()
        if not token.startswith("eyJ") or any(c.isspace() for c in token):
            messagebox.showerror("ESTQ", "Token inválido. Obtenha o token pela sua conta Cloudflare.")
            return
        self.run_background("Instalar túnel remoto como serviço Windows",
                            self._install_cloudflare_service, token)

    def _install_cloudflare_service(self, token):
        import ctypes
        if not ctypes.windll.shell32.IsUserAnAdmin():
            raise RuntimeError(
                "É necessária permissão de Administrador para instalar serviço Windows. "
                "Feche o painel e execute PAINEL_ESTQ.exe como administrador nesta etapa."
            )
        binary = find_binary("cloudflared")
        if not binary:
            raise RuntimeError("cloudflared ausente. Instale pelo painel primeiro.")
        checked = self._run(["sc.exe", "query", "cloudflared"], timeout=15) if self._service_exists() else ""
        if checked:
            raise RuntimeError(
                "Serviço Cloudflare já existe. O painel não altera um túnel previamente configurado."
            )
        # cloudflared >= 2026.7.3 grava o token em arquivo ACL-protegido
        # e configura Windows Service com --token-file.
        try:
            result = subprocess.run(
                [str(binary), "service", "install", token],
                capture_output=True, text=True, encoding="utf-8", errors="replace",
                timeout=100,
                creationflags=getattr(subprocess, "CREATE_NO_WINDOW", 0),
            )
        except subprocess.TimeoutExpired as exc:
            raise RuntimeError("Instalador Cloudflare excedeu o tempo.") from exc
        if result.returncode:
            message = (result.stderr or result.stdout or "").replace(token, "[TOKEN OCULTO]")
            raise RuntimeError("Cloudflare não conseguiu instalar serviço: " + message[-800:])
        self._log("Cloudflare Tunnel instalado como serviço Windows.")
        return "Túnel configurado. Confira o status da conexão e o domínio no painel da Cloudflare."

    def _service_exists(self):
        result = subprocess.run(
            ["sc.exe", "query", "cloudflared"],
            capture_output=True, text=True, timeout=10,
            creationflags=getattr(subprocess, "CREATE_NO_WINDOW", 0),
        )
        return result.returncode == 0

    def guide(self):
        webbrowser.open("https://github.com/" + REPO_SLUG + "/blob/main/ops/GUIA_MIGRACAO_E_CLOUD.md")

    def run(self):
        self.status_value.set("Servidor online" if api_ok() else "Servidor indisponível no momento")
        self._log("Painel portátil v" + PANEL_VERSION + " | GitHub main | dados locais preservados")
        self.root.mainloop()


if __name__ == "__main__":
    try:
        Painel().run()
    except Exception as error:
        import traceback
        tb = traceback.format_exc()
        DATA.mkdir(parents=True, exist_ok=True)
        (DATA / "falha-painel.log").write_text(tb, encoding="utf-8")
        raise SystemExit(str(error))
