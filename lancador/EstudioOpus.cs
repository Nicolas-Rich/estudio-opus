// Lançador do Estúdio Opus (vira "Estudio Opus.exe" na raiz do projeto; compile com lancador/compilar.ps1).
// Se o estúdio já está rodando, só abre o navegador; senão roda o "Iniciar Estudio.bat",
// que confere o Node, instala as dependências na 1ª vez e sobe o servidor.
using System;
using System.Diagnostics;
using System.IO;
using System.Net;
using System.Windows.Forms;

static class EstudioOpus
{
    const string URL = "http://127.0.0.1:4777";

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

    [STAThread]
    static void Main()
    {
        if (Rodando())
        {
            Process.Start(URL);
            return;
        }
        string pasta = AppDomain.CurrentDomain.BaseDirectory;
        string bat = Path.Combine(pasta, "Iniciar Estudio.bat");
        if (!File.Exists(bat))
        {
            MessageBox.Show("Não achei o \"Iniciar Estudio.bat\" em:\n" + pasta + "\n\nO executável precisa ficar dentro da pasta do Estúdio Opus.",
                "Estúdio Opus", MessageBoxButtons.OK, MessageBoxIcon.Error);
            return;
        }
        Process.Start(new ProcessStartInfo("cmd.exe", "/c \"\"" + bat + "\"\"")
        {
            WorkingDirectory = pasta,
            UseShellExecute = false,
        });
    }
}
