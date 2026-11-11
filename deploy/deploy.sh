#!/usr/bin/env bash
# clova-api-lab 배포 오케스트레이션 (로컬에서 실행).
#   1) 프론트/서버 로컬 빌드  2) EC2(nginx+SPA)  3) hellcat(프록시 데몬)
# EC2 에서는 절대 빌드하지 않는다 (916Mi RAM, OOM 위험).
# 라이브: https://elda-ai.org/giants/  (agent.elda-ai.org 도 동일 server block)
#         구 경로(/giant/clova/, /giant/)는 nginx 에서 301 → /giants/
set -euo pipefail
cd "$(dirname "$0")/.."

EC2=EldaFront   # ~/.ssh/config alias (구 AmazonFront — 2026-06 리네임)
HELLCAT=gino@192.168.0.28
HKEY="$HOME/.ssh/rs5_key"
HSSH="ssh -i $HKEY -o StrictHostKeyChecking=accept-new $HELLCAT"
HRSYNC="ssh -i $HKEY"
# 공개 sub-path. 바꿀 때 같이 손볼 곳: vite.config.ts 의 base, deploy/nginx/$SEG.conf,
# 그리고 아래 LEGACY_* 목록에 구 값 추가. (프런트 코드에는 절대 하드코딩하지 않는다 —
# API 경로는 VITE_API_BASE 로만 들어간다.)
SEG=giants
WEBROOT="/var/www/$SEG"
# 경로 이력: /giant/clova/ → /giant/ (2026-07-30) → /giants/ (2026-07-30)
LEGACY_CONFS="/etc/nginx/default.d/giant-clova.conf /etc/nginx/default.d/giant.conf"
LEGACY_WEBROOTS="/var/www/giant"
SLOT="apps/clova-api-lab"  # hellcat ~/apps/clova-api-lab

echo "== [1/4] 로컬 빌드 =="
VITE_API_BASE="/$SEG" npm run build
npm run build:server

echo "== [2/4] EC2 SPA + nginx =="
ssh "$EC2" "sudo mkdir -p $WEBROOT && sudo chown -R ec2-user:ec2-user $WEBROOT"
rsync -avz --delete dist/ "$EC2:$WEBROOT/"
scp "deploy/nginx/$SEG.conf" "$EC2:/tmp/$SEG.conf"
# 구 conf 를 먼저 치운다 — 남으면 location 중복으로 nginx -t 가 실패하고,
# 그러면 같은 EC2 의 다른 사이트(/admin 등)까지 reload 가 막힌다.
ssh "$EC2" "sudo rm -f $LEGACY_CONFS && sudo install -m644 -o root -g root /tmp/$SEG.conf /etc/nginx/default.d/$SEG.conf && rm -f /tmp/$SEG.conf && sudo nginx -t && sudo systemctl reload nginx && echo 'nginx reloaded'"
# 구 webroot 잔재 정리 (현 WEBROOT 는 절대 건드리지 않도록 가드)
for old in $LEGACY_WEBROOTS; do
  [ "$old" = "$WEBROOT" ] && continue
  ssh "$EC2" "test -d '$old' && sudo rm -rf '$old' && echo '구 webroot 제거: $old' || true"
done

echo "== [3/4] hellcat 파일 배치 =="
$HSSH "mkdir -p ~/$SLOT"
rsync -avz -e "$HRSYNC" server-dist/index.js          "$HELLCAT:~/$SLOT/index.js"
rsync -avz -e "$HRSYNC" server-dist/clova/ "$HELLCAT:~/$SLOT/runtime/clova/"
rsync -avz -e "$HRSYNC" deploy/hellcat.package.json    "$HELLCAT:~/$SLOT/package.json"
rsync -avz -e "$HRSYNC" deploy/clova-api-lab.service deploy/clova-api-lab-tunnel.service \
                        deploy/bootstrap-systemd.sh deploy/hellcat.env.example "$HELLCAT:~/$SLOT/"
# .env 는 키를 담으므로 있으면 보존, 없으면 example 로 생성
$HSSH "test -f ~/$SLOT/.env || cp ~/$SLOT/hellcat.env.example ~/$SLOT/.env; chmod 600 ~/$SLOT/.env"

# 의존성 설치(mysql2 등). 번들에 없는 external 만 node_modules 로.
echo "-- npm install (mysql2) --"
$HSSH "cd ~/$SLOT && npm install --omit=dev --no-audit --no-fund 2>&1 | tail -3"

echo "== [4/4] hellcat 서비스 재시작 (부트스트랩 완료된 경우) =="
# sudoers 는 유닛별 단일 명령만 NOPASSWD 허용 → 한 줄에 묶지 말고 각각 호출.
$HSSH 'sudo -n systemctl restart clova-api-lab 2>/dev/null && echo "app restarted" || echo "** clova-api-lab units 미설치 — bootstrap-systemd.sh 를 1회 실행하세요 **"'

echo "== done =="
