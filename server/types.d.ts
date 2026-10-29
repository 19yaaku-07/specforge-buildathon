declare module "mammoth" {
  export interface MammothResult {
    value: string;
    messages: Array<{ type: string; message: string }>;
  }
  export function extractRawText(input: { path?: string; buffer?: Buffer }): Promise<MammothResult>;
  export function convertToHtml(input: { path?: string; buffer?: Buffer }): Promise<MammothResult>;
}

declare module "word-extractor" {
  export default class WordExtractor {
    extract(input: string | Buffer): Promise<{
      getBody(): string;
      getHeaders(): string;
      getFooters(): string;
    }>;
  }
}

declare module "pdf-parse" {
  function pdfParse(dataBuffer: Buffer): Promise<{ text: string; numpages: number; info: any }>;
  export = pdfParse;
}
