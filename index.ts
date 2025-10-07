import type {
  OutputOptions,
  OutputBundle,
  OutputChunk,
  Plugin,
  NormalizedOutputOptions,
  PluginContext,
  InputPluginOption,
} from 'rollup'
import { parse } from 'acorn'
import { generate } from 'escodegen'
import { minify_sync } from 'terser'
import MagicString from 'magic-string'
import path from 'node:path'
import fs from 'fs-extra'
import { execSync } from 'node:child_process'
import { type TPluginOptions } from './index.d'

export default function rollupImportWithVersion(pluginOptions: TPluginOptions) {
  const externals = new Set<string>()
  const realPkgVersion = new Map()

  return {
    name: 'import-with-version',
    options: (opts) => {
      let external = opts.external || []

      // 过滤
      if (typeof external === 'function') {
        // const old = external
        // external = (source, importer, isResolved) => {
        //   // todo
        //   return old(source, importer, isResolved)
        // }
      } else {
        if (!Array.isArray(external)) {
          external = [external]
        }
        ;(external.filter((_) => !(_ instanceof RegExp)) as string[]).map((_) => externals.add(_))
      }

      return opts
    },
    async generateBundle(context: NormalizedOutputOptions, bundle: OutputBundle) {
      const pkgFilePath = path.join(process.cwd(), `package.json`)

      if (!fs.existsSync(pkgFilePath)) {
        throw new Error(`The package.json file is specified that (${pkgFilePath}) does not exist.`)
      }

      // extra schema file
      if (pluginOptions?.schema && context?.dir) {
        await fs.writeJSONSync(path.join(context.dir, 'schema.json'), pluginOptions.schema)
      }

      if (!externals.size) return

      const pkg = await fs.readJSON(pkgFilePath)

      const deps = Object.assign(
        {},
        pkg.dependencies,
        pkg.devDependencies,
        pkg.optionalDependencies,
        pkg.peerDependencies,
      )

      const cup = Array.from(externals).reduce(
        (o, k) => (deps[k] ? Object.assign(o, { [k]: deps[k] }) : o),
        {} as Record<string, string>,
      )

      const pkgVersion = new Map()

      await Promise.all(
        Object.keys(cup).map(async (dep) => {
          try {
            let latest = null
            // npm view <package-name>@'<version-range>' version --json
            const temp = await execSync(`npm view ${dep}@${cup[dep]} version --json`, {
              encoding: 'utf-8',
            })
            const versions = JSON.parse(temp.toString())

            if (typeof versions === 'string') latest = versions
            else latest = versions.pop()

            // format eq: "vue": "3.5.22",
            if (latest) pkgVersion.set(dep, latest)
            // ------ extra dep importmap
            const depMatcher = new RegExp(`^@athenaapp(?:/.+)?$`)
            if (!depMatcher.test(dep)) return

            const depPkgFilePath = path.join(process.cwd(), 'node_modules', dep, 'package.json')
            if (!fs.existsSync(depPkgFilePath)) return

            const depPkg = await fs.readJSON(depPkgFilePath)
            if (!depPkg?.componentConfig?.importmap) return

            const importmapPath = path.join(
              process.cwd(),
              'node_modules',
              dep,
              depPkg.componentConfig.importmap,
            )

            if (!fs.existsSync(importmapPath)) return

            const depImportmap = await fs.readJSON(importmapPath)

            Object.entries(depImportmap).map((_) => {
              // format eq: "vue@3.5.22": "https://esm.sh/vue@3.5.22",
              realPkgVersion.set(_[0], _[1])
            })
          } catch (err) {
            console.log(err)
          }
        }),
      )

      Object.values(bundle).forEach((data: OutputChunk) => {
        const { code } = data
        if (typeof code !== 'string') return

        const ast = parse(code, {
          ecmaVersion: 'latest',
          sourceType: 'module',
        })

        const magicString = new MagicString(code)

        // 遍历 AST，查找 ImportDeclaration 节点
        ast.body.forEach((node) => {
          if (node.type === 'ImportDeclaration') {
            const { source, start, end } = node
            let { value } = source

            if (!pkgVersion.has(value)) return

            // 找到需要外部化的依赖，将其替换
            const replaceValue = `${value}@${pkgVersion.get(value)}`

            source.value = replaceValue
            source.raw = `'${replaceValue}'`

            const format = minify_sync(generate(node), {
              format: {
                beautify: true,
              },
            })

            if (!format?.code) return

            magicString.overwrite(start, end, format.code)

            realPkgVersion.set(replaceValue, `https://esm.sh/${replaceValue}`)
          }
        })

        data.code = magicString.toString()
      })

      // 重复写入，后续需要做判断，值写入一次，变化之后则再次写入（cjs 也可存在 import）
      if (context?.dir && realPkgVersion.size) {
        await fs.writeJSONSync(
          path.join(context.dir, 'importmap.json'),
          Object.fromEntries(realPkgVersion),
        )
      }
    },
  } satisfies Plugin
}
