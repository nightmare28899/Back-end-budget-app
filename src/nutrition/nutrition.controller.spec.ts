import { StreamableFile } from "@nestjs/common";
import { validate } from "class-validator";
import { plainToInstance } from "class-transformer";
import { Readable } from "node:stream";
import type { CurrentUserType } from "../common/types/current-user.type";
import { NutritionCommandDto } from "./dto/nutrition-command.dto";
import { NutritionController } from "./nutrition.controller";

const user = { id: "user-1" } as CurrentUserType;

describe("NutritionController", () => {
  const service = {
    getState: jest.fn(),
    runCommand: jest.fn(),
    storeOriginal: jest.fn(),
    getOriginal: jest.fn(),
  };
  const dietImport = { importDiet: jest.fn() };
  const suggestions = { suggest: jest.fn() };
  const controller = new NutritionController(
    service as never,
    dietImport as never,
    suggestions as never,
  );

  beforeEach(() => jest.resetAllMocks());

  it("delegates state and commands with the authenticated user id", async () => {
    service.getState.mockResolvedValue({ profile: {} });
    service.runCommand.mockResolvedValue({ ok: true });

    await expect(controller.getState(user)).resolves.toEqual({ profile: {} });
    await controller.runCommand(user, {
      command: "favorite",
      payload: { a: 1 },
    });

    expect(service.getState).toHaveBeenCalledWith("user-1");
    expect(service.runCommand).toHaveBeenCalledWith("user-1", "favorite", {
      a: 1,
    });
  });

  it("delegates recipe suggestions with the authenticated user id", async () => {
    suggestions.suggest.mockResolvedValue({ suggestions: [], warnings: [] });
    const dto = { optionId: "11111111-1111-4111-8111-111111111111" };
    await controller.suggestRecipes(user, dto);
    expect(suggestions.suggest).toHaveBeenCalledWith("user-1", dto);
  });

  it("delegates diet imports without persisting", async () => {
    const files = [{ originalname: "a.jpg" }] as Express.Multer.File[];
    dietImport.importDiet.mockResolvedValue({
      draft: {},
      warnings: [],
      unmapped: [],
    });

    await expect(controller.importDiet(files)).resolves.toEqual({
      draft: {},
      warnings: [],
      unmapped: [],
    });
    expect(dietImport.importDiet).toHaveBeenCalledWith(files);
    expect(service.runCommand).not.toHaveBeenCalled();
  });

  it("delegates uploads", async () => {
    const file = { originalname: "a.pdf" } as Express.Multer.File;
    service.storeOriginal.mockResolvedValue({ ok: true, id: "f" });
    await controller.uploadOriginal(user, "diet-1", file);
    expect(service.storeOriginal).toHaveBeenCalledWith(
      "user-1",
      "diet-1",
      file,
    );
  });

  it("streams downloads with the hardened headers", async () => {
    service.getOriginal.mockResolvedValue({
      stream: Readable.from(["x"]),
      mime: "application/pdf",
      name: "My diet.pdf",
      contentLength: 1,
    });
    const headers: Record<string, string> = {};
    const response = {
      setHeader: (key: string, value: string) => {
        headers[key] = value;
      },
    };

    const result = await controller.download(user, "file-1", response as never);

    expect(result).toBeInstanceOf(StreamableFile);
    expect(headers).toEqual({
      "Content-Type": "application/pdf",
      "Content-Disposition": "attachment; filename*=UTF-8''My%20diet.pdf",
      "Content-Length": "1",
      "Cache-Control": "private, no-store",
      "X-Content-Type-Options": "nosniff",
    });
  });
});

describe("NutritionCommandDto", () => {
  const check = (input: unknown) =>
    validate(plainToInstance(NutritionCommandDto, input));

  it("accepts known commands with an object payload", async () => {
    await expect(
      check({ command: "save_diet", payload: { id: "x" } }),
    ).resolves.toHaveLength(0);
  });

  it.each(["cook_recipe", "undo_cook_recipe"])(
    "accepts the %s command",
    async (command) => {
      await expect(
        check({ command, payload: { id: "x" } }),
      ).resolves.toHaveLength(0);
    },
  );

  it("rejects unknown commands and non-object payloads", async () => {
    await expect(
      check({ command: "drop", payload: {} }),
    ).resolves.not.toHaveLength(0);
    await expect(
      check({ command: "favorite", payload: "x" }),
    ).resolves.not.toHaveLength(0);
    await expect(
      check({ command: "favorite", payload: [] }),
    ).resolves.not.toHaveLength(0);
    await expect(check({ command: "favorite" })).resolves.not.toHaveLength(0);
  });
});
