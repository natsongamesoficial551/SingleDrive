using System.Diagnostics;
using Microsoft.Win32;
using System.Windows.Forms;
using SingleDrive.Backup;

namespace SingleDrive.Desktop;

internal static class Program
{
    // Origem fixa: os dados e a sessão permanecem no mesmo domínio HTTPS do site.
    private const string SiteUrl = "https://singledrive.pages.dev/computers";

    [STAThread]
    private static void Main(string[] args)
    {
        DesktopAgent.Run(args, false, LaunchSite);
    }

    private static void LaunchSite()
    {
        try
        {
            var edge = LocateEdge();
            if (edge is null)
            {
                MessageBox.Show("Microsoft Edge não foi encontrado. Instale ou repare o Edge para abrir o SingleDrive.",
                    "SingleDrive", MessageBoxButtons.OK, MessageBoxIcon.Error);
                return;
            }

            var start = new ProcessStartInfo(edge)
            {
                UseShellExecute = false,
                WorkingDirectory = Path.GetDirectoryName(edge)!,
            };
            start.ArgumentList.Add($"--app={SiteUrl}");
            start.ArgumentList.Add("--no-first-run");
            start.ArgumentList.Add("--disable-features=msEdgeSidebarV2");
            if (Process.Start(start) is null) throw new InvalidOperationException("O Edge não iniciou.");
        }
        catch (Exception ex)
        {
            MessageBox.Show($"Não foi possível abrir o SingleDrive: {ex.Message}",
                "SingleDrive", MessageBoxButtons.OK, MessageBoxIcon.Error);
        }
    }

    private static string? LocateEdge()
    {
        var candidates = new[]
        {
            Registry.LocalMachine.OpenSubKey(@"SOFTWARE\Microsoft\Windows\CurrentVersion\App Paths\msedge.exe")?.GetValue("") as string,
            Registry.CurrentUser.OpenSubKey(@"SOFTWARE\Microsoft\Windows\CurrentVersion\App Paths\msedge.exe")?.GetValue("") as string,
            Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.ProgramFilesX86), "Microsoft", "Edge", "Application", "msedge.exe"),
            Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.ProgramFiles), "Microsoft", "Edge", "Application", "msedge.exe"),
        };
        return candidates.FirstOrDefault(path => !string.IsNullOrWhiteSpace(path) && File.Exists(path));
    }
}
