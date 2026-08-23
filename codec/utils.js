/**
 * Carta1 Audio Codec - Utilities
 *
 * This module provides common utility functions for the ATRAC1 codec.
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
 * Compose stateful stage factories once and return the reusable frame path.
 *
 * @param {*} context Shared stage ownership and persistent state.
 * @param {...Function} stages Ordered stage factories.
 * @returns {Function} Reusable composed frame operation.
 */
export function pipe(context, ...stages) {
  const operations = stages.map((stage) => stage(context))
  return (input) =>
    operations.reduce((value, operation) => operation(value), input)
}
