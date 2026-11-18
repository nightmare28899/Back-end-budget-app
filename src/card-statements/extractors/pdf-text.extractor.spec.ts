import { StatementProcessingError } from "../parsers/statement-parser.interface";
import { PdfTextExtractor } from "./pdf-text.extractor";

describe("PdfTextExtractor", () => {
  it("extracts page-aware text and always releases parser resources", async () => {
    const parser = {
      getText: jest.fn().mockResolvedValue({
        text: "Banamex statement",
        pages: [{ num: 1, text: "Banamex statement" }],
      }),
      destroy: jest.fn().mockResolvedValue(undefined),
    };
    const extractor = new StubPdfTextExtractor(parser);

    await expect(extractor.extract(Buffer.from("%PDF-test"))).resolves.toEqual({
      text: "Banamex statement",
      pages: [{ number: 1, text: "Banamex statement" }],
    });
    expect(parser.destroy).toHaveBeenCalledTimes(1);
  });

  it("rejects PDFs without extractable text", async () => {
    const parser = {
      getText: jest.fn().mockResolvedValue({ text: " ", pages: [] }),
      destroy: jest.fn().mockResolvedValue(undefined),
    };
    const extractor = new StubPdfTextExtractor(parser);

    await expect(extractor.extract(Buffer.from("%PDF-test"))).rejects.toEqual(
      expect.objectContaining<Partial<StatementProcessingError>>({
        code: "PDF_TEXT_EMPTY",
      }),
    );
    expect(parser.destroy).toHaveBeenCalledTimes(1);
  });
});

class StubPdfTextExtractor extends PdfTextExtractor {
  constructor(
    private readonly parser: {
      getText(): Promise<{
        text: string;
        pages: Array<{ num: number; text: string }>;
      }>;
      destroy(): Promise<void>;
    },
  ) {
    super();
  }

  protected override createParser() {
    return this.parser;
  }
}
