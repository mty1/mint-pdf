<script setup lang="ts">
import { computed, ref } from 'vue'
import { PDFDocument } from 'pdf-lib'
import * as pdfRendererLib from 'pdfjs-dist'
import pdfWorkerSource from 'pdfjs-dist/build/pdf.worker.mjs?raw'
import JSZip from 'jszip'
import mintLogo from './assets/mint-logo.png'

type Tool = {
  id: string
  name: string
  label: string
  short: string
  limit: string
  action: string
}

type SelectedFile = {
  id: string
  file: File
  previewUrl?: string
  rotation: number
}

type MergePageItem = {
  id: string
  fileId: string
  fileName: string
  pageIndex: number
  pageNumber: number
  previewUrl?: string
}

type SplitPageItem = {
  id: string
  fileId: string
  pageIndex: number
  pageNumber: number
  previewUrl?: string
  selected: boolean
}

type SplitRule = {
  id: string
  fileName: string
  pageIndices: number[]
  pageNumbers: number[]
}

type SignPageItem = {
  id: string
  pageIndex: number
  pageNumber: number
  previewUrl?: string
}

type SignPlacement = {
  id: string
  pageIndex: number
  pageNumber: number
  xPct: number
  yPct: number
  widthPct: number
}

type SignDragState = {
  id: string
  pageIndex: number
}

const tools: Tool[] = [
  {
    id: 'image',
    name: '图片转 PDF',
    label: '证件材料',
    short: 'JPG、PNG 排序后生成清晰 PDF。',
    limit: '适合报销、作业、证件',
    action: '生成 PDF',
  },
  {
    id: 'pdf-image',
    name: 'PDF 转图片',
    label: '导出图片',
    short: '把 PDF 每页导出为 JPG 或 PNG。',
    limit: '支持 JPG / PNG 打包下载',
    action: '导出图片',
  },
  {
    id: 'compress',
    name: '压缩 PDF',
    label: '最常用',
    short: '把报名表、合同、材料压到可上传大小。',
    limit: '支持 20MB 免费处理',
    action: '开始压缩',
  },
  {
    id: 'merge',
    name: '合并 PDF',
    label: '整理材料',
    short: '拖动排序，多份文件合成一个完整 PDF。',
    limit: '最多 6 个文件',
    action: '合并文件',
  },
  {
    id: 'split',
    name: '拆分 PDF',
    label: '提取页面',
    short: '看见每一页，勾选需要的页面导出。',
    limit: '示例：1-3, 8, 10-12',
    action: '导出选中页面',
  },
]

const selectedToolId = ref(tools[0].id)
const selectedMode = ref('balanced')
const selectedFiles = ref<SelectedFile[]>([])
const isProcessing = ref(false)
const statusMessage = ref('')
const draggingFileId = ref('')
const draggingMergePageId = ref('')
const mergeMode = ref<'file' | 'page'>('file')
const mergePageItems = ref<MergePageItem[]>([])
const splitPageItems = ref<SplitPageItem[]>([])
const splitRules = ref<SplitRule[]>([])
const splitPageCount = ref<number | null>(null)
const signPageItems = ref<SignPageItem[]>([])
const signPlacements = ref<SignPlacement[]>([])
const signImageFile = ref<File | null>(null)
const signImagePreviewUrl = ref('')
const signImageAspectRatio = ref(2)
const signStampWidth = ref(28)
const signDragState = ref<SignDragState | null>(null)
const outputFileName = ref('')
const uploadPanel = ref<HTMLElement | null>(null)
const parsingMergeFileIds = new Set<string>()
let mergePageParseRevision = 0
let splitInspectRevision = 0
let signInspectRevision = 0
const selectedTool = computed(
  () => tools.find((tool) => tool.id === selectedToolId.value) ?? tools[0],
)
const isPdfFileTool = computed(() => ['pdf-image', 'compress', 'merge', 'split', 'sign'].includes(selectedToolId.value))
const allowsMultipleFiles = computed(() => selectedToolId.value === 'image' || ['pdf-image', 'compress', 'merge'].includes(selectedToolId.value))
const addPdfButtonText = computed(() => (['split', 'sign'].includes(selectedToolId.value) ? '更换 PDF' : '继续添加 PDF'))
const supportsCustomOutputName = computed(() => ['image', 'merge', 'compress'].includes(selectedToolId.value))
const splitSelectedCount = computed(() => splitPageItems.value.filter((page) => page.selected).length)
const splitPrimaryAction = computed(() => (
  splitRules.value.length ? `按规则导出 ${splitRules.value.length} 份` : '导出选中页面'
))
const splitPanelSummary = computed(() => {
  if (!splitPageCount.value) {
    return '生成预览中'
  }

  if (splitRules.value.length) {
    return `已暂存 ${splitRules.value.length} 份 · 当前选 ${splitSelectedCount.value} 页`
  }

  return `已选 ${splitSelectedCount.value}/${splitPageCount.value} 页`
})
const primaryActionText = computed(() => (
  selectedToolId.value === 'split' ? splitPrimaryAction.value : selectedTool.value.action
))
const hasModeSwitch = computed(() => !['split', 'sign'].includes(selectedToolId.value))
const operationModeNote = computed(() => (
  selectedToolId.value === 'sign' ? '叠加签章，不改变原页面内容' : '按选中页面导出，不改变原文件'
))
const isPrimaryActionDisabled = computed(() => (
  isProcessing.value ||
  (selectedToolId.value === 'split' && splitSelectedCount.value === 0 && splitRules.value.length === 0) ||
  (selectedToolId.value === 'sign' && signPlacements.value.length === 0)
))
const fileInputAccept = computed(() => {
  if (selectedToolId.value === 'image') {
    return 'image/png,image/jpeg'
  }

  return 'application/pdf'
})
const outputNameHint = computed(() => {
  if (selectedToolId.value === 'image') {
    return '例如：报名材料'
  }

  if (selectedToolId.value === 'merge') {
    return '例如：合同合集'
  }

  return selectedFiles.value.length > 1 ? '例如：压缩结果' : '例如：压缩后的合同'
})

function selectTool(toolId: string, shouldFocusUpload = false) {
  const isChangingTool = selectedToolId.value !== toolId
  selectedToolId.value = toolId

  if (isChangingTool) {
    clearSelectedFiles()
    statusMessage.value = ''
  }

  if (shouldFocusUpload) {
    requestAnimationFrame(() => {
      uploadPanel.value?.scrollIntoView({ behavior: 'smooth', block: 'center' })
    })
  }
}

function clearSelectedFiles() {
  mergePageParseRevision += 1
  splitInspectRevision += 1
  signInspectRevision += 1
  parsingMergeFileIds.clear()

  for (const item of selectedFiles.value) {
    if (item.previewUrl) {
      URL.revokeObjectURL(item.previewUrl)
    }
  }
  for (const item of mergePageItems.value) {
    if (item.previewUrl) {
      URL.revokeObjectURL(item.previewUrl)
    }
  }
  for (const item of splitPageItems.value) {
    if (item.previewUrl) {
      URL.revokeObjectURL(item.previewUrl)
    }
  }
  for (const item of signPageItems.value) {
    if (item.previewUrl) {
      URL.revokeObjectURL(item.previewUrl)
    }
  }
  if (signImagePreviewUrl.value) {
    URL.revokeObjectURL(signImagePreviewUrl.value)
  }
  selectedFiles.value = []
  mergePageItems.value = []
  splitPageItems.value = []
  splitRules.value = []
  splitPageCount.value = null
  signPageItems.value = []
  signPlacements.value = []
  signImageFile.value = null
  signImagePreviewUrl.value = ''
  signImageAspectRatio.value = 2
  signStampWidth.value = 28
  signDragState.value = null
  outputFileName.value = ''
  draggingMergePageId.value = ''
}

