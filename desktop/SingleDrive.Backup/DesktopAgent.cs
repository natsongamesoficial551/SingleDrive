using System.Diagnostics;
using System.Security.Principal;
using Microsoft.Win32;

namespace SingleDrive.Backup;

public static class DesktopAgent
{
    public static readonly string SiteUrl = "https://singledrive.pages.dev/login";
    private const string DiscordUrl = "https://singledrive.pages.dev/discord";
    private const string RunKey = @"Software\Microsoft\Windows\CurrentVersion\Run";
    private const string SettingsKey = @"Software\SingleDrive";
    private const string ProtocolKey = @"Software\Classes\singledrive-desktop";
    private static string StartupCommand => $"\"{Environment.ProcessPath}\" --background";
    private static string ProtocolCommand => $"\"{Environment.ProcessPath}\" \"%1\"";

    private static bool HasInstalledStartup()
    {
        using var machine = RegistryKey.OpenBaseKey(RegistryHive.LocalMachine, RegistryView.Registry64);
        using var key = machine.OpenSubKey(RunKey);
        return string.Equals(key?.GetValue("SingleDrive") as string, StartupCommand, StringComparison.OrdinalIgnoreCase);
    }

    internal static bool StartupEnabled()
    {
        if (HasInstalledStartup())
        {
            using var settings = Registry.CurrentUser.OpenSubKey(SettingsKey);
            return settings?.GetValue("StartupEnabled") is not 0;
        }
        using var key = Registry.CurrentUser.OpenSubKey(RunKey);
        return key?.GetValue("SingleDrive") is string;
    }

    internal static void SetStartup(bool enabled)
    {
        using var key = Registry.CurrentUser.CreateSubKey(RunKey);
        if (HasInstalledStartup())
        {
            using var settings = Registry.CurrentUser.CreateSubKey(SettingsKey);
            settings.SetValue("StartupEnabled", enabled ? 1 : 0, RegistryValueKind.DWord);
            key.DeleteValue("SingleDrive", false);
            return;
        }
        if (enabled) key.SetValue("SingleDrive", StartupCommand);
        else key.DeleteValue("SingleDrive", false);
    }

    internal static void RegisterProtocol()
    {
        if (HasInstalledStartup())
        {
            using var oldCommand = Registry.CurrentUser.OpenSubKey(ProtocolKey + @"\shell\open\command");
            if (string.Equals(oldCommand?.GetValue("") as string, ProtocolCommand, StringComparison.OrdinalIgnoreCase))
                Registry.CurrentUser.DeleteSubKeyTree(ProtocolKey, false);
            return;
        }
        using var scheme = Registry.CurrentUser.CreateSubKey(ProtocolKey);
        scheme.SetValue("", "URL:SingleDrive Desktop");
        scheme.SetValue("URL Protocol", "");
        using var command = scheme.CreateSubKey(@"shell\open\command");
        command.SetValue("", ProtocolCommand);
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

        if (HasInstalledStartup())
        {
            if (background && (!StartupEnabled() || !File.Exists(Path.Combine(localDirectory, "agent-session.bin")))) return;
            if (!background) SetStartup(StartupEnabled()); // Retira a entrada por usuário usada pelas versões anteriores.
        }

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
            RegisterProtocol();
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
