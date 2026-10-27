// Lançador do Estúdio Opus (vira "Estudio Opus.exe" na raiz do projeto; compile com lancador/compilar.ps1).
// Roda o servidor sem janela de CMD e fica como ícone perto do relógio, com "Abrir" e "Fechar".
// Se o estúdio já está rodando, só abre o navegador. A saída do servidor vai para estudio.log.
// Com --fechar (atalho "Fechar Estúdio Opus"), avisa a instância aberta para fechar o estúdio.
using System;
using System.Diagnostics;
using System.Drawing;
using System.IO;
using System.Net;
using System.Text;
using System.Threading;
using System.Windows.Forms;

static class EstudioOpus
{
    const string URL = "http://127.0.0.1:4777";
    const string TITULO = "Estúdio Opus";
    const string EVENTO_FECHAR = @"Local\EstudioOpus.Fechar";

    static string pasta;
    static Process servidor;
    static NotifyIcon icone;
    static StreamWriter log;
    static bool fechando;
    static EventWaitHandle pedidoFechar;

    static bool Rodando()
    {
        try
        {
            var req = (HttpWebRequest)WebRequest.Create(URL + "/api/status");
            req.Timeout = 1500;
            req.Proxy = null;
            using (var resp = (HttpWebResponse)req.GetResponse()) return resp.StatusCode == HttpStatusCode.OK;
        }
        catch { return false; }
    }

    static void AbrirNavegador()
    {
        try { Process.Start(URL); } catch { }
    }

    static void Erro(string msg)
    {
        MessageBox.Show(msg, TITULO, MessageBoxButtons.OK, MessageBoxIcon.Error);
    }

    static ProcessStartInfo Oculto(string arquivo, string args)
    {
        return new ProcessStartInfo(arquivo, args)
        {
            WorkingDirectory = pasta,
            UseShellExecute = false,
            CreateNoWindow = true,
            RedirectStandardOutput = true,
            RedirectStandardError = true,
            StandardOutputEncoding = Encoding.UTF8,
            StandardErrorEncoding = Encoding.UTF8,
        };
    }

    // roda até o fim, sem janela, mandando a saída para o log; devolve o código de saída (-1 se nem iniciou)
    static int Rodar(string arquivo, string args)
    {
        try
        {
            using (var p = new Process { StartInfo = Oculto(arquivo, args) })
            {
                p.OutputDataReceived += (s, e) => Registrar(e.Data);
                p.ErrorDataReceived += (s, e) => Registrar(e.Data);
                p.Start();
                p.BeginOutputReadLine();
                p.BeginErrorReadLine();
                p.WaitForExit();
                return p.ExitCode;
            }
        }
        catch { return -1; }
    }

    static void Registrar(string linha)
    {
        if (linha == null || log == null) return;
        lock (log) { log.WriteLine(linha); }
    }

    // fecha o servidor e tudo o que ele abriu (IA, ffmpeg, navegador do render)
    static void PararServidor()
    {
        if (servidor == null) return;
        try
        {
            if (!servidor.HasExited)
            {
                var info = new ProcessStartInfo("taskkill", "/PID " + servidor.Id + " /T /F") { UseShellExecute = false, CreateNoWindow = true };
                using (var k = Process.Start(info)) k.WaitForExit(10000);
            }
        }
        catch { }
    }

    static void Sair()
    {
        fechando = true;
        PararServidor();
        if (icone != null) icone.Visible = false;
        Application.Exit();
    }

    static void Fechar()
    {
        EventWaitHandle evento;
        if (!EventWaitHandle.TryOpenExisting(EVENTO_FECHAR, out evento))
        {
            if (Rodando())
                Erro("O Estúdio Opus foi aberto pelo \"Iniciar Estudio.bat\".\n\nPara fechar, feche aquela janela preta.");
            else
                MessageBox.Show("O Estúdio Opus já está fechado.", TITULO, MessageBoxButtons.OK, MessageBoxIcon.Information);
            return;
        }
        using (evento) evento.Set();
        for (int i = 0; i < 30 && Rodando(); i++) Thread.Sleep(500);
        if (Rodando()) Erro("Não consegui fechar o Estúdio Opus. Tente de novo em alguns segundos.");
        else MessageBox.Show("Estúdio Opus fechado.", TITULO, MessageBoxButtons.OK, MessageBoxIcon.Information);
    }

