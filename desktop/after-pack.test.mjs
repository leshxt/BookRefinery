import assert from 'node:assert/strict'
import { join } from 'node:path'
import test from 'node:test'
import { resolveElectronExecutablePath } from './after-pack.mjs'

const context = {
  appOutDir: join('tmp', 'unpacked'),
  packager: {
    appInfo: {
      productFilename: 'BookRefinery',
    },
    executableName: 'bookrefinery',
  },
}

test('resolves the electron-builder executable for every packaged platform', () => {
  assert.equal(
    resolveElectronExecutablePath(context, 'win32'),
    join('tmp', 'unpacked', 'BookRefinery.exe'),
  )
  assert.equal(
    resolveElectronExecutablePath(context, 'linux'),
    join('tmp', 'unpacked', 'bookrefinery'),
  )
  assert.equal(
    resolveElectronExecutablePath(context, 'darwin'),
    join('tmp', 'unpacked', 'BookRefinery.app', 'Contents', 'MacOS', 'BookRefinery'),
  )
})

test('rejects a Linux package without a concrete executable name', () => {
  assert.throws(
    () => resolveElectronExecutablePath({
      ...context,
      packager: {
        ...context.packager,
        executableName: '',
      },
    }, 'linux'),
    /Linux executable name/u,
  )
})
