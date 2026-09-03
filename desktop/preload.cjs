const { contextBridge, ipcRenderer, webUtils } = require('electron')

const MAX_SAVE_BYTES = (4 * 1024 * 1024 * 1024) - (1024 * 1024)

contextBridge.exposeInMainWorld('bookRefineryDesktop', {
  resolveSelectedFileName: (file) => {
    let sourcePath
    try {
      sourcePath = webUtils.getPathForFile(file)
    } catch {
      return Promise.resolve(null)
    }
    if (typeof sourcePath !== 'string' || sourcePath.length === 0) return Promise.resolve(null)
    return ipcRenderer.invoke('bookrefinery:resolve-selected-file-name', sourcePath)
  },
  saveFile: (request) => {
    if (
      typeof request !== 'object' ||
      request === null ||
      typeof request.suggestedName !== 'string' ||
      request.mimeType !== 'application/zip' ||
      !(request.data instanceof ArrayBuffer) ||
      request.data.byteLength < 1 ||
      request.data.byteLength > MAX_SAVE_BYTES
    ) {
      return Promise.reject(new TypeError('Invalid BookRefinery save request.'))
    }
    return ipcRenderer.invoke('bookrefinery:save-file', {
      suggestedName: request.suggestedName,
      mimeType: request.mimeType,
      data: request.data,
    })
  },
})
