package app.singledrive.android

import android.content.Context
import android.security.keystore.KeyGenParameterSpec
import android.security.keystore.KeyProperties
import android.util.Base64
import java.security.KeyStore
import javax.crypto.Cipher
import javax.crypto.KeyGenerator
import javax.crypto.SecretKey
import javax.crypto.spec.GCMParameterSpec
import org.json.JSONObject

/** The AES key is non-exportable. Neither cookies nor OAuth verifiers are stored in plaintext. */
interface SessionStore {
    fun read(): JSONObject
    fun update(change: (JSONObject) -> Unit)
    fun clear()
}
class SecureStore(context: Context) : SessionStore {
    private val prefs = context.getSharedPreferences("secure_session", Context.MODE_PRIVATE)
    private val alias = "singledrive.session.v1"
    private fun key(): SecretKey {
        val keys = KeyStore.getInstance("AndroidKeyStore").apply { load(null) }
        (keys.getKey(alias, null) as? SecretKey)?.let { return it }
        return KeyGenerator.getInstance(KeyProperties.KEY_ALGORITHM_AES, "AndroidKeyStore").run {
            init(KeyGenParameterSpec.Builder(alias, KeyProperties.PURPOSE_ENCRYPT or KeyProperties.PURPOSE_DECRYPT)
                .setBlockModes(KeyProperties.BLOCK_MODE_GCM).setEncryptionPaddings(KeyProperties.ENCRYPTION_PADDING_NONE).build())
            generateKey()
        }
    }
    @Synchronized override fun read(): JSONObject {
        val raw = prefs.getString("payload", null) ?: return JSONObject()
        return try {
            val cipher = Cipher.getInstance("AES/GCM/NoPadding")
            val bytes = Base64.decode(raw, Base64.NO_WRAP)
            cipher.init(Cipher.DECRYPT_MODE, key(), GCMParameterSpec(128, bytes.copyOfRange(0, 12)))
            JSONObject(String(cipher.doFinal(bytes.copyOfRange(12, bytes.size)), Charsets.UTF_8))
        } catch (_: Exception) { prefs.edit().clear().commit(); JSONObject() }
    }
    @Synchronized override fun update(change: (JSONObject) -> Unit) {
        val value = read().apply(change)
        val cipher = Cipher.getInstance("AES/GCM/NoPadding")
        cipher.init(Cipher.ENCRYPT_MODE, key())
        val bytes = cipher.iv + cipher.doFinal(value.toString().toByteArray(Charsets.UTF_8))
        check(prefs.edit().putString("payload", Base64.encodeToString(bytes, Base64.NO_WRAP)).commit()) {
            "Não foi possível salvar a sessão com segurança."
        }
    }
    @Synchronized override fun clear() { prefs.edit().clear().commit() }
}
