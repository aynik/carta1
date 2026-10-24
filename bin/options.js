export function validateModes(modes) {
  if (!modes) {
    return { valid: true }
  }

  const parts = modes.split(',')
  if (parts.length !== 3) {
    return {
      valid: false,
      error: `Modes must have exactly 3 values separated by commas, got ${parts.length}`,
    }
  }

  const parsedModes = []
  const validValues = [
    [0, 2], // Position 1: 0 or 2
    [0, 2], // Position 2: 0 or 2
    [0, 3], // Position 3: 0 or 3
  ]

  for (let i = 0; i < 3; i++) {
    const mode = parseInt(parts[i], 10)
    if (isNaN(mode)) {
      return {
        valid: false,
        error: `Mode at position ${i + 1} is not a number: "${parts[i]}"`,
      }
    }

    if (!validValues[i].includes(mode)) {
      return {
        valid: false,
        error: `Mode at position ${i + 1} must be ${validValues[i].join(' or ')}, got ${mode}`,
      }
    }

    parsedModes.push(mode)
  }

  return { valid: true, modes: parsedModes }
}
