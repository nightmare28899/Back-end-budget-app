import type { ParsedStatementData } from "../card-statements.types";

export interface ExtractedStatementPage {
  number: number;
  text: string;
}

export interface ExtractedStatementText {
  text: string;
  pages: ExtractedStatementPage[];
}

export interface StatementParser {
  canParse(input: ExtractedStatementText): boolean;
  parse(input: ExtractedStatementText): ParsedStatementData;
}

export class StatementProcessingError extends Error {
  constructor(
    readonly code: string,
    message: string,
    options?: { cause?: unknown },
  ) {
    super(message, options);
    this.name = "StatementProcessingError";
  }
}
