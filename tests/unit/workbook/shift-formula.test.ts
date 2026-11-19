import { describe, expect, it } from "vitest";

import { shiftFormula } from "../../../src/modules/workbook/shift-formula";

describe("shiftFormula (a shared-formula clone's text from its master's)", () => {
  it("moves relative references and keeps absolute parts", () => {
    expect(shiftFormula("A1+B2", 1, 1)).toBe("B2+C3");
    expect(shiftFormula("$A$1+A$1+$A1", 2, 3)).toBe("$A$1+D$1+$A3");
    expect(shiftFormula("IF(H$5=$E7,$G7,0)", 3, 2)).toBe("IF(J$5=$E10,$G10,0)");
  });

  it("moves ranges, whole columns and whole rows", () => {
    expect(shiftFormula("SUM(A1:B2)", 1, 0)).toBe("SUM(A2:B3)");
    expect(shiftFormula("SUM($A$1:A1)", 4, 0)).toBe("SUM($A$1:A5)");
    expect(shiftFormula("SUM(A:A)+SUM($A:B)", 0, 1)).toBe("SUM(B:B)+SUM($A:C)");
    expect(shiftFormula("SUM(1:1)+SUM($1:2)", 2, 0)).toBe("SUM(3:3)+SUM($1:4)");
  });

  it("keeps sheet names, quoted or not, and moves the reference after them", () => {
    expect(shiftFormula("Sheet1!A1", 1, 0)).toBe("Sheet1!A2");
    expect(shiftFormula("+'Deposit Account'!H27", 0, 1)).toBe("+'Deposit Account'!I27");
    expect(shiftFormula("'It''s A1'!$B2:C3", 1, 1)).toBe("'It''s A1'!$B3:D4");
    expect(shiftFormula("Données!A1", 1, 0)).toBe("Données!A2");
  });

  it("leaves text inside string literals untouched", () => {
    expect(shiftFormula('IF(A1="A1",B1,"x""B2")', 1, 0)).toBe('IF(A2="A1",B2,"x""B2")');
  });

  it("leaves function names, defined names, numbers and error literals untouched", () => {
    expect(shiftFormula("LOG10(A1)+MyName+ABCD1+XFE1", 1, 0)).toBe("LOG10(A2)+MyName+ABCD1+XFE1");
    expect(shiftFormula("1E+5*2.5+A1", 1, 0)).toBe("1E+5*2.5+A2");
    expect(shiftFormula("#REF!+#DIV/0!+A1", 1, 0)).toBe("#REF!+#DIV/0!+A2");
    expect(shiftFormula("SUM(Sales[Amount])+B1", 0, 1)).toBe("SUM(Sales[Amount])+C1");
  });

  it("turns a reference that would leave the sheet into #REF!", () => {
    expect(shiftFormula("A1+B5", -1, 0)).toBe("#REF!+B4");
    expect(shiftFormula("XFD1", 0, 1)).toBe("#REF!");
    expect(shiftFormula("A1048576", 1, 0)).toBe("#REF!");
    expect(shiftFormula("SUM(A1:B2)", -1, 0)).toBe("SUM(#REF!)");
    expect(shiftFormula("Sheet1!A1", -1, 0)).toBe("Sheet1!#REF!");
    expect(shiftFormula("SUM(A:B)", 0, -1)).toBe("SUM(#REF!)");
  });
});
