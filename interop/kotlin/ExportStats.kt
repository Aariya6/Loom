fun main() { val xs = generateSequence(::readLine).mapNotNull { it.toDoubleOrNull() }.toList(); val mean = if (xs.isEmpty()) 0.0 else xs.average(); println("${xs.size},$mean") }
