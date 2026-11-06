package app.singledrive.android

import android.app.Application
import android.net.Uri
import android.provider.OpenableColumns
import android.util.Base64
import androidx.compose.runtime.*
import androidx.lifecycle.AndroidViewModel
import androidx.lifecycle.viewModelScope
import kotlinx.coroutines.*
import okhttp3.MediaType.Companion.toMediaType
import okhttp3.RequestBody.Companion.toRequestBody
import org.json.JSONObject
import java.security.MessageDigest
import java.security.SecureRandom
import java.util.Locale
import java.io.File
import java.util.UUID
import androidx.core.content.FileProvider

data class DriveFile(val id: String, val name: String, val mime: String, val size: Long, val folderId: String?) {
    companion object {
        fun parse(o: JSONObject) = DriveFile(o.getString("id"), o.getString("name"), o.optString("mimeType"),
            o.optString("sizeBytes").toLongOrNull() ?: 0, o.optString("folderId").takeIf { it.isNotBlank() && it != "null" })
    }
}
data class DriveFolder(val id: String, val name: String, val parentId: String?)
data class DriveAccount(val id: String, val email: String, val used: Long, val total: Long?, val full: Boolean)
data class PathEntry(val id: String, val name: String)
fun bytes(value: Long?): String {
    if (value == null) return "Sem limite informado"
    var n = value.toDouble(); var i = 0
    val units = arrayOf("B", "KB", "MB", "GB", "TB")
    while (n >= 1024 && i < units.lastIndex) { n /= 1024; i++ }
    return String.format(Locale.forLanguageTag("pt-BR"), if (i == 0) "%.0f %s" else "%.1f %s", n, units[i])
}

class DriveModel(app: Application) : AndroidViewModel(app) {
    private val store = SecureStore(app)
    private val api = Api(store)
    var user by mutableStateOf<JSONObject?>(null); private set
    var booting by mutableStateOf(true); private set
    var loading by mutableStateOf(false); private set
    var working by mutableStateOf(false); private set
    var message by mutableStateOf<String?>(null)
    var files by mutableStateOf(emptyList<DriveFile>()); private set
    var folders by mutableStateOf(emptyList<DriveFolder>()); private set
    var accounts by mutableStateOf(emptyList<DriveAccount>()); private set
    var path by mutableStateOf(emptyList<PathEntry>()); private set
    var used by mutableLongStateOf(0); private set
    var total by mutableStateOf<Long?>(null); private set
    var transfer by mutableStateOf<String?>(null); private set
    var progress by mutableFloatStateOf(0f); private set
    var resumable by mutableStateOf(false); private set
    var tab by mutableIntStateOf(0); private set
    var query by mutableStateOf("")
    private var refreshJob: Job? = null
    private var transferJob: Job? = null
    private val resolver get() = getApplication<Application>().contentResolver

