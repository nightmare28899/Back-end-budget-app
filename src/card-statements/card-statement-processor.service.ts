import { Injectable } from "@nestjs/common";
import type { ParsedStatementData } from "./card-statements.types";
import { PdfTextExtractor } from "./extractors/pdf-text.extractor";
import { BanamexStatementParser } from "./parsers/banamex/banamex-statement.parser";
import { StatementProcessingError } from "./parsers/statement-parser.interface";

@Injectable()
export class CardStatementProcessorService {
  constructor(
    private readonly pdfTextExtractor: PdfTextExtractor,
    private readonly banamexParser: BanamexStatementParser,
  ) {}

  async process(buffer: Buffer): Promise<ParsedStatementData> {
    const extracted = await this.pdfTextExtractor.extract(buffer);
    if (!this.banamexParser.canParse(extracted)) {
      throw new StatementProcessingError(
        "UNSUPPORTED_STATEMENT_ISSUER",
        "The PDF is not a supported Banamex statement",
      );
    }

    return this.banamexParser.parse(extracted);
  }
}
