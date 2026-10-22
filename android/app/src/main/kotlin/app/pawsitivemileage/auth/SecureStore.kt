package app.pawsitivemileage.auth

import android.content.Context
import android.security.keystore.KeyGenParameterSpec
import android.security.keystore.KeyProperties
import android.util.Base64
import androidx.core.content.edit
import java.security.KeyStore
import javax.crypto.Cipher
import javax.crypto.KeyGenerator
import javax.crypto.SecretKey
import javax.crypto.spec.GCMParameterSpec

/**
 * Small encrypted string store for the sign-in state (tokens). AES-GCM with a key that lives
 * in the Android Keystore and never leaves it; the ciphertext is kept in private preferences,
 * which are excluded from backups (res/xml/backup_rules.xml).
 */
class SecureStore(context: Context, name: String = "auth") {
    private val prefs = context.getSharedPreferences(name, Context.MODE_PRIVATE)

    fun get(key: String): String? {
        val stored = prefs.getString(key, null) ?: return null
        return runCatching {
            val bytes = Base64.decode(stored, Base64.NO_WRAP)
            val cipher = Cipher.getInstance(TRANSFORMATION)
            cipher.init(Cipher.DECRYPT_MODE, secretKey(), GCMParameterSpec(128, bytes, 0, IV_SIZE))
            String(cipher.doFinal(bytes, IV_SIZE, bytes.size - IV_SIZE), Charsets.UTF_8)
        }.getOrNull() // a key lost with a reinstall or OS reset means "signed out"
    }

    fun put(key: String, value: String) {
        val cipher = Cipher.getInstance(TRANSFORMATION)
        cipher.init(Cipher.ENCRYPT_MODE, secretKey())
        val bytes = cipher.iv + cipher.doFinal(value.toByteArray(Charsets.UTF_8))
        prefs.edit { putString(key, Base64.encodeToString(bytes, Base64.NO_WRAP)) }
    }

    fun remove(key: String) {
        prefs.edit { remove(key) }
    }

    private fun secretKey(): SecretKey {
        val keyStore = KeyStore.getInstance(KEYSTORE).apply { load(null) }
        (keyStore.getKey(ALIAS, null) as? SecretKey)?.let { return it }
        val generator = KeyGenerator.getInstance(KeyProperties.KEY_ALGORITHM_AES, KEYSTORE)
        generator.init(
            KeyGenParameterSpec.Builder(ALIAS, KeyProperties.PURPOSE_ENCRYPT or KeyProperties.PURPOSE_DECRYPT)
                .setBlockModes(KeyProperties.BLOCK_MODE_GCM)
                .setEncryptionPaddings(KeyProperties.ENCRYPTION_PADDING_NONE)
                .setKeySize(256)
                .build(),
        )
        return generator.generateKey()
    }

    private companion object {
        const val KEYSTORE = "AndroidKeyStore"
        const val ALIAS = "pawsitivemileage-auth"
        const val TRANSFORMATION = "AES/GCM/NoPadding"
        const val IV_SIZE = 12
    }
}
