$ErrorActionPreference = 'Stop'
$project = $PSScriptRoot
$runtime = 'D:\PROJETOS\9drive-runtime'
$node = (Get-Command node.exe -ErrorAction Stop).Source
$logs = Join-Path $runtime 'logs'
New-Item -ItemType Directory -Force -Path $logs | Out-Null

function Test-LocalPort([int]$port) {
    $client = [System.Net.Sockets.TcpClient]::new()
    try { $client.Connect('127.0.0.1', $port); return $true }
    catch { return $false }
    finally { $client.Dispose() }
}

if (-not (Test-LocalPort 13316)) {
    Start-Process -FilePath (Join-Path $runtime 'mariadb-11.4.8-winx64\bin\mariadbd.exe') -ArgumentList @("--defaults-file=$runtime\data\my.ini", '--bind-address=127.0.0.1') -WindowStyle Hidden
    for ($i = 0; $i -lt 30 -and -not (Test-LocalPort 13316); $i++) { Start-Sleep -Seconds 1 }
    if (-not (Test-LocalPort 13316)) { throw 'O banco nao iniciou. Verifique os arquivos de log em 9drive-runtime\data.' }
}

if (-not (Test-LocalPort 4000)) {
    Start-Process -FilePath $node -ArgumentList 'dist/server.js' -WorkingDirectory (Join-Path $project 'backend') -WindowStyle Hidden -RedirectStandardOutput (Join-Path $logs 'backend.log') -RedirectStandardError (Join-Path $logs 'backend-erro.log')
}
if (-not (Test-LocalPort 5173)) {
    Start-Process -FilePath $node -ArgumentList @('node_modules/vite/bin/vite.js', 'preview', '--host', '127.0.0.1', '--port', '5173', '--strictPort') -WorkingDirectory (Join-Path $project 'frontend') -WindowStyle Hidden -RedirectStandardOutput (Join-Path $logs 'frontend.log') -RedirectStandardError (Join-Path $logs 'frontend-erro.log')
}

for ($i = 0; $i -lt 30; $i++) {
    try {
        $health = Invoke-RestMethod 'http://127.0.0.1:4000/health' -TimeoutSec 2
        if ((Test-LocalPort 5173) -and $health) { Start-Process 'http://localhost:5173'; exit 0 }
    } catch { }
    Start-Sleep -Seconds 1
}
throw 'O 9Drive nao iniciou. Consulte os logs em D:\PROJETOS\9drive-runtime\logs.'
