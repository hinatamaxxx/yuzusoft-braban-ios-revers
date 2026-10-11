# Decrypt every Hxv4 xp3 of the game into out\<archive>\<dirhash>\<filehash> (parallel)
$root = Split-Path -Parent $PSScriptRoot
$py = Join-Path $root 'venv\Scripts\python.exe'
$tool = Join-Path $root 'tools\hxv4_extract.py'
$game = Get-ChildItem -Directory (Join-Path $root 'iso') | Select-Object -First 1
$logs = Join-Path $root 'out\logs'
New-Item -ItemType Directory -Force $logs | Out-Null
$procs = foreach ($a in 'scenario', 'data', 'bgimage', 'fgimage', 'voice', 'video') {
    $xp3 = Join-Path $game.FullName "$a.xp3"
    Start-Process -FilePath $py -ArgumentList "`"$tool`"", "`"$xp3`"", "`"$(Join-Path $root "out\$a")`"" `
        -NoNewWindow -PassThru -RedirectStandardOutput (Join-Path $logs "$a.log") -RedirectStandardError (Join-Path $logs "$a.err")
}
Write-Host "Extracting (this takes several minutes)..."
$procs | Wait-Process
foreach ($a in 'scenario', 'data', 'bgimage', 'fgimage', 'voice', 'video') {
    $last = Get-Content (Join-Path $logs "$a.log") -Tail 1
    $err = Get-Content (Join-Path $logs "$a.err") -Tail 3
    Write-Host "$a : $last $err"
}
Write-Host "DONE"
