package app.singledrive.android

import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.suspendCancellableCoroutine
import kotlinx.coroutines.sync.Mutex
import kotlinx.coroutines.sync.withLock
import kotlinx.coroutines.withContext
import okhttp3.*
import okhttp3.HttpUrl.Companion.toHttpUrl
import okhttp3.MediaType.Companion.toMediaType
import okhttp3.RequestBody.Companion.toRequestBody
import org.json.JSONArray
import org.json.JSONObject
import java.io.IOException
import java.util.concurrent.TimeUnit
import kotlin.coroutines.resume
import kotlin.coroutines.resumeWithException

class ApiException(val status: Int, message: String) : IOException(message)
fun json(vararg values: Pair<String, Any?>) = JSONObject().apply {
    values.forEach { (k,v) -> put(k, v ?: JSONObject.NULL) }
}
fun JSONObject.rows(key: String): List<JSONObject> = optJSONArray(key)?.let { a ->
    (0 until a.length()).map { a.getJSONObject(it) }
} ?: emptyList()
fun ids(id: String) = JSONArray().put(id)

class Api internal constructor(private val store: SessionStore, baseUrl: String = BuildConfig.API_BASE,
                               configureTransport: (OkHttpClient.Builder) -> Unit = {}) {
    private val base = baseUrl.toHttpUrl().also { require(it.isHttps) }
    @Volatile var accessToken: String? = null
        private set
    private val rotation = Mutex()
    private val cookieJar = object : CookieJar {
        override fun saveFromResponse(url: HttpUrl, cookies: List<Cookie>) {
            if (url.host != base.host || !url.isHttps) return
            cookies.filter { it.name == "__Host-sd_refresh" && it.secure && it.hostOnly && it.path == "/" }
                .lastOrNull()?.let { cookie ->
                    store.update { it.put("cookie", cookie.toString()) }
                }
        }
        override fun loadForRequest(url: HttpUrl): List<Cookie> {
            if (url.host != base.host || !url.isHttps) return emptyList()
            val raw = store.read().optString("cookie")
            return listOfNotNull(Cookie.parse(base, raw)?.takeIf { it.expiresAt > System.currentTimeMillis() && it.matches(url) })
        }
    }
    private val client = OkHttpClient.Builder().cookieJar(cookieJar)
        .connectTimeout(20, TimeUnit.SECONDS).readTimeout(90, TimeUnit.SECONDS)
        .writeTimeout(90, TimeUnit.SECONDS).callTimeout(180, TimeUnit.SECONDS)
        .followRedirects(false).followSslRedirects(false).apply(configureTransport).build()

    private suspend fun execute(request: Request): Response = suspendCancellableCoroutine { continuation ->
        val call = client.newCall(request)
        continuation.invokeOnCancellation { call.cancel() }
        call.enqueue(object : Callback {
            override fun onFailure(call: Call, e: IOException) {
                if (continuation.isActive) continuation.resumeWithException(e)
            }
            override fun onResponse(call: Call, response: Response) {
                continuation.resume(response) { _, value, _ -> value.close() }
            }
        })
    }
    private fun request(path: String, method: String, body: RequestBody?, token: String?, headers: Map<String, String>): Request {
        require(!path.startsWith('/') && !path.contains("://"))
        val url = base.resolve(path) ?: error("Endereço inválido")
        require(url.host == base.host && url.isHttps)
        return Request.Builder().url(url).header("Origin", BuildConfig.WEB_ORIGIN)
            .header("Accept", "application/json").header("User-Agent", "SingleDrive-Android/${BuildConfig.VERSION_NAME}")
            .apply { token?.let { header("Authorization", "Bearer $it") } }
            .apply { headers.forEach { (name, value) -> header(name, value) } }
            .method(method, body).build()
    }
    suspend fun call(path: String, method: String = "GET", data: JSONObject? = null, auth: Boolean = true): JSONObject {
        val body = if (method == "GET" || method == "DELETE") null else
            (data ?: JSONObject()).toString().toRequestBody("application/json".toMediaType())
        return send(path, method, body, auth) { response ->
            val text = response.body?.string().orEmpty()
            if (text.isBlank()) JSONObject() else JSONObject(text)
        }
    }
    suspend fun <T> send(path: String, method: String, body: RequestBody?, auth: Boolean = true, headers: Map<String, String> = emptyMap(),
                         consume: (Response) -> T): T = withContext(Dispatchers.IO) {
        val before = accessToken
        var response = execute(request(path, method, body, if (auth) before else null, headers))
        if (response.code == 401 && auth) {
            response.close()
            rotation.withLock { if (accessToken == before) refreshUnlocked() }
            response = execute(request(path, method, body, accessToken, headers))
        }
        response.use {
            if (!it.isSuccessful) {
                val text = it.body?.string().orEmpty()
                val msg = runCatching { JSONObject(text).optString("message") }.getOrDefault("")
                throw ApiException(it.code, msg.ifBlank { "Servidor indisponível (${it.code}). Tente novamente." })
            }
            consume(it)
        }
    }
    private suspend fun refreshUnlocked(): JSONObject {
        try { return accept(call("auth/refresh", "POST", auth = false)) }
        catch (e: ApiException) { if (e.status == 401) clear(); throw e }
    }
    suspend fun restore(): JSONObject = rotation.withLock { refreshUnlocked() }
    fun accept(data: JSONObject): JSONObject {
        accessToken = data.getString("accessToken")
        return data.getJSONObject("user")
    }
    fun clear() { accessToken = null; store.clear() }
}
