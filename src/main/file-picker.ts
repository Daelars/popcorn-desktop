import { Context, Effect, Layer } from 'effect'
import { dialog, shell } from 'electron'

/** Native file pickers and shell actions; faked in tests so the flows run headless. */
export interface FilePickerShape {
  /** Returns the chosen `.torrent` file, or undefined when the user cancels. */
  readonly pickTorrent: () => Effect.Effect<string | undefined>
  readonly openDirectory: (path: string) => Effect.Effect<void>
}

export class FilePickerService extends Context.Tag('FilePickerService')<
  FilePickerService,
  FilePickerShape
>() {}

export const FilePickerServiceLive = Layer.succeed(FilePickerService, {
  pickTorrent: () =>
    Effect.tryPromise(async () => {
      const result = await dialog.showOpenDialog({
        properties: ['openFile'],
        filters: [{ name: 'Torrent', extensions: ['torrent'] }],
      })
      return result.canceled ? undefined : result.filePaths[0]
    }).pipe(Effect.orElseSucceed(() => undefined)),
  openDirectory: (path) =>
    Effect.tryPromise(() => shell.openPath(path)).pipe(
      Effect.asVoid,
      Effect.orElseSucceed(() => undefined),
    ),
})
