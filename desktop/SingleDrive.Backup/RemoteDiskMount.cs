using System.Diagnostics;
using System.Security.Cryptography;
using System.Text;
using Microsoft.Win32;

namespace SingleDrive.Backup;

internal sealed class RemoteDiskMount : IDisposable
{
    // O envio segue direto ao backend para evitar o limite de corpo do proxy Pages.
    private const string DavUrl = "https://singledrive-api.onrender.com/remote-disk/dav/";
    private const string WinFspInstallerHash = "36CE01F9EEDBBE6842B7FB4BEDC79D7D4F71983E8ACEB6877B46A07B331C7E19";
    private readonly Process process;
    public string DriveLetter { get; }
    public bool Running => !process.HasExited;
    public bool Ready => Running && DriveInfo.GetDrives().Any(drive => drive.Name.StartsWith(DriveLetter, StringComparison.OrdinalIgnoreCase));
    public string LogPath { get; }
    public static bool NeedsBundledDriver => File.Exists(Path.Combine(AppContext.BaseDirectory, "WinFsp.msi")) && !HasWinFsp();

    public RemoteDiskMount(string profileId, string rootId, string key)
    {
        DriveLetter = FindLetter();
        var hash = Convert.ToHexString(SHA256.HashData(Encoding.UTF8.GetBytes(profileId + "\n" + rootId)))[..24];
        var remote = "singledrive_" + hash.ToLowerInvariant();
        var cache = Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.LocalApplicationData), "SingleDrive", "remote-disk");
        Directory.CreateDirectory(cache);
        LogPath = Path.Combine(cache, remote + ".log");
        var program = FindRclone() ?? throw new IOException("O rclone não foi encontrado.");
        var start = new ProcessStartInfo(program)
        {
            UseShellExecute = false,
            CreateNoWindow = true,
            WorkingDirectory = cache,
        };
        foreach (var arg in new[] {
            "mount", remote + ":", DriveLetter, "--config", "NUL", "--volname", "SingleDrive",
            "--vfs-cache-mode", "full", "--vfs-write-back", "2s", "--cache-dir", cache,
            "--dir-cache-time", "20s", "--poll-interval", "0", "--log-file", LogPath, "--log-level", "NOTICE",
        }) start.ArgumentList.Add(arg);
        var prefix = "RCLONE_CONFIG_" + remote.ToUpperInvariant() + "_";
        start.Environment[prefix + "TYPE"] = "webdav";
        start.Environment[prefix + "URL"] = DavUrl;
        start.Environment[prefix + "VENDOR"] = "other";
        start.Environment[prefix + "BEARER_TOKEN"] = key;
        process = Process.Start(start) ?? throw new IOException("O rclone não iniciou.");
    }

    public void Open()
    {
        if (!Ready) throw new IOException("A unidade ainda está conectando.");
        Process.Start(new ProcessStartInfo("explorer.exe", DriveLetter + @"\") { UseShellExecute = false });
    }

    private static string FindLetter()
    {
        var used = DriveInfo.GetDrives().Select(drive => char.ToUpperInvariant(drive.Name[0])).ToHashSet();
        foreach (var letter in "STUVWXYZRQPONMLKJIHGFED")
            if (!used.Contains(letter)) return letter + ":";
        throw new IOException("Nenhuma letra de unidade está disponível.");
    }

    private static string? FindRclone()
    {
        var local = Environment.GetFolderPath(Environment.SpecialFolder.LocalApplicationData);
        var candidates = new List<string> {
            Path.Combine(AppContext.BaseDirectory, "rclone.exe"),
            Path.Combine(local, "Microsoft", "WinGet", "Links", "rclone.exe"),
            Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.ProgramFiles), "WinGet", "Links", "rclone.exe"),
        };
        var path = Environment.GetEnvironmentVariable("PATH") ?? "";
        candidates.AddRange(path.Split(Path.PathSeparator, StringSplitOptions.RemoveEmptyEntries)
            .Where(Path.IsPathFullyQualified).Select(directory => Path.Combine(directory, "rclone.exe")));
        return candidates.FirstOrDefault(File.Exists);
    }

    public static async Task PrepareAsync(Action<string> status)
    {
        if (!HasWinFsp())
        {
            status("Instalando WinFsp. Confirme o instalador do Windows quando solicitado.");
            var bundledInstaller = Path.Combine(AppContext.BaseDirectory, "WinFsp.msi");
            if (File.Exists(bundledInstaller))
                await InstallBundledWinFspAsync(bundledInstaller);
            else
                await InstallAsync("WinFsp.WinFsp", "WinFsp", "https://winfsp.dev/rel/");
            if (!HasWinFsp()) throw new IOException("Conclua a instalação do WinFsp para montar a unidade.");
        }
        if (FindRclone() is null)
        {
            status("Instalando rclone para conectar a unidade…");
            await InstallAsync("Rclone.Rclone", "rclone", "https://rclone.org/downloads/");
            if (FindRclone() is null) throw new IOException("Reabra o SingleDrive após a instalação do rclone.");
        }
    }

    private static bool HasWinFsp()
    {
        using var machine = RegistryKey.OpenBaseKey(RegistryHive.LocalMachine, RegistryView.Registry32);
        using var settings = machine.OpenSubKey(@"SOFTWARE\WinFsp");
        return settings?.GetValue("InstallDir") is string directory
            && File.Exists(Path.Combine(directory, "bin", "winfsp-x64.dll"));
    }

    private static async Task InstallBundledWinFspAsync(string path)
    {
        // Mantém o instalador somente para leitura até o msiexec terminar.
        await using var file = File.OpenRead(path);
        if (Convert.ToHexString(await SHA256.HashDataAsync(file)) != WinFspInstallerHash)
            throw new IOException("O instalador do WinFsp foi alterado. Reinstale o SingleDrive.");

        var start = new ProcessStartInfo(Path.Combine(Environment.SystemDirectory, "msiexec.exe"))
            { UseShellExecute = true, Verb = "runas" };
        foreach (var argument in new[] { "/i", path, "/passive", "/norestart" }) start.ArgumentList.Add(argument);
        using var installer = Process.Start(start) ?? throw new IOException("Não foi possível abrir a instalação do WinFsp.");
        await installer.WaitForExitAsync();
        if (installer.ExitCode is 3010 or 1641)
            throw new IOException("Reinicie o Windows para concluir a instalação do WinFsp.");
        if (installer.ExitCode != 0)
            throw new IOException($"O Windows encerrou a instalação do WinFsp (código {installer.ExitCode}).");
    }

    private static async Task InstallAsync(string package, string name, string officialUrl)
    {
        var local = Environment.GetFolderPath(Environment.SpecialFolder.LocalApplicationData);
        var winget = Path.Combine(local, "Microsoft", "WindowsApps", "winget.exe");
        if (!File.Exists(winget))
        {
            Process.Start(new ProcessStartInfo(officialUrl) { UseShellExecute = true });
            throw new IOException($"Instale {name} na página que foi aberta e clique no botão novamente.");
        }
        var start = new ProcessStartInfo(winget) { UseShellExecute = false };
        foreach (var argument in new[] { "install", "--id", package, "--exact", "--source", "winget", "--interactive" })
            start.ArgumentList.Add(argument);
        using var installer = Process.Start(start) ?? throw new IOException($"Não foi possível abrir o instalador de {name}.");
        await installer.WaitForExitAsync();
        if (installer.ExitCode != 0) throw new IOException($"A instalação de {name} foi interrompida. Tente novamente.");
    }

    public void Dispose()
    {
        // A fila fica no cache por perfil e disco, inclusive após pausar.
        try
        {
            if (!process.HasExited) process.Kill();
            process.WaitForExit(1000);
        }
        finally { process.Dispose(); }
    }
}
