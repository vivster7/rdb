import { RDBRuntime } from "./RDBRuntime";

// var assert = require("assert");

describe("RDBRuntime", () => {
  let runtime: RDBRuntime;

  beforeEach(() => {
    runtime = new RDBRuntime("/Users/vivek/Code/rdb/test.rdb.sqlite3");
    runtime.start();
  });

  it("continue", () => {
    runtime.continue();
  });

  it("reverseContinue", () => {
    runtime.reverseContinue();
  });
  it("step", () => {
    runtime.step();
  });
  it("stepBack", () => {
    runtime.stepBack();
  });
  it("stepIn", () => {
    runtime.stepIn();
  });
  it("stepOut", () => {
    runtime.stepOut();
  });
  it("scopes", () => {
    // runtime.scopes();
  });
  it("variables", () => {
    // runtime.variables();
  });
  it("stack2", () => {
    runtime.stack2();
  });
  it("setBreakPoint", () => {
    // runtime.setBreakPoint();
  });
});
