/**
 * 排样器：guillotine 约束下的 2D 装箱。
 * 空闲矩形用「整边切分（guillotine split）」维护，任何一次放置都只把剩余区域
 * 沿一条整边切成两个子矩形，因此结果天然满足「每一刀都能直线裁到底」。
 */
import { EPS, planSheetCuts, toCutSteps, type Rect } from './guillotine'
import { round } from './units'
import type { PackResult, PackStats, Placement, RollSegment, Sheet, WasteRect } from './types'

export interface PackGroup {
  itemId: string
  copies: number
  photoW: number
  photoH: number
  allowRotate: boolean
  keepTogether: boolean
}

export interface PackOptions {
  paperW: number
  paperH: number
  marginMm: number
  safeEdgeMm: number
  gapMm: number
  kerfMm: number
  allowRotate: boolean
  /** 卷筒：把高度方向当作可连续送纸的长条，并在供给卷/实际用长处切段 */
  continuousRoll?: boolean
  /** 卷筒供给：余卷用完后接续的整卷序列；缺省为无限个同规格整卷 */
  rollSupplies?: Array<{ lengthMm: number; priceCents: number; leftover: boolean }>
}

export interface PackOutput {
  result: PackResult
  error?: string
}

interface PlacedRaw {
  itemId: string
  rect: Rect
  rotated: boolean
}

export function usableRegion(opts: PackOptions): Rect | null {
  const inset = opts.marginMm + opts.safeEdgeMm
  const w = round(opts.paperW - 2 * inset, 4)
  const h = round(
    opts.continuousRoll ? opts.paperH - inset : opts.paperH - 2 * inset,
    4,
  )
  if (w <= 0 || h <= 0) return null
  return { x: inset, y: inset, w, h }
}

export function emptyResult(elapsedMs = 0): PackResult {
  const stats: PackStats = {
    totalPhotos: 0,
    sheets: 0,
    avgUtilization: 0,
    elapsedMs,
    keepTogetherBroken: [],
  }
  return { sheets: [], stats }
}

interface RollFree extends Rect {
  /** 宽度贯通整卷的当前货架区域；其上方右侧还可继续放照片，下方可放下一货架 */
  active?: boolean
}

interface RollSegmentPack {
  placements: PlacedRaw[]
  usedLengthMm: number
  fullRollConsumed: boolean
}

function rollShelfBottom(rect: RollFree): number {
  return rect.y + rect.h
}

/** 卷筒专用切分：当前照片占满货架高度，剩余空间保留为「右侧 + 下方」两个 guillotine 区域 */
function splitRollPlace(
  free: RollFree[],
  idx: number,
  pw: number,
  ph: number,
): Rect {
  const f = free[idx]
  free.splice(idx, 1)
  const placed: Rect = { x: f.x, y: f.y, w: pw, h: ph }
  const dw = f.w - pw
  if (f.active) {
    if (dw > EPS) free.push({ x: f.x + pw, y: f.y, w: dw, h: ph })
  } else if (dw > EPS) {
    free.push({ x: f.x + pw, y: f.y, w: dw, h: ph })
  }
  if (f.active) {
    const belowH = f.y + f.h - (f.y + ph)
    if (belowH > EPS) free.push({ x: f.x, y: f.y + ph, w: f.w, h: belowH, active: true })
  } else if (f.y + ph < rollShelfBottom(f) - EPS) {
    free.push({ x: f.x, y: f.y + ph, w: f.w, h: rollShelfBottom(f) - (f.y + ph) })
  }
  return placed
}

function rollTryPlaceOne(
  free: RollFree[],
  g: PackGroup,
  opts: PackOptions,
  m: number,
): Trial | null {
  const sw = g.photoW + 2 * m
  const sh = g.photoH + 2 * m
  const fit = findBest(free, sw, sh, opts.allowRotate && g.allowRotate)
  if (!fit) return null
  const trial = free.slice()
  const placed = splitRollPlace(trial, fit.idx, fit.w, fit.h)
  return { free: trial as Rect[], placed, rotated: fit.rotated }
}

