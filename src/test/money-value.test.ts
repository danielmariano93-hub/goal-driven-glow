import { describe, expect, it } from "vitest";
import { moneyValue } from "../../supabase/functions/_shared/agent/money";

describe("conversor único de valor em reais", () => {
  const table: Array<[unknown, number | null]> = [
    ["10,80", 10.8], ["R$ 1.250,50", 1250.5], ["1.250", 1250], ["10.80", 10.8], ["1.250,00", 1250], ["R$ 5", 5],
    ["  21  ", 21], [21, 21], [5.4, 5.4], ["0,5", 0.5], ["-30,25", -30.25], ["10%", 10], ["", null], [null, null],
    [undefined, null], ["abc", null], [Number.NaN, null],
  ];
  it.each(table)("%j -> %j", (input, expected) => {
    expect(moneyValue(input)).toBe(expected);
  });
});
