import { contextBridge, ipcRenderer, webUtils } from 'electron'
import { createBridge } from '../shared/bridge'

const bridge = createBridge({
  invoke: (channel, payload) => ipcRenderer.invoke(channel, payload),
  on: (channel, listener) => {
    const wrapped = (_event: unknown, payload: unknown) => {
      listener(payload)
    }
    ipcRenderer.on(channel, wrapped)
    return () => {
      ipcRenderer.removeListener(channel, wrapped)
    }
  },
  pathForFile: (file) => webUtils.getPathForFile(file as File),
})

contextBridge.exposeInMainWorld('popcorn', bridge)