    init { viewModelScope.launch {
        try {
            if (store.read().optString("cookie").isNotBlank()) { user = api.restore(); refresh() }
        } catch (e: Exception) { if (e !is ApiException || e.status != 401) message = errorText(e) }
        finally { booting = false }
    } }
    private fun errorText(e: Throwable) = when (e) {
        is ApiException -> e.message ?: "A operação falhou."
        is java.net.UnknownHostException -> "Sem conexão. Confira sua internet e tente novamente."
        is java.net.SocketTimeoutException -> "O servidor demorou para responder. Tente novamente."
        is IllegalStateException -> e.message ?: "A operação não pôde ser concluída."
        else -> "Não foi possível concluir. Tente novamente."
    }
    fun action(block: suspend () -> Unit) {
        if (working) return
        working = true
        viewModelScope.launch {
            try { block() }
            catch (e: CancellationException) { throw e }
            catch (e: Exception) { message = errorText(e); if (e is ApiException && e.status == 401) user = null }
            finally { working = false }
        }
    }
    fun login(email: String, password: String) = action {
        user = api.accept(api.call("auth/login", "POST", json("email" to email.trim(), "password" to password), false)); refresh()
    }
    fun restoreLogin() = action { user = api.restore(); refresh() }
    fun google(connect: Boolean, full: Boolean, open: (Uri) -> Unit) = action {
        val flags = Base64.URL_SAFE or Base64.NO_PADDING or Base64.NO_WRAP
        val verifier = Base64.encodeToString(ByteArray(32).also { SecureRandom().nextBytes(it) }, flags)
        val challenge = Base64.encodeToString(MessageDigest.getInstance("SHA-256").digest(verifier.toByteArray()), flags)
        val result = api.call(if (connect) "auth/google/connect" else "auth/google/start", "POST",
            json("codeChallenge" to challenge, "accessMode" to if (full && connect) "full" else "essential", "client" to "android"), connect)
        val url = Uri.parse(result.getString("url"))
        check(url.scheme == "https" && url.host == "accounts.google.com")
        store.update { it.put("oauth", json("state" to result.getString("state"), "verifier" to verifier,
            "connect" to connect, "expires" to System.currentTimeMillis() + 600_000)) }
        open(url)
    }
    fun finishGoogle(uri: Uri) = action {
        if (uri.scheme != "app.singledrive.android" || uri.host != "oauth" || uri.path.orEmpty().isNotEmpty()) return@action
        val args = Uri.parse("https://local.invalid/?${uri.encodedFragment.orEmpty()}")
        val state = args.getQueryParameter("state").orEmpty(); val code = args.getQueryParameter("code").orEmpty()
        val pending = store.read().optJSONObject("oauth")
        if (pending == null || state != pending.optString("state") || code.isBlank() || pending.optLong("expires") <= System.currentTimeMillis()) {
            message = "A autorização expirou ou não foi iniciada neste app. Tente novamente."; return@action
        }
        val connect = pending.getBoolean("connect")
        if (connect && api.accessToken == null) user = api.restore()
        store.update { it.remove("oauth") }
        val result = api.call("auth/google/complete", "POST", json("state" to state, "code" to code, "verifier" to pending.getString("verifier")), connect)
        if (!connect) user = api.accept(result)
        message = if (connect) "Conta Google conectada." else "Bem-vindo ao SingleDrive."; refresh()
    }
    fun refresh() {
        if (user == null) return
        refreshJob?.cancel(); val trash = tab == 2; loading = true
        refreshJob = viewModelScope.launch {
            try {
                files = api.call(if (trash) "files/trash" else "files").rows("files").map(DriveFile::parse)
                if (!trash) folders = api.call("folders?all=1").rows("folders").map {
                    DriveFolder(it.getString("id"), it.getString("name"), it.optString("parentId").takeIf { p -> p.isNotBlank() && p != "null" })
                }
                loading = false
                accounts = api.call("connected-accounts").rows("accounts").map { a ->
                    val q = a.optJSONObject("storageAccount") ?: JSONObject()
                    DriveAccount(a.getString("id"), a.getString("email"), q.optString("usedBytes").toLongOrNull() ?: 0,
                        q.optString("totalBytes").toLongOrNull(), a.optJSONArray("scopes")?.toString()?.contains("/auth/drive\"") == true)
                }
                used = accounts.sumOf { it.used }; total = accounts.mapNotNull { it.total }.sum().takeIf { it > 0 }
                resumable = store.read().optJSONObject("upload")?.optString("userId") == user?.optString("id")
            } catch (e: CancellationException) { throw e }
            catch (e: Exception) { message = errorText(e); if (e is ApiException && e.status == 401) user = null }
            finally { loading = false }
        }
    }
    fun navigate(index: Int) { if (tab != index) { tab = index; query = ""; path = emptyList(); refresh() } }
    fun openFolder(folder: DriveFolder) { path = path + PathEntry(folder.id, folder.name) }
    fun up() { path = path.dropLast(1) }
    fun createFolder(name: String) = action {
        api.call("folders", "POST", json("name" to name.trim(), "parentId" to path.lastOrNull()?.id)); refresh()
    }
    fun rename(file: DriveFile, name: String) = action { api.call("files/${file.id}", "PATCH", json("name" to name.trim())); refresh() }
    fun move(file: DriveFile, folderId: String?) = action { api.call("files/${file.id}", "PATCH", json("folderId" to folderId)); refresh() }
    fun trash(file: DriveFile) = action {
        api.send("files/batch", "DELETE", json("fileIds" to ids(file.id)).toString().toRequestBody("application/json".toMediaType())) { }
        refresh()
    }
    fun restore(file: DriveFile) = action { api.call("files/batch/restore", "POST", json("fileIds" to ids(file.id))); refresh() }
    fun sync() = action { api.call("files/sync-google", "POST"); refresh(); message = "Biblioteca sincronizada." }
    fun syncAccount(a: DriveAccount) = action { api.call("connected-accounts/${a.id}/sync-quota", "POST"); refresh() }
    fun disconnect(a: DriveAccount) = action { api.call("connected-accounts/${a.id}", "DELETE"); refresh() }
    fun logout() = action {
        var revoked = true
        try { api.call("auth/logout", "POST") }
        catch (e: CancellationException) { throw e }
        catch (_: Exception) { revoked = false }
        transferJob?.cancelAndJoin(); refreshJob?.cancelAndJoin()
        api.clear(); user = null; files = emptyList(); folders = emptyList(); accounts = emptyList(); path = emptyList(); resumable = false
        withContext(Dispatchers.IO) { File(getApplication<Application>().cacheDir, "open").listFiles()?.forEach { it.delete() } }
        if (!revoked) message = "Sessão removida deste aparelho. Não foi possível confirmar a revogação no servidor."
    }
    fun cancelTransfer() { transferJob?.cancel() }
    private fun startTransfer(label: String, block: suspend () -> Unit) {
        if (transferJob?.isActive == true) return
        transfer = label; progress = 0f
        transferJob = viewModelScope.launch {
            try { block(); message = "Concluído."; refresh() }
            catch (_: CancellationException) { message = "Transferência interrompida. Uploads podem ser retomados." }
            catch (e: Exception) { message = errorText(e) }
            finally { transfer = null; resumable = store.read().optJSONObject("upload") != null }
        }
    }
    fun upload(uri: Uri) = startTransfer("Preparando envio…") {
        check(!resumable) { "Retome ou descarte o envio pendente antes de iniciar outro." }
        var name = "arquivo"; var size = -1L
        withContext(Dispatchers.IO) {
            resolver.query(uri, arrayOf(OpenableColumns.DISPLAY_NAME, OpenableColumns.SIZE), null, null, null)?.use {
                if (it.moveToFirst()) { name = it.getString(0) ?: name; if (!it.isNull(1)) size = it.getLong(1) }
            }
        }
        check(size in 1..(5L * 1024 * 1024 * 1024)) { "Escolha um arquivo de 1 byte a 5 GB com tamanho informado pelo Android." }
        val init = api.call("uploads/resumable/init", "POST", json("fileName" to name,
            "mimeType" to (resolver.getType(uri) ?: "application/octet-stream"), "sizeBytes" to size.toString(), "folderId" to path.lastOrNull()?.id))
        val saved = json("uri" to uri.toString(), "sessionId" to init.getString("sessionId"), "size" to size, "name" to name, "userId" to user!!.getString("id"))
        store.update { it.put("upload", saved) }; resumable = true; runUpload(saved)
    }
    fun resumeUpload() = startTransfer("Retomando envio…") {
        val saved = store.read().getJSONObject("upload")
        check(saved.getString("userId") == user!!.getString("id")); runUpload(saved)
    }
    fun discardUpload() { if (transfer == null) { store.update { it.remove("upload") }; resumable = false } }
    private suspend fun runUpload(saved: JSONObject) {
        val id = saved.getString("sessionId"); val size = saved.getLong("size")
        var offset = api.call("uploads/resumable/status/$id").optString("offset", "0").toLong()
        check(offset in 0..size)
        transfer = "Enviando ${saved.getString("name")}"; progress = offset.toFloat() / size
        withContext(Dispatchers.IO) {
            if (offset < size) resolver.openInputStream(Uri.parse(saved.getString("uri")))!!.use { input ->
                var skipped = 0L
                while (skipped < offset) {
                    ensureActive(); val n = input.skip(offset - skipped)
                    if (n > 0) skipped += n else { check(input.read() != -1) { "Arquivo alterado" }; skipped++ }
                }
                while (offset < size) {
                    ensureActive()
                    val chunk = ByteArray(minOf(5L * 1024 * 1024, size - offset).toInt()); var read = 0
                    while (read < chunk.size) { val n = input.read(chunk, read, chunk.size - read); check(n > 0) { "Arquivo alterado" }; read += n }
                    val end = offset + read - 1
                    val result = api.send("uploads/resumable/chunk/$id", "PUT", chunk.toRequestBody("application/octet-stream".toMediaType()),
                        headers = mapOf("Content-Range" to "bytes $offset-$end/$size")) { JSONObject(it.body!!.string()) }
                    val next = if (result.optString("status") == "completed") size else result.getString("offset").toLong()
                    check(next == end + 1) { "Posição inesperada. Retome para consultar o progresso." }
                    offset = next; withContext(Dispatchers.Main) { progress = offset.toFloat() / size }
                }
            }
        }
        store.update { it.remove("upload") }; resumable = false
    }
    fun download(file: DriveFile, uri: Uri) = startTransfer("Baixando ${file.name}") {
        withContext(Dispatchers.IO) {
            val job = currentCoroutineContext()
            api.send("files/${file.id}/download", "GET", null) { response ->
                resolver.openOutputStream(uri, "wt")!!.use { output ->
                    response.body!!.byteStream().use { input ->
                        val buffer = ByteArray(64 * 1024)
                        while (true) { job.ensureActive(); val n = input.read(buffer); if (n == -1) break; output.write(buffer, 0, n) }
                    }
                }
            }
        }
    }
    fun openFile(file: DriveFile, open: (Uri, String) -> Unit) = startTransfer("Abrindo ${file.name}") {
        val app = getApplication<Application>()
        val directory = File(app.cacheDir, "open").apply { mkdirs() }
        val limit = 200L * 1024 * 1024
        check(file.size <= limit) { "Para arquivos acima de 200 MB, use Salvar no dispositivo." }
        val name = file.name.replace(Regex("[^\\p{L}\\p{N}._ -]"), "_").take(100).ifBlank { "arquivo" }
        val cached = File(directory, "${UUID.randomUUID()}-$name")
        try {
            val mime = withContext(Dispatchers.IO) {
                directory.listFiles()?.filter { it.lastModified() < System.currentTimeMillis() - 86_400_000 }?.forEach { it.delete() }
                val remainingCache = 400L * 1024 * 1024 - directory.listFiles().orEmpty().sumOf { it.length() }
                check(file.size <= remainingCache) {
                    "Cache de abertura cheio. Use Salvar no dispositivo ou limpe o cache nos ajustes do Android."
                }
                val job = currentCoroutineContext()
                api.send("files/${file.id}/download", "GET", null) { response ->
                    var count = 0L
                    cached.outputStream().use { output -> response.body!!.byteStream().use { input ->
                        val buffer = ByteArray(64 * 1024)
                        while (true) {
                            job.ensureActive(); val n = input.read(buffer); if (n == -1) break
                            count += n; check(count <= minOf(limit, remainingCache)) { "Arquivo grande demais para abrir. Use Salvar no dispositivo." }
                            output.write(buffer, 0, n)
                        }
                    } }
                    response.header("Content-Type")?.substringBefore(';') ?: file.mime
                }
            }
            open(FileProvider.getUriForFile(app, "${BuildConfig.APPLICATION_ID}.files", cached), mime)
        } catch (e: Throwable) { cached.delete(); throw e }
    }
}
