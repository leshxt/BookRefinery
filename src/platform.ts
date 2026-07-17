export function isNativeDesktopRuntime(runtime: object = globalThis): boolean {
  return '__TAURI_INTERNALS__' in runtime
}
