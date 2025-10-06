import type { OutputPlugin } from 'rollup'

export interface TPluginOptions {
  schema: object
  external: string[]
}

export default function rollupImportWithVersion(pluginOptions: TPluginOptions): OutputPlugin
