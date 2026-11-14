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
    private Task? backupTask;
    private readonly NotifyIcon tray;
    private readonly System.Windows.Forms.Timer heartbeatTimer = new() { Interval = 30_000 };
    private readonly System.Windows.Forms.Timer openTimer = new() { Interval = 500 };
    private string StatePath => Path.Combine(Path.GetDirectoryName(settingsPath)!, $"backup-{accountId}.bin");
    private readonly Dictionary<string, FileStamp> sent = new(StringComparer.OrdinalIgnoreCase);
    private CancellationTokenSource? cancellation;

    public BackupForm(bool initiallyVisible, EventWaitHandle openSignal)
    {
        http = new HttpClient(new HttpClientHandler { AllowAutoRedirect = false, CookieContainer = cookies, UseCookies = true }) { Timeout = TimeSpan.FromMinutes(30) };
        Text = "SingleDrive Backup";
        Width = 630;
        Height = 350;
        StartPosition = FormStartPosition.CenterScreen;
        var trayMenu = new ContextMenuStrip();
        trayMenu.Items.Add("Abrir SingleDrive", null, (_, _) => DesktopAgent.OpenWebsite());
        trayMenu.Items.Add("Configurar backup", null, (_, _) => ShowAgent());
        trayMenu.Items.Add("Encerrar agente", null, (_, _) => { exitRequested = true; Close(); });
        tray = new NotifyIcon { Icon = SystemIcons.Application, Text = "SingleDrive — agente do PC", ContextMenuStrip = trayMenu, Visible = true };
        tray.DoubleClick += (_, _) => ShowAgent();
        FormClosing += (_, e) => { if (!exitRequested) { e.Cancel = true; Hide(); } else { cancellation?.Cancel(); heartbeatTimer.Stop(); openTimer.Stop(); tray.Dispose(); } };
        openTimer.Tick += (_, _) => { if (openSignal.WaitOne(0)) ShowAgent(); };
        openTimer.Start();
        heartbeatTimer.Tick += async (_, _) => await HeartbeatAsync();
        Shown += async (_, _) =>
        {
            if (!initiallyVisible) Hide();
            try
            {
                if (await RefreshAsync(ApiOrigin)) { await RegisterDeviceAsync(); heartbeatTimer.Start(); await HeartbeatAsync(); }
            }
            catch (Exception ex) { status.Text = $"Não foi possível vincular o PC: {ex.Message}"; }
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
        panel.Controls.Add(new Label { Text = "Pasta local", AutoSize = true });
        var row = new FlowLayoutPanel { Width = 580, Height = 38, WrapContents = false };
        row.Controls.Add(folder);
        var choose = new Button { Text = "Escolher", Width = 90 };
        choose.Click += (_, _) => { if (cancellation is not null) { MessageBox.Show("Pause o backup antes de trocar de pasta."); return; } using var dialog = new FolderBrowserDialog(); if (dialog.ShowDialog() == DialogResult.OK) folder.Text = dialog.SelectedPath; };
        row.Controls.Add(choose);
        panel.Controls.Add(row);
        panel.Controls.Add(toggle);
        panel.Controls.Add(status);
        panel.Controls.Add(new Label { Text = "Envios automáticos a cada 2 minutos. Exclusões locais não apagam arquivos remotos.", AutoSize = true });
        var startup = new CheckBox { Text = "Iniciar agente ao entrar no Windows", AutoSize = true };
        using (var runKey = Registry.CurrentUser.OpenSubKey(@"Software\Microsoft\Windows\CurrentVersion\Run")) startup.Checked = runKey?.GetValue("SingleDrive") is not null;
        startup.CheckedChanged += (_, _) =>
        {
            using var runKey = Registry.CurrentUser.CreateSubKey(@"Software\Microsoft\Windows\CurrentVersion\Run");
            if (startup.Checked) runKey.SetValue("SingleDrive", $"\"{Environment.ProcessPath}\" --background");
            else runKey.DeleteValue("SingleDrive", false);
        };
        panel.Controls.Add(startup);
        toggle.Click += async (_, _) => await ToggleAsync();
        LoadSettings();
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
        if (toggling) return;
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
        if (cancellation is not null || accountId is null || !localConsent || !Directory.Exists(folder.Text)) return;
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
            var attempted = 0;
            var uploaded = 0;
            foreach (var path in EnumerateFiles(root))
            {
                token.ThrowIfCancellationRequested();
                var info = new FileInfo(path);
                if (!info.Exists || info.Length == 0 || DateTime.UtcNow - info.LastWriteTimeUtc < TimeSpan.FromSeconds(5)) continue;
                var relative = Path.GetRelativePath(root, path).Replace('\\', '/');
                var identity = root + "|" + relative;
                var stamp = new FileStamp(info.Length, info.LastWriteTimeUtc.Ticks);
                if (sent.TryGetValue(identity, out var previous) && previous == stamp) continue;
                attempted++;
                runtimeStatus = "uploading";
                SetStatus($"Enviando {relative} ({attempted} tentativa(s) nesta varredura)");
                try
                {
                    await UploadAsync(baseUri, path, stamp, token);
                    sent[identity] = stamp;
                    await SaveStateAsync(token);
                    uploaded++;
                }
                catch (OperationCanceledException) when (token.IsCancellationRequested) { throw; }
                catch (Exception ex) { SetStatus($"Falha em {relative}: {ex.Message}"); }
            }
            SetStatus($"Varredura concluída. {uploaded} enviado(s), {attempted - uploaded} falha(s).");
            runtimeStatus = attempted == uploaded ? "idle" : "error";
            scanCompleted = attempted == uploaded;
        }
        finally { scanLock.Release(); }
    }

    private static IEnumerable<string> EnumerateFiles(string root)
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
                if ((attributes & FileAttributes.Directory) != 0) directories.Push(child);
                else yield return child;
            }
        }
    }

    private async Task UploadAsync(Uri baseUri, string path, FileStamp stamp, CancellationToken token)
    {
        if (accessToken is null && !await RefreshAsync(baseUri)) throw new IOException("Sessão expirada. Entre novamente com Google.");
        await using var stream = new FileStream(path, FileMode.Open, FileAccess.Read, FileShare.Read, 1024 * 1024, FileOptions.Asynchronous | FileOptions.SequentialScan);
        using var form = new MultipartFormDataContent();
        form.Add(new StringContent(stamp.Size.ToString()), "sizeBytes");
        form.Add(new StringContent(Path.GetFileName(path)), "fileName");
        form.Add(new StringContent("application/octet-stream"), "mimeType");
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
                await SaveSettingsAsync(baseUri);
                await RegisterDeviceAsync();
                heartbeatTimer.Start();
                status.Text = "Conta conectada. Escolha uma pasta e inicie o backup.";
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

    private async Task<bool> RefreshAsync(Uri baseUri)
    {
        await refreshLock.WaitAsync();
        try
        {
            using var request = new HttpRequestMessage(HttpMethod.Post, new Uri(baseUri, "auth/refresh"));
            request.Headers.Add("X-SingleDrive-Desktop", "1");
            using var response = await http.SendAsync(request);
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

    private async Task<JsonDocument> AgentRequestAsync(string path, HttpMethod method, object body)
    {
        for (var attempt = 0; attempt < 2; attempt++)
        {
            if (accessToken is null && !await RefreshAsync(ApiOrigin)) throw new UnauthorizedAccessException("Entre novamente com Google.");
            using var request = new HttpRequestMessage(method, new Uri(ApiOrigin, path)) { Content = JsonContent(body) };
            request.Headers.Authorization = new AuthenticationHeaderValue("Bearer", accessToken);
            using var response = await http.SendAsync(request);
            if (response.StatusCode == HttpStatusCode.Unauthorized)
            {
                accessToken = null;
                if (attempt == 0 && await RefreshAsync(ApiOrigin)) continue;
                throw new UnauthorizedAccessException("O vínculo expirou ou foi revogado.");
            }
            if (response.StatusCode == HttpStatusCode.Forbidden) throw new UnauthorizedAccessException("Vincule o PC novamente pelo login Google.");
            if (!response.IsSuccessStatusCode) throw new IOException($"Servidor retornou {(int)response.StatusCode}.");
            return JsonDocument.Parse(await response.Content.ReadAsStringAsync());
        }
        throw new UnauthorizedAccessException("Sessão inválida.");
    }

    private async Task RegisterDeviceAsync()
    {
        using var result = await AgentRequestAsync("desktop-devices/register", HttpMethod.Post,
            new { name = Environment.MachineName, platform = "windows", appVersion = "0.2.0" });
        deviceId = result.RootElement.GetProperty("device").GetProperty("id").GetString();
    }

    private async Task SetBackupPolicyAsync(bool enabled)
    {
        using var result = await AgentRequestAsync($"desktop-devices/{deviceId}", HttpMethod.Patch, new { backupEnabled = enabled });
    }

    private async Task HeartbeatAsync()
    {
        if (heartbeatBusy || toggling || deviceId is null) return;
        heartbeatBusy = true;
        try
        {
            using var result = await AgentRequestAsync("desktop-devices/heartbeat", HttpMethod.Post, new {
                runtimeStatus, sourceNames = string.IsNullOrEmpty(folder.Text) ? Array.Empty<string>() : new[] { string.IsNullOrEmpty(new DirectoryInfo(folder.Text).Name) ? "Pasta raiz" : new DirectoryInfo(folder.Text).Name },
                uploadedFiles = sent.Count, completedScan = scanCompleted,
            });
            scanCompleted = false;
            var enabled = result.RootElement.GetProperty("backupEnabled").GetBoolean();
            if (!enabled) await StopBackupAsync();
            else if (localConsent) await StartBackupAsync();
        }
        catch (UnauthorizedAccessException)
        {
            await ClearDeviceAsync();
        }
        catch (Exception) { status.Text = "Sem contato com o servidor. Tentaremos novamente em 30 segundos."; }
        finally { heartbeatBusy = false; }
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
        Directory.CreateDirectory(Path.GetDirectoryName(settingsPath)!);
        var name = "__Host-sd_refresh";
        var token = cookies.GetCookies(baseUri)[name]?.Value ?? "";
        var protectedSettings = ProtectedData.Protect(JsonSerializer.SerializeToUtf8Bytes(new Settings(folder.Text, token, localConsent)), null, DataProtectionScope.CurrentUser);
        await File.WriteAllBytesAsync(settingsPath + ".tmp", protectedSettings);
        File.Move(settingsPath + ".tmp", settingsPath, true);
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

    private sealed record Settings(string Folder, string Cookie, bool LocalConsent);
    private sealed record FileStamp(long Size, long ModifiedTicks);
}
