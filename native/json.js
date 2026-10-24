/** Porffor alpha 19's JSON string writer truncates UTF-16 to bytes. Escape
 * non-ASCII code units here so native JSON preserves AEA titles and paths. */
export function stringifyInspection(value, depth = 0) {
  if (typeof value === 'string') {
    let quoted = '"'
    for (let index = 0; index < value.length; index++) {
      const code = value.charCodeAt(index)
      if (code === 34 || code === 92) quoted += '\\' + value[index]
      else if (code < 32 || code >= 127)
        quoted += '\\u' + code.toString(16).padStart(4, '0')
      else quoted += value[index]
    }
    return quoted + '"'
  }
  if (value === null || typeof value !== 'object') return JSON.stringify(value)
  const array = Array.isArray(value)
  const keys = Object.keys(value)
  const open = array ? '[' : '{'
  const close = array ? ']' : '}'
  if (keys.length === 0) return open + close
  const indent = '  '.repeat(depth + 1)
  const entries = keys.map(
    (key) =>
      indent +
      (array ? '' : stringifyInspection(key) + ': ') +
      stringifyInspection(value[key], depth + 1)
  )
  return open + '\n' + entries.join(',\n') + '\n' + '  '.repeat(depth) + close
}
