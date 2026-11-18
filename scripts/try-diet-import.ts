/**
 * Dev helper: runs the diet import service on local files and prints the draft.
 * Calls the real Gemini API (needs GEMINI_API_KEY in the environment); persists nothing.
 *
 * Usage (from the backend root):
 *   GEMINI_API_KEY=... npm run try:diet-import -- <photo1.jpg> [photo2.png] [photo3.webp]
 *   npm run try:diet-import -- <diet.pdf>
 */
import "dotenv/config";
import { readFileSync } from "node:fs";
import { basename } from "node:path";
import {
  DietImportService,
  createDietImportClient,
} from "../src/nutrition/diet-import/diet-import.service";

async function main(): Promise<void> {
  const paths = process.argv.slice(2);
  if (!paths.length) {
    console.error("Usage: try-diet-import <file> [file] [file]");
    process.exit(1);
  }

  const service = new DietImportService(createDietImportClient());
  const result = await service.importDiet(
    paths.map((path) => ({
      originalname: basename(path),
      buffer: readFileSync(path),
    })),
  );
  console.log(JSON.stringify(result, null, 2));
}

main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
});