const modes = [
  { id: 'balanced', name: '平衡' },
  { id: 'clear', name: '清晰' },
  { id: 'small', name: '最小' },
]

const mergeModes = [
  { id: 'file', name: '按文件' },
  { id: 'page', name: '按页面' },
] as const

const imageModeSettings = {
  clear: { maxSide: 3200, quality: 0.92 },
  balanced: { maxSide: 2000, quality: 0.82 },
  small: { maxSide: 1200, quality: 0.68 },
}

const pdfImageModeSettings = {
  clear: { scale: 3, quality: 0.95 },
  balanced: { scale: 2, quality: 0.85 },
  small: { scale: 1.25, quality: 0.72 },
}

const compressModeSettings = {
  clear: { scale: 1.8, quality: 0.82 },
  balanced: { scale: 1.35, quality: 0.68 },
  small: { scale: 0.95, quality: 0.52 },
}

function isSupportedImage(file: File) {
  return file.type === 'image/png' || file.type === 'image/jpeg' || /\.(png|jpe?g)$/i.test(file.name)
}

function isSupportedPdf(file: File) {
  return file.type === 'application/pdf' || /\.pdf$/i.test(file.name)
}

function getFileKey(file: File) {
  return `${file.name}-${file.size}-${file.lastModified}`
}

function clearSplitPages() {
  for (const item of splitPageItems.value) {
    if (item.previewUrl) {
      URL.revokeObjectURL(item.previewUrl)
    }
  }
  splitPageItems.value = []
  splitRules.value = []
  splitPageCount.value = null
}

function clearSignPages() {
  for (const item of signPageItems.value) {
    if (item.previewUrl) {
      URL.revokeObjectURL(item.previewUrl)
    }
  }
  signPageItems.value = []
  signPlacements.value = []
  signDragState.value = null
}

function clearSignImage() {
  if (signImagePreviewUrl.value) {
    URL.revokeObjectURL(signImagePreviewUrl.value)
  }
  signImageFile.value = null
  signImagePreviewUrl.value = ''
  signImageAspectRatio.value = 2
  signPlacements.value = []
}

async function renderSplitPdfPages(item: SelectedFile) {
  const inspectRevision = ++splitInspectRevision
  clearSplitPages()
  statusMessage.value = '正在生成页面预览...'

  try {
    const pdfjsLib = await loadPdfRenderer()
    const pdf = await pdfjsLib.getDocument({ data: await item.file.arrayBuffer() }).promise
    const pages: SplitPageItem[] = []

    for (let pageNumber = 1; pageNumber <= pdf.numPages; pageNumber += 1) {
      statusMessage.value = `正在生成第 ${pageNumber}/${pdf.numPages} 页预览...`
      const page = await pdf.getPage(pageNumber)
      const viewport = page.getViewport({ scale: 0.34 })
      const canvas = document.createElement('canvas')
      const context = canvas.getContext('2d')

      if (!context) {
        throw new Error('Canvas is not available')
      }

      canvas.width = Math.ceil(viewport.width)
      canvas.height = Math.ceil(viewport.height)
      context.fillStyle = '#ffffff'
      context.fillRect(0, 0, canvas.width, canvas.height)
      await page.render({ canvas, canvasContext: context, viewport }).promise
      const blob = await canvasToBlob(canvas, 'image/jpeg', 0.78)

      pages.push({
        id: `${item.id}-split-page-${pageNumber}-${crypto.randomUUID()}`,
        fileId: item.id,
        pageIndex: pageNumber - 1,
        pageNumber,
        previewUrl: URL.createObjectURL(blob),
        selected: false,
      })
    }

    await pdf.destroy()

    if (
      inspectRevision !== splitInspectRevision ||
      selectedToolId.value !== 'split' ||
      selectedFiles.value[0]?.id !== item.id
    ) {
      for (const page of pages) {
        if (page.previewUrl) {
          URL.revokeObjectURL(page.previewUrl)
        }
      }
      return
    }

    splitPageItems.value = pages
    splitPageCount.value = pages.length
    statusMessage.value = `已生成 ${pages.length} 页预览，点击页面选择后可暂存`
  } catch (error) {
    console.error(error)
    statusMessage.value = '无法生成页面预览，请确认 PDF 未加密或未损坏'
  }
}

async function renderSignPdfPages(item: SelectedFile) {
  const inspectRevision = ++signInspectRevision
  clearSignPages()
  statusMessage.value = '正在生成签章页面预览...'

  try {
    const pdfjsLib = await loadPdfRenderer()
    const pdf = await pdfjsLib.getDocument({ data: await item.file.arrayBuffer() }).promise
    const pages: SignPageItem[] = []

    for (let pageNumber = 1; pageNumber <= pdf.numPages; pageNumber += 1) {
      statusMessage.value = `正在生成第 ${pageNumber}/${pdf.numPages} 页预览...`
      const page = await pdf.getPage(pageNumber)
      const viewport = page.getViewport({ scale: 0.42 })
      const canvas = document.createElement('canvas')
      const context = canvas.getContext('2d')

      if (!context) {
        throw new Error('Canvas is not available')
      }

      canvas.width = Math.ceil(viewport.width)
      canvas.height = Math.ceil(viewport.height)
      context.fillStyle = '#ffffff'
      context.fillRect(0, 0, canvas.width, canvas.height)
      await page.render({ canvas, canvasContext: context, viewport }).promise
      const blob = await canvasToBlob(canvas, 'image/jpeg', 0.78)

      pages.push({
        id: `${item.id}-sign-page-${pageNumber}-${crypto.randomUUID()}`,
        pageIndex: pageNumber - 1,
        pageNumber,
        previewUrl: URL.createObjectURL(blob),
      })
    }

    await pdf.destroy()

    if (
      inspectRevision !== signInspectRevision ||
      selectedToolId.value !== 'sign' ||
      selectedFiles.value[0]?.id !== item.id
    ) {
      for (const page of pages) {
        if (page.previewUrl) {
          URL.revokeObjectURL(page.previewUrl)
        }
      }
      return
    }

    signPageItems.value = pages
    statusMessage.value = `已生成 ${pages.length} 页预览`
  } catch (error) {
    console.error(error)
    statusMessage.value = '无法生成签章预览，请确认 PDF 未加密或未损坏'
  }
}

