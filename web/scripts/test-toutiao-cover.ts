import assert from "node:assert/strict"
import { mkdirSync, rmSync, unlinkSync, writeFileSync } from "node:fs"
import path from "node:path"
import sharp from "sharp"

const tempDataDir = path.join("/tmp", `autowriting-toutiao-cover-${process.pid}`)
process.env.DATA_DIR = tempDataDir

const { prepareToutiaoCoverFile, readToutiaoCoverImage } = await import("../server/utils/toutiaoCover.ts")

let preparedPath: string | null = null
try {
  const png = await sharp({
    create: {
      width: 4,
      height: 4,
      channels: 3,
      background: "#336699",
    },
  }).png().toBuffer()
  const dataUrl = `data:image/png;base64,${png.toString("base64")}`
  assert.deepEqual(await readToutiaoCoverImage(dataUrl, "https://example.test"), png)

  const uploadDir = path.join(tempDataDir, "uploads")
  mkdirSync(uploadDir, { recursive: true })
  writeFileSync(path.join(uploadDir, "cover.png"), png)
  assert.deepEqual(
    await readToutiaoCoverImage("/api/images/uploads/cover.png", "https://example.test"),
    png,
  )
  preparedPath = await prepareToutiaoCoverFile(dataUrl, "https://example.test")
  assert.equal((await sharp(preparedPath).metadata()).format, "jpeg")

  await assert.rejects(
    () => readToutiaoCoverImage("/api/images/uploads/../missing.png", "https://example.test"),
  )
  console.log("Toutiao cover data URL and local upload resolution passed")
} finally {
  if (preparedPath) unlinkSync(preparedPath)
  rmSync(tempDataDir, { recursive: true, force: true })
}