    [STAThread]
    static void Main(string[] args)
    {
        if (Array.IndexOf(args, "--fechar") >= 0)
        {
            Fechar();
            return;
        }
        if (Rodando())
        {
            AbrirNavegador();
            return;
        }
        Application.EnableVisualStyles();
        pasta = AppDomain.CurrentDomain.BaseDirectory;
        if (!File.Exists(Path.Combine(pasta, "server.js")))
        {
            Erro("Não achei o server.js em:\n" + pasta + "\n\nO executável precisa ficar dentro da pasta do Estúdio Opus.");
            return;
        }
        if (Rodar("node", "-v") != 0)
        {
            Erro("O Node.js não está instalado.\n\nBaixe a versão LTS em https://nodejs.org, instale e abra o Estúdio Opus de novo.");
            return;
        }

        log = new StreamWriter(Path.Combine(pasta, "estudio.log"), false, new UTF8Encoding(false)) { AutoFlush = true };

        icone = new NotifyIcon
        {
            Icon = Icon.ExtractAssociatedIcon(Application.ExecutablePath),
            Text = TITULO,
            Visible = true,
        };
        var menu = new ContextMenuStrip();
        menu.Items.Add("Abrir o Estúdio Opus", null, (s, e) => AbrirNavegador()).Font = new Font(menu.Font, FontStyle.Bold);
        menu.Items.Add(new ToolStripSeparator());
        menu.Items.Add("Fechar o Estúdio Opus", null, (s, e) => Sair());
        icone.ContextMenuStrip = menu;
        icone.DoubleClick += (s, e) => AbrirNavegador();

        if (!Directory.Exists(Path.Combine(pasta, "node_modules")))
        {
            icone.ShowBalloonTip(5000, TITULO, "Instalando as dependências pela primeira vez. Pode levar alguns minutos…", ToolTipIcon.Info);
            if (Rodar("cmd.exe", "/c npm install --no-audit --no-fund") != 0)
            {
                icone.Visible = false;
                Erro("Falha ao instalar as dependências. Verifique sua internet e tente de novo.\n\nDetalhes em: " + Path.Combine(pasta, "estudio.log"));
                return;
            }
        }

        // controle invisível só para voltar à thread da interface quando o servidor cair
        var sync = new Control();
        sync.CreateControl();
        servidor = new Process { StartInfo = Oculto("node", "server.js --abrir"), EnableRaisingEvents = true };
        servidor.OutputDataReceived += (s, e) => Registrar(e.Data);
        servidor.ErrorDataReceived += (s, e) => Registrar(e.Data);
        servidor.Exited += (s, e) =>
        {
            if (fechando) return;
            fechando = true;
            sync.BeginInvoke((MethodInvoker)(() =>
            {
                icone.Visible = false;
                Erro("O Estúdio Opus parou de funcionar.\n\nDetalhes em: " + Path.Combine(pasta, "estudio.log"));
                Application.Exit();
            }));
        };
        servidor.Start();
        servidor.BeginOutputReadLine();
        servidor.BeginErrorReadLine();

        // o atalho "Fechar Estúdio Opus" (--fechar) sinaliza este evento
        pedidoFechar = new EventWaitHandle(false, EventResetMode.AutoReset, EVENTO_FECHAR);
        ThreadPool.RegisterWaitForSingleObject(pedidoFechar, (st, t) => sync.BeginInvoke((MethodInvoker)Sair), null, Timeout.Infinite, true);

        icone.ShowBalloonTip(6000, TITULO, "O estúdio está abrindo no navegador. Para fechar, use o atalho \"Fechar Estúdio Opus\" na Área de Trabalho ou o botão direito neste ícone.", ToolTipIcon.Info);
        Application.ApplicationExit += (s, e) => { fechando = true; PararServidor(); };
        Application.Run();
    }
}
