"""GFARM Control: painel independente do ERP, sem dependencias de terceiros."""
from __future__ import annotations

import argparse
import getpass
import hashlib
import hmac
import http.cookies
import http.server
import ipaddress
import json
import os
import secrets
import socket
import sys
import threading
import time
from pathlib import Path
from urllib.parse import urlsplit

try:
    from . import engine
except ImportError:
    import engine

PORT = 8787
PASSWORD_PATH = engine.ROOT / "control-auth.json"
SESSIONS = {}
RATE = {}
CURRENT_JOB = {"state": "idle", "message": "Nenhuma operacao iniciada."}
JOB_LOCK = threading.RLock()


def resource(name):
    root = Path(getattr(sys, "_MEIPASS", Path(__file__).resolve().parent))
    path = root / name
    if not path.is_file():
        raise RuntimeError("Arquivo do Control nao encontrado: " + name)
    return path.read_bytes()


def password_hash(password, salt):
    return hashlib.pbkdf2_hmac("sha256", password.encode("utf-8"), salt, 350000).hex()


def provision(password):
    if len(password) < 12:
        raise RuntimeError("Senha do GFARM Control precisa ter pelo menos 12 caracteres.")
    if PASSWORD_PATH.exists():
        raise RuntimeError("Senha ja configurada. O instalador nao sobrescreve senhas existentes.")
    PASSWORD_PATH.parent.mkdir(parents=True, exist_ok=True)
    salt = secrets.token_bytes(24)
    digest = {"salt": salt.hex(), "digest": password_hash(password, salt)}
    tmp = PASSWORD_PATH.with_suffix(".tmp")
    tmp.write_text(json.dumps(digest), encoding="utf-8")
    os.replace(tmp, PASSWORD_PATH)


def login_valid(password):
    if not PASSWORD_PATH.exists():
        return False
    auth = json.loads(PASSWORD_PATH.read_text(encoding="utf-8"))
    correct = bytes.fromhex(auth["digest"])
    actual = bytes.fromhex(password_hash(password, bytes.fromhex(auth["salt"])))
    return hmac.compare_digest(correct, actual)


def local(host):
    return host in ("127.0.0.1", "::1", "localhost")


def valid_bind_ip(value):
    try:
        return ipaddress.ip_address(value) in ipaddress.ip_network("100.64.0.0/10")
    except ValueError:
        return False


def valid_host(header):
    name = header.strip().lower().split(":")[0]
    return local(name) or name == engine.load().get("remote_host")


def job_start(action, options):
    with JOB_LOCK:
        if CURRENT_JOB["state"] == "running":
            raise RuntimeError("Ja existe uma operacao em andamento.")
        CURRENT_JOB.update(state="running", action=action, message="Iniciando...", ended=None)

    def worker():
        def report(message):
            with JOB_LOCK:
                CURRENT_JOB["message"] = message
            engine.write_log(action + ": " + message)
        try:
            report("Executando " + action + "...")
            if action == "start":
                result = engine.start()
            elif action == "stop":
                result = engine.stop()
            elif action == "restart":
                result = engine.restart()
            elif action == "backup":
                result = engine.create_backup()
            elif action == "verify":
                result = engine.verify_backup(options.get("name", ""))
            elif action == "restore":
                result = engine.restore_empty(options.get("name", ""),
                                              options.get("confirmation", ""))
            elif action == "import_files":
                result = engine.import_assets_only(options.get("path", ""))
            elif action == "update":
                result = engine.update(report)
            else:
                raise RuntimeError("Acao nao permitida.")
            with JOB_LOCK:
                CURRENT_JOB.update(state="done", message=str(result),
                                   ended=time.time())
            engine.write_log(action + " concluido.")
        except Exception as ex:
            with JOB_LOCK:
                CURRENT_JOB.update(state="error", message=str(ex),
                                   ended=time.time())
            engine.write_log(action + " FALHOU: " + str(ex))
    threading.Thread(target=worker, name="gfarm-job", daemon=True).start()


