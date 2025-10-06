import type { OutputPlugin } from 'rollup'

export interface TPluginOptions {
  schema?: object
}

export default function rollupImportWithVersion(pluginOptions: TPluginOptions): OutputPlugin
