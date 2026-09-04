import assert from "node:assert/strict";
import { test } from "node:test";
import { evalFormula, evalWith } from "./_harness";

const data = { A1: "10", A2: "20", A3: "30", A4: "40", A5: "50", A6: "x" };

test("order statistics and ranks", () => {
  assert.equal(evalWith("=LARGE(A1:A6, 2)", data), "40");
  assert.equal(evalWith("=SMALL(A1:A6, 2)", data), "20");
  assert.equal(evalWith("=LARGE(A1:A6, 6)", data), "#NUM!");
  assert.equal(evalWith("=RANK(40, A1:A6)", data), "2");
  assert.equal(evalWith("=RANK(40, A1:A6, 1)", data), "4");
  assert.equal(evalWith("=RANK(45, A1:A6)", data), "#N/A");
  assert.equal(evalWith("=RANK.AVG(20, A1:A3)", { A1: "20", A2: "20", A3: "30" }), "2.5");
});

test("percentiles interpolate; the exclusive forms refuse the ends", () => {
  assert.equal(evalWith("=PERCENTILE(A1:A5, 0.5)", data), "30");
  assert.equal(evalWith("=PERCENTILE(A1:A5, 0.9)", data), "46");
  assert.equal(evalWith("=PERCENTILE.EXC(A1:A5, 0.5)", data), "30");
  assert.equal(evalWith("=PERCENTILE.EXC(A1:A5, 0.1)", data), "#NUM!");
  assert.equal(evalWith("=QUARTILE(A1:A5, 1)", data), "20");
  assert.equal(evalWith("=QUARTILE(A1:A5, 3)", data), "40");
  assert.equal(evalWith("=QUARTILE.EXC(A1:A5, 1)", data), "15");
  assert.equal(evalWith("=PERCENTRANK(A1:A5, 35)", data), "0.625");
  assert.equal(evalWith("=PERCENTRANK(A1:A5, 99)", data), "#N/A");
});

test("the A forms count text and booleans; the blanks and uniques are counted", () => {
  const mixed = { A1: "10", A2: "x", A3: "TRUE", A5: "10" };
  assert.equal(evalWith("=AVERAGEA(A1:A5)", mixed), "5.25");
  assert.equal(evalWith("=MAXA(A1:A5)", mixed), "10");
  assert.equal(evalWith("=MINA(A1:A5)", mixed), "0");
  assert.equal(evalWith("=COUNTBLANK(A1:A5)", mixed), "1");
  assert.equal(evalWith("=COUNTUNIQUE(A1:A5)", mixed), "3");
  assert.equal(evalWith("=COUNTUNIQUE(A1:A2)", { A1: "abc", A2: "ABC" }), "1", "text compares without case");
});

test("MAXIFS and MINIFS over criteria pairs", () => {
  const sales = { A1: "east", A2: "west", A3: "east", A4: "west", B1: "5", B2: "9", B3: "7", B4: "2" };
  assert.equal(evalWith('=MAXIFS(B1:B4, A1:A4, "east")', sales), "7");
  assert.equal(evalWith('=MINIFS(B1:B4, A1:A4, "west")', sales), "2");
  assert.equal(evalWith('=MAXIFS(B1:B4, A1:A4, "east", B1:B4, "<6")', sales), "5");
  assert.equal(evalWith('=MAXIFS(B1:B4, A1:A4, "north")', sales), "0");
  assert.equal(evalWith('=MAXIFS(B1:B4, A1:A3, "east")', sales), "#VALUE!");
});

