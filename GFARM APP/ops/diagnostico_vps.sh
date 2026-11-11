#!/usr/bin/env bash
# Coleta informações. NÃO reinicia, NÃO exclui, NÃO limpa dados ou containers.
set +e
umask 077
OUT="/root/diagnostico-vps-$(date +%Y%m%d-%H%M%S).txt"
{
  echo "######## DIAGNOSTICO VPS (somente leitura) ########"
  date -Is
  echo '--- INICIALIZACAO E CARGA ---'
  uptime
  who -b
  echo '--- MEMORIA/SWAP ---'
  free -h
  echo '--- PRESSAO DO SISTEMA ---'
  for f in /proc/pressure/memory /proc/pressure/cpu /proc/pressure/io; do
    if [ -r "$f" ]; then echo "$f"; cat "$f"; fi
  done
  echo '--- PROCESSOS MAIORES (memoria) ---'
  ps -eo pid,ppid,comm,stat,%mem,%cpu,rss --sort=-rss | head -n 22
  echo '--- PARTICOES E INODES ---'
  df -hT / /var/lib/docker /opt/apps 2>&1
  df -ih / /var/lib/docker /opt/apps 2>&1
  echo '--- SSH E DOCKER ---'
  systemctl is-active ssh 2>/dev/null || systemctl is-active sshd 2>/dev/null
  systemctl is-active docker 2>/dev/null
  echo '--- ERROS DE MEMORIA/DISCO DO BOOT ATUAL ---'
  journalctl -k -b --no-pager 2>/dev/null | grep -Ei 'oom|out of memory|killed process|memory cgroup|no space left|I/O error|ext4-fs error|blocked for more than' | tail -n 65
  echo '--- ERROS DE MEMORIA/DISCO DO BOOT ANTERIOR ---'
  journalctl -k -b -1 --no-pager 2>/dev/null | grep -Ei 'oom|out of memory|killed process|memory cgroup|no space left|I/O error|ext4-fs error|blocked for more than' | tail -n 65
  echo '--- SSH ULTIMAS 12 HORAS ---'
  journalctl --since '12 hours ago' -u ssh -u sshd --no-pager 2>/dev/null | grep -Ei 'fail|fatal|error|timeout|starting|stopped|killed|listening|refused|start request repeated' | tail -n 55
  echo '--- CONTAINERS (reinicios e OOM) ---'
  if command -v docker >/dev/null 2>&1; then
    timeout 20s docker ps -a --format 'table {{.Names}}\t{{.Status}}\t{{.Image}}' 2>&1 | head -n 75
    ids="$(timeout 15s docker ps -aq 2>/dev/null)"
    if [ -n "$ids" ]; then
      timeout 20s docker inspect --format '{{.Name}} | status={{.State.Status}} | reinicios={{.RestartCount}} | oom={{.State.OOMKilled}} | erro={{.State.Error}}' $ids 2>&1 | head -n 80
    fi
    echo '--- USO ATUAL DOS CONTAINERS ---'
    timeout 20s docker stats --no-stream --format 'table {{.Name}}\t{{.MemUsage}}\t{{.CPUPerc}}' 2>&1 | head -n 60
    echo '--- ESPACO CONSUMIDO POR IMAGENS/CACHE DOCKER ---'
    timeout 25s docker system df 2>&1
  else
    echo 'Docker nao instalado ou indisponivel.'
  fi
  echo '--- FIM DO DIAGNOSTICO ---'
} 2>&1 | tee "$OUT"
echo "RELATORIO: $OUT"
