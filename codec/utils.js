/**
 * Carta1 Audio Codec - Utilities
 *
 * This module provides common utility functions for the ATRAC1 codec including
 * pipeline composition, error handling, and audio stream processing utilities
 * for delay compensation and frame padding.
 */

/**
 * Throws an error with the given message
 * @param {string} msg - Error message
 * @throws {Error} Always throws an error with the provided message
 */
export function throwError(msg) {
  throw new Error(msg)
}

/**
 * Creates a pipeline by composing multiple processing stages
 * @param {Object} context - Shared context passed to all stages
 * @param {...Function} stages - Stage functions to compose
 * @returns {Function} Composed pipeline function
 */
export function pipe(context, ...stages) {
  const functions = stages.map((stage) => stage(context))

  return (input) => {
    return functions.reduce((value, fn) => fn(value), input)
  }
}