function rollTryPlaceMany(
  free: RollFree[],
  g: PackGroup,
  count: number,
  opts: PackOptions,
  m: number,
): Trial[] | null {
  let cur = free
  const out: Trial[] = []
  for (let i = 0; i < count; i++) {
    const t = rollTryPlaceOne(cur, g, opts, m)
    if (!t) return null
    out.push(t)
    cur = t.free as RollFree[]
  }
  return out
}

/**
 * 卷筒排样：先把整卷视为可连续送纸的无限长条，货架式自上而下填放；
 * 当前卷剩余空间放不下下一张时才开新卷，最后按实际最低切块尾端横切计费。
 * 不采用「先估总长再分卷」：任何估计偏短都会增加一次卷首/卷尾边料，连续填放已经取得按卷容量的最省断点。
 */
function packRollSegment(
  queue: PackGroup[],
  opts: PackOptions,
  m: number,
  inset: number,
  supplyLengthMm: number,
): RollSegmentPack {
  // 卷筒只在卷首保留一次纸边/安全边；横切端不留第二次边。
  const usableLength = supplyLengthMm - inset
  let free: RollFree[] = [{ x: inset, y: inset, w: opts.paperW - 2 * inset, h: usableLength, active: true }]
  const placements: PlacedRaw[] = []
  const commit = (t: Trial, g: PackGroup) => {
    free = t.free as RollFree[]
    placements.push({ itemId: g.itemId, rect: t.placed, rotated: t.rotated })
  }

  let progress = true
  while (progress) {
    progress = false
    // 不拆散：只要下一组照片能放进本卷空段、却放不进当前剩余空间，就切到下一卷。
    const blocked = queue.some(
      (g) =>
        g.copies > 1 &&
        g.keepTogether &&
        !rollTryPlaceMany(free, g, g.copies, opts, m) &&
        rollTryPlaceMany(
          [{ x: inset, y: inset, w: opts.paperW - 2 * inset, h: usableLength, active: true }],
          g,
          g.copies,
          opts,
          m,
        ) !== null,
    )
    if (blocked) break

    for (const g of queue) {
      if (g.copies <= 1 || !g.keepTogether) continue
      const many = rollTryPlaceMany(free, g, g.copies, opts, m)
      if (many) {
        for (const t of many) commit(t, g)
        g.copies = 0
        progress = true
      }
    }
    for (const g of queue) {
      if (g.copies <= 0) continue
      let t = rollTryPlaceOne(free, g, opts, m)
      while (t) {
        commit(t, g)
        g.copies--
        progress = true
        if (g.copies <= 0) break
        t = rollTryPlaceOne(free, g, opts, m)
      }
    }
    if (free.length > 400) free = free.filter((r) => r.w > 0.5 && r.h > 0.5)
  }

  if (!placements.length) {
    return {
    placements: [],
    usedLengthMm: supplyLengthMm,
    fullRollConsumed: true,
  }
  }
  const lowest = Math.max(...placements.map((p) => p.rect.y + p.rect.h))
  // 卷首的纸边只在第一卷计一次；最后切块若已顶到整卷末端，连不可再用的卷尾边料一起计为整卷。
  const usableBottom = supplyLengthMm - inset
  const usedLengthMm = round(lowest >= usableBottom - FIT_EPS ? supplyLengthMm : lowest, 4)
  return {
    placements,
    usedLengthMm,
    fullRollConsumed: usedLengthMm >= supplyLengthMm - FIT_EPS,
  }
}

