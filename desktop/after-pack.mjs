import { FuseVersion, FuseV1Options, flipFuses } from '@electron/fuses'
import { join } from 'node:path'

export default async function hardenElectronBinary(context) {
  const executableName = context.packager.appInfo.productFilename
  const executablePath = process.platform === 'darwin'
    ? join(context.appOutDir, `${executableName}.app`, 'Contents', 'MacOS', executableName)
    : join(context.appOutDir, `${executableName}${process.platform === 'win32' ? '.exe' : ''}`)

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
