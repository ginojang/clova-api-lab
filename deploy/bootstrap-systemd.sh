#!/usr/bin/env bash
# hellcat 에서 1회 실행 (sudo 비밀번호 입력 필요).
# systemd 유닛 2개 설치 + enable, 그리고 gino 에게 restart/is-active NOPASSWD 부여.
# 사용: ssh -i ~/.ssh/rs5_key gino@192.168.0.28 'bash ~/apps/clova-api-lab/bootstrap-systemd.sh'
set -euo pipefail

SLOT=/home/gino/apps/clova-api-lab
UNIT_DIR=/etc/systemd/system

echo "[1/4] systemd 유닛 복사"
sudo cp "$SLOT/clova-api-lab.service"        "$UNIT_DIR/clova-api-lab.service"
sudo cp "$SLOT/clova-api-lab-tunnel.service" "$UNIT_DIR/clova-api-lab-tunnel.service"

echo "[2/4] sudoers.d 설치 (gino: restart/is-active NOPASSWD)"
sudo tee /etc/sudoers.d/clova-api-lab >/dev/null <<'SUDOERS'
gino ALL=(root) NOPASSWD: /usr/bin/systemctl restart clova-api-lab, /usr/bin/systemctl restart clova-api-lab-tunnel, /usr/bin/systemctl is-active clova-api-lab, /usr/bin/systemctl is-active clova-api-lab-tunnel
SUDOERS
sudo chmod 440 /etc/sudoers.d/clova-api-lab
sudo visudo -cf /etc/sudoers.d/clova-api-lab

echo "[3/4] daemon-reload + enable --now"
sudo systemctl daemon-reload
sudo systemctl enable --now clova-api-lab.service
sudo systemctl enable --now clova-api-lab-tunnel.service

echo "[4/4] 상태"
sudo systemctl is-active clova-api-lab clova-api-lab-tunnel || true
curl -sS http://127.0.0.1:3600/health && echo
echo "=== bootstrap 완료 ==="