function buildRollSheets(
  rawSheets: Array<{ raw: RollSegmentPack }>,
  opts: PackOptions,
): Sheet[] {
  const m = (opts.kerfMm + opts.gapMm) / 2
  const resultSheets = rawSheets.map(({ raw }, s) => {
    const segmentOpts: PackOptions = {
      ...opts,
      paperH: raw.usedLengthMm,
      rollSupplies: undefined,
    }
    const list: PlacedRaw[] = raw.placements
      .slice()
      .sort((a, b) =>
        Math.abs(a.rect.y - b.rect.y) > 0.01 ? a.rect.y - b.rect.y : a.rect.x - b.rect.x,
      )
    const { sheets } = sheetsFromPlacements(
      list.map((p, i) => ({
        itemId: p.itemId,
        sheetIndex: 0,
        x: p.rect.x + m,
        y: p.rect.y + m,
        w: p.rect.w - 2 * m,
        h: p.rect.h - 2 * m,
        rotated: p.rotated,
        seq: i + 1,
      })),
      segmentOpts,
      1,
    )
    const sheet = sheets[0]
    return { ...sheet, index: s, physicalHeightMm: raw.usedLengthMm }
  })
  const rollSegments = rollSegmentsForHeights(
    resultSheets.map((sheet) => sheet.physicalHeightMm ?? opts.paperH),
    opts,
  )
  resultSheets.forEach((sheet, i) => {
    sheet.roll = rollSegments[i]
  })
  return resultSheets
}

function packRoll(groups: PackGroup[], opts: PackOptions): PackOutput {
  const started = performance.now()
  const region = usableRegion(opts)
  if (!region) {
    return {
      error: '纸边留白 + 四周安全边 已超过卷筒尺寸，请调小裁切参数',
      result: emptyResult(performance.now() - started),
    }
  }
  const m = (opts.kerfMm + opts.gapMm) / 2
  const queue: PackGroup[] = groups
    .filter((g) => g.copies > 0)
    .map((g) => ({ ...g }))
    .sort((a, b) => {
      const ma = Math.max(a.photoW, a.photoH)
      const mb = Math.max(b.photoW, b.photoH)
      if (Math.abs(ma - mb) > EPS) return mb - ma
      return b.photoW * b.photoH - a.photoW * a.photoH
    })

  const oversize: string[] = []
  for (const g of queue) {
    const sw = g.photoW + 2 * m
    const sh = g.photoH + 2 * m
    const canRot = opts.allowRotate && g.allowRotate
    const fitsAcross = sw <= region.w + EPS
    const fitsRotatedAcross = canRot && sh <= region.w + EPS
    if (!fitsAcross && !fitsRotatedAcross) {
      oversize.push(
        `${round(g.photoW, 1)}×${round(g.photoH, 1)}mm 放不进卷筒可用区 ${round(region.w, 1)}mm 宽`,
      )
    }
  }
  if (oversize.length) {
    return {
      error: Array.from(new Set(oversize)).join('；') + '（可换更宽的卷筒，或调小安全边/纸边留白）',
      result: emptyResult(performance.now() - started),
    }
  }

  const defaultSupply = {
    lengthMm: opts.paperH,
    priceCents: 0,
    leftover: false,
  }
  const supplies = opts.rollSupplies?.length ? opts.rollSupplies : [defaultSupply]
  const rawSegments: Array<{ raw: RollSegmentPack }> = []
  let guard = 0
  let supplyIndex = 0
  while (queue.some((g) => g.copies > 0) && guard++ < 20000) {
    const supply = supplies[Math.min(supplyIndex, supplies.length - 1)]
    const raw = packRollSegment(
      queue,
      opts,
      m,
      opts.marginMm + opts.safeEdgeMm,
      supply.lengthMm,
    )
    if (!raw.placements.length) break
    rawSegments.push({ raw })
    if (raw.fullRollConsumed) supplyIndex++
  }

  const sheets = buildRollSheets(rawSegments, opts)
  // 用最终段长重建后重新连续编号
  let seq = 0
  const sheetOfItem = new Map<string, Set<number>>()
  for (const sheet of sheets) {
    for (const p of sheet.placements) {
      p.seq = ++seq
      let set = sheetOfItem.get(p.itemId)
      if (!set) {
        set = new Set()
        sheetOfItem.set(p.itemId, set)
      }
      set.add(sheet.index)
    }
  }

  const keepTogetherBroken: string[] = []
  for (const g of groups) {
    if (!g.keepTogether || g.copies <= 1) continue
    const set = sheetOfItem.get(g.itemId)
    if (set && set.size > 1) keepTogetherBroken.push(g.itemId)
  }
  const totalPhotos = sheets.reduce((acc, s) => acc + s.placements.length, 0)
  const usedLengthMm = round(sheets.reduce((acc, s) => acc + (s.roll?.usedLengthMm ?? 0), 0), 4)
  const lastLeftover = sheets[sheets.length - 1]?.roll?.leftoverLengthMm ?? 0
  const usedArea = sheets.reduce((acc, s) => acc + s.usedAreaMm2, 0)
  const totalArea = usedLengthMm * opts.paperW
  const stats: PackStats = {
    totalPhotos,
    sheets: sheets.length,
    avgUtilization: totalArea > 0 ? usedArea / totalArea : 0,
    elapsedMs: round(performance.now() - started, 2),
    keepTogetherBroken,
    usedLengthMm,
    leftoverLengthMm: round(lastLeftover, 4),
  }
  return { result: { sheets, stats } }
}

