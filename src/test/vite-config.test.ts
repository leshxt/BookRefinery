import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'
import { resolveConfig, type ConfigEnv } from 'vite'

const root = fileURLToPath(new URL('../..', import.meta.url))
const configFile = fileURLToPath(new URL('../../vite.config.ts', import.meta.url))

describe('browser runtime configuration', () => {
  it.each(['serve', 'build'] satisfies readonly ConfigEnv['command'][])(
    'removes the Node-only node-html-markdown performance flag during %s',
    async (command) => {
      const config = await resolveConfig({ root, configFile }, command)

      expect(config.define?.['process.env.LOG_PERF']).toBe('false')
    },
  )
})
