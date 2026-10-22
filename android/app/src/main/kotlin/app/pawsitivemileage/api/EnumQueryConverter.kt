package app.pawsitivemileage.api

import kotlinx.serialization.SerialName
import retrofit2.Converter
import retrofit2.Retrofit
import java.lang.reflect.Type

/**
 * Query and path enums go out as their wire value (`@SerialName`, e.g. "desc"), not the Kotlin
 * constant name ("DESC"), which is what Retrofit would send by default and the API rejects.
 */
object EnumQueryConverterFactory : Converter.Factory() {
    override fun stringConverter(type: Type, annotations: Array<out Annotation>, retrofit: Retrofit): Converter<*, String>? {
        val enumClass = (type as? Class<*>)?.takeIf { it.isEnum } ?: return null
        val wire = enumClass.enumConstants.associateWith { constant ->
            val name = (constant as Enum<*>).name
            enumClass.getField(name).getAnnotation(SerialName::class.java)?.value ?: name
        }
        return Converter<Any, String> { wire[it] }
    }
}
