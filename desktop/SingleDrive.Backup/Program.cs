using System.Net.Http.Headers;
using System.Net;
using System.Security.Cryptography;
using System.Text.Json;
using System.Windows.Forms;
using System.Diagnostics;
using Microsoft.Win32;

namespace SingleDrive.Backup;

internal static class Program
{
    [STAThread]
    private static void Main(string[] args)
    {
        DesktopAgent.Run(args, true);
    }
}

internal sealed class BackupForm : Form
{
    private static readonly Uri ApiOrigin = new("https://singledrive.pages.dev/api/");
    private readonly Button login = new() { Text = "Entrar com Google", Width = 160 };
    private readonly TextBox folder = new() { Width = 465, ReadOnly = true };
    private readonly Label status = new() { AutoSize = true, Text = "Parado" };
    private readonly Button diskToggle = new() { Text = "Criar disco remoto", Width = 170 };
    private readonly Button diskOpen = new() { Text = "Abrir disco", Width = 120, Enabled = false };
    private readonly Button diskTransfer = new() { Text = "Salvar arquivos no disco", Width = 170, Enabled = false };
    private readonly Label diskStatus = new() { AutoSize = true, MaximumSize = new Size(560, 0), Text = "Entre com Google para criar a unidade." };
    private bool diskConsent;
    private bool diskSetupBusy;
    private bool diskPolicyKnown;
    private bool diskEnabled;
    private bool diskRestorable;
    private bool openDiskWhenReady;
    private string? diskRootId;
    private RemoteDiskMount? remoteDisk;
    private DateTime diskRetryAt;
    private DateTime diskStartedAt;
    private readonly SemaphoreSlim settingsLock = new(1, 1);
    private readonly Button toggle = new() { Text = "Iniciar backup", Width = 140 };
    private readonly SemaphoreSlim scanLock = new(1, 1);
    private readonly SemaphoreSlim refreshLock = new(1, 1);
    private readonly CookieContainer cookies = new();
    private readonly HttpClient http;
    private string? accessToken;
    private readonly string settingsPath = Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.LocalApplicationData), "SingleDrive", "agent-session.bin");
    private string? accountId;
    private string? deviceId;
    private string runtimeStatus = "idle";
    private bool localConsent;
    private bool heartbeatBusy;
    private bool exitRequested;
    private bool toggling;
    private bool scanCompleted;
    private bool restoring;
    private Task? backupTask;
    private readonly NotifyIcon tray;
    private const int HeartbeatIntervalMs = 30_000;
    private readonly System.Windows.Forms.Timer heartbeatTimer = new() { Interval = 1 };
    private readonly System.Windows.Forms.Timer openTimer = new() { Interval = 500 };
    private readonly System.Windows.Forms.Timer diskTimer = new() { Interval = 1000 };
    private string StatePath => Path.Combine(Path.GetDirectoryName(settingsPath)!, $"backup-v3-{accountId}.bin");
    private readonly Dictionary<string, FileStamp> sent = new(StringComparer.OrdinalIgnoreCase);
    private CancellationTokenSource? cancellation;

    public BackupForm(EventWaitHandle openSignal)
    {
        http = new HttpClient(new HttpClientHandler { AllowAutoRedirect = false, CookieContainer = cookies, UseCookies = true }) { Timeout = TimeSpan.FromMinutes(30) };
        Text = "SingleDrive — Computador";
        Width = 630;
        Height = 495;
        StartPosition = FormStartPosition.CenterScreen;
        var trayMenu = new ContextMenuStrip();
        trayMenu.Items.Add("Abrir SingleDrive", null, (_, _) => DesktopAgent.OpenWebsite());
        trayMenu.Items.Add("Configurar computador", null, (_, _) => ShowAgent());
        trayMenu.Items.Add("Encerrar agente", null, (_, _) => { exitRequested = true; Close(); });
        tray = new NotifyIcon { Icon = SystemIcons.Application, Text = "SingleDrive — agente do PC", ContextMenuStrip = trayMenu, Visible = true };
        tray.DoubleClick += (_, _) => ShowAgent();
        FormClosing += (_, e) =>
        {
            if (!exitRequested && e.CloseReason == CloseReason.UserClosing)
            {
                e.Cancel = true;
                Hide();
                return;
            }
            exitRequested = true;
            StopRemoteDisk();
            cancellation?.Cancel();
            heartbeatTimer.Stop();
            openTimer.Stop();
            tray.Dispose();
        };
        openTimer.Tick += (_, _) => { if (openSignal.WaitOne(0)) ShowAgent(); };
        openTimer.Start();
        diskTimer.Tick += (_, _) => CheckRemoteDisk();
        heartbeatTimer.Tick += async (_, _) =>
        {
            heartbeatTimer.Interval = HeartbeatIntervalMs;
            await HeartbeatAsync();
        };
        var panel = new FlowLayoutPanel { Dock = DockStyle.Fill, FlowDirection = FlowDirection.TopDown, WrapContents = false, Padding = new Padding(16), AutoScroll = true };
        Controls.Add(panel);
        panel.Controls.Add(new Label { Text = "Vincule este PC à mesma conta Google do SingleDrive.", AutoSize = true });
        panel.Controls.Add(login);
        var unlink = new Button { Text = "Desvincular este PC", Width = 160 };
        unlink.Click += async (_, _) =>
        {
            if (deviceId is null) return;
            if (MessageBox.Show("Encerrar o vínculo deste PC? As cópias já enviadas serão mantidas.", "SingleDrive", MessageBoxButtons.YesNo) != DialogResult.Yes) return;
            try { using var result = await AgentRequestAsync($"desktop-devices/{deviceId}", HttpMethod.Delete, new { }); await ClearDeviceAsync(); }
            catch (Exception ex) { status.Text = $"Não foi possível desvincular: {ex.Message}"; }
        };
        panel.Controls.Add(unlink);
        login.Click += async (_, _) => await LoginAsync();
        var diskRow = new FlowLayoutPanel { Width = 580, Height = 36, WrapContents = false };
        diskRow.Controls.Add(diskToggle);
        diskRow.Controls.Add(diskOpen);
        diskRow.Controls.Add(diskTransfer);
        panel.Controls.Add(diskRow);
        panel.Controls.Add(diskStatus);
        diskToggle.Click += async (_, _) => await ConfigureRemoteDiskAsync();
        diskOpen.Click += (_, _) =>
        {
            try { remoteDisk?.Open(); }
            catch (Exception ex) { diskStatus.Text = ex.Message; }
        };
        diskTransfer.Click += (_, _) =>
        {
            if (deviceId is null) return;
            try { Process.Start(new ProcessStartInfo(new Uri(ApiOrigin, $"/computers?transfer={Uri.EscapeDataString(deviceId)}").AbsoluteUri) { UseShellExecute = true }); }
            catch (Exception ex) { diskStatus.Text = ex.Message; }
        };
        panel.Controls.Add(new Label { Text = "Pasta local para backup", AutoSize = true });
        var row = new FlowLayoutPanel { Width = 580, Height = 38, WrapContents = false };
        row.Controls.Add(folder);
        var choose = new Button { Text = "Escolher", Width = 90 };
        choose.Click += (_, _) => { if (cancellation is not null) { MessageBox.Show("Pause o backup antes de trocar de pasta."); return; } using var dialog = new FolderBrowserDialog(); if (dialog.ShowDialog() == DialogResult.OK) folder.Text = dialog.SelectedPath; };
        row.Controls.Add(choose);
        panel.Controls.Add(row);
        panel.Controls.Add(toggle);
        var restore = new Button { Text = "Restaurar backup", Width = 160 };
        restore.Click += async (_, _) => { restore.Enabled = false; try { restoring = true; await RestoreAsync(); } catch (Exception ex) { status.Text = $"Restauração interrompida: {ex.Message}"; } finally { restoring = false; restore.Enabled = true; } };
        panel.Controls.Add(restore);
        panel.Controls.Add(status);
        panel.Controls.Add(new Label { Text = "Envios automáticos a cada 2 minutos. Exclusões locais não apagam arquivos remotos.", AutoSize = true });
        var startup = new CheckBox { Text = "Iniciar agente ao entrar no Windows", AutoSize = true };
        startup.Checked = DesktopAgent.StartupEnabled();
        startup.CheckedChanged += (_, _) => DesktopAgent.SetStartup(startup.Checked);
        panel.Controls.Add(startup);
        toggle.Click += async (_, _) => await ToggleAsync();
        LoadSettings();
        if (cookies.GetCookies(ApiOrigin)["__Host-sd_refresh"] is not null) heartbeatTimer.Start();
    }

    private void LoadSettings()
    {
        try
        {
            if (!File.Exists(settingsPath)) return;
            var settings = JsonSerializer.Deserialize<Settings>(ProtectedData.Unprotect(File.ReadAllBytes(settingsPath), null, DataProtectionScope.CurrentUser));
            if (settings is null) return;
            folder.Text = settings.Folder;
            localConsent = settings.LocalConsent;
            diskConsent = settings.DiskConsent;
            SetDiskButtons();
            if (!string.IsNullOrEmpty(settings.Cookie))
            {
                cookies.Add(ApiOrigin, new Cookie("__Host-sd_refresh", settings.Cookie, "/") { Secure = true, HttpOnly = true });
                status.Text = "Sessão salva. Clique em Iniciar backup.";
            }
        }
        catch { status.Text = "Configuração local inválida. Informe os dados novamente."; }
    }

    private async Task ToggleAsync()
    {
        if (toggling || restoring) return;
        toggling = true;
        toggle.Enabled = false;
        try {
        if (deviceId is null) { MessageBox.Show("Entre com Google para vincular este computador."); return; }
        if (cancellation is not null)
        {
            await SetBackupPolicyAsync(false);
            await StopBackupAsync();
            return;
        }
        var uri = ApiOrigin;
        if (!Directory.Exists(folder.Text))
        { MessageBox.Show("Escolha uma pasta."); return; }
        if (!await RefreshAsync(uri))
        { MessageBox.Show("Entre com Google antes de iniciar o backup."); return; }
        localConsent = true;
        await SaveSettingsAsync(uri);
        await SetBackupPolicyAsync(true);
        await StartBackupAsync();
        }
        catch (Exception ex) { status.Text = $"Não foi possível alterar o backup: {ex.Message}"; }
        finally { toggling = false; toggle.Enabled = true; }
    }

    private async Task StartBackupAsync()
    {
        if (restoring || cancellation is not null || accountId is null || !localConsent || !Directory.Exists(folder.Text)) return;
        sent.Clear();
        try
        {
            if (File.Exists(StatePath))
            {
                var saved = JsonSerializer.Deserialize<Dictionary<string, FileStamp>>(ProtectedData.Unprotect(await File.ReadAllBytesAsync(StatePath), null, DataProtectionScope.CurrentUser));
                if (saved is not null) foreach (var item in saved) sent[item.Key] = item.Value;
            }
        }
        catch { status.Text = "Catálogo local inválido; os arquivos serão conferidos novamente."; }
        cancellation = new CancellationTokenSource();
        toggle.Text = "Parar backup";
        backupTask = RunAsync(ApiOrigin, folder.Text, cancellation.Token);
    }

    private async Task RunAsync(Uri baseUri, string root, CancellationToken token)
    {
        while (!token.IsCancellationRequested)
        {
            try { runtimeStatus = "scanning"; await ScanAsync(baseUri, root, token); }
            catch (OperationCanceledException) when (token.IsCancellationRequested) { break; }
            catch (Exception ex) { runtimeStatus = "error"; SetStatus($"Erro: {ex.Message}"); }
            try { await Task.Delay(TimeSpan.FromMinutes(2), token); }
            catch (OperationCanceledException) { break; }
        }
    }

    private async Task ScanAsync(Uri baseUri, string root, CancellationToken token)
    {
        await scanLock.WaitAsync(token);
        try
        {
            RestorePaths.CheckParents(root);
            var description = RestorePaths.Describe(root);
            using var registeredRoot = await AgentRequestAsync("backups/roots", HttpMethod.Post, new {
                name = new DirectoryInfo(root).Name, machine = Environment.MachineName, originalPath = root,
                anchor = description.Anchor, suffix = description.Suffix });
            var rootId = registeredRoot.RootElement.GetProperty("id").GetString();
            var backupFolder = await EnsureFolderAsync("Backups de PCs", null);
            var computerFolder = await EnsureFolderAsync($"{Environment.MachineName} - {deviceId![..8]}", backupFolder);
            var rootName = new DirectoryInfo(root).Name;
            var remoteRoot = await EnsureFolderAsync($"{rootName[..Math.Min(rootName.Length, 240)]} - {rootId![..8]}", computerFolder);
            var remoteFolders = new Dictionary<string, string>(StringComparer.OrdinalIgnoreCase) { [""] = remoteRoot };
            async Task<string> RemoteDirectory(string relative)
            {
                if (remoteFolders.TryGetValue(relative, out var cached)) return cached;
                var separator = relative.LastIndexOf('/');
                var parent = separator < 0 ? "" : relative[..separator];
                var name = separator < 0 ? relative : relative[(separator + 1)..];
                var id = await EnsureFolderAsync(name, await RemoteDirectory(parent));
                remoteFolders[relative] = id; return id;
            }
            var attempted = 0;
            var uploaded = 0;
            foreach (var directory in EnumerateFiles(root, true))
            {
                token.ThrowIfCancellationRequested();
                var relativeDirectory = Path.GetRelativePath(root, directory).Replace('\\', '/');
                await RemoteDirectory(relativeDirectory);
                var directoryKey = root + "|directory|" + relativeDirectory;
                if (sent.ContainsKey(directoryKey)) continue;
                using var recorded = await AgentRequestAsync($"backups/{rootId}/entries", HttpMethod.Post, new { relativePath = relativeDirectory, kind = "directory" });
                sent[directoryKey] = new FileStamp(-1, 0);
            }
            foreach (var path in EnumerateFiles(root))
            {
                token.ThrowIfCancellationRequested();
                var info = new FileInfo(path);
                if (!info.Exists || DateTime.UtcNow - info.LastWriteTimeUtc < TimeSpan.FromSeconds(5)) continue;
                var relative = Path.GetRelativePath(root, path).Replace('\\', '/');
                var identity = root + "|" + relative;
                var stamp = new FileStamp(info.Length, info.LastWriteTimeUtc.Ticks);
                if (sent.TryGetValue(identity, out var previous) && previous == stamp) continue;
                attempted++;
                runtimeStatus = "uploading";
                SetStatus($"Enviando {relative} ({attempted} tentativa(s) nesta varredura)");
                try
                {
                    if (stamp.Size == 0) {
                        using var empty = await AgentRequestAsync($"backups/{rootId}/entries", HttpMethod.Post,
                            new { relativePath = relative, kind = "empty", modifiedUtc = new DateTime(stamp.ModifiedTicks, DateTimeKind.Utc).ToString("O") });
                        sent[identity] = stamp; await SaveStateAsync(token); uploaded++; continue;
                    }
                    var relativeParent = relative.Contains('/') ? relative[..relative.LastIndexOf('/')] : "";
                    var remoteParent = await RemoteDirectory(relativeParent);
                    var fileId = await UploadAsync(baseUri, path, stamp, remoteParent, token);
                    await using var hashStream = File.OpenRead(path);
                    var sha256 = Convert.ToHexString(await SHA256.HashDataAsync(hashStream, token)).ToLowerInvariant();
                    var current = new FileInfo(path);
                    if (current.Length != stamp.Size || current.LastWriteTimeUtc.Ticks != stamp.ModifiedTicks) throw new IOException("Arquivo mudou durante a conferência.");
                    using var saved = await AgentRequestAsync($"backups/{rootId}/entries", HttpMethod.Post,
                        new { relativePath = relative, fileId, sha256, modifiedUtc = new DateTime(stamp.ModifiedTicks, DateTimeKind.Utc).ToString("O") });
                    sent[identity] = stamp;
                    await SaveStateAsync(token);
                    uploaded++;
                }
                catch (OperationCanceledException) when (token.IsCancellationRequested) { throw; }
                catch (Exception ex) { SetStatus($"Falha em {relative}: {ex.Message}"); }
            }
            await SaveStateAsync(token);
            SetStatus($"Varredura concluída. {uploaded} enviado(s), {attempted - uploaded} falha(s).");
            runtimeStatus = attempted == uploaded ? "idle" : "error";
            scanCompleted = attempted == uploaded;
        }
        finally { scanLock.Release(); }
    }

    private static IEnumerable<string> EnumerateFiles(string root, bool directoriesOnly = false)
    {
        var directories = new Stack<string>();
        directories.Push(root);
        while (directories.Count > 0)
        {
            var current = directories.Pop();
            IEnumerable<string> children;
            try { children = Directory.EnumerateFileSystemEntries(current).ToArray(); }
            catch (IOException) { continue; }
            catch (UnauthorizedAccessException) { continue; }
            foreach (var child in children)
            {
                FileAttributes attributes;
                try { attributes = File.GetAttributes(child); }
                catch (IOException) { continue; }
                catch (UnauthorizedAccessException) { continue; }
                if ((attributes & FileAttributes.ReparsePoint) != 0) continue;
                if ((attributes & FileAttributes.Directory) != 0) { directories.Push(child); if (directoriesOnly) yield return child; }
                else if (!directoriesOnly) yield return child;
            }
        }
    }

    private async Task<string> EnsureFolderAsync(string name, string? parentId)
    {
        using var list = await AgentRequestAsync("folders" + (parentId is null ? "" : $"?parentId={parentId}"), HttpMethod.Get, null);
        foreach (var item in list.RootElement.GetProperty("folders").EnumerateArray())
            if (item.GetProperty("name").GetString() == name) {
                if (!item.TryGetProperty("providerFolderId", out var provider) || provider.ValueKind != JsonValueKind.String)
                    throw new IOException("A pasta ainda não está vinculada ao Google Drive. Confira sua conta e tente novamente.");
                return item.GetProperty("id").GetString()!;
            }
        using var created = await AgentRequestAsync("folders", HttpMethod.Post, new { name, parentId });
        var result = created.RootElement.GetProperty("folder");
        if (result.GetProperty("providerFolderId").ValueKind != JsonValueKind.String)
            throw new IOException("Não foi possível criar a pasta no Google Drive. Confira a conexão da conta Google.");
        return result.GetProperty("id").GetString()!;
    }

    private async Task<string> UploadAsync(Uri baseUri, string path, FileStamp stamp, string remoteFolderId, CancellationToken token)
    {
        if (accessToken is null && !await RefreshAsync(baseUri)) throw new IOException("Sessão expirada. Entre novamente com Google.");
        await using var stream = new FileStream(path, FileMode.Open, FileAccess.Read, FileShare.Read, 1024 * 1024, FileOptions.Asynchronous | FileOptions.SequentialScan);
        using var form = new MultipartFormDataContent();
        form.Add(new StringContent(stamp.Size.ToString()), "sizeBytes");
        form.Add(new StringContent(Path.GetFileName(path)), "fileName");
        form.Add(new StringContent("application/octet-stream"), "mimeType");
        form.Add(new StringContent(remoteFolderId), "folderId");
        using var content = new StreamContent(stream);
        content.Headers.ContentType = new MediaTypeHeaderValue("application/octet-stream");
        form.Add(content, "file", Path.GetFileName(path));
        using var request = new HttpRequestMessage(HttpMethod.Post, new Uri(baseUri, "uploads")) { Content = form };
        request.Headers.Authorization = new AuthenticationHeaderValue("Bearer", accessToken);
        using var response = await http.SendAsync(request, HttpCompletionOption.ResponseHeadersRead, token);
        if (response.StatusCode == HttpStatusCode.Unauthorized)
        {
            accessToken = null;
            throw new IOException("Sessão expirada. A renovação será tentada na próxima varredura.");
        }
        if (!response.IsSuccessStatusCode) throw new IOException($"API retornou {(int)response.StatusCode}: {await response.Content.ReadAsStringAsync(token)}");
        var now = new FileInfo(path);
        if (now.Length != stamp.Size || now.LastWriteTimeUtc.Ticks != stamp.ModifiedTicks)
            throw new IOException("Arquivo mudou durante o envio; será reenviado na próxima varredura.");
        using var result = JsonDocument.Parse(await response.Content.ReadAsStringAsync(token));
        return result.RootElement.GetProperty("file").GetProperty("id").GetString()!;
    }

    private async Task RestoreAsync()
    {
        if (deviceId is null) { MessageBox.Show("Entre com Google para recuperar os backups da sua conta."); return; }
        if (cancellation is not null) { MessageBox.Show("Pause o backup antes de restaurar."); return; }
        using var catalog = await AgentRequestAsync("backups", HttpMethod.Get, null);
        var roots = catalog.RootElement.GetProperty("roots").EnumerateArray().ToArray();
        if (roots.Length == 0) { MessageBox.Show("Nenhum catálogo de restauração disponível. Inicie um backup com esta versão primeiro."); return; }
        using var picker = new Form { Text = "Escolha o backup", Width = 650, Height = 320, StartPosition = FormStartPosition.CenterParent };
        var list = new ListBox { Dock = DockStyle.Fill };
        foreach (var root in roots) list.Items.Add($"{root.GetProperty("machine").GetString()} — {root.GetProperty("originalPath").GetString()}");
        var select = new Button { Text = "Selecionar", Dock = DockStyle.Bottom, DialogResult = DialogResult.OK };
        picker.Controls.Add(list); picker.Controls.Add(select); picker.AcceptButton = select; list.SelectedIndex = 0;
        if (picker.ShowDialog(this) != DialogResult.OK || list.SelectedIndex < 0) return;
        var chosen = roots[list.SelectedIndex];
        var suggested = RestorePaths.Suggest(chosen.GetProperty("originalPath").GetString()!, chosen.GetProperty("anchor").GetString()!, chosen.GetProperty("suffix").GetString()!);
        var decision = MessageBox.Show($"Destino sugerido:\n{suggested}\n\nSim: usar este destino. Não: escolher outra pasta.\nArquivos existentes serão preservados e ignorados.", "Restaurar pastas", MessageBoxButtons.YesNoCancel);
        if (decision == DialogResult.Cancel) return;
        if (decision == DialogResult.No) { using var folderPicker = new FolderBrowserDialog { Description = "Escolha a pasta raiz da restauração" }; if (folderPicker.ShowDialog() != DialogResult.OK) return; suggested = folderPicker.SelectedPath; }
        RestorePaths.CheckParents(suggested);
        var rootId = chosen.GetProperty("id").GetString();
        string? after = null;
        Directory.CreateDirectory(suggested);
        var restored = 0; var skipped = 0;
        do
        {
            using var page = await AgentRequestAsync($"backups/{rootId}/entries" + (after is null ? "" : $"?after={after}"), HttpMethod.Get, null);
            foreach (var entry in page.RootElement.GetProperty("entries").EnumerateArray())
            {
                var target = RestorePaths.Resolve(suggested, entry.GetProperty("relativePath").GetString()!);
                if (entry.TryGetProperty("kind", out var kind) && kind.GetString() == "directory") { Directory.CreateDirectory(target); continue; }
                if (File.Exists(target)) { skipped++; continue; }
                if (kind.ValueKind == JsonValueKind.String && kind.GetString() == "empty") {
                    Directory.CreateDirectory(Path.GetDirectoryName(target)!);
                    using (var empty = new FileStream(target, FileMode.CreateNew, FileAccess.Write, FileShare.None)) { }
                    File.SetLastWriteTimeUtc(target, entry.GetProperty("modifiedUtc").GetDateTime().ToUniversalTime()); restored++; continue;
                }
                Directory.CreateDirectory(Path.GetDirectoryName(target)!);
                RestorePaths.CheckParents(target);
                SetStatus($"Restaurando {entry.GetProperty("relativePath").GetString()}");
                if (!await RefreshAsync(ApiOrigin)) throw new IOException("Sessão expirada.");
                using var request = new HttpRequestMessage(HttpMethod.Get, new Uri(ApiOrigin, $"files/{entry.GetProperty("fileId").GetString()}/download"));
                request.Headers.Authorization = new AuthenticationHeaderValue("Bearer", accessToken);
                using var response = await http.SendAsync(request, HttpCompletionOption.ResponseHeadersRead);
                response.EnsureSuccessStatusCode();
                var temporary = Path.Combine(Path.GetDirectoryName(target)!, $".singledrive-{Guid.NewGuid():N}.tmp");
                try
                {
                    await using (var output = new FileStream(temporary, FileMode.CreateNew, FileAccess.Write, FileShare.None))
                    {
                        await using var input = await response.Content.ReadAsStreamAsync();
                        var buffer = new byte[1024 * 128]; long total = 0;
                        var expected = long.Parse(entry.GetProperty("sizeBytes").GetString()!);
                        int read;
                        while ((read = await input.ReadAsync(buffer)) > 0) { total += read; if (total > expected) throw new IOException("Tamanho recebido excede o catálogo."); await output.WriteAsync(buffer.AsMemory(0, read)); }
                        if (total != expected) throw new IOException("Download incompleto.");
                    }
                    await using (var verify = File.OpenRead(temporary))
                        if (!Convert.ToHexString(await SHA256.HashDataAsync(verify)).Equals(entry.GetProperty("sha256").GetString(), StringComparison.OrdinalIgnoreCase)) throw new IOException("A integridade do arquivo não confere.");
                    RestorePaths.CheckParents(target);
                    File.SetLastWriteTimeUtc(temporary, entry.GetProperty("modifiedUtc").GetDateTime().ToUniversalTime());
                    File.Move(temporary, target, false); restored++;
                }
                finally { if (File.Exists(temporary)) File.Delete(temporary); }
            }
            after = page.RootElement.GetProperty("next").GetString();
        } while (after is not null);
        SetStatus($"Restauração concluída: {restored} recuperado(s), {skipped} existente(s) preservado(s). Destino: {suggested}");
    }

    private async Task LoginAsync()
    {
        if (deviceId is not null) { MessageBox.Show("Este PC já está vinculado. Desvincule antes de entrar com outra conta."); return; }
        if (cancellation is not null) { MessageBox.Show("Pause o backup antes de trocar de conta."); return; }
        var baseUri = ApiOrigin;
        login.Enabled = false;
        try
        {
            RegisterProtocol();
            var verifier = Convert.ToBase64String(RandomNumberGenerator.GetBytes(32)).TrimEnd('=').Replace('+', '-').Replace('/', '_');
            var challenge = Convert.ToBase64String(SHA256.HashData(System.Text.Encoding.ASCII.GetBytes(verifier))).TrimEnd('=').Replace('+', '-').Replace('/', '_');
            using var request = new HttpRequestMessage(HttpMethod.Post, new Uri(baseUri, "auth/google/start"))
            { Content = JsonContent(new { client = "desktop", codeChallenge = challenge }) };
            request.Headers.Add("X-SingleDrive-Desktop", "1");
            using var response = await http.SendAsync(request);
            response.EnsureSuccessStatusCode();
            using var data = JsonDocument.Parse(await response.Content.ReadAsStringAsync());
            var state = data.RootElement.GetProperty("state").GetString()!;
            var url = data.RootElement.GetProperty("url").GetString()!;
            var consentUrl = new Uri(url);
            if (consentUrl.Scheme != "https" || consentUrl.Host != "accounts.google.com") throw new IOException("Endereço de autorização Google inválido.");
            var callbackPath = Path.Combine(Path.GetDirectoryName(settingsPath)!, "oauth-callback.txt");
            if (File.Exists(callbackPath)) File.Delete(callbackPath);
            status.Text = "Conclua o acesso no navegador...";
            Process.Start(new ProcessStartInfo(url) { UseShellExecute = true });
            for (var i = 0; i < 600; i++)
            {
                await Task.Delay(1000);
                if (!File.Exists(callbackPath)) continue;
                string callback;
                try { callback = File.ReadAllText(callbackPath); File.Delete(callbackPath); }
                catch (IOException) { continue; }
                var fragment = new Uri(callback).Fragment.TrimStart('#');
                var parts = fragment.Split('&').Select(part => part.Split('=', 2)).Where(part => part.Length == 2).ToDictionary(part => part[0], part => Uri.UnescapeDataString(part[1]));
                if (!parts.TryGetValue("state", out var returnedState) || returnedState != state || !parts.TryGetValue("code", out var code)) continue;
                using var complete = new HttpRequestMessage(HttpMethod.Post, new Uri(baseUri, "auth/google/complete"))
                { Content = JsonContent(new { state, code, verifier }) };
                complete.Headers.Add("X-SingleDrive-Desktop", "1");
                using var completed = await http.SendAsync(complete);
                if (!completed.IsSuccessStatusCode) throw new IOException($"Login falhou: {(int)completed.StatusCode}");
                using var session = JsonDocument.Parse(await completed.Content.ReadAsStringAsync());
                accessToken = session.RootElement.GetProperty("accessToken").GetString();
                accountId = session.RootElement.GetProperty("user").GetProperty("id").GetString();
                localConsent = false;
                diskConsent = false;
                SetDiskButtons();
                await SaveSettingsAsync(baseUri);
                heartbeatTimer.Interval = HeartbeatIntervalMs;
                heartbeatTimer.Start();
                await RegisterDeviceAsync();
                status.Text = "Conta conectada. O PC está vinculado.";
                await HeartbeatAsync();
                return;
            }
            status.Text = "Tempo de login esgotado. Tente novamente.";
        }
        catch (Exception ex) { status.Text = $"Falha no login: {ex.Message}"; }
        finally { login.Enabled = true; }
    }

    private static StringContent JsonContent(object value) => new(JsonSerializer.Serialize(value), System.Text.Encoding.UTF8, "application/json");

    private static void RegisterProtocol()
    {
        using var scheme = Registry.CurrentUser.CreateSubKey(@"Software\Classes\singledrive-desktop");
        scheme.SetValue("", "URL:SingleDrive Desktop");
        scheme.SetValue("URL Protocol", "");
        using var command = scheme.CreateSubKey(@"shell\open\command");
        command.SetValue("", $"\"{Environment.ProcessPath}\" \"%1\"");
    }

    private async Task<bool> RefreshAsync(Uri baseUri, CancellationToken cancellationToken = default)
    {
        using var timeout = CancellationTokenSource.CreateLinkedTokenSource(cancellationToken);
        timeout.CancelAfter(HeartbeatIntervalMs);
        await refreshLock.WaitAsync(timeout.Token);
        try
        {
            using var request = new HttpRequestMessage(HttpMethod.Post, new Uri(baseUri, "auth/refresh"));
            request.Headers.Add("X-SingleDrive-Desktop", "1");
            using var response = await http.SendAsync(request, timeout.Token);
            if (response.StatusCode == HttpStatusCode.Unauthorized) { accessToken = null; return false; }
            if (!response.IsSuccessStatusCode) throw new IOException($"Servidor temporariamente indisponível ({(int)response.StatusCode}).");
            using var data = JsonDocument.Parse(await response.Content.ReadAsStringAsync());
            accessToken = data.RootElement.GetProperty("accessToken").GetString();
            accountId = data.RootElement.GetProperty("user").GetProperty("id").GetString();
            await SaveSettingsAsync(baseUri);
            return !string.IsNullOrEmpty(accessToken);
        }
        finally { refreshLock.Release(); }
    }

    private async Task<JsonDocument> AgentRequestAsync(string path, HttpMethod method, object? body, CancellationToken cancellationToken = default)
    {
        for (var attempt = 0; attempt < 2; attempt++)
        {
            if (accessToken is null && !await RefreshAsync(ApiOrigin, cancellationToken)) throw new UnauthorizedAccessException("Entre novamente com Google.");
            using var request = new HttpRequestMessage(method, new Uri(ApiOrigin, path)) { Content = body is null ? null : JsonContent(body) };
            request.Headers.Authorization = new AuthenticationHeaderValue("Bearer", accessToken);
            using var response = await http.SendAsync(request, cancellationToken);
            if (response.StatusCode == HttpStatusCode.Unauthorized)
            {
                accessToken = null;
                if (attempt == 0 && await RefreshAsync(ApiOrigin, cancellationToken)) continue;
                throw new UnauthorizedAccessException("O vínculo expirou ou foi revogado.");
            }
            if (response.StatusCode == HttpStatusCode.Forbidden) throw new UnauthorizedAccessException("Vincule o PC novamente pelo login Google.");
            if (!response.IsSuccessStatusCode) {
                using var error = JsonDocument.Parse(await response.Content.ReadAsStringAsync());
                throw new IOException(error.RootElement.TryGetProperty("message", out var message) ? message.GetString() : $"Servidor retornou {(int)response.StatusCode}.");
            }
            return JsonDocument.Parse(await response.Content.ReadAsStringAsync());
        }
        throw new UnauthorizedAccessException("Sessão inválida.");
    }

    private async Task RegisterDeviceAsync()
    {
        using var timeout = new CancellationTokenSource(HeartbeatIntervalMs);
        using var result = await AgentRequestAsync("desktop-devices/register", HttpMethod.Post,
            new { name = Environment.MachineName, platform = "windows", appVersion = "0.6.4" }, timeout.Token);
        deviceId = result.RootElement.GetProperty("device").GetProperty("id").GetString();
    }

    private async Task SetBackupPolicyAsync(bool enabled)
    {
        using var result = await AgentRequestAsync($"desktop-devices/{deviceId}", HttpMethod.Patch, new { backupEnabled = enabled });
    }

    private async Task HeartbeatAsync()
    {
        if (heartbeatBusy || toggling || exitRequested) return;
        var restoringSession = deviceId is null;
        if (restoringSession && (!login.Enabled || cookies.GetCookies(ApiOrigin)["__Host-sd_refresh"] is null)) return;
        heartbeatBusy = true;
        if (restoringSession) login.Enabled = false;
        try
        {
            if (restoringSession) await RegisterDeviceAsync();
            if (exitRequested) return;
            using var timeout = new CancellationTokenSource(HeartbeatIntervalMs);
            using var result = await AgentRequestAsync("desktop-devices/heartbeat", HttpMethod.Post, new {
                runtimeStatus, sourceNames = string.IsNullOrEmpty(folder.Text) ? Array.Empty<string>() : new[] { string.IsNullOrEmpty(new DirectoryInfo(folder.Text).Name) ? "Pasta raiz" : new DirectoryInfo(folder.Text).Name },
                uploadedFiles = sent.Values.Count(stamp => stamp.Size >= 0), completedScan = scanCompleted,
                remoteDiskMounted = remoteDisk?.Ready == true,
            }, timeout.Token);
            scanCompleted = false;
            await UpdateRemoteDiskAsync(result.RootElement);
            var enabled = result.RootElement.GetProperty("backupEnabled").GetBoolean();
            if (!enabled) await StopBackupAsync();
            else if (localConsent) await StartBackupAsync();
        }
        catch (UnauthorizedAccessException)
        {
            await ClearDeviceAsync();
        }
        catch (Exception) { status.Text = "Sem contato com o servidor. Tentaremos novamente em 30 segundos."; }
        finally
        {
            if (restoringSession) login.Enabled = true;
            heartbeatBusy = false;
        }
    }

    private async Task ConfigureRemoteDiskAsync()
    {
        if (deviceId is null) { diskStatus.Text = "Entre com Google para vincular este PC."; return; }
        if (diskSetupBusy || heartbeatBusy) return;
        diskSetupBusy = true;
        SetDiskButtons();
        try
        {
            if (!diskPolicyKnown) await HeartbeatAsync();
            if (!diskPolicyKnown) throw new IOException("O servidor ainda não informou a configuração do disco.");
            if (diskConsent && diskEnabled)
            {
                diskConsent = false;
                StopRemoteDisk();
                await SaveSettingsAsync(ApiOrigin);
                diskStatus.Text = "Disco desconectado neste PC.";
                return;
            }
            if (!diskEnabled && diskRootId is not null)
                throw new IOException("Retome o acesso deste computador no site, em Computadores.");
            var linkedDevice = deviceId ?? throw new IOException("Vincule o PC novamente.");
            var createDisk = diskRootId is null;
            if (createDisk)
            {
                using var response = await AgentRequestAsync("connected-accounts", HttpMethod.Get, null);
                var hasDrive = response.RootElement.GetProperty("accounts").EnumerateArray()
                    .Any(item => item.GetProperty("provider").GetString() == "google_drive" && item.GetProperty("status").GetString() == "connected");
                if (!hasDrive)
                {
                    diskStatus.Text = "Conecte uma conta Google Drive em Configurações no site.";
                    Process.Start(new ProcessStartInfo(new Uri(ApiOrigin, "/settings").AbsoluteUri) { UseShellExecute = true });
                    return;
                }
            }
            await RemoteDiskMount.PrepareAsync(message => diskStatus.Text = message);
            if (exitRequested || deviceId != linkedDevice) return;
            if (createDisk)
            {
                using var response = await AgentRequestAsync($"remote-disk/devices/{linkedDevice}", HttpMethod.Put,
                    new { enabled = true, poolEnabled = true });
            }
            diskConsent = true;
            openDiskWhenReady = true;
            diskRetryAt = DateTime.MinValue;
            await SaveSettingsAsync(ApiOrigin);
            await HeartbeatAsync();
        }
        catch (Exception ex) { diskStatus.Text = $"Disco remoto: {ex.Message}"; }
        finally { diskSetupBusy = false; SetDiskButtons(); }
    }

    private async Task UpdateRemoteDiskAsync(JsonElement policy)
    {
        diskPolicyKnown = policy.TryGetProperty("remoteDiskEnabled", out var enabled);
        diskEnabled = diskPolicyKnown && enabled.GetBoolean();
        diskRestorable = policy.TryGetProperty("remoteDiskRestorable", out var restorable) && restorable.GetBoolean();
        diskRootId = diskPolicyKnown ? policy.GetProperty("remoteDiskRootId").GetString() : null;
        SetDiskButtons();
        if (!diskEnabled)
        {
            StopRemoteDisk();
            if (!diskSetupBusy)
                diskStatus.Text = !diskPolicyKnown ? "O servidor ainda não oferece disco remoto."
                    : diskRestorable ? "Recupere as pastas que já foram salvas no Google Drive."
                    : diskRootId is null ? "Crie uma unidade para salvar no Google Drive." : "Disco pausado no site.";
            return;
        }
        if (!diskConsent || exitRequested)
        {
            if (!diskSetupBusy) diskStatus.Text = "Clique em Conectar disco remoto para montar a unidade.";
            return;
        }
        if (diskRootId is not string root || accountId is null || remoteDisk is not null) return;
        if (DateTime.UtcNow < diskRetryAt) return;
        try
        {
            using var timeout = new CancellationTokenSource(HeartbeatIntervalMs);
            using var data = await AgentRequestAsync("remote-disk/mount-key", HttpMethod.Post, new { }, timeout.Token);
            if (!diskConsent || exitRequested) return;
            var key = data.RootElement.GetProperty("key").GetString()!;
            remoteDisk = new RemoteDiskMount(accountId, root, key);
            diskStartedAt = DateTime.UtcNow;
            diskStatus.Text = $"Conectando a unidade {remoteDisk.DriveLetter}…";
            diskTimer.Start();
            SetDiskButtons();
        }
        catch (UnauthorizedAccessException) { throw; }
        catch (Exception ex)
        {
            diskRetryAt = DateTime.UtcNow.AddMinutes(2);
            diskStatus.Text = $"Disco remoto: {ex.Message}";
        }
    }

    private void CheckRemoteDisk()
    {
        if (remoteDisk is not { } mount) { diskTimer.Stop(); return; }
        if (mount.Ready)
        {
            diskStatus.Text = $"SingleDrive ({mount.DriveLetter}) está disponível no Explorador.";
            SetDiskButtons();
            if (!openDiskWhenReady) return;
            openDiskWhenReady = false;
            try { mount.Open(); }
            catch (Exception ex) { diskStatus.Text = ex.Message; }
            return;
        }
        if (mount.Running && DateTime.UtcNow - diskStartedAt < TimeSpan.FromMinutes(2)) return;
        StopRemoteDisk();
        diskRetryAt = DateTime.UtcNow.AddMinutes(2);
        diskStatus.Text = "Falha ao montar. Confira o WinFsp e o registro do rclone.";
        diskStatus.AccessibleDescription = mount.LogPath;
    }

    private void StopRemoteDisk()
    {
        diskTimer.Stop();
        openDiskWhenReady = false;
        var mount = remoteDisk;
        remoteDisk = null;
        if (mount is not null) mount.Dispose();
        SetDiskButtons();
    }

    private void SetDiskButtons()
    {
        diskToggle.Text = diskConsent && diskEnabled ? "Desconectar disco"
            : diskRestorable ? "Restaurar disco remoto" : diskRootId is null ? "Criar disco remoto" : "Conectar disco remoto";
        diskToggle.Enabled = !diskSetupBusy && (diskEnabled || diskRootId is null);
        diskOpen.Enabled = remoteDisk?.Ready == true;
        diskTransfer.Enabled = diskEnabled && deviceId is not null;
    }

    private async Task StopBackupAsync()
    {
        var previous = cancellation;
        if (previous is not null)
        {
            previous.Cancel();
            if (backupTask is not null) await backupTask;
            previous.Dispose();
            cancellation = null;
        }
        runtimeStatus = "paused";
        toggle.Text = "Iniciar backup";
        status.Text = "Backup pausado. O PC continua vinculado.";
    }

    private async Task ClearDeviceAsync()
    {
        diskConsent = false;
        diskPolicyKnown = false;
        diskEnabled = false;
        diskRestorable = false;
        diskRootId = null;
        StopRemoteDisk();
        diskStatus.Text = "Entre com Google para criar a unidade.";
        await StopBackupAsync();
        heartbeatTimer.Stop();
        deviceId = null;
        accessToken = null;
        localConsent = false;
        cookies.Add(ApiOrigin, new Cookie("__Host-sd_refresh", "", "/") { Secure = true, Expired = true });
        if (File.Exists(settingsPath)) File.Delete(settingsPath);
        status.Text = "Vínculo encerrado. Entre com Google para vincular novamente.";
    }

    private void ShowAgent() { Show(); WindowState = FormWindowState.Normal; Activate(); }

    private async Task SaveSettingsAsync(Uri baseUri)
    {
        await settingsLock.WaitAsync();
        try
        {
            Directory.CreateDirectory(Path.GetDirectoryName(settingsPath)!);
            var token = cookies.GetCookies(baseUri)["__Host-sd_refresh"]?.Value ?? "";
            var settings = new Settings(folder.Text, token, localConsent, diskConsent);
            var protectedSettings = ProtectedData.Protect(JsonSerializer.SerializeToUtf8Bytes(settings), null, DataProtectionScope.CurrentUser);
            await File.WriteAllBytesAsync(settingsPath + ".tmp", protectedSettings);
            File.Move(settingsPath + ".tmp", settingsPath, true);
        }
        finally { settingsLock.Release(); }
    }

    private async Task SaveStateAsync(CancellationToken token)
    {
        var temporary = StatePath + ".tmp";
        await File.WriteAllBytesAsync(temporary, ProtectedData.Protect(JsonSerializer.SerializeToUtf8Bytes(sent), null, DataProtectionScope.CurrentUser), token);
        File.Move(temporary, StatePath, true);
    }

    private void SetStatus(string value)
    {
        if (IsDisposed) return;
        if (InvokeRequired) BeginInvoke(() => status.Text = value);
        else status.Text = value;
    }

    private sealed record Settings(string Folder, string Cookie, bool LocalConsent, bool DiskConsent = false);
    private sealed record FileStamp(long Size, long ModifiedTicks);
}
