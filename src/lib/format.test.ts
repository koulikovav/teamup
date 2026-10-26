import { describe, expect, it } from "vitest";
import { day, parseRub } from "./format";

describe("parseRub", () => {
  it("понимает пробелы и запятую", () => {
    expect(parseRub("3 000")).toBe(300000);
    expect(parseRub("1500,5")).toBe(150050);
  });
  it("отбрасывает пустое, ноль и мусор", () => {
    expect(parseRub("")).toBeNull();
    expect(parseRub("0")).toBeNull();
    expect(parseRub("-5")).toBeNull();
    expect(parseRub("abc")).toBeNull();
    expect(parseRub(null)).toBeNull();
  });
});

describe("day", () => {
  it("переводит дату в привычный вид", () => {
    expect(day("2026-09-01")).toBe("01.09.2026");
  });
});
