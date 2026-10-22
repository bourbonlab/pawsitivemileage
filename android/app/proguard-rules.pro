# R8 rules for the release build. Library rules (Retrofit, OkHttp, kotlinx.serialization, AppAuth,
# Room, WorkManager) ship with the libraries; these cover what the app does reflectively.

# Retrofit implements the generated API interfaces with a runtime Proxy. R8 sees no implementation
# and rewrites them, which fails as a ClassCastException in Retrofit.create(). Keep them intact.
-keep interface app.pawsitivemileage.api.generated.apis.** { *; }

# Retrofit reads generic return types (Response<T>) and suspend continuations from signatures
-keepattributes Signature, InnerClasses, EnclosingMethod, RuntimeVisibleAnnotations, RuntimeVisibleParameterAnnotations, AnnotationDefault
-keep,allowobfuscation,allowshrinking class kotlin.coroutines.Continuation
-keep,allowobfuscation,allowshrinking class retrofit2.Response

# EnumQueryConverterFactory sends each enum constant's @SerialName value, read by reflection
-keepclassmembers enum app.pawsitivemileage.api.generated.** { <fields>; }

# The generated models appear to Retrofit only as type arguments (Response<GetProfileResponse>).
# If R8 removes or merges them, the signature degrades to Object and Retrofit can't find a
# converter ("Unable to create converter for class java.lang.Object"). They're small; keep them.
-keep class app.pawsitivemileage.api.generated.models.** { *; }
