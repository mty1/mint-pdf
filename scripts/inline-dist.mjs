import { readFile, writeFile } from 'node:fs/promises'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const distDir = resolve(root, 'dist')
const indexPath = resolve(distDir, 'index.html')

function toDistPath(assetPath) {
  return resolve(distDir, assetPath.replace(/^\.\//, '').replace(/^\//, ''))
}

function escapeInlineScript(source) {
  return source.replaceAll('</script', '<\\/script')
}

let html = await readFile(indexPath, 'utf8')

html = await replaceAsync(
  html,
  /<link\s+rel="stylesheet"[^>]*href="([^"]+)"[^>]*>/g,
  async (_tag, href) => {
    const css = await readFile(toDistPath(href), 'utf8')
    return `<style>\n${css}\n</style>`
  },
)

html = await replaceAsync(
  html,
  /<script\s+type="module"[^>]*src="([^"]+)"[^>]*><\/script>/g,
  async (_tag, src) => {
    const js = await readFile(toDistPath(src), 'utf8')
    return `<script type="module">\n${escapeInlineScript(js)}\n</script>`
  },
)

await writeFile(indexPath, html, 'utf8')

async function replaceAsync(value, pattern, replacer) {
  const parts = []
  let lastIndex = 0

  for (const match of value.matchAll(pattern)) {
    parts.push(value.slice(lastIndex, match.index))
    parts.push(await replacer(...match))
    lastIndex = match.index + match[0].length
  }

  parts.push(value.slice(lastIndex))
  return parts.join('')
}
