import { PDFDocument, PDFHexString } from 'pdf-lib'
import type { Annotation, HighlightColor } from '../../shared/ipc'

/** RGB 0..1 for each highlight color, close to what readers show on screen. */
export const PDF_COLORS: Record<HighlightColor, [number, number, number]> = {
  yellow: [1, 0.86, 0.3],
  green: [0.55, 0.85, 0.45],
  blue: [0.5, 0.75, 1],
  pink: [1, 0.6, 0.75],
  purple: [0.75, 0.6, 1]
}

/**
 * Returns a copy of the PDF with our highlights written as standard PDF Highlight annotations
 * (with notes as their pop-up text), so any PDF viewer shows them. The input is not modified.
 */
export async function annotatePdf(
  original: Uint8Array,
  annotations: Annotation[]
): Promise<Uint8Array> {
  const doc = await PDFDocument.load(original, { updateMetadata: false })
  const pages = doc.getPages()
  for (const a of annotations) {
    if (a.type !== 'highlight' || a.anchor.kind !== 'pdf') continue
    const page = pages[a.anchor.page - 1]
    if (!page || !a.anchor.rects.length) continue
    // Our rects are fractions of the visible page (crop box), origin top-left; PDF space is bottom-left.
    const box = page.getCropBox()
    const quads: number[] = []
    let x1 = Infinity
    let y1 = Infinity
    let x2 = -Infinity
    let y2 = -Infinity
    for (const [fx, fy, fw, fh] of a.anchor.rects) {
      const left = box.x + fx * box.width
      const right = left + fw * box.width
      const top = box.y + box.height - fy * box.height
      const bottom = top - fh * box.height
      // QuadPoints order used by viewers: top-left, top-right, bottom-left, bottom-right.
      quads.push(left, top, right, top, left, bottom, right, bottom)
      x1 = Math.min(x1, left)
      x2 = Math.max(x2, right)
      y1 = Math.min(y1, bottom)
      y2 = Math.max(y2, top)
    }
    const annot = doc.context.obj({
      Type: 'Annot',
      Subtype: 'Highlight',
      Rect: [x1, y1, x2, y2],
      QuadPoints: quads,
      C: PDF_COLORS[a.color ?? 'yellow'],
      CA: 0.45,
      F: 4, // print
      // Hex strings are UTF-16, so notes in any language (e.g. Arabic) survive.
      T: PDFHexString.fromText('Ur Library'),
      Contents: PDFHexString.fromText(a.note ?? a.text ?? ''),
      NM: PDFHexString.fromText(a.id)
    })
    page.node.addAnnot(doc.context.register(annot))
  }
  doc.setModificationDate(new Date())
  doc.setProducer('Ur Library')
  return doc.save()
}
