import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { validateSeed, type SeedFile } from "./format";

const demo: SeedFile = JSON.parse(readFileSync("examples/demo-club.json", "utf8"));

describe("validateSeed", () => {
  it("принимает пример клуба", () => {
    expect(validateSeed(demo)).toEqual([]);
  });

  it("находит ссылки на несуществующие категории и статьи", () => {
    const broken: SeedFile = {
      ...demo,
      members: [{ fullName: "Тестов Тест", status: "active", feeCategory: "Нет такой" }],
      expenses: [{ budgetItem: "Нет статьи", amount: 1, spentOn: "2026-1-1", description: "x" }],
    };
    expect(validateSeed(broken)).toHaveLength(3);
  });
});
