# Gera o ícone, compila "Estudio Opus.exe" na raiz do projeto e cria o atalho na Área de Trabalho.
# Uso: clique com o botão direito > "Executar com o PowerShell" (ou: powershell -ExecutionPolicy Bypass -File lancador\compilar.ps1)
$ErrorActionPreference = 'Stop'
Add-Type -AssemblyName System.Drawing

$aqui = $PSScriptRoot
$raiz = Split-Path $aqui -Parent
$ico = Join-Path $aqui 'estudio-opus.ico'
$exe = Join-Path $raiz 'Estudio Opus.exe'

# --- ícone: o mesmo do favicon (quadrado laranja arredondado + "play" branco), em 16/32/48/256 px ---
function Desenhar([int]$t) {
  $bmp = New-Object System.Drawing.Bitmap $t, $t
  $g = [System.Drawing.Graphics]::FromImage($bmp)
  $g.SmoothingMode = 'AntiAlias'
  $g.Clear([System.Drawing.Color]::Transparent)
  $k = $t / 32.0
  $r = 8 * $k
  $p = New-Object System.Drawing.Drawing2D.GraphicsPath
  $p.AddArc(0, 0, 2 * $r, 2 * $r, 180, 90)
  $p.AddArc($t - 2 * $r, 0, 2 * $r, 2 * $r, 270, 90)
  $p.AddArc($t - 2 * $r, $t - 2 * $r, 2 * $r, 2 * $r, 0, 90)
  $p.AddArc(0, $t - 2 * $r, 2 * $r, 2 * $r, 90, 90)
  $p.CloseFigure()
  $g.FillPath((New-Object System.Drawing.SolidBrush ([System.Drawing.Color]::FromArgb(255, 255, 106, 61))), $p)
  $tri = [System.Drawing.PointF[]]@(
    (New-Object System.Drawing.PointF (12 * $k), (9 * $k)),
    (New-Object System.Drawing.PointF (24 * $k), (16 * $k)),
    (New-Object System.Drawing.PointF (12 * $k), (23 * $k)))
  $g.FillPolygon([System.Drawing.Brushes]::White, $tri)
  $g.Dispose()
  $ms = New-Object System.IO.MemoryStream
  $bmp.Save($ms, [System.Drawing.Imaging.ImageFormat]::Png)
  $bmp.Dispose()
  , $ms.ToArray()
}
$tamanhos = 16, 32, 48, 256
$imgs = $tamanhos | ForEach-Object { , (Desenhar $_) }
$fs = [System.IO.File]::Create($ico)
$w = New-Object System.IO.BinaryWriter $fs
$w.Write([UInt16]0); $w.Write([UInt16]1); $w.Write([UInt16]$tamanhos.Count)
$offset = 6 + 16 * $tamanhos.Count
for ($i = 0; $i -lt $tamanhos.Count; $i++) {
  $t = $tamanhos[$i]; $dados = $imgs[$i]
  $w.Write([byte]($t % 256)); $w.Write([byte]($t % 256)); $w.Write([byte]0); $w.Write([byte]0)
  $w.Write([UInt16]1); $w.Write([UInt16]32); $w.Write([UInt32]$dados.Length); $w.Write([UInt32]$offset)
  $offset += $dados.Length
}
foreach ($dados in $imgs) { $w.Write($dados) }
$w.Close()

# --- compila com o csc que já vem no Windows (.NET Framework 4) ---
$csc = Join-Path $env:WINDIR 'Microsoft.NET\Framework64\v4.0.30319\csc.exe'
if (-not (Test-Path $csc)) { $csc = Join-Path $env:WINDIR 'Microsoft.NET\Framework\v4.0.30319\csc.exe' }
& $csc /nologo /target:winexe /optimize+ '/codepage:65001' "/win32icon:$ico" "/out:$exe" /r:System.Windows.Forms.dll /r:System.Drawing.dll (Join-Path $aqui 'EstudioOpus.cs')
if ($LASTEXITCODE -ne 0) { throw 'Falha ao compilar o lançador.' }

# --- atalho na Área de Trabalho ---
$desktop = [Environment]::GetFolderPath('Desktop')
$sh = New-Object -ComObject WScript.Shell
$lnk = $sh.CreateShortcut((Join-Path $desktop 'Estúdio Opus.lnk'))
$lnk.TargetPath = $exe
$lnk.WorkingDirectory = $raiz
$lnk.IconLocation = "$exe,0"
$lnk.Description = 'Abre o Estúdio Opus'
$lnk.Save()

Write-Host "Pronto: $exe"
Write-Host "Atalho: $(Join-Path $desktop 'Estúdio Opus.lnk')"
