package app.singledrive.android

import kotlinx.coroutines.runBlocking
import okhttp3.mockwebserver.MockResponse
import okhttp3.mockwebserver.MockWebServer
import okhttp3.tls.HandshakeCertificates
import okhttp3.tls.HeldCertificate
import org.json.JSONObject
import org.junit.After
import org.junit.Assert.*
import org.junit.Before
import org.junit.Test

class ApiTest {
    private val server = MockWebServer()
    private val store = object : SessionStore {
        var value = JSONObject()
        @Synchronized override fun read() = JSONObject(value.toString())
        @Synchronized override fun update(change: (JSONObject) -> Unit) { value = read().apply(change) }
        @Synchronized override fun clear() { value = JSONObject() }
    }
    private lateinit var api: Api
    @Before fun setup() {
        val cert = HeldCertificate.Builder().commonName("localhost").addSubjectAlternativeName("localhost").build()
        val serverTls = HandshakeCertificates.Builder().heldCertificate(cert).build()
        val clientTls = HandshakeCertificates.Builder().addTrustedCertificate(cert.certificate).build()
        server.useHttps(serverTls.sslSocketFactory(), false)
        server.start()
        api = Api(store, server.url("/").toString()) { it.sslSocketFactory(clientTls.sslSocketFactory(), clientTls.trustManager) }
    }
    @After fun close() = server.shutdown()
    private fun session(token: String) = json("accessToken" to token, "user" to json("id" to "test-user"))

    @Test fun expiredTokenRotatesOnceAndRetriesWithNewToken() = runBlocking {
        val renewedToken = "test-access-token-never-persisted"
        api.accept(session("expired"))
        server.enqueue(MockResponse().setResponseCode(401))
        server.enqueue(MockResponse().setBody(session(renewedToken).toString()).addHeader("Set-Cookie", "__Host-sd_refresh=rotated; Path=/; Secure; HttpOnly"))
        server.enqueue(MockResponse().setBody("{\"files\":[]}"))
        assertEquals(0, api.call("files").rows("files").size)
        assertEquals("Bearer expired", server.takeRequest().getHeader("Authorization"))
        assertEquals("/auth/refresh", server.takeRequest().path)
        val retried = server.takeRequest()
        assertEquals("Bearer $renewedToken", retried.getHeader("Authorization"))
        assertEquals("__Host-sd_refresh=rotated", retried.getHeader("Cookie"))
        assertFalse(store.read().toString().contains(renewedToken))
        assertFalse(store.read().has("accessToken"))
    }
    @Test fun invalidSessionClearsCredentialsAndDoesNotRetryOperation() = runBlocking {
        api.accept(session("expired"))
        store.update { it.put("cookie", "__Host-sd_refresh=old; Path=/; Secure; HttpOnly") }
        server.enqueue(MockResponse().setResponseCode(401))
        server.enqueue(MockResponse().setResponseCode(401).setBody("{}"))
        try { api.call("files"); fail("Expected unauthorized") } catch (e: ApiException) { assertEquals(401, e.status) }
        assertNull(api.accessToken)
        assertEquals(0, store.read().length())
        assertEquals(2, server.requestCount)
    }
    @Test fun redirectCannotSendCredentialsToAnotherServer() = runBlocking {
        api.accept(session("secret"))
        server.enqueue(MockResponse().setResponseCode(302).addHeader("Location", "https://example.invalid/steal"))
        try { api.call("files"); fail("Redirect must not be followed") } catch (e: ApiException) { assertEquals(302, e.status) }
        assertEquals(1, server.requestCount)
    }
    @Test fun rejectsAbsoluteUrlsBeforeMakingRequest() = runBlocking {
        for (path in listOf("https://attacker.invalid/", "//attacker.invalid/")) {
            try { api.call(path); fail("Untrusted URL accepted") } catch (_: IllegalArgumentException) { }
        }
        assertEquals(0, server.requestCount)
    }
    @Test fun ignoresInsecureAndDomainCookies() = runBlocking {
        server.enqueue(MockResponse().setBody("{}").addHeader("Set-Cookie", "__Host-sd_refresh=bad; Path=/")
            .addHeader("Set-Cookie", "__Host-sd_refresh=bad2; Domain=localhost; Path=/; Secure"))
        api.call("health", auth = false)
        assertEquals("", store.read().optString("cookie"))
    }
}