export function rollSuppliesOf(opts: PackOptions): NonNullable<PackOptions['rollSupplies']> {
  return opts.rollSupplies?.length
    ? opts.rollSupplies
    : [{ lengthMm: opts.paperH, priceCents: 0, leftover: false }]
}

/** 按排样器产生的段高消耗纸卷；同一次连续送纸的多个切段共用一卷，卷用尽才进入下一供给 */
export function rollSegmentsForHeights(
  heightsMm: number[],
  opts: PackOptions,
): RollSegment[] {
  const supplies = rollSuppliesOf(opts)
  let supplyIndex = 0
  let remaining = supplies[0]?.lengthMm ?? opts.paperH
  return heightsMm.map((requestedHeight, i) => {
    if (i > 0 && requestedHeight > remaining + FIT_EPS) {
      supplyIndex++
      const next = supplies[Math.min(supplyIndex, supplies.length - 1)]
      remaining = next.lengthMm
    }
    const supply = supplies[Math.min(supplyIndex, supplies.length - 1)]
    const usedLengthMm = round(Math.min(requestedHeight, remaining), 4)
    const segment: RollSegment = {
      rollIndex: i,
      supplyIndex: Math.min(supplyIndex, supplies.length - 1),
      supplyLengthMm: supply.lengthMm,
      supplyPriceCents: supply.priceCents,
      supplyLeftover: supply.leftover,
      usedLengthMm,
      leftoverLengthMm: round(Math.max(0, supply.lengthMm - usedLengthMm), 4),
      crossCutAtMm: usedLengthMm,
      fullRollConsumed: usedLengthMm >= supply.lengthMm - FIT_EPS,
      costCents: Math.round((usedLengthMm / supply.lengthMm) * supply.priceCents),
    }
    remaining = Math.max(0, remaining - usedLengthMm)
    const nextHeight = heightsMm[i + 1] ?? 0
    if (remaining <= FIT_EPS || nextHeight > remaining + FIT_EPS) {
      supplyIndex++
      const next = supplies[Math.min(supplyIndex, supplies.length - 1)]
      remaining = next.lengthMm
    }
    return segment
  })
}

