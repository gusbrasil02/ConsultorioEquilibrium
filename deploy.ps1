$vpsUser = "root"
$vpsHost = "2.25.171.78"
$repoDir = "/var/www/ConsultorioEquilibrium"

# 1. Commit e push local
Write-Host "-> Verificando git local..." -ForegroundColor Cyan
Set-Location "c:\Users\gusta\Documents\VSCode\DataWaveBR\SistemaFisioConsultorio"

$status = git status --porcelain
if ($status) {
    Write-Host "   Ha mudancas. Fazendo commit automatico..." -ForegroundColor Yellow
    git add -A
    git commit -m "chore: deploy automatico $(Get-Date -Format 'yyyy-MM-dd HH:mm')"
}

Write-Host "-> Enviando para o GitHub..." -ForegroundColor Cyan
git push origin main
if ($LASTEXITCODE -ne 0) {
    Write-Host "ERRO: git push falhou. Abortando deploy." -ForegroundColor Red
    exit 1
}

# 2. Na VPS: pull + persistencia + rebuild + restart
Write-Host "-> Atualizando VPS e rebuilding container..." -ForegroundColor Cyan
ssh "${vpsUser}@${vpsHost}" @"
  set -e
  cd $repoDir
  git pull origin main

  # Garante que o arquivo de calibracao existe (nao sobrescreve se ja existir)
  mkdir -p $repoDir/data
  if [ ! -f $repoDir/data/acu-points-calibrated.json ]; then
    echo '{}' > $repoDir/data/acu-points-calibrated.json
  fi

  docker compose --project-name consultorioequilibrium build --no-cache
  docker compose --project-name consultorioequilibrium up -d
  docker system prune -f --volumes=false
  echo "Deploy concluido com sucesso!"
"@

if ($LASTEXITCODE -ne 0) {
    Write-Host "ERRO: Deploy na VPS falhou." -ForegroundColor Red
    exit 1
}

Write-Host "-> Deploy finalizado! Acesse https://consultorioequilibrium.datawavebr.com" -ForegroundColor Green
