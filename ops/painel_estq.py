"""Painel portátil do ESTQ para instalar, atualizar e transferir servidor Windows.

Código oficial: GitHub main. O EXE é gerado pelo CI, nunca contém credenciais.
Sem efeitos destrutivos: restauração apenas em banco novo e vazio.
"""
from __future__ import annotations

import base64
import hmac
import ipaddress
import json
import os
import queue
import re
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
from ops.local_install import (default_server_root, initial_server_root,
                               is_estq_project, locate_projects, windows_processes)

REPO = "https://github.com/layon-lima/gest-o-de-estoque-novo-horizonte.git"
REPO_SLUG = "layon-lima/gest-o-de-estoque-novo-horizonte"
REPO_BRANCH = "main"
PANEL_VERSION = "1.3"
DATA = Path(os.environ.get("LOCALAPPDATA", str(Path.home()))) / "ESTQ-Painel"
CONFIG = DATA / "painel.json"
LOG = DATA / "painel.log"
DEFAULT_PROJECT = default_server_root()
REMOTE_KEY = DATA / "id_ed25519_estq"
REMOTE_HOSTS = DATA / "remote_known_hosts"


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
        self.root.title("GFARM — Painel de Controle | v" + PANEL_VERSION)
        self.root.geometry("1040x850")
        self.root.minsize(850, 730)
        self.project_value = tk.StringVar(value=str(initial_server_root(self.config)))
        self.remote_ip = tk.StringVar(value=self.config.get("remote_ip", ""))
        self.remote_user = tk.StringVar(value=self.config.get("remote_user", ""))
        self.remote_project = tk.StringVar(value=self.config.get("remote_project", ""))
        self.status_value = tk.StringVar(value="Verificando servidor...")
        self._layout()
        self.root.protocol("WM_DELETE_WINDOW", self._close)
        self.root.after(200, self._drain)
        # Não altera a instalação ao iniciar. Só oferece localização se a API
        # está neste computador e o caminho padrão não contém o ERP existente.
        if api_ok() and not is_estq_project(Path(self.project_value.get()).expanduser()):
            self.root.after(500, self.detect_existing)

    def _close(self):
        if self.busy:
            messagebox.showwarning(
                "Operação em andamento",
                "Aguarde finalizar a instalação, backup ou restauração para fechar o painel."
            )
            return
        self.root.destroy()

    def _layout(self):
        outer = ttk.Frame(self.root, padding=14)
        outer.pack(fill="both", expand=True)
        ttk.Label(outer, text="GFARM — PAINEL DE CONTROLE",
                  font=("Segoe UI", 16, "bold")).pack(anchor="w")
        ttk.Label(outer, text="Instalação, GitHub, banco, migração, início automático e diagnóstico.",
                  foreground="#64748b").pack(anchor="w", pady=(0, 10))
        location = ttk.Frame(outer)
        location.pack(fill="x", pady=(0, 6))
        ttk.Label(location, text="Pasta do servidor:").pack(side="left")
        ttk.Entry(location, textvariable=self.project_value).pack(side="left", fill="x", expand=True, padx=8)
        ttk.Button(location, text="Escolher pasta", command=self.choose_project).pack(side="left", padx=(0, 6))
        ttk.Button(location, text="Localizar instalação em uso", command=self.detect_existing).pack(side="left")
        ttk.Label(outer, textvariable=self.status_value, foreground="#2563eb").pack(anchor="w", pady=(0, 10))
        panel_location = (str(Path(sys.executable).resolve().parent)
                          if getattr(sys, "frozen", False) else "ambiente de desenvolvimento")
        ttk.Label(outer,
                  text=f"Painel instalado em: {panel_location} | Servidor: pasta independente e gravável",
                  foreground="#64748b").pack(anchor="w", pady=(0, 5))

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

        remote = ttk.LabelFrame(outer, text="CONTROLE REMOTO — SERVIDOR EM OUTRO PC (TAILSCALE + SSH)", padding=8)
        remote.pack(fill="x", pady=(10, 0))
        fields = ttk.Frame(remote)
        fields.pack(fill="x")
        for column, (label, variable, size) in enumerate([
            ("IP Tailscale do servidor (100.x.x.x)", self.remote_ip, 22),
            ("Usuário Windows do servidor", self.remote_user, 20),
            ("Pasta do projeto no servidor (C:\\\\...)", self.remote_project, 50),
        ]):
            area = ttk.Frame(fields)
            area.grid(row=0, column=column, sticky="ew", padx=(0, 8))
            fields.columnconfigure(column, weight=3 if column == 2 else 1)
            ttk.Label(area, text=label).pack(anchor="w")
            ttk.Entry(area, textvariable=variable, width=size).pack(fill="x")

        actions = ttk.Frame(remote)
        actions.pack(fill="x", pady=(8, 0))
        for index, (label, callback) in enumerate([
            ("Instalar Tailscale (1ª vez)", self.remote_install_tailscale),
            ("1. Gerar/copiar chave deste PC", self.remote_generate_key),
            ("2. Autorizar no servidor (local)", self.remote_enable),
            ("3. Confiar na identidade", self.remote_pair),
            ("Testar conexão", self.remote_connect),
            ("ATUALIZAR SERVIDOR REMOTO", self.remote_update),
        ]):
            button = ttk.Button(actions, text=label, command=callback)
            button.grid(row=index // 3, column=index % 3, sticky="ew",
                        padx=(0, 7), pady=(0, 4))
            actions.columnconfigure(index % 3, weight=1)
            self.buttons.append(button)
        ttk.Label(remote, text="Ative Tailscale nos dois computadores. A autorização inicial é feita UMA VEZ no PC servidor, como administrador.",
                  foreground="#64748b").pack(anchor="w", pady=(5, 0))

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
                    self.status_value.set("API local online" if api_ok() else "API local indisponível — para outro PC use Testar conexão")
                    if isinstance(data, dict) and data.get("kind") == "discovery":
                        self._offer_discovered(data)
                    else:
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

    def detect_existing(self):
        """Procura o backend ativo de forma somente leitura, sem baixar Git ou tocar no banco."""
        self.run_background("Localizando a instalação existente", self._detect_existing)

    def _detect_existing(self):
        current = Path(self.project_value.get()).expanduser()
        found = locate_projects(current)
        return {"kind": "discovery", "found": found}

    def _offer_discovered(self, report):
        found = report["found"]
        if not found:
            messagebox.showwarning(
                "Servidor não localizado",
                "Não consegui identificar automaticamente a pasta que executa o estoque.\n\n"
                "Isso NÃO significa que o banco esteja ausente. Clique em Escolher pasta e "
                "selecione a pasta que contém backend, dist e os dados locais. "
                "Nada foi instalado ou modificado."
            )
            return
        # Mais de uma instalação exige confirmação explícita para evitar apontar
        # o painel a clone de testes em lugar do servidor que atende os usuários.
        if len(found) == 1:
            chosen = found[0]
        else:
            menu = "\n".join(
                f"{n}. {r['path']}  [{r['source']}]"
                for n, r in enumerate(found[:10], 1)
            )
            index = simpledialog.askinteger(
                "Selecionar instalação existente",
                "Foram encontradas instalações diferentes. Escolha a pasta correta; "
                "não alteraremos nenhuma delas automaticamente:\n\n" + menu,
                minvalue=1, maxvalue=min(len(found), 10), parent=self.root
            )
            if index is None:
                return
            chosen = found[index - 1]
        path = chosen["path"]
        if not messagebox.askyesno(
            "Confirmar servidor",
            f"Usar esta pasta no painel?\n\n{path}\n\n"
            f"Identificação: {chosen['source']}\n"
            f"Clone Git: {'SIM' if chosen['git'] else 'NÃO'}\n\n"
            "Esta operação só salva o caminho no painel. Não interrompe o estoque."
        ):
            return
        self.project_value.set(str(path))
        self.project()
        self._log("Pasta de instalação selecionada: " + str(path))
        if not chosen["git"]:
            messagebox.showwarning(
                "Instalação existente sem clone Git",
                "Encontrei o ESTQ em execução, mas esta pasta não possui o "
                "controle de versões .git.\n\n"
                "O estoque continua funcionando normalmente. NÃO vamos clonar "
                "ou substituir arquivos por cima dele. A atualização direta exige "
                "vinculação segura da instalação existente ao repositório, "
                "sem recriar banco ou mudar uploads."
            )
        else:
            messagebox.showinfo(
                "Instalação localizada",
                "O caminho correto foi associado ao painel. Agora o botão "
                "Atualizar do GitHub e publicar usará esta instalação."
            )

    def _check_active_target(self, project: Path) -> None:
        """Nunca publicar silenciosamente em outro clone enquanto API local está ativa."""
        if not api_ok():
            return
        active = locate_projects(processes=windows_processes(), other_roots=[])
        active_paths = {x["path"] for x in active if x["source"] == "processo ativo"}
        if active_paths and project.resolve() not in active_paths:
            choices = "\n".join(str(x) for x in sorted(active_paths, key=str))
            raise RuntimeError(
                "A API está online, mas foi iniciada por OUTRA pasta:\n" + choices +
                "\n\nUse Localizar instalação em uso. "
                "Atualização bloqueada para não publicar no projeto errado."
            )

    def remote_install_tailscale(self):
        if messagebox.askyesno("Tailscale",
            "Instalar o Tailscale oficial pelo Winget neste computador? "
            "Depois será necessário fazer login na rede privada."):
            self.run_background("Instalando Tailscale", self._winget, "Tailscale.Tailscale")

    def remote_generate_key(self):
        """A chave privada nunca deixa o PC de controle."""
        DATA.mkdir(parents=True, exist_ok=True)
        if not REMOTE_KEY.is_file():
            binary = find_binary("ssh-keygen")
            if not binary:
                messagebox.showerror("Acesso remoto", "OpenSSH Client do Windows não foi encontrado.")
                return
            self._run([binary, "-q", "-t", "ed25519", "-a", "64",
                       "-N", "", "-f", str(REMOTE_KEY), "-C", "ESTQ-painel-remoto"],
                      timeout=35, display=False)
        public = Path(str(REMOTE_KEY) + ".pub")
        if not public.is_file():
            messagebox.showerror("Acesso remoto", "Chave pública não encontrada.")
            return
        self.root.clipboard_clear()
        self.root.clipboard_append(public.read_text(encoding="ascii").strip())
        messagebox.showinfo("Chave pública copiada",
            "Chave pública copiada! No computador SERVIDOR, abra este painel como "
            "Administrador, escolha a pasta correta do projeto e clique "
            "'Autorizar no servidor (local)'. Cole a chave. "
            "Nunca copie/envie o arquivo da chave privada.")

    def remote_enable(self):
        project = self.project()
        if not (project / "ops" / "windows" / "HABILITAR_REMOTO.ps1").is_file():
            messagebox.showerror("Acesso remoto", "Projeto do servidor ainda não está atualizado.")
            return
        key = simpledialog.askstring("Autorizar seu PC",
            "Cole a chave PÚBLICA gerada no seu computador de controle:",
            parent=self.root)
        if not key:
            return
        if not re.fullmatch(r"ssh-ed25519 [A-Za-z0-9+/=]+(?: [A-Za-z0-9._@ -]{0,120})?", key.strip()):
            messagebox.showerror("Chave inválida", "Cole somente a chave pública ssh-ed25519.")
            return
        if not messagebox.askyesno("Configurar servidor",
            "Isso instala/habilita o OpenSSH no computador SERVIDOR "
            "e restringe a porta SSH ao Tailscale. Exige permissão de Administrador. "
            "Não modifica o ERP ou o banco. Continuar?"):
            return
        self.run_background("Autorizando conexão privada no servidor",
            self._enable_ssh, project, key.strip())

    def _enable_ssh(self, project, key):
        script = project / "ops" / "windows" / "HABILITAR_REMOTO.ps1"
        return self._run(["powershell.exe", "-NoProfile", "-ExecutionPolicy", "Bypass",
                          "-File", str(script), "-Projeto", str(project),
                          "-PublicKey", key], timeout=1200)

    def _remote_values(self):
        ip = self.remote_ip.get().strip()
        try:
            address = ipaddress.ip_address(ip)
        except ValueError as exc:
            raise RuntimeError("Informe o IP Tailscale (100.x.x.x) do servidor.") from exc
        if address.version != 4 or address not in ipaddress.ip_network("100.64.0.0/10"):
            raise RuntimeError("Por segurança, o painel aceita somente IP privado Tailscale (100.64.0.0/10).")
        user = self.remote_user.get().strip()
        if not re.fullmatch(r"[A-Za-z0-9_.-]{1,64}", user):
            raise RuntimeError("Informe o nome do usuário Windows do servidor (sem domínio).")
        project = self.remote_project.get().strip().rstrip("\\")
        if not re.fullmatch(r"[A-Za-z]:\\[A-Za-z0-9_ .\\-]{3,210}", project):
            raise RuntimeError("Informe a pasta Windows completa do projeto no servidor, sem caracteres especiais.")
        self.config.update(remote_ip=ip, remote_user=user, remote_project=project)
        save_config(self.config)
        return ip, user, project

    def remote_pair(self):
        try:
            host, _, _ = self._remote_values()
        except RuntimeError as exc:
            messagebox.showerror("Acesso remoto", str(exc))
            return
        expected = simpledialog.askstring("Identidade do servidor",
            "Digite o SHA256:... exibido pelo PAINEL no computador servidor "
            "(FINGERPRINT_HOST). Só aceite se for exatamente igual:",
            parent=self.root)
        if expected:
            self.run_background("Verificando identidade SSH", self._pair_ssh,
                                host, expected.strip())

    def _pair_ssh(self, host, expected):
        scan = find_binary("ssh-keyscan")
        keygen = find_binary("ssh-keygen")
        if not scan or not keygen:
            raise RuntimeError("OpenSSH Client incompleto: faltam ssh-keyscan e ssh-keygen.")
        result = self._run([scan, "-T", "12", "-t", "ed25519", host],
                           timeout=25, display=False)
        line = next((x.strip() for x in result.splitlines()
                     if len(x.split()) >= 3 and x.split()[1] == "ssh-ed25519"), "")
        if not line:
            raise RuntimeError("Servidor não apresentou host key ed25519.")
        DATA.mkdir(parents=True, exist_ok=True)
        candidate = DATA / "hostkey_candidate.tmp"
        try:
            candidate.write_text(line + "\n", encoding="ascii")
            fingerprint = self._run([keygen, "-lf", str(candidate), "-E", "sha256"],
                                    timeout=12, display=False)
        finally:
            candidate.unlink(missing_ok=True)
        found = re.search(r"SHA256:[A-Za-z0-9+/=]+", fingerprint)
        if not found or not hmac.compare_digest(found.group(), expected):
            raise RuntimeError("A identidade do servidor NÃO confere. Pareamento recusado.")
        if REMOTE_HOSTS.is_file():
            existing = REMOTE_HOSTS.read_text(encoding="ascii")
            if any(x.startswith(host + " ") and x.strip() != line
                   for x in existing.splitlines()):
                raise RuntimeError("Já existe outra identidade para este servidor. "
                                   "Não sobrescrevemos host keys automaticamente.")
            if line not in existing.splitlines():
                with REMOTE_HOSTS.open("a", encoding="ascii") as fp:
                    fp.write(line + "\n")
        else:
            REMOTE_HOSTS.write_text(line + "\n", encoding="ascii")
        return "Identidade SHA256 confirmada. A conexão SSH agora exige essa chave do servidor."

    def _remote_command(self, action):
        if action not in ("status", "update"):
            raise RuntimeError("Ação remota não autorizada.")
        host, user, project = self._remote_values()
        if not REMOTE_KEY.is_file() or not REMOTE_HOSTS.is_file():
            raise RuntimeError("Gere a chave deste PC e confirme o fingerprint do servidor primeiro.")
        ssh = find_binary("ssh")
        if not ssh:
            raise RuntimeError("OpenSSH Client não está instalado no Windows.")
        # O sshd usa ForceCommand por chave: apenas "status" e "update".
        return [ssh, "-T", "-i", str(REMOTE_KEY),
                "-o", "BatchMode=yes", "-o", "IdentitiesOnly=yes",
                "-o", "StrictHostKeyChecking=yes",
                "-o", "GlobalKnownHostsFile=NUL",
                "-o", "UserKnownHostsFile=" + str(REMOTE_HOSTS),
                "-o", "ClearAllForwardings=yes",
                "-o", "ConnectTimeout=12",
                "-o", "ServerAliveInterval=15", "-o", "ServerAliveCountMax=3",
                user + "@" + host,
                action]

    def _execute_remote(self, action):
        command = self._remote_command(action)
        proc = subprocess.Popen([str(x) for x in command],
                                stdout=subprocess.PIPE, stderr=subprocess.STDOUT,
                                text=True, encoding="utf-8", errors="replace",
                                creationflags=getattr(subprocess, "CREATE_NO_WINDOW", 0))
        recent = []
        try:
            for line in proc.stdout:
                line = line.rstrip()
                if line:
                    self._log(line)
                    recent.append(line)
                    recent = recent[-12:]
            code = proc.wait(timeout=30)
        finally:
            if proc.poll() is None:
                proc.kill()
        if code:
            raise RuntimeError("Falha no comando remoto (" + str(code) + "): " +
                               " | ".join(recent[-4:])[-600:])
        return "Conexão remota validada." if action == "status" else (
            "Atualização remota concluída. Confira também o log e o estado da API."
        )

    def remote_connect(self):
        try:
            self._remote_command("status")
            self.run_background("Testando servidor privado", self._execute_remote, "status")
        except RuntimeError as exc:
            messagebox.showerror("Acesso remoto", str(exc))

    def remote_update(self):
        try:
            self._remote_command("update")
        except RuntimeError as exc:
            messagebox.showerror("Acesso remoto", str(exc))
            return
        if messagebox.askyesno("Atualização REMOTA",
            "Atualizar o ESTQ no computador servidor?\n\n"
            "A atualização será bloqueada se existirem alterações de banco, "
            "dependências ou falta de controle seguro do backend. "
            "Se for necessário reiniciar, pode haver uma breve interrupção. "
            "Evite executar durante movimentações de estoque."):
            self.run_background("Atualizando servidor remoto com validações",
                                self._execute_remote, "update")

    def _run(self, command, cwd=None, env=None, input_text=None, timeout=2400, display=True):
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
        if output and display:
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
            if binary == "python":
                ready = False
                try:
                    self._python_for_venv()
                    ready = True
                except RuntimeError:
                    pass
                if ready:
                    self._log(label + " detectado.")
                    continue
            elif present:
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
            # Nunca registrar URL: origin pode conter credencial de checkout privado.
            remote = self._run(
                [git, "remote", "get-url", "origin"], cwd=project, display=False
            ).lower()
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
            result = subprocess.run(
                [str(py), "-3.13", "--version"], capture_output=True,
                text=True, timeout=10,
                creationflags=getattr(subprocess, "CREATE_NO_WINDOW", 0),
            )
            if result.returncode == 0 and "Python 3.13" in (result.stdout + result.stderr):
                return [str(py), "-3.13"]
        python = find_binary("python")
        candidates = [
            python,
            Path(os.environ.get("ProgramFiles", "C:/Program Files")) / "Python313" / "python.exe",
            Path(os.environ.get("LOCALAPPDATA", str(Path.home()))) / "Programs" / "Python" / "Python313" / "python.exe",
        ]
        for candidate in candidates:
            if not candidate or not candidate.is_file():
                continue
            result = subprocess.run(
                [str(candidate), "--version"], capture_output=True,
                text=True, timeout=10,
                creationflags=getattr(subprocess, "CREATE_NO_WINDOW", 0),
            )
            if result.returncode == 0 and "Python 3.13" in (result.stdout + result.stderr):
                return [str(candidate)]
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
        if not is_estq_project(project):
            if messagebox.askyesno(
                "Caminho do servidor não identificado",
                "A pasta configurada não corresponde a uma instalação existente "
                "do ESTQ. Deseja localizar a instalação em uso?\n\n"
                "Não será criado outro servidor nem outro banco."
            ):
                self.detect_existing()
            return
        if not (project / ".git").exists():
            if messagebox.askyesno(
                "Instalação antiga sem Git",
                "Encontrei o estoque instalado nesta pasta, mas ela não contém "
                "um clone Git. Não vou fazer nova instalação nem sobrescrever "
                "o servidor existente.\n\nDeseja localizar outra instalação "
                "que esteja vinculada ao GitHub?"
            ):
                self.detect_existing()
            return
        try:
            self._check_active_target(project)
        except RuntimeError as error:
            messagebox.showerror("Proteção do servidor", str(error))
            return
        if not messagebox.askyesno(
            "Atualizar o servidor em uso",
            f"Instalação selecionada:\n{project}\n\n"
            "Publicar a versão do GitHub com verificações de segurança?\n"
            "Atualizações com migrations ou dependências do backend serão "
            "bloqueadas até execução supervisionada.\n\n"
            "Se houver reinício, pode ocorrer breve interrupção. "
            "Não atualize durante movimentações de estoque."
        ):
            return
        self.run_background("Atualização segura do servidor existente",
                            self._update_publish, project)

    def _update_publish(self, project):
        self._check_active_target(project)
        if not (project / ".git").exists():
            raise RuntimeError("Esta instalação não está vinculada ao GitHub. Nada foi alterado.")
        if not api_ok():
            raise RuntimeError(
                "O servidor local não responde. Atualização bloqueada para "
                "não publicar em um banco ou instalação desconhecidos."
            )
        # Reutiliza exatamente as proteções e o motor da atualização remota,
        # mas executando localmente; sem instalar um clone novo ou iniciar outra API.
        python = python_project(project)
        updater = project / "ops" / "remote_update.py"
        if not updater.is_file():
            raise RuntimeError(
                "O projeto ainda não contém o atualizador seguro. "
                "Não execute 'Preparar aplicativo' em cima do ERP em uso."
            )
        return self._run([python, updater, "--project-dir", project, "update"],
                         cwd=project, timeout=3600)

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

    def _restored_database(self, project):
        env_path = project / "backend" / ".env"
        if not env_path.is_file():
            raise RuntimeError("backend/.env ausente.")
        # Apenas lê configurações, sem expor segredos ou modificar dados.
        values = {}
        for line in env_path.read_text(encoding="utf-8-sig").splitlines():
            if not line.strip() or line.lstrip().startswith("#") or "=" not in line:
                continue
            key, value = line.split("=", 1)
            values[key.strip()] = value.strip().strip('"').strip("'")
        for key in ("DB_HOST", "DB_PORT", "DB_NAME", "DB_USER", "DB_PASSWORD"):
            if not values.get(key):
                raise RuntimeError("Configuração incompleta: falta " + key)
        psql = find_binary("psql")
        if not psql:
            raise RuntimeError("Cliente PostgreSQL psql não encontrado.")
        subprocess_env = os.environ.copy()
        subprocess_env["PGPASSWORD"] = values["DB_PASSWORD"]
        cmd = [str(psql), "-h", values["DB_HOST"], "-p", values["DB_PORT"],
               "-U", values["DB_USER"], "-d", values["DB_NAME"],
               "-X", "-v", "ON_ERROR_STOP=1", "-At", "-c",
               "SELECT to_regclass('public.alembic_version') IS NOT NULL"]
        result = subprocess.run(cmd, env=subprocess_env, capture_output=True,
                                text=True, timeout=15,
                                creationflags=getattr(subprocess, "CREATE_NO_WINDOW", 0))
        if result.returncode != 0 or result.stdout.strip() != "t":
            raise RuntimeError(
                "Banco do ESTQ sem estrutura restaurada. Não é seguro iniciar o servidor "
                "antes de restaurar os dados. Não execute migrations sobre um banco vazio."
            )
        return True

    def _start(self, project):
        if api_ok():
            return "Backend já responde em http://127.0.0.1:8000. Nenhuma instância duplicada foi iniciada."
        if port_busy():
            raise RuntimeError("Porta 8000 já usada por outro processo. Não iniciamos servidor duplicado.")
        self._restored_database(project)
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
        self._restored_database(project)
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
        self.status_value.set("API local online" if api_ok() else "API local indisponível — para outro PC use Testar conexão")
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
