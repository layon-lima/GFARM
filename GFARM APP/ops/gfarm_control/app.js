"use strict";
let CSRF = "";
let busy = false;
let logsCache = "";
const $ = id => document.getElementById(id);
const txt = (id, value) => { const el = $(id); if (el) el.textContent = String(value ?? "—"); };

async function request(path, method = "GET", data = null) {
  const options = { method, credentials: "same-origin", headers: {} };
  if (method !== "GET") {
    options.headers["Content-Type"] = "application/json";
    options.headers["X-GFARM-CSRF"] = CSRF;
    options.body = JSON.stringify(data || {});
  }
  const resp = await fetch(path, options);
  let result;
  try { result = await resp.json(); } catch { throw new Error("Resposta inválida do servidor Control."); }
  if (resp.status === 401 && path !== "/api/login") {
    $("workspace").classList.add("hidden");
    $("login").classList.remove("hidden");
  }
  if (!resp.ok) throw new Error(result.error || "Operação não concluída.");
  return result;
}
function message(text, isError = false) {
  const el = $("notice");
  el.textContent = text;
  el.classList.remove("hidden");
  el.classList.toggle("error", isError);
  if (!isError) setTimeout(() => { if (el.textContent === text) el.classList.add("hidden"); }, 9000);
}
function page(name) {
  const names = {overview:"Visão geral",updates:"Atualizações",server:"Servidor",backups:"Backups",remote:"Acesso remoto",maintenance:"Manutenção"};
  if (!names[name]) return;
  Object.keys(names).forEach(key => $("page-" + key).classList.toggle("hidden", key !== name));
  document.querySelectorAll(".nav-item").forEach(el => el.classList.toggle("active", el.dataset.page === name));
  txt("page-title", names[name]);
  if (name === "backups") refreshBackups();
  if (name === "maintenance") refreshLogs();
}
function renderStatus(payload) {
  CSRF = payload.csrf;
  const s = payload.system, j = payload.job;
  txt("m-app", s.app_online ? "Online" : "Desligado");
  txt("m-db", s.database_configured ? "Configurado" : "Não configurado");
  txt("m-version", s.version && s.version.length > 12 ? s.version.substring(0, 12) : s.version);
  txt("m-backups", s.backup_count);
  txt("m-path", s.project);
  $("online-chip").textContent = s.app_online ? "Servidor online" : "Servidor desligado";
  $("online-chip").classList.toggle("off", !s.app_online);
  $("automatic").checked = Boolean(s.automatic);
  if (document.activeElement !== $("remote-ip")) $("remote-ip").value = s.remote_host || "127.0.0.1";
  txt("job-message", j.message);
  txt("update-message", j.message);
  txt("job-state", j.state === "running" ? "Operação em andamento" : j.state === "done" ? "Concluída" : j.state === "error" ? "Falha" : "Pronto");
  txt("update-state", j.state === "running" ? "Atualizando ou processando..." : j.state === "done" ? "Concluído" : j.state === "error" ? "Falhou" : "Aguardando");
  $("job-state").classList.toggle("error", j.state === "error");
  $("update-state").classList.toggle("error", j.state === "error");
  busy = j.state === "running";
  document.querySelectorAll("[data-action]").forEach(btn => btn.disabled = busy);
}
async function status() {
  try { renderStatus(await request("/api/status")); } catch (ex) { console.warn(ex.message); }
}
async function operate(action, data = {}) {
  if (busy) return message("Uma operação ainda está em andamento.", true);
  if (action === "stop" && !confirm("Desligar somente a API do GFARM? O PostgreSQL continuará funcionando.")) return;
  if (action === "update" && !confirm("Atualizar GFARM pela branch main? A versão atual será preservada.")) return;
  if (action === "restore" && !confirm("A restauração só será permitida se banco e diretórios estiverem vazios. Confirmar?")) return;
  try {
    await request("/api/action", "POST", { action, ...data });
    await status();
    message("Operação iniciada. Acompanhe o progresso no painel.");
  } catch (ex) { message(ex.message, true); }
}
async function refreshBackups() {
  try {
    const result = await request("/api/backups");
    const root = $("backup-list");
    root.replaceChildren();
    if (!result.items.length) {
      const msg = document.createElement("p");
      msg.className = "muted";
      msg.textContent = "Nenhum backup disponível.";
      root.append(msg);
      return;
    }
    result.items.forEach(file => {
      const line = document.createElement("div");
      line.className = "list-row";
      const name = document.createElement("b");
      name.textContent = file.nome + "  ·  " + (file.bytes / 1048576).toFixed(1) + " MB";
      const button = document.createElement("button");
      button.textContent = "Verificar";
      button.addEventListener("click", () => operate("verify", {name:file.nome}));
      const pick = document.createElement("button");
      pick.textContent = "Selecionar";
      pick.addEventListener("click", () => { $("restore-file").value = file.nome; message("Backup selecionado para restauração em banco vazio."); });
      line.append(name, button, pick);
      root.append(line);
    });
  } catch (ex) { message(ex.message, true); }
}
async function refreshLogs() {
  try {
    logsCache = (await request("/api/log")).lines.join("\n");
    txt("logs", logsCache || "Nenhum registro encontrado.");
  } catch (ex) { message(ex.message, true); }
}
async function enterPanel() {
  $("login").classList.add("hidden");
  $("workspace").classList.remove("hidden");
  await status();
}
document.addEventListener("DOMContentLoaded", async () => {
  $("login-form").addEventListener("submit", async ev => {
    ev.preventDefault();
    try {
      const answer = await request("/api/login", "POST", {password:$("password").value});
      CSRF = answer.csrf;
      $("password").value = "";
      txt("login-error", "");
      await enterPanel();
    } catch (ex) { txt("login-error", ex.message); }
  });
  document.querySelectorAll("[data-page]").forEach(item =>
    item.addEventListener("click", () => page(item.dataset.page))
  );
  document.querySelectorAll("[data-action]").forEach(item =>
    item.addEventListener("click", () => operate(item.dataset.action))
  );
  $("open-app").addEventListener("click", () => {
    if (["localhost", "127.0.0.1"].includes(window.location.hostname)) {
      window.open("http://127.0.0.1:8000/", "_blank", "noopener,noreferrer");
    } else {
      message("A API do GFARM nao esta exposta na porta 8000 para acesso remoto. Abra o sistema pelo endereco HTTPS habitual.", true);
    }
  });
  $("import-assets-button").addEventListener("click", () => {
    const selected = $("assets-backup-path").value.trim();
    if (!selected) return message("Informe o caminho completo do ZIP local.", true);
    if (!confirm("Importar somente fotos, documentos e XMLs? O banco de dados permanecerá intocado.")) return;
    operate("import_files", {path:selected});
  });
  $("restore-button").addEventListener("click", () => operate("restore", {
    name:$("restore-file").value.trim(), confirmation:$("restore-confirmation").value.trim()
  }));
  $("automatic").addEventListener("change", async ev => {
    try { message((await request("/api/automatic", "POST", {enabled:ev.target.checked})).message); }
    catch(ex) { message(ex.message, true); await status(); }
  });
  $("database-form").addEventListener("submit", async ev => {
    ev.preventDefault();
    if (!confirm("Salvar as configurações do PostgreSQL existente? Nenhuma tabela será apagada.")) return;
    const values = Object.fromEntries(new FormData(ev.target).entries());
    try {
      message((await request("/api/database", "POST", values)).message);
      ev.target.querySelectorAll("input[type=password]").forEach(el => el.value = "");
      await status();
    } catch (ex) { message(ex.message, true); }
  });
  $("save-remote").addEventListener("click", async () => {
    try { message((await request("/api/remote", "POST", {host:$("remote-ip").value.trim()})).message); }
    catch (ex) { message(ex.message, true); }
  });
  $("generate-key").addEventListener("click", async () => {
    try {
      const item = await request("/api/deploy-key");
      txt("public-key", item.public_key);
      $("public-key").classList.remove("hidden");
    } catch (ex) { message(ex.message, true); }
  });
  $("refresh-logs").addEventListener("click", refreshLogs);
  $("copy-logs").addEventListener("click", () => {
    navigator.clipboard.writeText(logsCache).then(() => message("Log copiado.")).catch(() => message("Não foi possível copiar.", true));
  });
  $("logout").addEventListener("click", async () => {
    try { await request("/api/logout", "POST"); } catch {}
    CSRF = "";
    $("workspace").classList.add("hidden");
    $("login").classList.remove("hidden");
  });
  try {
    const setup = await request("/api/bootstrap");
    if (!setup.installed) txt("login-error", "O instalador ainda precisa configurar a senha administrativa.");
    if (setup.authenticated) await enterPanel();
  } catch (ex) { txt("login-error", ex.message); }
  setInterval(() => {
    if (!$("workspace").classList.contains("hidden")) status();
  }, 3000);
});