/** 由一组（可能被手工微调过的）照片矩形重建每张相纸的切割步骤与利用率 */
export function sheetsFromPlacements(
  placements: Placement[],
  opts: PackOptions,
  sheetCount: number,
): { sheets: Sheet[]; errors: string[] } {
  const errors: string[] = []
  const region = usableRegion(opts)
  if (!region) return { sheets: [], errors: ['纸边留白 + 四周安全边 已超过相纸尺寸'] }
  const m = (opts.kerfMm + opts.gapMm) / 2
  const sheets: Sheet[] = []
  for (let s = 0; s < sheetCount; s++) {
    const list = placements
      .filter((p) => p.sheetIndex === s)
      .slice()
      .sort((a, b) => (Math.abs(a.y - b.y) > 0.01 ? a.y - b.y : a.x - b.x))
    const slots: Rect[] = list.map((p) => ({
      x: p.x - m,
      y: p.y - m,
      w: p.w + 2 * m,
      h: p.h + 2 * m,
    }))
    // 越界检查（安全边）
    for (const p of list) {
      if (
        p.x < region.x - EPS ||
        p.y < region.y - EPS ||
        p.x + p.w > region.x + region.w + EPS ||
        p.y + p.h > region.y + region.h + EPS
      ) {
        errors.push(`第 ${s + 1} 张纸上的第 ${p.seq} 号照片超出了安全边范围`)
      }
    }
    for (let i = 0; i < slots.length; i++) {
      for (let j = i + 1; j < slots.length; j++) {
        const a = slots[i]
        const b = slots[j]
        if (
          a.x < b.x + b.w - EPS &&
          b.x < a.x + a.w - EPS &&
          a.y < b.y + b.h - EPS &&
          b.y < a.y + a.h - EPS
        ) {
          errors.push(`第 ${s + 1} 张纸上的照片互相重叠`)
          i = slots.length
          break
        }
      }
    }
    const plan = planSheetCuts(region, slots)
    if (!plan.validation.ok) {
      errors.push(`第 ${s + 1} 张纸不满足 guillotine 贯通裁切：${plan.validation.reason}`)
    }
    const cutSteps = toCutSteps(s, plan.cuts, plan.rawCuts)
    const usedAreaMm2 = list.reduce((acc, p) => acc + p.w * p.h, 0)
    const wasteRects: WasteRect[] = plan.pieces
      .filter((pc) => pc.idx.length === 0 && pc.r.w >= 8 && pc.r.h >= 8)
      .map((pc) => ({
        x: round(pc.r.x, 3),
        y: round(pc.r.y, 3),
        w: round(pc.r.w, 3),
        h: round(pc.r.h, 3),
      }))
    const physicalHeightMm = opts.continuousRoll
      ? round(
          Math.min(
            opts.paperH,
            list.reduce((acc, p) => Math.max(acc, p.y + p.h + m), 0),
          ),
          4,
        )
      : opts.paperH
    const alreadyHasCrossCut = cutSteps.some(
      (c) =>
        c.axis === 'h' &&
        Math.abs(c.at - physicalHeightMm) < EPS &&
        Math.abs(c.from) < EPS &&
        Math.abs(c.to - opts.paperW) < EPS,
    )
    const effectiveCutSteps =
      opts.continuousRoll && !alreadyHasCrossCut
        ? [
            ...cutSteps,
            { sheetIndex: s, axis: 'h' as const, at: physicalHeightMm, from: 0, to: opts.paperW, merged: false },
          ]
        : cutSteps
    sheets.push({
      index: s,
      placements: list,
      cutSteps: effectiveCutSteps,
      rawCutCount: plan.rawCuts.length,
      usedAreaMm2: round(usedAreaMm2, 3),
      sheetAreaMm2: opts.paperW * physicalHeightMm,
      utilization: opts.paperW * physicalHeightMm > 0
        ? usedAreaMm2 / (opts.paperW * physicalHeightMm)
        : 0,
      wasteRects,
      physicalHeightMm,
    })
  }
  const resultSheets = sheets
  if (opts.continuousRoll) {
    const rollSegments = rollSegmentsForHeights(
      resultSheets.map((s) => s.physicalHeightMm ?? opts.paperH),
      opts,
    )
    resultSheets.forEach((sheet, i) => {
      sheet.roll = rollSegments[i]
    })
  }
  return { sheets: resultSheets, errors }
}

interface Fit {
  idx: number
  rotated: boolean
  w: number
  h: number
}

/** 放置适配判断用的极小容差（1 纳米级），只吸收浮点噪声 */
const FIT_EPS = 1e-6

function findBest(free: Rect[], w: number, h: number, allowRotate: boolean): Fit | null {
  let best: Fit | null = null
  let bestScore: number[] | null = null
  const consider = (
    i: number,
    rectW: number,
    rectH: number,
    pw: number,
    ph: number,
    rot: boolean,
  ) => {
    if (pw > rectW + FIT_EPS || ph > rectH + FIT_EPS) return
    const dw = rectW - pw
    const dh = rectH - ph
    const score = [Math.min(dw, dh), Math.max(dw, dh), rectW * rectH - pw * ph]
    if (
      !bestScore ||
      score[0] < bestScore[0] - EPS ||
      (Math.abs(score[0] - bestScore[0]) < EPS &&
        (score[1] < bestScore[1] - EPS ||
          (Math.abs(score[1] - bestScore[1]) < EPS && score[2] < bestScore[2] - EPS)))
    ) {
      bestScore = score
      best = { idx: i, rotated: rot, w: pw, h: ph }
    }
  }
  for (let i = 0; i < free.length; i++) {
    const f = free[i]
    consider(i, f.w, f.h, w, h, false)
    if (allowRotate && Math.abs(w - h) > EPS) consider(i, f.w, f.h, h, w, true)
  }
  return best
}

