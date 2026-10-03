/** 数据模型（对应规格书 §7） */

export type PaperKind = 'sheet' | 'roll'

export interface RollSupply {
  /** 可用长度 mm（余料卷或整卷） */
  lengthMm: number
  /** 该供给卷的账面价格（分） */
  priceCents: number
  /** true = 已登记余料卷；false = 新整卷 */
  leftover: boolean
}

export interface Paper {
  id: string
  name: string
  wMm: number
  /** sheet：单张高度；roll：本次供给的第一卷长度（余料卷可为短卷） */
  hMm: number
  marginMm: number
  /** sheet：每张价格；roll：第一卷整卷/余卷价格（按长度折算成每米价格） */
  priceCents: number
  kind: PaperKind
  /** 使用卷筒余料时，余卷用尽后接续的新整卷规格 */
  parentRoll?: Paper
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
  rollIndex: number
  /** 供给序号：第一个余卷/整卷为 0，之后按顺序接续 */
  supplyIndex: number
  /** 供给卷长度（mm） */
  supplyLengthMm: number
  /** 供给卷账面价格（分） */
  supplyPriceCents: number
  /** true = 该供给来自登记余料卷 */
  supplyLeftover: boolean
  /** 从这卷纸实际切断/计费用掉的长度（mm，含纸边） */
  usedLengthMm: number
  /** 这卷纸用后剩余长度（mm；整卷用尽为 0） */
  leftoverLengthMm: number
  /** 相对本次切断段顶端的横切位置（mm） */
  crossCutAtMm: number
  /** 是否整卷用尽；为 true 时不产生可下次继续使用的卷筒余料 */
  fullRollConsumed: boolean
  /** 本次切断段的计费金额（分） */
  costCents: number
}

export interface Sheet {
  index: number
  placements: Placement[]
  cutSteps: CutStep[]
  /** 合并前的切割步数（用于共边合并的对比断言） */
  rawCutCount: number
  usedAreaMm2: number
  sheetAreaMm2: number
  utilization: number
  wasteRects: WasteRect[]
  /** 卷筒：本次从卷上切断的实际段长；普通纸：整张高度 */
  physicalHeightMm?: number
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
  /** 卷筒：本次总送纸/计费长度（mm） */
  usedLengthMm?: number
  /** 卷筒：任务结束后最后一卷的剩余长度（mm） */
  leftoverLengthMm?: number
}

export interface PackResult {
  sheets: Sheet[]
  stats: PackStats
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
  /** 卷筒：每米价格（分） */
  priceCentsPerMeter?: number
  /** 卷筒：本次用掉的长度（米） */
  usedMeters?: number
  /** 卷筒：最后一卷剩余长度（米） */
  leftoverMeters?: number
  /** 卷筒：每个切断段的用量、断点与金额 */
  rollSegments?: RollSegment[]
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
  /** 卷筒余料用尽后接续的新整卷规格 */
  parentRoll?: Paper
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
