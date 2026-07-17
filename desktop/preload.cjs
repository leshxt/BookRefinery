const { contextBridge, ipcRenderer } = require('electron')

const MAX_SAVE_BYTES = 300 * 1024 * 1024

contextBridge.exposeInMainWorld('bookRefineryDesktop', {
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
