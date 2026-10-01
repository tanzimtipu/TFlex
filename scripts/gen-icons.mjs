#!/usr/bin/env node
/**
 * Jovrel Windows icon generator.
 *
 * Rebuilds the three committed .ico assets from the SVG masters:
 *   assets/brand/jovrel.ico      <- assets/brand/jovrel-mark.svg
 *   assets/brand/jovrel-pdf.ico  <- assets/brand/jovrel-pdf-file.svg
 *   assets/brand/favicon.ico     <- assets/brand/jovrel-mark.svg
 *
 * Every frame <=128 is written as a 32-bit BMP/DIB frame with an alpha channel.
 * Windows Explorer's folder-view icon paths (Extra large / Large / Medium /
 * Tiles / Content) do NOT consume PNG-compressed frames below 256x256, which
 * is why the previous all-PNG set rendered stretched/stale/missing. The 256
 * frame is emitted as PNG (Vista+ supports it there) to keep the file small.
 *
 * The SVG is rasterised at each NATIVE size (not downscaled from a bitmap), so
 * every frame is the master art composed square and undistorted at that size.
 *
 * Run: node scripts/gen-icons.mjs
 */
import { readFileSync, writeFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'

const require = createRequire(import.meta.url)
const { createCanvas, loadImage } = require('@napi-rs/canvas')

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..')
const BRAND = join(ROOT, 'assets', 'brand')

// Native frame sizes, ascending. <=128 BMP; 256 PNG.
const SIZES = [16, 20, 24, 32, 40, 48, 64, 96, 128, 256]

/** Build one uncompressed 32-bit DIB frame (BITMAPINFOHEADER + BGRA XOR + AND). */
function bmpFrame(rgba, size) {
  const rowBytes = size * 4
  const andRow = Math.ceil(size / 32) * 4
  const dib = Buffer.alloc(40 + rowBytes * size + andRow * size)
  dib.writeUInt32LE(40, 0) // biSize
  dib.writeInt32LE(size, 4) // biWidth
  dib.writeInt32LE(size * 2, 8) // biHeight = XOR + AND
  dib.writeUInt16LE(1, 12) // biPlanes
  dib.writeUInt16LE(32, 14) // biBitCount
  dib.writeUInt32LE(0, 16) // biCompression = BI_RGB
  dib.writeUInt32LE(rowBytes * size, 20) // biSizeImage
  let p = 40
  for (let y = size - 1; y >= 0; y--) {
    for (let x = 0; x < size; x++) {
      const i = (y * size + x) * 4
      dib[p++] = rgba.data[i + 2] // B
      dib[p++] = rgba.data[i + 1] // G
      dib[p++] = rgba.data[i] // R
      dib[p++] = rgba.data[i + 3] // A
    }
  }
  // AND mask stays all-zero: the alpha channel carries the transparency.
  return dib
}

/** Assemble an ICO container from { size, data } frames (ascending). */
function buildIco(frames) {
  const header = Buffer.alloc(6)
  header.writeUInt16LE(0, 0) // reserved
  header.writeUInt16LE(1, 2) // type = icon
  header.writeUInt16LE(frames.length, 4)
  const entries = Buffer.alloc(16 * frames.length)
  let offset = 6 + 16 * frames.length
  frames.forEach((f, i) => {
    const o = i * 16
    entries[o] = f.size >= 256 ? 0 : f.size
    entries[o + 1] = f.size >= 256 ? 0 : f.size
    entries[o + 2] = 0 // color count
    entries[o + 3] = 0 // reserved
    entries.writeUInt16LE(1, o + 4) // planes
    entries.writeUInt16LE(32, o + 6) // bit count
    entries.writeUInt32LE(f.data.length, o + 8)
    entries.writeUInt32LE(offset, o + 12)
    offset += f.data.length
  })
  return Buffer.concat([header, entries, ...frames.map((f) => f.data)])
}

const PNG_SIG = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])

/** Print the declared frame table of an .ico so the encoding is inspectable. */
function dumpIco(file) {
  const buf = readFileSync(file)
  const count = buf.readUInt16LE(4)
  console.log(`  ${file} (${buf.length} B), frames: ${count}`)
  for (let i = 0; i < count; i++) {
    const o = 6 + i * 16
    const w = buf[o] === 0 ? 256 : buf[o]
    const h = buf[o + 1] === 0 ? 256 : buf[o + 1]
    const bytes = buf.readUInt32LE(o + 8)
    const offset = buf.readUInt32LE(o + 12)
    const enc = buf.subarray(offset, offset + 8).equals(PNG_SIG) ? 'PNG' : 'BMP'
    console.log(`    ${String(w).padStart(3)}x${String(h).padStart(3)}  ${enc}  ${bytes} B`)
  }
}

/** Render one master SVG to an .ico at every native size. */
async function build(name, svgFile) {
  const master = await loadImage(readFileSync(join(BRAND, svgFile)))
  const frames = SIZES.map((size) => {
    const canvas = createCanvas(size, size)
    const ctx = canvas.getContext('2d')
    ctx.clearRect(0, 0, size, size)
    ctx.imageSmoothingEnabled = true
    ctx.imageSmoothingQuality = 'high'
    ctx.drawImage(master, 0, 0, size, size)
    const data =
      size === 256 ? canvas.toBuffer('image/png') : bmpFrame(ctx.getImageData(0, 0, size, size), size)
    return { size, data }
  })
  const out = join(BRAND, name)
  writeFileSync(out, buildIco(frames))
  console.log(`${name} <- ${svgFile}`)
  dumpIco(out)
}

await build('jovrel.ico', 'jovrel-mark.svg')
await build('jovrel-pdf.ico', 'jovrel-pdf-file.svg')
await build('favicon.ico', 'jovrel-mark.svg')
console.log('icons: regenerated')