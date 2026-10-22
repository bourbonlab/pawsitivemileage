package app.pawsitivemileage.ui

import java.text.NumberFormat
import java.time.Instant
import java.time.ZoneId
import java.time.format.DateTimeFormatter
import java.util.Locale

/** Display helpers shared by the screens */
object Format {
    private val money = NumberFormat.getCurrencyInstance(Locale.US)
    fun money(value: Double?): String = value?.let(money::format) ?: "—"
    fun gallons(value: Double?): String = value?.let { "%.3f gal".format(Locale.US, it) } ?: "—"
    fun mpg(value: Double?): String = value?.let { "%.1f mpg".format(Locale.US, it) } ?: "—"
    fun miles(value: Double?): String = value?.let { NumberFormat.getIntegerInstance(Locale.US).format(it.toLong()) + " mi" } ?: "—"

    private val stamp = DateTimeFormatter.ofPattern("MMM d, h:mm a", Locale.US)
    fun offline(savedAt: Long, zone: ZoneId = ZoneId.systemDefault()): String =
        "Offline · last updated ${stamp.format(Instant.ofEpochMilli(savedAt).atZone(zone))}"

    /** Parse a number as typed: "41.20", "$41.20", "52,310" */
    fun parse(text: String): Double? = text.trim().replace("$", "").replace(",", "").toDoubleOrNull()
}
