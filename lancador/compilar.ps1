# Gera os ícones, compila "Estudio Opus.exe" na raiz do projeto e cria os atalhos na Área de Trabalho
# ("Estúdio Opus" para abrir e "Fechar Estúdio Opus" para fechar).
# Uso: clique com o botão direito > "Executar com o PowerShell" (ou: powershell -ExecutionPolicy Bypass -File lancador\compilar.ps1)
$ErrorActionPreference = 'Stop'
Add-Type -AssemblyName System.Drawing

$aqui = $PSScriptRoot
$raiz = Split-Path $aqui -Parent
$ico = Join-Path $aqui 'estudio-opus.ico'
$icoFechar = Join-Path $aqui 'fechar-estudio-opus.ico'
$exe = Join-Path $raiz 'Estudio Opus.exe'

# --- ícones: o do favicon (quadrado laranja arredondado + "play" branco) e o de fechar (vermelho + "stop") ---
function Desenhar([int]$t, [bool]$fechar) {
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
  $cor = if ($fechar) { [System.Drawing.Color]::FromArgb(255, 229, 72, 77) } else { [System.Drawing.Color]::FromArgb(255, 255, 106, 61) }
  $g.FillPath((New-Object System.Drawing.SolidBrush $cor), $p)
  if ($fechar) {
    $g.FillRectangle([System.Drawing.Brushes]::White, (10 * $k), (10 * $k), (12 * $k), (12 * $k))
  } else {
    $tri = [System.Drawing.PointF[]]@(
      (New-Object System.Drawing.PointF (12 * $k), (9 * $k)),
      (New-Object System.Drawing.PointF (24 * $k), (16 * $k)),
      (New-Object System.Drawing.PointF (12 * $k), (23 * $k)))
    $g.FillPolygon([System.Drawing.Brushes]::White, $tri)
  }
  $g.Dispose()
  $ms = New-Object System.IO.MemoryStream
  $bmp.Save($ms, [System.Drawing.Imaging.ImageFormat]::Png)
  $bmp.Dispose()
  , $ms.ToArray()
}
function SalvarIco([string]$arquivo, [bool]$fechar) {
  $tamanhos = 16, 32, 48, 256
  $imgs = $tamanhos | ForEach-Object { , (Desenhar $_ $fechar) }
  $fs = [System.IO.File]::Create($arquivo)
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
}
SalvarIco $ico $false
SalvarIco $icoFechar $true

# --- compila com o csc que já vem no Windows (.NET Framework 4) ---
$csc = Join-Path $env:WINDIR 'Microsoft.NET\Framework64\v4.0.30319\csc.exe'
if (-not (Test-Path $csc)) { $csc = Join-Path $env:WINDIR 'Microsoft.NET\Framework\v4.0.30319\csc.exe' }
& $csc /nologo /target:winexe /optimize+ '/codepage:65001' "/win32icon:$ico" "/out:$exe" /r:System.Windows.Forms.dll /r:System.Drawing.dll (Join-Path $aqui 'EstudioOpus.cs')
if ($LASTEXITCODE -ne 0) { throw 'Falha ao compilar o lançador.' }

# --- atalhos na Área de Trabalho ---
$desktop = [Environment]::GetFolderPath('Desktop')
$sh = New-Object -ComObject WScript.Shell
function Atalho([string]$nome, [string]$argumentos, [string]$icone, [string]$descricao) {
  $lnk = $sh.CreateShortcut((Join-Path $desktop "$nome.lnk"))
  $lnk.TargetPath = $exe
  $lnk.Arguments = $argumentos
  $lnk.WorkingDirectory = $raiz
  $lnk.IconLocation = "$icone,0"
  $lnk.Description = $descricao
  $lnk.Save()
  Write-Host "Atalho: $(Join-Path $desktop "$nome.lnk")"
}
Atalho 'Estúdio Opus' '' $exe 'Abre o Estúdio Opus'
Atalho 'Fechar Estúdio Opus' '--fechar' $icoFechar 'Fecha o Estúdio Opus'

Write-Host "Pronto: $exe"
