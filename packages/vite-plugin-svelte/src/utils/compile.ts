import { CompileOptions, Processed, ResolvedOptions } from './options'
import { compile, preprocess, walk } from 'svelte/compiler'
// @ts-ignore
import { createMakeHot } from 'svelte-hmr'
import { SvelteRequest } from './id'

const makeHot = createMakeHot({ walk })

export async function compileSvelte(
  svelteRequest: SvelteRequest,
  code: string,
  options: Partial<ResolvedOptions>,
  ssr: boolean | undefined
): Promise<CompileData> {
  const { filename, normalizedFilename, cssId } = svelteRequest
  const { onwarn, emitCss = true } = options
  const dependencies = []
  const finalCompilerOptions: CompileOptions = {
    ...options.compilerOptions,
    filename,
    generate: ssr ? 'ssr' : 'dom'
  }

  let preprocessed
  if (options.preprocess) {
    preprocessed = await preprocess(code, options.preprocess, { filename })
    if (preprocessed.dependencies)
      dependencies.push(...preprocessed.dependencies)
    if (preprocessed.map) finalCompilerOptions.sourcemap = preprocessed.map
  }

  const compiled = compile(
    preprocessed ? preprocessed.code : code,
    finalCompilerOptions
  )

  ;(compiled.warnings || []).forEach((warning) => {
    if (!emitCss && warning.code === 'css-unused-selector') return
    // TODO handle warnings
    if (onwarn) onwarn(warning /*, this.warn*/)
    //else this.warn(warning)
  })
  let svelteCssClass
  if (emitCss && compiled.css.code) {
    // TODO properly update sourcemap?
    compiled.js.code += `\nimport ${JSON.stringify(svelteRequest.cssId)};\n`

    // TODO is there a better way to get this?
    svelteCssClass = compiled.css.code.match(/\.svelte-[^\{]*/)![0].substring(1)
  }

  // only apply hmr when not in ssr context and hot options are set
  if (!ssr && options.hot) {
    compiled.js.code = makeHot({
      id: filename,
      compiledCode: compiled.js.code,
      hotOptions: options.hot,
      compiled,
      originalCode: code,
      compileOptions: finalCompilerOptions
    })
  }

  compiled.js.dependencies = dependencies

  // return everything that was created during preprocess/compile
  const result = {
    filename,
    normalizedFilename,
    cssId,
    code,
    preprocessed,
    compiled,
    compilerOptions: finalCompilerOptions,
    options,
    ssr,
    svelteCssClass
  }
  if (!options.isBuild) {
    // no cache on build
    cacheCompileData(result)
  }
  return result
}

// TODO separate cache for ssr true/false to support hybrid scenarios
const cache = new Map<string, CompileData>()
const prevCache = new Map<string, CompileData | undefined>()

export function getCompileData(
  svelteRequest: SvelteRequest,
  errorOnMissing = true
): CompileData | undefined {
  const id = svelteRequest.normalizedFilename
  if (cache.has(id)) {
    return cache.get(id)!
  }
  if (errorOnMissing) {
    throw new Error(
      `${id} has no corresponding entry in the cache. ` +
        `This is a @svitejs/vite-plugin-svelte internal error, please open an issue.`
    )
  }
}

// TODO do we need this?
export function getPrevCompileData(
  svelteRequest: SvelteRequest
): CompileData | undefined {
  const id = svelteRequest.normalizedFilename
  if (prevCache.has(id)) {
    return prevCache.get(id)
  }
}

function cacheCompileData(compileData: CompileData) {
  const id = compileData.normalizedFilename
  if (cache.has(id)) {
    prevCache.set(id, cache.get(id))
  }
  cache.set(id, compileData)
}

export interface Compiled {
  js: any
  css: any
  ast: any // TODO type
  warnings: any[] // TODO type
  vars: {
    name: string
    export_name: string
    injected: boolean
    module: boolean
    mutated: boolean
    reassigned: boolean
    referenced: boolean
    writable: boolean
    referenced_from_script: boolean
  }[]
  stats: {
    timings: {
      total: number
    }
  }
}

export interface CompileData {
  filename: string
  normalizedFilename: string
  cssId: string
  code: string
  preprocessed?: Processed
  compiled: Compiled
  compilerOptions: CompileOptions
  options: Partial<ResolvedOptions>
  ssr: boolean | undefined
  svelteCssClass?: string
}