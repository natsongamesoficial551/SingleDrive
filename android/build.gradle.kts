plugins {
    id("com.android.application") version "8.11.1" apply false
    id("org.jetbrains.kotlin.android") version "2.1.20" apply false
    id("org.jetbrains.kotlin.plugin.compose") version "2.1.20" apply false
}
System.getenv("SINGLEDRIVE_BUILD_ROOT")?.let { output ->
    layout.buildDirectory.set(file("$output/root"))
    subprojects { layout.buildDirectory.set(file("$output/$name")) }
}