/** 在空闲矩形内放置 pw×ph，并按整边切分剩余区域 */
function splitPlace(free: Rect[], idx: number, pw: number, ph: number): Rect {
  const f = free[idx]
  free.splice(idx, 1)
  const placed: Rect = { x: f.x, y: f.y, w: pw, h: ph }
  const dw = f.w - pw
  const dh = f.h - ph
  if (dh <= EPS && dw <= EPS) return placed
  if (dh <= EPS) {
    free.push({ x: f.x + pw, y: f.y, w: dw, h: ph })
    return placed
  }
  if (dw <= EPS) {
    free.push({ x: f.x, y: f.y + ph, w: f.w, h: dh })
    return placed
  }
  const maxH = Math.max(f.w * dh, dw * ph)
  const maxV = Math.max(dw * f.h, pw * dh)
  if (maxH >= maxV) {
    free.push({ x: f.x, y: f.y + ph, w: f.w, h: dh })
    free.push({ x: f.x + pw, y: f.y, w: dw, h: ph })
  } else {
    free.push({ x: f.x + pw, y: f.y, w: dw, h: f.h })
    free.push({ x: f.x, y: f.y + ph, w: pw, h: dh })
  }
  return placed
}

interface Trial {
  free: Rect[]
  placed: Rect
  rotated: boolean
}

function tryPlaceOne(free: Rect[], g: PackGroup, opts: PackOptions, m: number): Trial | null {
  const sw = g.photoW + 2 * m
  const sh = g.photoH + 2 * m
  const fit = findBest(free, sw, sh, opts.allowRotate && g.allowRotate)
  if (!fit) return null
  const trial = free.slice()
  const placed = splitPlace(trial, fit.idx, fit.w, fit.h)
  return { free: trial, placed, rotated: fit.rotated }
}

function tryPlaceMany(
  free: Rect[],
  g: PackGroup,
  count: number,
  opts: PackOptions,
  m: number,
): Trial[] | null {
  let cur = free
  const out: Trial[] = []
  for (let i = 0; i < count; i++) {
    const t = tryPlaceOne(cur, g, opts, m)
    if (!t) return null
    out.push(t)
    cur = t.free
  }
  return out
}

export function packRollForPaper(groups: PackGroup[], opts: PackOptions): PackOutput {
  return packRoll(groups, { ...opts, continuousRoll: true })
}

