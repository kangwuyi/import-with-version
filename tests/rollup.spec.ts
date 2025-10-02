import rollupImportWithVersion from '../index'
import { type OutputOptions } from 'rollup'

test('rollupImportWithVersion', async () => {
  const sourceCode = `
import { computed, reactive, ref } from 'vue'
import * as Vuex from 'vuex'
import VueRouter from 'vue-router'
import { ElInput } from 'element-plus'
`

  const targetCode = `
import { computed, reactive, ref } from "vue@3.5.22";
import * as Vuex from 'vuex'
import VueRouter from 'vue-router'
import { ElInput } from 'element-plus'
`
  const bundleOptions = {
    test: { code: sourceCode },
  }

  const outputOptions = {
    globals: {
      vue: 'Vue',
      'element-plus': 'ElementPlus',
      vuex: 'Vuex',
      'vue-router': 'VueRouter',
      rollup: 'rollup',
    },
  }

  await rollupImportWithVersion().generateBundle(
    outputOptions as OutputOptions,
    bundleOptions as any,
  )
  expect(bundleOptions.test.code).toBe(targetCode)
})
