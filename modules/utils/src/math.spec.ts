import { expect } from "chai";

import { toWad, fromWad, inverse, sanitizeDecimals, calculateExchange } from "./math";

describe("Math", () => {
  it("toWad", () => {
    expect(toWad("1").toString()).to.be.equal("1000000000000000000");
    expect(toWad("1", 18).toString()).to.be.equal("1000000000000000000");
    expect(toWad("1", 8).toString()).to.be.equal("100000000");
    expect(toWad("1", 0).toString()).to.be.equal("1");
  });
  it("fromWad", () => {
    expect(fromWad("1000000000000000000")).to.be.equal("1");
    expect(fromWad("1000000000000000000", 18)).to.be.equal("1");
    expect(fromWad("100000000", 8)).to.be.equal("1");
    expect(fromWad("1", 0)).to.be.equal("1");
  });
  it("inverse", () => {
    expect(inverse("0.01")).to.be.equal("100");
    expect(inverse("100")).to.be.equal("0.01");
    expect(inverse("1")).to.be.equal("1");
  });
  it("sanitizeDecimals", () => {
    expect(sanitizeDecimals("100.2901385789273895723895782234234234234234234234233")).to.be.equal(
      "100.290138578927389572",
    );
    expect(sanitizeDecimals("100.0000000")).to.be.equal("100");
  });
  it("calculateExchange", () => {
    expect(calculateExchange("0.1", "100")).to.be.equal("10");
    expect(calculateExchange("10", "0.1")).to.be.equal("100");
  });
});