async function setSelectedFiles(files: File[]) {
  statusMessage.value = ''

  if (selectedToolId.value === 'image') {
    const images = files.filter(isSupportedImage)
    const nextItems = images.map((file) => ({
      id: `${file.name}-${file.size}-${file.lastModified}-${crypto.randomUUID()}`,
      file,
      previewUrl: URL.createObjectURL(file),
      rotation: 0,
    }))
    selectedFiles.value = [...selectedFiles.value, ...nextItems]

    if (files.length > images.length) {
      statusMessage.value = '已忽略非 JPG/PNG 图片文件'
    }
    return
  }

  if (isPdfFileTool.value) {
    const pdfFiles = files.filter(isSupportedPdf)

    if (selectedToolId.value === 'split') {
      if (pdfFiles.length === 0) {
        statusMessage.value = '请上传 PDF 文件'
        return
      }

      const file = pdfFiles[0]
      clearSplitPages()
      const nextItem: SelectedFile = {
        id: `${getFileKey(file)}-${crypto.randomUUID()}`,
        file,
        rotation: 0,
      }
      const ignoredCount = files.length - 1
      selectedFiles.value = [nextItem]
      await renderSplitPdfPages(nextItem)

      if (ignoredCount > 0 && statusMessage.value.startsWith('已生成')) {
        statusMessage.value = `${statusMessage.value}，已忽略其他文件`
      }

      return
    }

    if (selectedToolId.value === 'sign') {
      if (pdfFiles.length === 0) {
        statusMessage.value = '请上传 PDF 文件'
        return
      }

      const file = pdfFiles[0]
      clearSignPages()
      const nextItem: SelectedFile = {
        id: `${getFileKey(file)}-${crypto.randomUUID()}`,
        file,
        rotation: 0,
      }
      const ignoredCount = files.length - 1
      selectedFiles.value = [nextItem]
      await renderSignPdfPages(nextItem)

      if (ignoredCount > 0 && statusMessage.value.startsWith('已生成')) {
        statusMessage.value = `${statusMessage.value}，已忽略其他文件`
      }

      return
    }

    const existingFileKeys = new Set(selectedFiles.value.map((item) => getFileKey(item.file)))
    const nextItems: SelectedFile[] = []

    for (const file of pdfFiles) {
      const fileKey = getFileKey(file)

      if (existingFileKeys.has(fileKey)) {
        continue
      }

      existingFileKeys.add(fileKey)
      nextItems.push({
        id: `${fileKey}-${crypto.randomUUID()}`,
        file,
        rotation: 0,
      })
    }

    selectedFiles.value = [...selectedFiles.value, ...nextItems]

    if (selectedToolId.value === 'merge' && mergeMode.value === 'page' && nextItems.length) {
      await appendMergePageItems(nextItems)
    }

    if (pdfFiles.length > nextItems.length) {
      statusMessage.value = '已忽略重复 PDF 文件'
    }

    if (files.length > pdfFiles.length) {
      statusMessage.value = '已忽略非 PDF 文件'
    }
    return
  }

  selectedFiles.value = files.map((file) => ({
    id: `${file.name}-${file.size}-${file.lastModified}-${crypto.randomUUID()}`,
    file,
    rotation: 0,
  }))
}

async function handleFileChange(event: Event) {
  const input = event.target as HTMLInputElement
  await setSelectedFiles(Array.from(input.files ?? []))
  input.value = ''
}

async function handleDrop(event: DragEvent) {
  await setSelectedFiles(Array.from(event.dataTransfer?.files ?? []))
}

function downloadBlob(blob: Blob, filename: string) {
  const url = URL.createObjectURL(blob)
  const link = document.createElement('a')
  link.href = url
  link.download = filename
  document.body.appendChild(link)
  link.click()
  link.remove()
  URL.revokeObjectURL(url)
}

function getBaseFilename(filename: string) {
  return filename.replace(/\.[^.]+$/, '') || 'document'
}

