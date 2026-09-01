import { fileURLToPath } from 'node:url'
import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { resolveConfig, type ConfigEnv } from 'vite'

const root = fileURLToPath(new URL('../..', import.meta.url))
const configFile = fileURLToPath(new URL('../../vite.config.ts', import.meta.url))
const packageMetadata: unknown = JSON.parse(readFileSync(new URL('../../package.json', import.meta.url), 'utf8'))
if (
  typeof packageMetadata !== 'object' ||
  packageMetadata === null ||
  !('version' in packageMetadata) ||
  typeof packageMetadata.version !== 'string'
) {
  throw new TypeError('Test package metadata is invalid.')
}
const packageVersion = packageMetadata.version

describe('browser runtime configuration', () => {
  it.each(['serve', 'build'] satisfies readonly ConfigEnv['command'][])(
    'removes the Node-only node-html-markdown performance flag during %s',
    async (command) => {
      const config = await resolveConfig({ root, configFile }, command)

      expect(config.define?.['process.env.LOG_PERF']).toBe('false')
      expect(config.define?.['__BOOKREFINERY_VERSION__']).toBe(JSON.stringify(packageVersion))
    },
  )
})
