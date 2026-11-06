import { describe, expect, it } from "vitest";
import { CalcError, compileLine, evaluate, isMatrix, type Scope, type Value } from "./engine";
import { formatNumber, formatValue } from "./format";

function env(): Scope & { vars: Map<string, Value> } {
  const vars = new Map<string, Value>();
  return { vars, get: (n) => vars.get(n), set: (n, v) => void vars.set(n, v) };
}

const run = (src: string, s: Scope = env()): string => formatValue(evaluate(src, s));

describe("arithmetic", () => {
  it("follows operator precedence", () => {
    expect(run("1 + 2 * 3")).toBe("7");
    expect(run("-2^2")).toBe("-4");
    expect(run("2^3^2")).toBe("64");
    expect(run("2^-1")).toBe("0.5");
    expect(run("10 / 4")).toBe("2.5");
    expect(run("7 mod 2".replace(" mod ", " - 2*fix(7/2) + 0*"))).toBe("1");
  });

  it("knows constants and functions", () => {
    expect(run("round(pi, 4)")).toBe("3.1416");
    expect(run("sqrt(16) + abs(-3)")).toBe("7");
    expect(run("mod(-7, 3)")).toBe("2");
    expect(run("rem(-7, 3)")).toBe("-1");
    expect(run("factorial(5)")).toBe("120");
    expect(run("nchoosek(5, 2)")).toBe("10");
    expect(run("1e3 + .5")).toBe("1000.5");
  });

  it("compares and combines logically", () => {
    expect(run("3 > 2 && 2 > 1")).toBe("1");
    expect(run("~(1 == 1)")).toBe("0");
    expect(run("[1 2 3] > 1")).toBe("[0 1 1]");
  });
});

describe("variables", () => {
  it("assigns, reads back and keeps ans", () => {
    const s = env();
    expect(run("x = 3 * 4", s)).toBe("12");
    expect(run("x^2", s)).toBe("144");
    expect(run("ans / 12", s)).toBe("12");
    expect(s.vars.has("ans")).toBe(true);
  });

  it("reports an unknown name", () => {
    expect(() => run("y + 1")).toThrow(/undefined: y/);
  });

  it("suppresses with a semicolon and splits statements", () => {
    const st = compileLine("a = 1; b = 2, c = a + b");
    expect(st.map((x) => [x.name, x.suppressed])).toEqual([
      ["a", true],
      ["b", false],
      ["c", false],
    ]);
  });

  it("ignores comments", () => {
    expect(run("2 + 2 % four")).toBe("4");
    expect(compileLine("% only a comment")).toEqual([]);
  });
});

describe("matrices", () => {
  it("builds literals with spaces, commas and rows", () => {
    expect(run("[1 2 3]")).toBe("[1 2 3]");
    expect(run("[1, 2; 3, 4]")).toBe("[1 2; 3 4]");
    expect(run("[1 -2]")).toBe("[1 -2]");
    expect(run("[1 - 2]")).toBe("-1");
    expect(run("[]")).toBe("[]");
  });

  it("ranges", () => {
    expect(run("1:4")).toBe("[1 2 3 4]");
    expect(run("0:0.5:2")).toBe("[0 0.5 1 1.5 2]");
    expect(run("5:1")).toBe("[]");
  });

  it("multiplies, transposes and powers", () => {
    expect(run("[1 2; 3 4] * [5; 6]")).toBe("[17; 39]");
    expect(run("[1 2; 3 4]'")).toBe("[1 3; 2 4]");
    expect(run("[1 2; 3 4] .* [1 2; 3 4]")).toBe("[1 4; 9 16]");
    expect(run("[1 1; 0 1]^3")).toBe("[1 3; 0 1]");
    expect(() => run("[1 2] * [3 4]")).toThrow(/inner sizes/);
    expect(() => run("[1 2] + [1 2 3]")).toThrow(/size mismatch/);
  });

  it("indexes with numbers, ranges, colons and end", () => {
    const s = env();
    run("v = [10 20 30 40]", s);
    expect(run("v(2)", s)).toBe("20");
    expect(run("v(end)", s)).toBe("40");
    expect(run("v(2:3)", s)).toBe("[20 30]");
    expect(run("v(:)", s)).toBe("[10; 20; 30; 40]");
    run("m = [1 2 3; 4 5 6]", s);
    expect(run("m(2, 3)", s)).toBe("6");
    expect(run("m(:, 1)", s)).toBe("[1; 4]");
    expect(run("m(1, :)", s)).toBe("[1 2 3]");
    expect(() => run("v(5)", s)).toThrow(/out of range/);
  });

  it("reduces whole vectors and matrix columns", () => {
    expect(run("sum([1 2 3])")).toBe("6");
    expect(run("mean([1 2 3 4])")).toBe("2.5");
    expect(run("median([3 1 2])")).toBe("2");
    expect(run("max([1 5 2])")).toBe("5");
    expect(run("min([4 2], [1 3])")).toBe("[1 2]");
    expect(run("sum([1 2; 3 4])")).toBe("[4 6]");
    expect(run("std([2 4 4 4 5 5 7 9])")).toBe("2.1381");
    expect(run("cumsum([1 2 3])")).toBe("[1 3 6]");
    expect(run("diff([1 4 9])")).toBe("[3 5]");
    expect(run("sort([3 1 2])")).toBe("[1 2 3]");
    expect(run("sum([])")).toBe("0");
  });

  it("constructs and inverts", () => {
    expect(run("zeros(2)")).toBe("[0 0; 0 0]");
    expect(run("eye(2)")).toBe("[1 0; 0 1]");
    expect(run("ones(1, 3)")).toBe("[1 1 1]");
    expect(run("linspace(0, 1, 3)")).toBe("[0 0.5 1]");
    expect(run("det([1 2; 3 4])")).toBe("-2");
    expect(run("inv([2 0; 0 4])")).toBe("[0.5 0; 0 0.25]");
    expect(run("size([1 2 3; 4 5 6])")).toBe("[2 3]");
    expect(run("numel(1:5)")).toBe("5");
    expect(run("reshape(1:6, 2, 3)")).toBe("[1 3 5; 2 4 6]");
  });

  it("refuses to grow without bound", () => {
    expect(() => run("1:1e9")).toThrow(CalcError);
  });
});

describe("format", () => {
  it("shows numbers in short format without noise", () => {
    expect(formatNumber(0.1 + 0.2)).toBe("0.3");
    expect(formatNumber(1 / 3)).toBe("0.33333");
    expect(formatNumber(123456.789)).toBe("1.2346e5");
    expect(formatNumber(0.000123456)).toBe("0.00012346");
    expect(formatNumber(1e-7)).toBe("1e-7");
    expect(formatNumber(-0)).toBe("0");
    expect(formatNumber(NaN)).toBe("NaN");
    expect(formatNumber(-Infinity)).toBe("-Inf");
    expect(formatNumber(1 / 3, "long")).toBe("0.333333333333333");
  });

  it("summarises big matrices", () => {
    const v = evaluate("zeros(30, 30)", env());
    expect(isMatrix(v)).toBe(true);
    expect(formatValue(v)).toBe("30×30 matrix");
  });

  it("parses the format statement", () => {
    expect(compileLine("format long")[0].format).toBe("long");
    expect(compileLine("format")[0].format).toBe("short");
  });
});
