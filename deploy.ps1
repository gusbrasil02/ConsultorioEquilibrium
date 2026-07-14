# ─────────────────────────────────────────────────────────────────────────────
# Deploy agora é automático pelo Coolify: qualquer push na branch `main`
# dispara o build e o restart do container. Este script só faz commit + push.
#
# (Não há mais SSH/rebuild manual na VPS.)
# ─────────────────────────────────────────────────────────────────────────────

Set-Location "c:\Users\gusta\Documents\VSCode\DataWaveBR\SistemaFisioConsultorio"

$status = git status --porcelain
if ($status) {
    Write-Host "-> Ha mudancas. Fazendo commit..." -ForegroundColor Yellow
    git add -A
    $msg = Read-Host "Mensagem do commit (enter para padrao)"
    if ([string]::IsNullOrWhiteSpace($msg)) {
        $msg = "chore: deploy $(Get-Date -Format 'yyyy-MM-dd HH:mm')"
    }
    git commit -m $msg
} else {
    Write-Host "-> Nada para commitar." -ForegroundColor Cyan
}

Write-Host "-> Enviando para o GitHub (dispara deploy no Coolify)..." -ForegroundColor Cyan
git push origin main
if ($LASTEXITCODE -ne 0) {
    Write-Host "ERRO: git push falhou." -ForegroundColor Red
    exit 1
}

Write-Host "-> Push feito. O Coolify vai buildar e publicar em instantes." -ForegroundColor Green
Write-Host "   Acompanhe em https://consultorioequilibrium.datawavebr.com" -ForegroundColor Green
