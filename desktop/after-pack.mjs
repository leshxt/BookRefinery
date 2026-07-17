import { FuseVersion, FuseV1Options, flipFuses } from '@electron/fuses'
import { join } from 'node:path'

export function resolveElectronExecutablePath(context, platform = process.platform) {
  const productFilename = context.packager.appInfo.productFilename
  if (platform === 'darwin') {
    return join(context.appOutDir, `${productFilename}.app`, 'Contents', 'MacOS', productFilename)
  }

  if (platform === 'win32') {
    return join(context.appOutDir, `${productFilename}.exe`)
  }

  const linuxExecutableName = context.packager.executableName
  if (typeof linuxExecutableName !== 'string' || linuxExecutableName.length === 0) {
    throw new Error('electron-builder did not expose the Linux executable name')
  }
  return join(context.appOutDir, linuxExecutableName)
}

export default async function hardenElectronBinary(context) {
  const executablePath = resolveElectronExecutablePath(context)

  await flipFuses(executablePath, {
    version: FuseVersion.V1,
    [FuseV1Options.RunAsNode]: false,
    [FuseV1Options.EnableCookieEncryption]: true,
    [FuseV1Options.EnableNodeOptionsEnvironmentVariable]: false,
    [FuseV1Options.EnableNodeCliInspectArguments]: false,
    [FuseV1Options.EnableEmbeddedAsarIntegrityValidation]: true,
    [FuseV1Options.OnlyLoadAppFromAsar]: true,
  })
}
