import { Injectable } from "@nestjs/common";
import type { ParsedStatementData } from "./card-statements.types";
import { PdfTextExtractor } from "./extractors/pdf-text.extractor";
import { BanamexStatementParser } from "./parsers/banamex/banamex-statement.parser";
import { BbvaStatementParser } from "./parsers/bbva/bbva-statement.parser";
import { RappiCardStatementParser } from "./parsers/rappicard/rappicard-statement.parser";
import type { StatementParser } from "./parsers/statement-parser.interface";
import { StatementProcessingError } from "./parsers/statement-parser.interface";

@Injectable()
export class CardStatementProcessorService {
  constructor(
    private readonly pdfTextExtractor: PdfTextExtractor,
    private readonly banamexParser: BanamexStatementParser,
    private readonly rappiCardParser: RappiCardStatementParser,
    private readonly bbvaParser: BbvaStatementParser,
  ) {}

  async process(buffer: Buffer): Promise<ParsedStatementData> {
    const extracted = await this.pdfTextExtractor.extract(buffer);
    const parsers: StatementParser[] = [
      this.banamexParser,
      this.rappiCardParser,
      this.bbvaParser,
    ];
    const parser = parsers.find((candidate) => candidate.canParse(extracted));
    if (!parser) {
      throw new StatementProcessingError(
        "UNSUPPORTED_STATEMENT_ISSUER",
        "The PDF is not a supported credit-card statement",
      );
    }

    return parser.parse(extracted);
  }
}
