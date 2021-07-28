import { RDBRuntime } from "./RDBRuntime";

var assert = require("assert");

// Test File - sampleWorkspace/test.py
// 01  from goet.tracer.sql import SqlTracer
// 02  from goet.lib.db.sqlite import connection
// 03
// 04
// 05  class A:
// 06      def __init__(self, x):
// 07          self.x = x
// 08
// 09      def __repr__(self) -> str:
// 10          return f"A(x={getattr(self, 'x', None)})"
// 11
// 12
// 13  def fn():
// 14      a = A(1)
// 15      # fn2()
// 16      a = 1 + 1
// 17      b = a + 1
// 18      return b
// 19
// 20
// 21  def fn2():
// 22      a = 3
// 23      return a
// 24
// 25
// 26  with SqlTracer(connection) as t:
// 27      fn()

// TODO: WRITE TESTS
// TODO: WRITE TESTS
// TODO: WRITE TESTS
// TODO: WRITE TESTS
// TODO: WRITE TESTS

describe("RDBRuntime", async () => {
  let runtime: RDBRuntime;

  beforeEach(async () => {
    runtime = new RDBRuntime("/Users/vivek/Code/rdb/test.rdb.sqlite3");
    await runtime.start();
  });

  it("starts on the first line", async () => {
    const { frames, count } = await runtime.stack();
    assert.deepEqual(count, 1);
    assert.deepEqual(frames, [
      {
        file: "/Users/vivek/Code/rdb/sampleWorkspace/test.py",
        index: 1,
        line: 27,
        name: "1(1)(27)",
      },
    ]);
  });

  it("steps in one line at at time", async () => {
    await runtime.stepIn();
    const { frames, count } = await runtime.stack();
    assert.deepEqual(count, 2);
    assert.deepEqual(frames, [
      {
        file: "/Users/vivek/Code/rdb/sampleWorkspace/test.py",
        index: 2,
        line: 14,
        name: "2(2)(14)",
      },
      {
        file: "/Users/vivek/Code/rdb/sampleWorkspace/test.py",
        index: 1,
        line: 27,
        name: "1(1)(27)",
      },
    ]);
  });

  it("should set breakpoints", async () => {
    await runtime.setBreakPoint(
      "/Users/vivek/Code/rdb/sampleWorkspace/test.py",
      7
    );
  });

  it("continue", async () => {
    await runtime.continue();
  });

  it("reverseContinue", async () => {
    await runtime.reverseContinue();
  });
  it("step", async () => {
    await runtime.step();
  });
  it("stepBack", async () => {
    await runtime.stepBack();
  });
  it("stepIn", async () => {
    await runtime.stepIn();
  });
  it("stepOut", async () => {
    await runtime.stepOut();
  });
  it("scopes", async () => {
    // await runtime.scopes();
  });
  it("variables", async () => {
    // await runtime.variables();
  });
  it("setBreakPoint", async () => {
    // await runtime.setBreakPoint();
  });
});
