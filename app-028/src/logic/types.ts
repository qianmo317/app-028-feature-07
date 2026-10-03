/** 数据模型（对应规格书 §7） */

export type PaperKind = 'sheet' | 'roll'
export type PriceUnit = 'sheet' | 'meter'

export interface Paper {
  id: string
  name: string
  /** 单张纸为高度；卷筒纸为固定幅宽 */
  wMm: number
  /** 单张纸为高度；卷筒纸为一整卷的长度 */
  hMm: number
  marginMm: number
  /** sheet = 每张价格；meter = 每米价格（单位均为分） */
  priceCents: number
  kind: PaperKind
  priceUnit?: PriceUnit
}

export interface PhotoSize {
  id: string
  name: string
  wMm: number
  hMm: number
  rotateByDefault: boolean
}

/** 本机读取的照片文件信息（只读尺寸与方向，不上传） */
export interface PhotoRef {
  name: string
  wPx: number
  hPx: number
  landscape: boolean
}

export interface Item {
  id: string
  sizeId: string
  qty: number
  rotateAllowed: boolean
  /** true = 同一张照片重复排；false = 一张照片只出现一次（每张各需一张底片） */
  repeatSamePhoto: boolean
  /** true = 该尺寸的照片尽量不拆散，排在同一张相纸上 */
  keepTogether: boolean
  photo?: PhotoRef
}

/** 实际照片矩形（mm，含旋转后的宽高） */
export interface Placement {
  itemId: string
  sheetIndex: number
  x: number
  y: number
  w: number
  h: number
  rotated: boolean
  seq: number
}

export type CutAxis = 'v' | 'h'

/** 贯通切割线；axis='v' 时 at 为 x，from/to 为 y 区间 */
export interface CutStep {
  sheetIndex: number
  axis: CutAxis
  at: number
  from: number
  to: number
  /** 该步由共边合并而来 */
  merged: boolean
}

export interface RollSegment {
  rollNumber: number
  /** 库存整卷长度（mm） */
  stockLengthMm: number
  /** 本任务实际计费/切断长度（mm） */
  usedLengthMm: number
  /** 本卷切完后剩余长度（mm），可留下次使用 */
  leftoverLengthMm: number
  /** 沿送纸方向的切断位置（本卷局部坐标，mm） */
  cutAtMm: number
  /** 本卷在本次连续送纸中的起点（mm） */
  startOffsetMm: number
  /** 本卷切断处在本次连续送纸中的位置（mm） */
  endOffsetMm: number
  /** true = 本卷刚好用到卷尾，余料为 0 */
  fullyUsed: boolean
}

export interface Sheet {
  index: number
  placements: Placement[]
  cutSteps: CutStep[]
  /** 合并前的切割步数（用于共边合并的对比断言） */
  rawCutCount: number
  usedAreaMm2: number
  /** 单张纸为整张面积；卷筒为实际切断段的面积，不包含可留用的卷尾 */
  sheetAreaMm2: number
  utilization: number
  wasteRects: WasteRect[]
  /** 卷筒纸：本张版面对应一卷纸上切下的一段 */
  roll?: RollSegment
}

export interface WasteRect {
  x: number
  y: number
  w: number
  h: number
}

export interface PackStats {
  totalPhotos: number
  sheets: number
  avgUtilization: number
  elapsedMs: number
  keepTogetherBroken: string[]
}

export interface PackResult {
  sheets: Sheet[]
  stats: PackStats
}

export interface RollCostSegment {
  rollNumber: number
  usedLengthMm: number
  leftoverLengthMm: number
  cutAtMm: number
  startOffsetMm: number
  endOffsetMm: number
  totalCents: number
  perPhotoCents: number
  photoCount: number
  fullyUsed: boolean
}

export interface CostReport {
  paperName: string
  sheets: number
  totalCents: number
  perPhotoCents: number
  totalPhotoCount: number
  /** 本方案浪费率 */
  wasteRate: number
  /** 不排样逐张打印的浪费率 */
  naiveWasteRate: number
  naiveTotalCents: number
  savedCents: number
  /** 卷筒纸总计费长度（米） */
  totalUsedMeters?: number
  /** 卷筒纸计价单价（分/米） */
  priceCentsPerMeter?: number
  /** 卷筒纸分卷切断与成本明细 */
  rollSegments?: RollCostSegment[]
}

export interface Task {
  id: string
  name: string
  paperId: string
  /** 自定义相纸（paperId 为 'custom' 时生效） */
  customPaper?: Paper
  items: Item[]
  gapMm: number
  kerfMm: number
  safeEdgeMm: number
  allowRotate: boolean
  headerText: string
  footerText: string
  createdAt: number
  /** 手工微调过的排样（存在时优先于自动排样结果） */
  manual?: {
    placements: Placement[]
    valid: boolean
    message: string
    validationMs: number
    stepCount: number
  }
  result?: PackResult
}

export interface Leftover {
  id: string
  name: string
  wMm: number
  hMm: number
  marginMm: number
  priceCents: number
  createdAt: number
  usedCount: number
  kind?: PaperKind
  priceUnit?: PriceUnit
}

export interface Settings {
  gapMm: number
  kerfMm: number
  safeEdgeMm: number
  allowRotate: boolean
  exportDpi: number
}

export interface PaperTemplate {
  id: string
  name: string
  paperId: string
  items: Array<{
    sizeId: string
    qty: number
    rotateAllowed: boolean
    keepTogether: boolean
  }>
}