function sanitizeFileBaseName(rawName: string) {
  return rawName
    .replace(/[<>:"/\\|?*\u0000-\u001f]/g, '')
    .replace(/\s+/g, ' ')
    .replace(/[. ]+$/g, '')
    .replace(/\.(pdf|zip)$/i, '')
    .trim()
}

function getDownloadFilename(defaultFilename: string, extension: 'pdf' | 'zip') {
  const safeName = sanitizeFileBaseName(outputFileName.value)

  return safeName ? `${safeName}.${extension}` : defaultFilename
}

function getSplitRuleFilename(rule: SplitRule, index: number, baseName: string) {
  const safeName = sanitizeFileBaseName(rule.fileName)
  const defaultName = `${baseName}-第${index + 1}份-${formatPageNumbers(rule.pageNumbers)}`

  return `${safeName || defaultName}.pdf`
}

function getUniqueArchiveFilename(filename: string, usedFilenames: Set<string>) {
  if (!usedFilenames.has(filename)) {
    usedFilenames.add(filename)
    return filename
  }

  const dotIndex = filename.lastIndexOf('.')
  const baseName = dotIndex > 0 ? filename.slice(0, dotIndex) : filename
  const extension = dotIndex > 0 ? filename.slice(dotIndex) : ''
  let count = 2
  let uniqueName = `${baseName}-${count}${extension}`

  while (usedFilenames.has(uniqueName)) {
    count += 1
    uniqueName = `${baseName}-${count}${extension}`
  }

  usedFilenames.add(uniqueName)
  return uniqueName
}

function canvasToBlob(canvas: HTMLCanvasElement, type: string, quality?: number) {
  return new Promise<Blob>((resolve, reject) => {
    canvas.toBlob((blob) => {
      if (blob) {
        resolve(blob)
      } else {
        reject(new Error('Failed to export canvas'))
      }
    }, type, quality)
  })
}

let pdfWorkerObjectUrl = ''

function getPdfWorkerUrl() {
  if (!pdfWorkerObjectUrl) {
    pdfWorkerObjectUrl = URL.createObjectURL(
      new Blob([pdfWorkerSource], { type: 'text/javascript' }),
    )
  }

  return pdfWorkerObjectUrl
}

async function loadPdfRenderer() {
  pdfRendererLib.GlobalWorkerOptions.workerSrc = getPdfWorkerUrl()
  return pdfRendererLib
}

function removeSelectedFile(fileId: string) {
  const item = selectedFiles.value.find((file) => file.id === fileId)
  if (item?.previewUrl) {
    URL.revokeObjectURL(item.previewUrl)
  }
  selectedFiles.value = selectedFiles.value.filter((file) => file.id !== fileId)

  if (selectedToolId.value === 'split' && selectedFiles.value.length === 0) {
    splitInspectRevision += 1
    clearSplitPages()
  }

  if (selectedToolId.value === 'sign' && selectedFiles.value.length === 0) {
    signInspectRevision += 1
    clearSignPages()
  }

  for (const page of mergePageItems.value) {
    if (page.fileId === fileId && page.previewUrl) {
      URL.revokeObjectURL(page.previewUrl)
    }
  }
  mergePageItems.value = mergePageItems.value.filter((page) => page.fileId !== fileId)
}

async function appendMergePageItems(items: SelectedFile[]) {
  const pdfjsLib = await loadPdfRenderer()

  for (const item of items) {
    const parseRevision = mergePageParseRevision
    const hasParsedPages = mergePageItems.value.some((page) => page.fileId === item.id)

    if (hasParsedPages || parsingMergeFileIds.has(item.id)) {
      continue
    }

    parsingMergeFileIds.add(item.id)

    try {
      const pdf = await pdfjsLib.getDocument({ data: await item.file.arrayBuffer() }).promise
      const pages: MergePageItem[] = []

      for (let pageNumber = 1; pageNumber <= pdf.numPages; pageNumber += 1) {
        const pageIndex = pageNumber - 1
        const page = await pdf.getPage(pageNumber)
        const viewport = page.getViewport({ scale: 0.24 })
        const canvas = document.createElement('canvas')
        const context = canvas.getContext('2d')

        if (!context) {
          throw new Error('Canvas is not available')
        }

        canvas.width = Math.ceil(viewport.width)
        canvas.height = Math.ceil(viewport.height)
        context.fillStyle = '#ffffff'
        context.fillRect(0, 0, canvas.width, canvas.height)
        await page.render({ canvas, canvasContext: context, viewport }).promise
        const blob = await canvasToBlob(canvas, 'image/jpeg', 0.72)

        pages.push({
          id: `${item.id}-page-${pageIndex}-${crypto.randomUUID()}`,
          fileId: item.id,
          fileName: item.file.name,
          pageIndex,
          pageNumber,
          previewUrl: URL.createObjectURL(blob),
        })
      }

      await pdf.destroy()

      if (
        parseRevision !== mergePageParseRevision ||
        !selectedFiles.value.some((file) => file.id === item.id)
      ) {
        for (const page of pages) {
          if (page.previewUrl) {
            URL.revokeObjectURL(page.previewUrl)
          }
        }
        continue
      }

      const existingPageKeys = new Set(mergePageItems.value.map((page) => `${page.fileId}-${page.pageIndex}`))
      const uniquePages = pages.filter((page) => !existingPageKeys.has(`${page.fileId}-${page.pageIndex}`))
      mergePageItems.value = [...mergePageItems.value, ...uniquePages]
    } catch (error) {
      statusMessage.value = `无法读取 ${item.file.name} 的页面，可能是加密、损坏或受保护的 PDF`
    } finally {
      parsingMergeFileIds.delete(item.id)
    }
  }
}

async function ensureMergePageItems() {
  const missingFiles = selectedFiles.value.filter((file) => (
    !mergePageItems.value.some((page) => page.fileId === file.id)
  ))

  if (missingFiles.length) {
    await appendMergePageItems(missingFiles)
  }
}

async function setMergeMode(mode: 'file' | 'page') {
  mergeMode.value = mode

  if (mode === 'page') {
    await ensureMergePageItems()
  }
}

function getMergePageSourceLabel(page: MergePageItem) {
  const fileIndex = selectedFiles.value.findIndex((file) => file.id === page.fileId)
  return `${fileIndex >= 0 ? fileIndex + 1 : '?'}-${page.pageNumber}`
}

function toggleSplitPage(pageId: string) {
  splitPageItems.value = splitPageItems.value.map((page) => (
    page.id === pageId ? { ...page, selected: !page.selected } : page
  ))
}

function setAllSplitPages(selected: boolean) {
  splitPageItems.value = splitPageItems.value.map((page) => ({ ...page, selected }))
}

function invertSplitPages() {
  splitPageItems.value = splitPageItems.value.map((page) => ({ ...page, selected: !page.selected }))
}

function selectSplitRange(kind: 'first' | 'odd' | 'even') {
  splitPageItems.value = splitPageItems.value.map((page) => {
    if (kind === 'first') {
      return { ...page, selected: page.pageNumber === 1 }
    }

    return {
      ...page,
      selected: kind === 'odd' ? page.pageNumber % 2 === 1 : page.pageNumber % 2 === 0,
    }
  })
}

function getSelectedSplitPages() {
  return splitPageItems.value
    .filter((page) => page.selected)
    .map((page) => ({
      pageIndex: page.pageIndex,
      pageNumber: page.pageNumber,
    }))
}

function formatPageNumbers(pageNumbers: number[]) {
  if (pageNumbers.length === 0) {
    return '未选择页面'
  }

  const ranges: string[] = []
  let start = pageNumbers[0]
  let previous = pageNumbers[0]

  for (let index = 1; index <= pageNumbers.length; index += 1) {
    const current = pageNumbers[index]

    if (current === previous + 1) {
      previous = current
      continue
    }

    ranges.push(start === previous ? `${start}` : `${start}-${previous}`)
    start = current
    previous = current
  }

  return ranges.join('、')
}

function stashSplitRule() {
  const selectedPages = getSelectedSplitPages()

  if (selectedPages.length === 0) {
    statusMessage.value = '请先选择要暂存的页面'
    return
  }

  splitRules.value = [
    ...splitRules.value,
    {
      id: crypto.randomUUID(),
      fileName: '',
      pageIndices: selectedPages.map((page) => page.pageIndex),
      pageNumbers: selectedPages.map((page) => page.pageNumber),
    },
  ]
  setAllSplitPages(false)
  statusMessage.value = `已暂存第 ${splitRules.value.length} 份，可继续选择下一组页面`
}

function removeSplitRule(ruleId: string) {
  splitRules.value = splitRules.value.filter((rule) => rule.id !== ruleId)
}

function clearSplitRules() {
  splitRules.value = []
}

function rotateSelectedFile(fileId: string) {
  const item = selectedFiles.value.find((file) => file.id === fileId)
  if (item) {
    item.rotation += 90
  }
}

function handlePreviewDragStart(event: DragEvent, fileId: string) {
  draggingFileId.value = fileId
  event.dataTransfer?.setData('text/plain', fileId)
  if (event.dataTransfer) {
    event.dataTransfer.effectAllowed = 'move'
  }
}

function handlePreviewDragOver(event: DragEvent, targetFileId: string) {
  event.preventDefault()
  if (event.dataTransfer) {
    event.dataTransfer.dropEffect = 'move'
  }
  moveDraggingFile(targetFileId)
}

function moveDraggingFile(targetFileId: string) {
  const sourceFileId = draggingFileId.value

  if (!sourceFileId || sourceFileId === targetFileId) {
    return
  }

  const files = [...selectedFiles.value]
  const sourceIndex = files.findIndex((file) => file.id === sourceFileId)
  const targetIndex = files.findIndex((file) => file.id === targetFileId)

  if (sourceIndex === -1 || targetIndex === -1) {
    return
  }

  const [source] = files.splice(sourceIndex, 1)
  files.splice(targetIndex, 0, source)
  selectedFiles.value = files
}

function handlePreviewDrop() {
  draggingFileId.value = ''
}

function handleCanvasDrop() {
  draggingFileId.value = ''
}

function triggerFileUpload() {
  document.getElementById('file-upload')?.click()
}

function triggerSignImageUpload() {
  document.getElementById('sign-image-upload')?.click()
}

function clamp(value: number, min: number, max: number) {
  return Math.min(max, Math.max(min, value))
}

async function handleSignImageChange(event: Event) {
  const input = event.target as HTMLInputElement
  const file = Array.from(input.files ?? []).find(isSupportedImage)
  input.value = ''

  if (!file) {
    statusMessage.value = '请上传 PNG 或 JPG 签名图片'
    return
  }

  clearSignImage()
  signImageFile.value = file
  signImagePreviewUrl.value = URL.createObjectURL(file)

  try {
    const bitmap = await createImageBitmap(file)
    signImageAspectRatio.value = bitmap.width / bitmap.height || 2
    bitmap.close()
  } catch (error) {
    signImageAspectRatio.value = 2
  }

  statusMessage.value = '签章图片已准备好'
}

function getPointerPercent(event: PointerEvent | MouseEvent, element: HTMLElement) {
  const rect = element.getBoundingClientRect()

  return {
    xPct: clamp(((event.clientX - rect.left) / rect.width) * 100, 2, 98),
    yPct: clamp(((event.clientY - rect.top) / rect.height) * 100, 2, 98),
  }
}

function addSignPlacement(event: MouseEvent, page: SignPageItem) {
  if (!signImageFile.value) {
    statusMessage.value = '请先上传签名或印章图片'
    return
  }

  const target = event.currentTarget as HTMLElement
  const point = getPointerPercent(event, target)
  signPlacements.value = [
    ...signPlacements.value,
    {
      id: crypto.randomUUID(),
      pageIndex: page.pageIndex,
      pageNumber: page.pageNumber,
      xPct: point.xPct,
      yPct: point.yPct,
      widthPct: signStampWidth.value,
    },
  ]
}

function getSignPlacementsForPage(pageIndex: number) {
  return signPlacements.value.filter((placement) => placement.pageIndex === pageIndex)
}

function startSignDrag(event: PointerEvent, placement: SignPlacement) {
  event.stopPropagation()
  ;(event.currentTarget as HTMLElement).setPointerCapture?.(event.pointerId)
  signDragState.value = {
    id: placement.id,
    pageIndex: placement.pageIndex,
  }
}

function updateSignDrag(event: PointerEvent, pageIndex: number) {
  const dragState = signDragState.value

  if (!dragState || dragState.pageIndex !== pageIndex) {
    return
  }

  const target = event.currentTarget as HTMLElement
  const point = getPointerPercent(event, target)
  signPlacements.value = signPlacements.value.map((placement) => (
    placement.id === dragState.id
      ? { ...placement, xPct: point.xPct, yPct: point.yPct }
      : placement
  ))
}

function stopSignDrag() {
  signDragState.value = null
}

function removeSignPlacement(placementId: string) {
  signPlacements.value = signPlacements.value.filter((placement) => placement.id !== placementId)
}

function handleMergePageDragStart(event: DragEvent, pageId: string) {
  draggingMergePageId.value = pageId
  event.dataTransfer?.setData('text/plain', pageId)
  if (event.dataTransfer) {
    event.dataTransfer.effectAllowed = 'move'
  }
}

function handleMergePageDragOver(event: DragEvent, targetPageId: string) {
  event.preventDefault()
  if (event.dataTransfer) {
    event.dataTransfer.dropEffect = 'move'
  }
  moveMergePage(targetPageId)
}

function moveMergePage(targetPageId: string) {
  const sourcePageId = draggingMergePageId.value

  if (!sourcePageId || sourcePageId === targetPageId) {
    return
  }

  const pages = [...mergePageItems.value]
  const sourceIndex = pages.findIndex((page) => page.id === sourcePageId)
  const targetIndex = pages.findIndex((page) => page.id === targetPageId)

  if (sourceIndex === -1 || targetIndex === -1) {
    return
  }

  const [source] = pages.splice(sourceIndex, 1)
  pages.splice(targetIndex, 0, source)
  mergePageItems.value = pages
}

function handleMergePageDrop() {
  draggingMergePageId.value = ''
}

async function getImageBytesForPdf(item: SelectedFile) {
  const normalizedRotation = ((item.rotation % 360) + 360) % 360
  const settings = imageModeSettings[selectedMode.value as keyof typeof imageModeSettings]
  const bitmap = await createImageBitmap(item.file)
  const isSideways = normalizedRotation % 180 !== 0
  const rawWidth = isSideways ? bitmap.height : bitmap.width
  const rawHeight = isSideways ? bitmap.width : bitmap.height
  const scale = Math.min(1, settings.maxSide / Math.max(rawWidth, rawHeight))
  const canvas = document.createElement('canvas')
  canvas.width = Math.max(1, Math.round(rawWidth * scale))
  canvas.height = Math.max(1, Math.round(rawHeight * scale))
  const context = canvas.getContext('2d')

  if (!context) {
    throw new Error('Canvas is not available')
  }

  context.translate(canvas.width / 2, canvas.height / 2)
  context.rotate((normalizedRotation * Math.PI) / 180)
  context.drawImage(bitmap, -(bitmap.width * scale) / 2, -(bitmap.height * scale) / 2, bitmap.width * scale, bitmap.height * scale)
  bitmap.close()

  const blob = await new Promise<Blob>((resolve, reject) => {
    canvas.toBlob((result) => {
      if (result) {
        resolve(result)
      } else {
        reject(new Error('Failed to render rotated image'))
      }
    }, 'image/jpeg', settings.quality)
  })

  return {
    bytes: new Uint8Array(await blob.arrayBuffer()),
    type: 'jpg',
  }
}

async function convertImagesToPdf() {
  if (selectedFiles.value.length === 0) {
    statusMessage.value = '请先上传 JPG 或 PNG 图片'
    return
  }

  isProcessing.value = true
  statusMessage.value = '正在生成 PDF...'

  try {
    const pdfDoc = await PDFDocument.create()
    const pageWidth = 595.28
    const pageHeight = 841.89
    const margin = 36
    const drawableWidth = pageWidth - margin * 2
    const drawableHeight = pageHeight - margin * 2

    for (const file of selectedFiles.value) {
      const imageFile = await getImageBytesForPdf(file)
      const image = imageFile.type === 'png'
        ? await pdfDoc.embedPng(imageFile.bytes)
        : await pdfDoc.embedJpg(imageFile.bytes)
      const page = pdfDoc.addPage([pageWidth, pageHeight])
      const scale = Math.min(drawableWidth / image.width, drawableHeight / image.height)
      const width = image.width * scale
      const height = image.height * scale

      page.drawImage(image, {
        x: (pageWidth - width) / 2,
        y: (pageHeight - height) / 2,
        width,
        height,
      })
    }

    const pdfBytes = await pdfDoc.save()
    downloadBlob(
      new Blob([new Uint8Array(pdfBytes)], { type: 'application/pdf' }),
      getDownloadFilename('薄荷PDF-图片转PDF.pdf', 'pdf'),
    )
    statusMessage.value = `已生成 PDF，共 ${selectedFiles.value.length} 张图片`
  } catch (error) {
    console.error(error)
    statusMessage.value = '生成失败，请确认图片格式为 JPG 或 PNG'
  } finally {
    isProcessing.value = false
  }
}

async function convertPdfToImages() {
  if (selectedFiles.value.length === 0) {
    statusMessage.value = '请先上传 PDF 文件'
    return
  }

  isProcessing.value = true
  statusMessage.value = '正在加载 PDF 渲染器...'

  try {
    const pdfjsLib = await loadPdfRenderer()

    const settings = pdfImageModeSettings[selectedMode.value as keyof typeof pdfImageModeSettings]
    const zip = new JSZip()
    let imageCount = 0

    for (const item of selectedFiles.value) {
      const pdf = await pdfjsLib.getDocument({ data: await item.file.arrayBuffer() }).promise
      const folderName = getBaseFilename(item.file.name)
      const folder = selectedFiles.value.length > 1 ? zip.folder(folderName) ?? zip : zip

      for (let pageNumber = 1; pageNumber <= pdf.numPages; pageNumber += 1) {
        statusMessage.value = `正在导出 ${item.file.name} 第 ${pageNumber}/${pdf.numPages} 页...`
        const page = await pdf.getPage(pageNumber)
        const viewport = page.getViewport({ scale: settings.scale })
        const canvas = document.createElement('canvas')
        const context = canvas.getContext('2d')

        if (!context) {
          throw new Error('Canvas is not available')
        }

        canvas.width = Math.ceil(viewport.width)
        canvas.height = Math.ceil(viewport.height)

        await page.render({ canvas, canvasContext: context, viewport }).promise

        const blob = await canvasToBlob(canvas, 'image/jpeg', settings.quality)
        folder.file(`${folderName}-${String(pageNumber).padStart(3, '0')}.jpg`, blob)
        imageCount += 1
      }

      await pdf.destroy()
    }

    statusMessage.value = '正在打包图片...'
    const zipBlob = await zip.generateAsync({ type: 'blob' })
    downloadBlob(zipBlob, '薄荷PDF-PDF转图片.zip')
    statusMessage.value = `已导出 ${imageCount} 张图片`
  } catch (error) {
    console.error(error)
    statusMessage.value = '导出失败，请确认 PDF 文件未损坏或未加密'
  } finally {
    isProcessing.value = false
  }
}

async function compressPdfFile(item: SelectedFile) {
  const pdfjsLib = await loadPdfRenderer()
  const settings = compressModeSettings[selectedMode.value as keyof typeof compressModeSettings]
  const input = await pdfjsLib.getDocument({ data: await item.file.arrayBuffer() }).promise
  const output = await PDFDocument.create()

  for (let pageNumber = 1; pageNumber <= input.numPages; pageNumber += 1) {
    statusMessage.value = `正在压缩 ${item.file.name} 第 ${pageNumber}/${input.numPages} 页...`
    const page = await input.getPage(pageNumber)
    const baseViewport = page.getViewport({ scale: 1 })
    const renderViewport = page.getViewport({ scale: settings.scale })
    const canvas = document.createElement('canvas')
    const context = canvas.getContext('2d')

    if (!context) {
      throw new Error('Canvas is not available')
    }

    canvas.width = Math.ceil(renderViewport.width)
    canvas.height = Math.ceil(renderViewport.height)
    context.fillStyle = '#ffffff'
    context.fillRect(0, 0, canvas.width, canvas.height)

    await page.render({ canvas, canvasContext: context, viewport: renderViewport }).promise

    const imageBlob = await canvasToBlob(canvas, 'image/jpeg', settings.quality)
    const image = await output.embedJpg(new Uint8Array(await imageBlob.arrayBuffer()))
    const outputPage = output.addPage([baseViewport.width, baseViewport.height])
    outputPage.drawImage(image, {
      x: 0,
      y: 0,
      width: baseViewport.width,
      height: baseViewport.height,
    })
  }

  await input.destroy()
  return output.save()
}

async function compressPdf() {
  if (selectedFiles.value.length === 0) {
    statusMessage.value = '请先上传 PDF 文件'
    return
  }

  isProcessing.value = true
  statusMessage.value = '正在加载 PDF 压缩器...'

  try {
    if (selectedFiles.value.length === 1) {
      const item = selectedFiles.value[0]
      const pdfBytes = await compressPdfFile(item)
      downloadBlob(
        new Blob([new Uint8Array(pdfBytes)], { type: 'application/pdf' }),
        getDownloadFilename(`${getBaseFilename(item.file.name)}-compressed.pdf`, 'pdf'),
      )
      statusMessage.value = '已生成压缩 PDF'
      return
    }

    const zip = new JSZip()

    for (const item of selectedFiles.value) {
      const pdfBytes = await compressPdfFile(item)
      zip.file(`${getBaseFilename(item.file.name)}-compressed.pdf`, pdfBytes)
    }

    statusMessage.value = '正在打包压缩 PDF...'
    const zipBlob = await zip.generateAsync({ type: 'blob' })
    downloadBlob(zipBlob, getDownloadFilename('薄荷PDF-压缩PDF.zip', 'zip'))
    statusMessage.value = `已压缩 ${selectedFiles.value.length} 个 PDF`
  } catch (error) {
    console.error(error)
    statusMessage.value = '压缩失败，请确认 PDF 文件未损坏或未加密'
  } finally {
    isProcessing.value = false
  }
}

async function mergePdf() {
  if (mergeMode.value === 'file' && selectedFiles.value.length < 2) {
    statusMessage.value = '请至少上传 2 个 PDF 文件'
    return
  }

  if (mergeMode.value === 'page' && selectedFiles.value.length === 0) {
    statusMessage.value = '请先上传 PDF 文件'
    return
  }

  isProcessing.value = true
  statusMessage.value = '正在合并 PDF...'

  try {
    const output = await PDFDocument.create()

    if (mergeMode.value === 'page') {
      await ensureMergePageItems()

      if (mergePageItems.value.length === 0) {
        throw new Error('没有可合并的页面')
      }

      const sourceMap = new Map<string, PDFDocument>()

      for (const item of selectedFiles.value) {
        try {
          sourceMap.set(item.id, await PDFDocument.load(await item.file.arrayBuffer()))
        } catch (error) {
          throw new Error(`无法读取 ${item.file.name}，可能是加密、损坏或受保护的 PDF`)
        }
      }

      for (const pageItem of mergePageItems.value) {
        const source = sourceMap.get(pageItem.fileId)

        if (!source) {
          continue
        }

        statusMessage.value = `正在合并 ${pageItem.fileName} 第 ${pageItem.pageNumber} 页...`
        const [page] = await output.copyPages(source, [pageItem.pageIndex])
        output.addPage(page)
      }
    } else {
      for (const item of selectedFiles.value) {
      statusMessage.value = `正在合并 ${item.file.name}...`
      let source: PDFDocument

      try {
        source = await PDFDocument.load(await item.file.arrayBuffer())
      } catch (error) {
        throw new Error(`无法读取 ${item.file.name}，可能是加密、损坏或受保护的 PDF`)
      }

      const pages = await output.copyPages(source, source.getPageIndices())
      for (const page of pages) {
        output.addPage(page)
      }
      }
    }

    const pdfBytes = await output.save()
    downloadBlob(
      new Blob([new Uint8Array(pdfBytes)], { type: 'application/pdf' }),
      getDownloadFilename('薄荷PDF-合并PDF.pdf', 'pdf'),
    )
    statusMessage.value = `已合并 ${selectedFiles.value.length} 个 PDF`
  } catch (error) {
    console.error(error)
    statusMessage.value = error instanceof Error
      ? `合并失败：${error.message}`
      : '合并失败，请确认 PDF 文件未加密、未损坏且文件不过大'
  } finally {
    isProcessing.value = false
  }
}

async function splitPdf() {
  if (selectedFiles.value.length === 0) {
    statusMessage.value = '请先上传 PDF 文件'
    return
  }

  isProcessing.value = true
  statusMessage.value = '正在拆分 PDF...'

  try {
    const item = selectedFiles.value[0]
    const selectedPages = getSelectedSplitPages()
    const rules = splitRules.value.length
      ? splitRules.value
      : selectedPages.length
        ? [{
            id: 'current-selection',
            fileName: '',
            pageIndices: selectedPages.map((page) => page.pageIndex),
            pageNumbers: selectedPages.map((page) => page.pageNumber),
          }]
        : []

    if (rules.length === 0) {
      throw new Error('请先点击选择页面，或把一组页面暂存为一份')
    }

    const source = await PDFDocument.load(await item.file.arrayBuffer())
    const baseFilename = getBaseFilename(item.file.name)

    if (rules.length === 1) {
      const rule = rules[0]
      const output = await PDFDocument.create()
      const pages = await output.copyPages(source, rule.pageIndices)

      for (const page of pages) {
        output.addPage(page)
      }

      const pdfBytes = await output.save()
      downloadBlob(
        new Blob([new Uint8Array(pdfBytes)], { type: 'application/pdf' }),
        splitRules.value.length
          ? getSplitRuleFilename(rule, 0, baseFilename)
          : `${baseFilename}-拆分-${formatPageNumbers(rule.pageNumbers)}.pdf`,
      )
      statusMessage.value = `已导出 1 份 PDF，共 ${rule.pageIndices.length} 页`
      return
    }

    const zip = new JSZip()
    const usedFilenames = new Set<string>()

    for (const [index, rule] of rules.entries()) {
      statusMessage.value = `正在导出第 ${index + 1}/${rules.length} 份...`
      const output = await PDFDocument.create()
      const pages = await output.copyPages(source, rule.pageIndices)

      for (const page of pages) {
        output.addPage(page)
      }

      const pdfBytes = await output.save()
      zip.file(
        getUniqueArchiveFilename(getSplitRuleFilename(rule, index, baseFilename), usedFilenames),
        pdfBytes,
      )
    }

    statusMessage.value = '正在打包拆分结果...'
    const zipBlob = await zip.generateAsync({ type: 'blob' })
    downloadBlob(zipBlob, `${getBaseFilename(item.file.name)}-拆分结果.zip`)
    statusMessage.value = `已按 ${rules.length} 条规则导出 ${rules.length} 份 PDF`
  } catch (error) {
    console.error(error)
    statusMessage.value = error instanceof Error
      ? `拆分失败：${error.message}`
      : '拆分失败，请确认 PDF 文件未加密且页面选择正确'
  } finally {
    isProcessing.value = false
  }
}

async function signPdf() {
  if (selectedFiles.value.length === 0) {
    statusMessage.value = '请先上传 PDF 文件'
    return
  }

  if (!signImageFile.value) {
    statusMessage.value = '请先上传签名或印章图片'
    return
  }

  if (signPlacements.value.length === 0) {
    statusMessage.value = '请先在页面上放置签章'
    return
  }

  isProcessing.value = true
  statusMessage.value = '正在写入签章...'

  try {
    const item = selectedFiles.value[0]
    const pdfDoc = await PDFDocument.load(await item.file.arrayBuffer())
    const signBytes = new Uint8Array(await signImageFile.value.arrayBuffer())
    const isPng = signImageFile.value.type === 'image/png' || /\.png$/i.test(signImageFile.value.name)
    const signImage = isPng ? await pdfDoc.embedPng(signBytes) : await pdfDoc.embedJpg(signBytes)
    const pages = pdfDoc.getPages()

    for (const placement of signPlacements.value) {
      const page = pages[placement.pageIndex]

      if (!page) {
        continue
      }

      const pageWidth = page.getWidth()
      const pageHeight = page.getHeight()
      const width = (placement.widthPct / 100) * pageWidth
      const height = width / signImageAspectRatio.value
      const centerX = (placement.xPct / 100) * pageWidth
      const centerY = pageHeight - (placement.yPct / 100) * pageHeight

      page.drawImage(signImage, {
        x: centerX - width / 2,
        y: centerY - height / 2,
        width,
        height,
      })
    }

    const pdfBytes = await pdfDoc.save()
    downloadBlob(
      new Blob([new Uint8Array(pdfBytes)], { type: 'application/pdf' }),
      `${getBaseFilename(item.file.name)}-签章.pdf`,
    )
    statusMessage.value = `已添加 ${signPlacements.value.length} 个签章`
  } catch (error) {
    console.error(error)
    statusMessage.value = '签章失败，请确认 PDF 和签章图片未损坏'
  } finally {
    isProcessing.value = false
  }
}

async function handlePrimaryAction() {
  if (selectedToolId.value === 'image') {
    await convertImagesToPdf()
    return
  }

  if (selectedToolId.value === 'pdf-image') {
    await convertPdfToImages()
    return
  }

  if (selectedToolId.value === 'compress') {
    await compressPdf()
    return
  }

  if (selectedToolId.value === 'merge') {
    await mergePdf()
    return
  }

  if (selectedToolId.value === 'split') {
    await splitPdf()
    return
  }

  if (selectedToolId.value === 'sign') {
    await signPdf()
    return
  }

  statusMessage.value = `${selectedTool.value.name} 功能下一步实现`
}
</script>

<template>
  <main class="app-shell">
    <div class="mint-glow mint-glow-a"></div>
    <div class="mint-glow mint-glow-b"></div>

    <header class="topbar" aria-label="薄荷PDF 顶部导航">
      <a class="brand" href="#" aria-label="薄荷PDF 首页">
        <span class="brand-mark" aria-hidden="true">
          <img :src="mintLogo" alt="" />
        </span>
        <span>薄荷PDF</span>
      </a>
      <p class="local-note">无需联网，文件不泄露，完全免费，无需 Token</p>
    </header>

    <section class="workspace" aria-labelledby="page-title">
      <div class="upload-card operation-card" id="upload-panel" ref="uploadPanel">
        <div class="tool-picker" aria-labelledby="page-title">
          <div class="tool-picker-head">
            <div>
              <p class="eyebrow">PDF 工具</p>
              <h1 id="page-title">选择工具</h1>
            </div>
            <span class="tool-count">{{ tools.length }} 个常用功能</span>
          </div>
          <div class="quick-tools" aria-label="快速切换 PDF 工具">
            <button
              v-for="tool in tools"
              :key="`quick-${tool.id}`"
              :class="{ active: selectedToolId === tool.id }"
              type="button"
              @click="selectTool(tool.id)"
            >
              {{ tool.name }}
            </button>
          </div>
        </div>

        <div class="operation-head">
          <div>
            <p class="panel-kicker">当前工具</p>
            <h2>{{ selectedTool.name }}</h2>
            <p class="current-desc">{{ selectedTool.short }}</p>
          </div>
        </div>

        <div class="operation-body">
          <input
            id="file-upload"
            class="file-input"
            type="file"
            :accept="fileInputAccept"
            :multiple="allowsMultipleFiles"
            @change="handleFileChange"
          />

          <label
            v-if="selectedFiles.length === 0"
            class="drop-zone"
            :class="{ 'has-files': selectedFiles.length > 0 }"
            for="file-upload"
            @dragover.prevent
            @drop.prevent="handleDrop"
          >
            <span class="upload-icon" aria-hidden="true">
              <span></span>
            </span>
            <strong>{{ selectedFiles.length ? `${selectedFiles.length} 个文件已选择` : '拖入文件，或点击上传' }}</strong>
          </label>

          <div
            v-if="selectedToolId === 'image' && selectedFiles.length"
            class="preview-stage"
            @dragover.prevent
            @drop.prevent="handleCanvasDrop"
          >
            <article
              v-for="(item, index) in selectedFiles"
              :key="item.id"
              class="page-card"
              :class="{ dragging: draggingFileId === item.id }"
              draggable="true"
              @dragstart="handlePreviewDragStart($event, item.id)"
              @dragend="draggingFileId = ''"
              @dragenter.prevent
              @dragover="handlePreviewDragOver($event, item.id)"
              @drop.prevent="handlePreviewDrop"
            >
              <div class="page-paper">
                <div class="page-toolbar">
                  <button type="button" title="旋转" @click.stop="rotateSelectedFile(item.id)">↻</button>
                  <button type="button" title="移除" @click.stop="removeSelectedFile(item.id)">×</button>
                </div>
                <img
                  :src="item.previewUrl"
                  :alt="item.file.name"
                  draggable="false"
                  :style="{
                    transform: `rotate(${item.rotation}deg) scale(${item.rotation % 180 === 0 ? 1 : 0.78})`,
                  }"
                />
              </div>
              <span class="page-name">{{ index + 1 }}. {{ item.file.name }}</span>
            </article>
            <button class="add-page-card" type="button" @click="triggerFileUpload">
              <span>+</span>
              <strong>继续添加图片</strong>
            </button>
          </div>

          <div v-if="isPdfFileTool && selectedFiles.length" class="pdf-file-list">
            <article v-for="item in selectedFiles" :key="item.id" class="pdf-file-card">
              <span class="pdf-file-icon">PDF</span>
              <div>
                <strong>{{ item.file.name }}</strong>
                <small>{{ (item.file.size / 1024 / 1024).toFixed(2) }} MB</small>
              </div>
              <button type="button" @click="removeSelectedFile(item.id)">移除</button>
            </article>
            <button class="add-pdf-button" type="button" @click="triggerFileUpload">{{ addPdfButtonText }}</button>
          </div>

          <div v-if="selectedToolId === 'split' && selectedFiles.length" class="split-panel">
            <div class="split-panel-head">
              <div>
                <strong>选择要导出的页面</strong>
                <span>选一组页面暂存为一份，可连续暂存多份后一起导出</span>
              </div>
              <em>{{ splitPanelSummary }}</em>
            </div>
            <div class="split-presets" aria-label="快速选择页面">
              <button type="button" :disabled="!splitPageItems.length" @click="setAllSplitPages(true)">全选</button>
              <button type="button" :disabled="!splitPageItems.length" @click="invertSplitPages">反选</button>
              <button type="button" :disabled="!splitPageItems.length" @click="setAllSplitPages(false)">清空</button>
              <button type="button" :disabled="!splitPageItems.length" @click="selectSplitRange('first')">只选首页</button>
              <button type="button" :disabled="!splitPageItems.length" @click="selectSplitRange('odd')">奇数页</button>
              <button type="button" :disabled="!splitPageItems.length" @click="selectSplitRange('even')">偶数页</button>
            </div>
            <div class="split-stash-row">
              <button
                class="split-stash-button"
                type="button"
                :disabled="splitSelectedCount === 0"
                @click="stashSplitRule"
              >
                暂存为一份
              </button>
              <span>当前选择会保存成一条导出规则，暂存后自动清空选择。</span>
            </div>
            <div v-if="splitRules.length" class="split-rule-board">
              <div class="split-rule-head">
                <strong>已暂存 {{ splitRules.length }} 份</strong>
                <button type="button" @click="clearSplitRules">清空暂存</button>
              </div>
              <div class="split-rule-list">
                <article v-for="(rule, index) in splitRules" :key="rule.id" class="split-rule-card">
                  <span>第 {{ index + 1 }} 份</span>
                  <strong>第 {{ formatPageNumbers(rule.pageNumbers) }} 页</strong>
                  <input
                    v-model="rule.fileName"
                    class="split-rule-input"
                    type="text"
                    :placeholder="`文件名：第${index + 1}份`"
                    maxlength="80"
                    autocomplete="off"
                    :aria-label="`第 ${index + 1} 份文件名`"
                  />
                  <small>{{ rule.pageNumbers.length }} 页</small>
                  <button type="button" @click="removeSplitRule(rule.id)">移除</button>
                </article>
              </div>
            </div>
            <div v-if="splitPageItems.length" class="split-page-grid">
              <button
                v-for="page in splitPageItems"
                :key="page.id"
                class="split-page-card"
                :class="{ selected: page.selected }"
                type="button"
                @click="toggleSplitPage(page.id)"
              >
                <span class="split-page-number">第 {{ page.pageNumber }} 页</span>
                <span class="split-page-state">{{ page.selected ? '已选' : '未选' }}</span>
                <span class="split-page-preview">
                  <img v-if="page.previewUrl" :src="page.previewUrl" :alt="`第 ${page.pageNumber} 页`" />
                </span>
              </button>
            </div>
            <div v-else class="split-preview-loading">正在生成页面预览...</div>
          </div>

          <div v-if="selectedToolId === 'sign' && selectedFiles.length" class="sign-panel">
            <input
              id="sign-image-upload"
              class="file-input"
              type="file"
              accept="image/png,image/jpeg"
              @change="handleSignImageChange"
            />
            <div class="sign-controls">
              <button class="sign-upload-button" type="button" @click="triggerSignImageUpload">
                {{ signImagePreviewUrl ? '更换签章图片' : '上传签名/印章' }}
              </button>
              <div v-if="signImagePreviewUrl" class="sign-image-chip">
                <img :src="signImagePreviewUrl" alt="" />
                <button type="button" @click="clearSignImage">移除</button>
              </div>
              <label class="sign-size-control">
                <span>签章大小</span>
                <input v-model.number="signStampWidth" type="range" min="10" max="52" />
              </label>
            </div>
            <div v-if="signPageItems.length" class="sign-page-grid">
              <article
                v-for="page in signPageItems"
                :key="page.id"
                class="sign-page-card"
              >
                <span class="sign-page-number">第 {{ page.pageNumber }} 页</span>
                <div
                  class="sign-page-paper"
                  @click="addSignPlacement($event, page)"
                  @pointermove="updateSignDrag($event, page.pageIndex)"
                  @pointerup="stopSignDrag"
                  @pointerleave="stopSignDrag"
                >
                  <img class="sign-page-preview" :src="page.previewUrl" :alt="`第 ${page.pageNumber} 页`" draggable="false" />
                  <span
                    v-for="placement in getSignPlacementsForPage(page.pageIndex)"
                    :key="placement.id"
                    class="sign-stamp"
                    :class="{ dragging: signDragState?.id === placement.id }"
                    :style="{
                      left: `${placement.xPct}%`,
                      top: `${placement.yPct}%`,
                      width: `${placement.widthPct}%`,
                    }"
                    @click.stop
                    @pointerdown="startSignDrag($event, placement)"
                  >
                    <img v-if="signImagePreviewUrl" :src="signImagePreviewUrl" alt="" draggable="false" />
                    <button type="button" title="移除" @click.stop="removeSignPlacement(placement.id)">×</button>
                  </span>
                </div>
              </article>
            </div>
            <div v-else class="sign-preview-loading">正在生成页面预览...</div>
          </div>

          <label v-if="supportsCustomOutputName" class="output-name-panel">
            <span>下载文件名</span>
            <input
              v-model="outputFileName"
              type="text"
              :placeholder="outputNameHint"
              maxlength="80"
              autocomplete="off"
            />
          </label>

          <div
            v-if="selectedToolId === 'merge' && mergeMode === 'page' && mergePageItems.length"
            class="merge-page-board"
          >
            <div class="merge-page-head">
              <strong>页面队列</strong>
              <span>拖动页面调整合并顺序</span>
            </div>
            <div class="merge-page-list">
              <article
                v-for="page in mergePageItems"
                :key="page.id"
                class="merge-page-card"
                :class="{ dragging: draggingMergePageId === page.id }"
                draggable="true"
                @dragstart="handleMergePageDragStart($event, page.id)"
                @dragend="draggingMergePageId = ''"
                @dragenter.prevent
                @dragover="handleMergePageDragOver($event, page.id)"
                @drop.prevent="handleMergePageDrop"
              >
                <span
                  class="merge-page-source-badge"
                  :title="`${page.fileName} 第 ${page.pageNumber} 页`"
                >
                  {{ getMergePageSourceLabel(page) }}
                </span>
                <div class="merge-page-preview">
                  <img v-if="page.previewUrl" :src="page.previewUrl" :alt="`${page.fileName} 第 ${page.pageNumber} 页`" />
                </div>
                <div>
                  <strong>{{ page.fileName }}</strong>
                  <small>第 {{ page.pageNumber }} 页</small>
                </div>
              </article>
            </div>
          </div>

          <div class="action-bar">
            <div class="option-panel">
              <div>
                <span>处理模式</span>
                <strong>{{ selectedTool.short }}</strong>
              </div>
              <div v-if="hasModeSwitch" class="mode-switch" aria-label="处理质量">
                <template v-if="selectedToolId === 'merge'">
                  <button
                    v-for="mode in mergeModes"
                    :key="mode.id"
                    :class="{ active: mergeMode === mode.id }"
                    type="button"
                    @click="setMergeMode(mode.id)"
                  >
                    {{ mode.name }}
                  </button>
                </template>
                <template v-else>
                  <button
                    v-for="mode in modes"
                    :key="mode.id"
                    :class="{ active: selectedMode === mode.id }"
                    type="button"
                    @click="selectedMode = mode.id"
                  >
                    {{ mode.name }}
                  </button>
                </template>
              </div>
              <div v-else class="split-mode-note">{{ operationModeNote }}</div>
            </div>

            <button
              class="full-button"
              type="button"
              :disabled="isPrimaryActionDisabled"
              @click="handlePrimaryAction"
            >
              {{ isProcessing ? '处理中...' : primaryActionText }}
            </button>
          </div>
          <p v-if="statusMessage" class="status-message">{{ statusMessage }}</p>
        </div>
      </div>
    </section>

  </main>
</template>
