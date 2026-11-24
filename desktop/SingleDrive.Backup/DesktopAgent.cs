using System.Diagnostics;
using System.Security.Principal;
using Microsoft.Win32;

namespace SingleDrive.Backup;

public static class DesktopAgent
{
    public static readonly string SiteUrl = "https://singledrive.pages.dev/login";
    private const string DiscordUrl = "https://singledrive.pages.dev/discord";
    private const string RunKey = @"Software\Microsoft\Windows\CurrentVersion\Run";
    private static string StartupCommand => $"\"{Environment.ProcessPath}\" --background";

    internal static bool StartupEnabled()
    {
        using var key = Registry.CurrentUser.OpenSubKey(RunKey);
        return key?.GetValue("SingleDrive") is string;
    }

    internal static void SetStartup(bool enabled)
    {
        using var key = Registry.CurrentUser.CreateSubKey(RunKey);
        if (enabled) key.SetValue("SingleDrive", StartupCommand);
        else key.DeleteValue("SingleDrive", false);
    }

    public static void Run(string[] args, bool initiallyVisible, Action? onStarted = null)
    {
        if (args.Length == 1 && string.Equals(args[0].TrimEnd('/'), "singledrive-desktop://discord", StringComparison.OrdinalIgnoreCase))
        {
            try { Process.Start(new ProcessStartInfo(DiscordUrl) { UseShellExecute = true }); }
            catch (System.ComponentModel.Win32Exception)
            {
                MessageBox.Show("Não foi possível abrir o navegador. Acesse singledrive.pages.dev/discord pelo navegador padrão.",
                    "SingleDrive", MessageBoxButtons.OK, MessageBoxIcon.Warning);
            }
            return;
        }

        var localDirectory = Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.LocalApplicationData), "SingleDrive");
        Directory.CreateDirectory(localDirectory);
        if (args.Length == 1 && Uri.TryCreate(args[0], UriKind.Absolute, out var callback) &&
            callback.Scheme == "singledrive-desktop" && callback.Host == "oauth" && args[0].Length < 8192)
        {
            var path = Path.Combine(localDirectory, "oauth-callback.txt");
            File.WriteAllText(path + ".tmp", args[0]);
            File.Move(path + ".tmp", path, true);
            return;
        }
        var background = args.Length == 1 && args[0] == "--background";
        var configure = args.Length == 1 && args[0].TrimEnd('/') == "singledrive-desktop://backup";
        if (args.Length > 0 && !background && !configure) return;

        // Reparar atalhos antigos ao abrir a edição instalada, mesmo se outro agente estiver rodando.
        if (!background && onStarted is not null &&
            string.Equals(AppContext.BaseDirectory.TrimEnd(Path.DirectorySeparatorChar),
                Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.ProgramFiles), "SingleDrive"),
                StringComparison.OrdinalIgnoreCase) && StartupEnabled())
            SetStartup(true);

        var sid = WindowsIdentity.GetCurrent().User!.Value;
        using var mutex = new Mutex(true, $@"Local\SingleDrive.Agent.{sid}", out var firstInstance);
        using var openSignal = new EventWaitHandle(false, EventResetMode.AutoReset, $@"Local\SingleDrive.Open.{sid}");
        if (!firstInstance)
        {
            if (!background) openSignal.Set();
            if (!configure && !background) onStarted?.Invoke();
            return;
        }
        try
        {
            using var scheme = Registry.CurrentUser.CreateSubKey(@"Software\Classes\singledrive-desktop");
            scheme.SetValue("", "URL:SingleDrive Desktop");
            scheme.SetValue("URL Protocol", "");
            using var command = scheme.CreateSubKey(@"shell\open\command");
            command.SetValue("", $"\"{Environment.ProcessPath}\" \"%1\"");
            ApplicationConfiguration.Initialize();
            if (!background && !configure) onStarted?.Invoke();
            using var agent = new BackupForm(openSignal);
            if (!background && (initiallyVisible || configure))
            {
                Application.Run(agent);
            }
            else
            {
                _ = agent.Handle;
                agent.FormClosed += (_, _) => Application.ExitThread();
                Application.Run();
            }
        }
        finally { mutex.ReleaseMutex(); }
    }

    public static void OpenWebsite() => Process.Start(new ProcessStartInfo(SiteUrl) { UseShellExecute = true });
}
