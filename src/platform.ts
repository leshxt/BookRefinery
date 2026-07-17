export function isNativeDesktopRuntime(runtime: object = globalThis): boolean {
  return 'bookRefineryDesktop' in runtime
}