class Handler(http.server.BaseHTTPRequestHandler):
    server_version = "GFARMControl/1.0"

    def log_message(self, fmt, *args):
        # Nao registrar tokens, senhas ou cookies.
        if self.path.split("?")[0] not in ("/api/login", "/api/status"):
            engine.write_log("http: " + fmt % args)

    def send(self, status, body, *, cookie=None, mime="application/json"):
        if isinstance(body, (dict, list)):
            data = json.dumps(body, ensure_ascii=False).encode("utf-8")
        elif isinstance(body, str):
            data = body.encode("utf-8")
        else:
            data = body
        self.send_response(status)
        self.send_header("Content-Type", mime + ("; charset=utf-8" if mime.startswith("text/") or mime == "application/json" else ""))
        self.send_header("Content-Length", str(len(data)))
        self.send_header("Cache-Control", "no-store")
        self.send_header("X-Content-Type-Options", "nosniff")
        self.send_header("X-Frame-Options", "DENY")
        self.send_header("Referrer-Policy", "no-referrer")
        self.send_header("Content-Security-Policy", "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; connect-src 'self'; base-uri 'none'; form-action 'self'; frame-ancestors 'none'")
        if cookie:
            self.send_header("Set-Cookie", cookie)
        self.end_headers()
        self.wfile.write(data)

    def json_body(self):
        if int(self.headers.get("Content-Length", "0")) > 32768:
            raise RuntimeError("Requisicao grande demais.")
        length = int(self.headers.get("Content-Length", "0"))
        if length < 2:
            return {}
        result = json.loads(self.rfile.read(length))
        if not isinstance(result, dict):
            raise RuntimeError("Corpo JSON invalido.")
        return result

    def session(self):
        cookies = http.cookies.SimpleCookie()
        try:
            cookies.load(self.headers.get("Cookie", ""))
        except http.cookies.CookieError:
            return None
        token = cookies.get("gfarm_session")
        if not token:
            return None
        session = SESSIONS.get(token.value)
        if not session or session["expires"] < time.monotonic():
            SESSIONS.pop(token.value, None)
            return None
        return session

    def origin_ok(self):
        origin = self.headers.get("Origin")
        if not origin:
            return False
        parts = urlsplit(origin)
        return parts.scheme in ("http", "https") and parts.netloc.lower() == self.headers.get("Host", "").lower()

    def authorized(self, csrf=False):
        session = self.session()
        if session is None:
            self.send(401, {"error": "Autenticacao necessaria."})
            return None
        if csrf and (not self.origin_ok() or
                     not hmac.compare_digest(self.headers.get("X-GFARM-CSRF", ""),
                                             session["csrf"])):
            self.send(403, {"error": "Verificacao de seguranca falhou."})
            return None
        return session

    def do_GET(self):
        path = self.path.split("?")[0]
        if not valid_host(self.headers.get("Host", "")):
            self.send(403, {"error": "Host nao permitido."})
            return
        if path in ("/", "/index.html"):
            self.send(200, resource("ui.html"), mime="text/html")
            return
        if path == "/app.js":
            self.send(200, resource("app.js"), mime="text/javascript")
            return
        if path == "/api/bootstrap":
            self.send(200, {"installed": PASSWORD_PATH.is_file(),
                            "authenticated": bool(self.session())})
            return
        session = self.authorized()
        if session is None:
            return
        if path == "/api/status":
            self.send(200, {"system": engine.status(), "job": dict(CURRENT_JOB),
                            "csrf": session["csrf"]})
        elif path == "/api/backups":
            self.send(200, {"items": engine.list_backups()})
        elif path == "/api/log":
            log = engine.LOG
            lines = log.read_text(encoding="utf-8", errors="replace").splitlines()[-120:] if log.is_file() else []
            self.send(200, {"lines": lines})
        elif path == "/api/deploy-key":
            self.send(200, {"public_key": engine.public_key()})
        else:
            self.send(404, {"error": "Rota inexistente."})

    def do_POST(self):
        if not valid_host(self.headers.get("Host", "")):
            self.send(403, {"error": "Host nao permitido."})
            return
        path = self.path.split("?")[0]
        try:
            if path == "/api/login":
                if not self.origin_ok():
                    self.send(403, {"error": "Origem invalida."})
                    return
                who = self.client_address[0]
                if RATE.get(who, 0) > time.monotonic():
                    self.send(429, {"error": "Aguarde antes de tentar novamente."})
                    return
                data = self.json_body()
                if not login_valid(str(data.get("password", ""))):
                    RATE[who] = time.monotonic() + 3
                    self.send(401, {"error": "Senha incorreta."})
                    return
                token = secrets.token_urlsafe(36)
                session = {"expires": time.monotonic() + 8 * 3600,
                           "csrf": secrets.token_urlsafe(32)}
                SESSIONS[token] = session
                secure = "; Secure" if self.headers.get("Host", "").startswith("https://") else ""
                self.send(200, {"ok": True, "csrf": session["csrf"]},
                          cookie="gfarm_session=%s; HttpOnly; SameSite=Strict; Path=/; Max-Age=28800%s" % (token, secure))
                return
            session = self.authorized(csrf=True)
            if session is None:
                return
            data = self.json_body()
            if path == "/api/logout":
                cookies = http.cookies.SimpleCookie()
                cookies.load(self.headers.get("Cookie", ""))
                token = cookies.get("gfarm_session")
                if token:
                    SESSIONS.pop(token.value, None)
                self.send(200, {"ok": True}, cookie="gfarm_session=; Max-Age=0; Path=/; HttpOnly; SameSite=Strict")
            elif path == "/api/action":
                action = str(data.get("action", ""))
                if action not in ("start", "stop", "restart", "backup", "verify", "restore", "import_files", "update"):
                    raise RuntimeError("Acao nao autorizada.")
                job_start(action, data)
                self.send(202, {"ok": True, "job": dict(CURRENT_JOB)})
            elif path == "/api/database":
                if CURRENT_JOB["state"] == "running":
                    raise RuntimeError("Aguarde a operacao em andamento terminar.")
                answer = engine.save_database(data)
                self.send(200, {"message": answer})
            elif path == "/api/remote":
                host = str(data.get("host", "")).strip()
                if host != "127.0.0.1" and not valid_bind_ip(host):
                    raise RuntimeError("Endereco remoto deve ser IP Tailscale 100.64.0.0/10.")
                cfg = engine.load()
                cfg["remote_host"] = host
                engine.save(cfg)
                self.send(200, {"message": "Configurado. A interface remota sera ativada quando o IP Tailscale estiver disponivel."})
            elif path == "/api/automatic":
                cfg = engine.load()
                cfg["automatic"] = bool(data.get("enabled", True))
                engine.save(cfg)
                self.send(200, {"message": "Monitor automatico configurado."})
            else:
                self.send(404, {"error": "Rota inexistente."})
        except (RuntimeError, ValueError, OSError, json.JSONDecodeError) as ex:
            self.send(400, {"error": str(ex)})


