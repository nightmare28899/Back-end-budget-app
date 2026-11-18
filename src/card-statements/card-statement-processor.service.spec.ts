import type { ParsedStatementData } from "./card-statements.types";
import { CardStatementProcessorService } from "./card-statement-processor.service";
import { PdfTextExtractor } from "./extractors/pdf-text.extractor";
import { BanamexStatementParser } from "./parsers/banamex/banamex-statement.parser";
import { BbvaStatementParser } from "./parsers/bbva/bbva-statement.parser";
import { RappiCardStatementParser } from "./parsers/rappicard/rappicard-statement.parser";
import { StatementProcessingError } from "./parsers/statement-parser.interface";

describe("CardStatementProcessorService", () => {
  const extracted = {
    text: "synthetic statement",
    pages: [{ number: 1, text: "synthetic statement" }],
  };
  const parsed = { parserVersion: "test" } as ParsedStatementData;

  function createSubject() {
    const extract = jest.fn().mockResolvedValue(extracted);
    const banamexCanParse = jest.fn();
    const banamexParse = jest.fn().mockReturnValue(parsed);
    const rappiCardCanParse = jest.fn();
    const rappiCardParse = jest.fn().mockReturnValue(parsed);
    const bbvaCanParse = jest.fn();
    const bbvaParse = jest.fn().mockReturnValue(parsed);
    const pdfTextExtractor = {
      extract,
    } as unknown as PdfTextExtractor;
    const banamexParser = {
      canParse: banamexCanParse,
      parse: banamexParse,
    } as unknown as BanamexStatementParser;
    const rappiCardParser = {
      canParse: rappiCardCanParse,
      parse: rappiCardParse,
    } as unknown as RappiCardStatementParser;
    const bbvaParser = {
      canParse: bbvaCanParse,
      parse: bbvaParse,
    } as unknown as BbvaStatementParser;

    return {
      subject: new CardStatementProcessorService(
        pdfTextExtractor,
        banamexParser,
        rappiCardParser,
        bbvaParser,
      ),
      extract,
      banamexCanParse,
      banamexParse,
      rappiCardCanParse,
      rappiCardParse,
      bbvaCanParse,
      bbvaParse,
    };
  }

  it("dispatches Banamex statements to the first registered matching parser", async () => {
    const {
      subject,
      banamexCanParse,
      banamexParse,
      rappiCardCanParse,
      rappiCardParse,
      bbvaCanParse,
      bbvaParse,
    } = createSubject();
    banamexCanParse.mockReturnValue(true);

    await expect(subject.process(Buffer.from("pdf"))).resolves.toBe(parsed);

    expect(banamexParse).toHaveBeenCalledWith(extracted);
    expect(rappiCardCanParse).not.toHaveBeenCalled();
    expect(rappiCardParse).not.toHaveBeenCalled();
    expect(bbvaCanParse).not.toHaveBeenCalled();
    expect(bbvaParse).not.toHaveBeenCalled();
  });

  it("dispatches BBVA statements after the other registered parsers reject them", async () => {
    const {
      subject,
      banamexCanParse,
      rappiCardCanParse,
      bbvaCanParse,
      bbvaParse,
    } = createSubject();
    banamexCanParse.mockReturnValue(false);
    rappiCardCanParse.mockReturnValue(false);
    bbvaCanParse.mockReturnValue(true);

    await expect(subject.process(Buffer.from("pdf"))).resolves.toBe(parsed);

    expect(bbvaParse).toHaveBeenCalledWith(extracted);
  });

  it("dispatches RappiCard statements without invoking the nonmatching parser", async () => {
    const {
      subject,
      banamexCanParse,
      banamexParse,
      rappiCardCanParse,
      rappiCardParse,
      bbvaCanParse,
      bbvaParse,
    } = createSubject();
    banamexCanParse.mockReturnValue(false);
    rappiCardCanParse.mockReturnValue(true);

    await expect(subject.process(Buffer.from("pdf"))).resolves.toBe(parsed);

    expect(banamexParse).not.toHaveBeenCalled();
    expect(rappiCardParse).toHaveBeenCalledWith(extracted);
    expect(bbvaCanParse).not.toHaveBeenCalled();
    expect(bbvaParse).not.toHaveBeenCalled();
  });

  it("preserves unsupported-issuer rejection when no parser matches", async () => {
    const {
      subject,
      banamexCanParse,
      banamexParse,
      rappiCardCanParse,
      rappiCardParse,
      bbvaCanParse,
      bbvaParse,
    } = createSubject();
    banamexCanParse.mockReturnValue(false);
    rappiCardCanParse.mockReturnValue(false);
    bbvaCanParse.mockReturnValue(false);

    await expect(subject.process(Buffer.from("pdf"))).rejects.toMatchObject({
      code: "UNSUPPORTED_STATEMENT_ISSUER",
    } satisfies Partial<StatementProcessingError>);

    expect(banamexParse).not.toHaveBeenCalled();
    expect(rappiCardParse).not.toHaveBeenCalled();
    expect(bbvaParse).not.toHaveBeenCalled();
  });
});
