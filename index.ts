import type { OutputOptions, OutputBundle, OutputChunk } from 'rollup'
import { parse } from 'acorn'
import { generate } from 'escodegen'
import { minify_sync } from 'terser'
import MagicString from 'magic-string'
import path from 'node:path'
import fs from 'fs-extra'
import { execSync } from 'node:child_process'

export default function rollupImportWithVersion() {
  return {
    name: 'import-with-version',
    async generateBundle(options: OutputOptions, bundle: OutputBundle) {
      const externals = Object.keys(options?.globals || {})

      if (!externals.length) return

      const pkgFilePath = path.join(process.cwd(), `package.json`)

      if (!fs.existsSync(pkgFilePath)) {
        throw new Error(`The package.json file is specified that (${pkgFilePath}) does not exist.`)
      }

      const pkg = await fs.readJSON(pkgFilePath)

      const deps = Object.assign(
        {},
        pkg.dependencies,
        pkg.devDependencies,
        pkg.optionalDependencies,
        pkg.peerDependencies,
      )

      const cup = externals.reduce(
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

            if (latest) pkgVersion.set(dep, latest)
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
          }
        })

        data.code = magicString.toString()
      })

      console.log('dir', options)
    },
  }
}