def remote_listener():
    last = None
    while True:
        try:
            host = engine.load().get("remote_host", "127.0.0.1")
            if valid_bind_ip(host) and host != last:
                try:
                    with http.server.ThreadingHTTPServer((host, PORT), Handler) as srv:
                        last = host
                        engine.write_log("Control remoto ouvindo no IP Tailscale " + host)
                        while engine.load().get("remote_host") == host:
                            srv.timeout = 2
                            srv.handle_request()
                        last = None
                except OSError as exc:
                    engine.write_log("Aguardando Tailscale: " + str(exc))
        except Exception as ex:
            engine.write_log("Erro no acesso remoto: " + str(ex))
        time.sleep(10)


def main():
    p = argparse.ArgumentParser()
    p.add_argument("--setup-password-file", type=Path)
    p.add_argument("--open", action="store_true")
    p.add_argument("--port", type=int, default=PORT)
    args = p.parse_args()
    if args.open:
        import webbrowser
        webbrowser.open("http://127.0.0.1:%d/" % args.port)
        return
    if args.setup_password_file:
        password = args.setup_password_file.read_text(encoding="utf-8").strip()
        try:
            provision(password)
            print("Senha do GFARM Control configurada.")
        finally:
            args.setup_password_file.unlink(missing_ok=True)
        return
    if not PASSWORD_PATH.is_file():
        raise RuntimeError("GFARM Control ainda nao configurado pelo instalador.")
    engine.ROOT.mkdir(parents=True, exist_ok=True)
    threading.Thread(target=engine.watchdog, daemon=True).start()
    threading.Thread(target=remote_listener, daemon=True).start()
    server = http.server.ThreadingHTTPServer(("127.0.0.1", args.port), Handler)
    engine.write_log("GFARM Control ativo em http://127.0.0.1:%d" % args.port)
    server.serve_forever(poll_interval=0.5)


if __name__ == "__main__":
    try:
        main()
    except Exception as exc:
        # PyInstaller --windowed nao possui console: diagnostico local obrigatorio.
        # Senhas/tokens nao sao incluidos no log de inicializacao.
        try:
            engine.ROOT.mkdir(parents=True, exist_ok=True)
            with (engine.ROOT / "control-startup.log").open(
                    "a", encoding="utf-8") as log:
                from datetime import datetime
                log.write(datetime.now().isoformat(timespec="seconds") +
                          " | " + type(exc).__name__ + ": " + str(exc) + "\\n")
        except OSError:
            pass
        raise