export function pack(groups: PackGroup[], opts: PackOptions): PackOutput {
  if (opts.continuousRoll) return packRoll(groups, opts)
  const started = performance.now()
  const region = usableRegion(opts)
  if (!region) {
    return {
      error: '纸边留白 + 四周安全边 已超过相纸尺寸，请调小裁切参数',
      result: emptyResult(performance.now() - started),
    }
  }
  const m = (opts.kerfMm + opts.gapMm) / 2

  const queue: PackGroup[] = groups
    .filter((g) => g.copies > 0)
    .map((g) => ({ ...g }))
    .sort((a, b) => {
      const ma = Math.max(a.photoW, a.photoH)
      const mb = Math.max(b.photoW, b.photoH)
      if (Math.abs(ma - mb) > EPS) return mb - ma
      return b.photoW * b.photoH - a.photoW * a.photoH
    })

  // 单张都放不下 -> 直接给出边界提示
  const oversize: string[] = []
  for (const g of queue) {
    const sw = g.photoW + 2 * m
    const sh = g.photoH + 2 * m
    const canRot = opts.allowRotate && g.allowRotate
    const ok =
      (sw <= region.w + EPS && sh <= region.h + EPS) ||
      (canRot && sh <= region.w + EPS && sw <= region.h + EPS)
    if (!ok) {
      oversize.push(
        `${round(g.photoW, 1)}×${round(g.photoH, 1)}mm 放不进可用区 ${round(region.w, 1)}×${round(region.h, 1)}mm`,
      )
    }
  }
  if (oversize.length) {
    return {
      error: Array.from(new Set(oversize)).join('；') + '（可换更大的相纸，或调小安全边/纸边留白）',
      result: emptyResult(performance.now() - started),
    }
  }

  const rawSheets: Array<{ placements: PlacedRaw[] }> = []
  let guard = 0
  while (queue.some((g) => g.copies > 0) && guard++ < 20000) {
    let free: Rect[] = [{ ...region }]
    const placements: PlacedRaw[] = []

    const commit = (t: Trial, g: PackGroup) => {
      free = t.free
      placements.push({ itemId: g.itemId, rect: t.placed, rotated: t.rotated })
    }

    let progress = true
    while (progress) {
      progress = false
      // 不拆散：若该组能整组放进空纸、却放不进当前剩余空间，则结束当前纸另起一张
      if (placements.length > 0) {
        const blocked = queue.some(
          (g) =>
            g.copies > 1 &&
            g.keepTogether &&
            !tryPlaceMany(free, g, g.copies, opts, m) &&
            tryPlaceMany([{ ...region }], g, g.copies, opts, m) !== null,
        )
        if (blocked) break
      }
      for (const g of queue) {
        if (g.copies <= 1 || !g.keepTogether) continue
        const many = tryPlaceMany(free, g, g.copies, opts, m)
        if (many) {
          for (const t of many) commit(t, g)
          g.copies = 0
          progress = true
        }
      }
      for (const g of queue) {
        if (g.copies <= 0) continue
        let t = tryPlaceOne(free, g, opts, m)
        while (t) {
          commit(t, g)
          g.copies--
          progress = true
          if (g.copies <= 0) break
          t = tryPlaceOne(free, g, opts, m)
        }
      }
      if (free.length > 400) {
        free = free.filter((r) => r.w > 0.5 && r.h > 0.5)
      }
    }
    if (placements.length === 0) break
    rawSheets.push({ placements })
  }

  // 组装：按「从上到下、从左到右」编号
  const rawPlacements: Placement[] = []
  let seq = 0
  const sheetOfItem = new Map<string, Set<number>>()
  for (let s = 0; s < rawSheets.length; s++) {
    const raw = rawSheets[s]
    const ordered = raw.placements
      .slice()
      .sort((a, b) =>
        Math.abs(a.rect.y - b.rect.y) > 0.01 ? a.rect.y - b.rect.y : a.rect.x - b.rect.x,
      )
    for (const p of ordered) {
      seq += 1
      // 排样器放置的是「切块」（照片 + 刀宽/隙距补偿），这里换算回照片实际矩形
      rawPlacements.push({
        itemId: p.itemId,
        sheetIndex: s,
        x: p.rect.x + m,
        y: p.rect.y + m,
        w: p.rect.w - 2 * m,
        h: p.rect.h - 2 * m,
        rotated: p.rotated,
        seq,
      })
      let set = sheetOfItem.get(p.itemId)
      if (!set) {
        set = new Set()
        sheetOfItem.set(p.itemId, set)
      }
      set.add(s)
    }
  }

  const { sheets } = sheetsFromPlacements(rawPlacements, opts, rawSheets.length)

  const keepTogetherBroken: string[] = []
  for (const g of groups) {
    if (!g.keepTogether || g.copies <= 1) continue
    const set = sheetOfItem.get(g.itemId)
    if (set && set.size > 1) keepTogetherBroken.push(g.itemId)
  }

  const totalPhotos = sheets.reduce((acc, s) => acc + s.placements.length, 0)
  const totalUsed = sheets.reduce((acc, s) => acc + s.usedAreaMm2, 0)
  const stats: PackStats = {
    totalPhotos,
    sheets: sheets.length,
    avgUtilization:
      totalUsed > 0 ? totalUsed / (sheets.length * opts.paperW * opts.paperH) : 0,
    elapsedMs: round(performance.now() - started, 2),
    keepTogetherBroken,
  }
  return { result: { sheets, stats } }
}
