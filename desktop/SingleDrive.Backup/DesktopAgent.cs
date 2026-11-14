using System.Diagnostics;
using System.Security.Principal;
using Microsoft.Win32;

namespace SingleDrive.Backup;

public static class DesktopAgent
{
    public static readonly string SiteUrl = "https://singledrive.netlify.app/computers";

    public static void Run(string[] args, bool initiallyVisible, Action? onStarted = null)
    {
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
            Application.Run(new BackupForm((initiallyVisible || configure) && !background, openSignal));
        }
        finally { mutex.ReleaseMutex(); }
    }

    public static void OpenWebsite() => Process.Start(new ProcessStartInfo(SiteUrl) { UseShellExecute = true });
}