test("spread under the modern names, and the means", () => {
  const d = { A1: "2", A2: "4", A3: "4", A4: "4", A5: "5", A6: "5", A7: "7", A8: "9" };
  assert.equal(evalWith("=STDEV.P(A1:A8)", d), "2");
  assert.equal(evalWith("=ROUND(STDEV.S(A1:A8), 4)", d), "2.1381");
  assert.equal(evalWith("=VAR.P(A1:A8)", d), "4");
  assert.equal(evalWith("=STDEVP(A1:A8)", d), "2");
  assert.equal(evalWith("=VARP(A1:A8)", d), "4");
  assert.equal(evalWith("=STDEV.S(A1)", d), "#DIV/0!");
  assert.equal(evalFormula("=GEOMEAN(2, 8)"), "4");
  assert.equal(evalFormula("=HARMEAN(1, 4)"), "1.6");
  assert.equal(evalFormula("=GEOMEAN(-1, 4)"), "#NUM!");
  assert.equal(evalWith("=DEVSQ(A1:A8)", d), "32");
  assert.equal(evalWith("=AVEDEV(A1:A8)", d), "1.5");
});

test("two-variable statistics on a straight line", () => {
  const xy = { A1: "1", A2: "2", A3: "3", A4: "4", B1: "3", B2: "5", B3: "7", B4: "9" };
  assert.equal(evalWith("=CORREL(A1:A4, B1:B4)", xy), "1");
  assert.equal(evalWith("=PEARSON(A1:A4, B1:B4)", xy), "1");
  assert.equal(evalWith("=SLOPE(B1:B4, A1:A4)", xy), "2");
  assert.equal(evalWith("=INTERCEPT(B1:B4, A1:A4)", xy), "1");
  assert.equal(evalWith("=RSQ(B1:B4, A1:A4)", xy), "1");
  assert.equal(evalWith("=FORECAST(10, B1:B4, A1:A4)", xy), "21");
  assert.equal(evalWith("=COVARIANCE.P(A1:A4, B1:B4)", xy), "2.5");
  assert.equal(evalWith("=ROUND(COVARIANCE.S(A1:A4, B1:B4), 4)", xy), "3.3333");
  assert.equal(evalWith("=CORREL(A1:A4, B1:B3)", xy), "#N/A");
});

test("the normal distribution both ways", () => {
  assert.equal(evalFormula("=ROUND(NORM.S.DIST(1.96, TRUE), 4)"), "0.975");
  assert.equal(evalFormula("=ROUND(NORM.S.INV(0.975), 4)"), "1.96");
  assert.equal(evalFormula("=ROUND(NORM.DIST(110, 100, 15, TRUE), 4)"), "0.7475");
  assert.equal(evalFormula("=ROUND(NORM.DIST(100, 100, 15, FALSE), 4)"), "0.0266");
  assert.equal(evalFormula("=ROUND(NORM.INV(0.7475, 100, 15), 1)"), "110");
  assert.equal(evalFormula("=NORM.INV(1.2, 0, 1)"), "#NUM!");
  assert.equal(evalFormula("=STANDARDIZE(110, 100, 15)"), String(evalFormula("=10/15")));
  assert.equal(evalFormula("=ROUND(CONFIDENCE.NORM(0.05, 2.5, 50), 4)"), "0.693");
  assert.equal(evalFormula("=ROUND(NORMSDIST(0), 4)"), "0.5");
});

test("shape: skew, kurtosis, trimmed mean, discrete distributions", () => {
  const d = { A1: "3", A2: "4", A3: "5", A4: "2", A5: "3", A6: "4", A7: "5", A8: "6", A9: "4", A10: "7" };
  assert.equal(evalWith("=ROUND(SKEW(A1:A10), 4)", d), "0.3595");
  assert.equal(evalWith("=ROUND(KURT(A1:A10), 4)", d), "-0.1518");
  assert.equal(evalWith("=TRIMMEAN(A1:A10, 0.2)", d), "4.25");
  assert.equal(evalFormula("=ROUND(BINOM.DIST(6, 10, 0.5, FALSE), 4)"), "0.2051");
  assert.equal(evalFormula("=ROUND(BINOM.DIST(6, 10, 0.5, TRUE), 4)"), "0.8281");
  assert.equal(evalFormula("=ROUND(POISSON.DIST(2, 3, FALSE), 4)"), "0.224");
  assert.equal(evalFormula("=ROUND(POISSON.DIST(2, 3, TRUE), 4)"), "0.4232");
});
