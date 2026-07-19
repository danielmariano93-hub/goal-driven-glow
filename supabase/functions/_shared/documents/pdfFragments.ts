import { PDFDocument } from "https://esm.sh/pdf-lib@1.17.1";

export type PdfFragment = {
  index: number;
  total: number;
  page_start: number;
  page_end: number;
  bytes: Uint8Array;
};

export async function splitPdfIntoFragments(bytes: Uint8Array, pagesPerFragment = 4): Promise<PdfFragment[]> {
  const source = await PDFDocument.load(bytes, { ignoreEncryption: false, updateMetadata: false });
  const pageCount = source.getPageCount();
  const fragments: PdfFragment[] = [];
  for (let start = 0; start < pageCount; start += pagesPerFragment) {
    const end = Math.min(pageCount, start + pagesPerFragment);
    const target = await PDFDocument.create();
    const indexes = Array.from({ length: end - start }, (_, offset) => start + offset);
    const pages = await target.copyPages(source, indexes);
    for (const page of pages) target.addPage(page);
    fragments.push({
      index: fragments.length + 1,
      total: Math.ceil(pageCount / pagesPerFragment),
      page_start: start + 1,
      page_end: end,
      bytes: await target.save({ useObjectStreams: true, addDefaultPage: false }),
    });
  }
  return fragments;
}

export function bytesToDataUrl(bytes: Uint8Array, mime: string): string {
  let binary = "";
  const chunk = 0x8000;
  for (let i = 0; i < bytes.length; i += chunk) {
    binary += String.fromCharCode(...bytes.subarray(i, i + chunk));
  }
  return `data:${mime};base64,${btoa(binary)}`;
}
