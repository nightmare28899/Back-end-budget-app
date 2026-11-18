import { Injectable } from "@nestjs/common";
import { PDFParse } from "pdf-parse";
import type { ExtractedStatementText } from "../parsers/statement-parser.interface";
import { StatementProcessingError } from "../parsers/statement-parser.interface";

interface PdfTextParser {
  getText(): Promise<{
    text: string;
    pages: Array<{ num: number; text: string }>;
  }>;
  destroy(): Promise<void>;
}

@Injectable()
export class PdfTextExtractor {
  async extract(buffer: Buffer): Promise<ExtractedStatementText> {
    if (buffer.length === 0) {
      throw new StatementProcessingError(
        "PDF_TEXT_EMPTY",
        "The statement PDF is empty",
      );
    }

    const parser = this.createParser(buffer);
    try {
      const result = await parser.getText();
      const text = result.text.trim();
      if (!text) {
        throw new StatementProcessingError(
          "PDF_TEXT_EMPTY",
          "The statement PDF does not contain extractable text",
        );
      }

      return {
        text,
        pages: result.pages.map((page) => ({
          number: page.num,
          text: page.text,
        })),
      };
    } catch (error) {
      if (error instanceof StatementProcessingError) {
        throw error;
      }
      throw new StatementProcessingError(
        "PDF_TEXT_EXTRACTION_FAILED",
        "The statement PDF text could not be extracted",
        { cause: error },
      );
    } finally {
      await parser.destroy().catch(() => undefined);
    }
  }

  protected createParser(buffer: Buffer): PdfTextParser {
    return new PDFParse({ data: buffer });
  }
}
