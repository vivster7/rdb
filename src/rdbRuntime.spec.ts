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

const testDB = "/Users/vivek/Code/rdb/test.rdb.sqlite3";
const testFile = "/Users/vivek/Code/rdb/sampleWorkspace/test.py";

describe("RDBRuntime", async () => {
  let runtime: RDBRuntime;

  beforeEach(async () => {
    runtime = new RDBRuntime(testDB);
    await runtime.start();
  });

  it("starts on the first line", async () => {
    const {
      frames: [{ line }],
    } = await runtime.stack();
    assert.deepEqual(line, 27);
  });

  it("continue", async () => {
    await runtime.setBreakPoint(testFile, 7);
    await runtime.continue();
    const {
      frames: [{ line }],
    } = await runtime.stack();
    assert.deepEqual(line, 7);
  });

  it("has a locals scope + variables", async () => {
    await runtime.setBreakPoint(testFile, 7);
    await runtime.continue();
    const {
      frames: [topFrame],
    } = await runtime.stack();
    assert.deepEqual(topFrame.line, 7);
    const [scope] = await runtime.scopes(topFrame.index);
    const [var1, var2] = await runtime.variables(scope.variablesReference);
    assert.deepEqual(var1.name, "self");
    assert.deepEqual(var1.value, "{}");
    assert.deepEqual(var2.name, "x");
    assert.deepEqual(var2.value, "1");
  });

  it("stack", async () => {
    await runtime.setBreakPoint(testFile, 7);
    await runtime.continue();
    const { frames, count } = await runtime.stack();
    assert.deepEqual(count, 3);
    assert.deepEqual(frames, [
      {
        file: testFile,
        index: 3,
        line: 7,
        name: "__init__ (7)",
      },
      {
        file: testFile,
        index: 2,
        line: 14,
        name: "fn (14)",
      },
      {
        file: testFile,
        index: 1,
        line: 27,
        name: "<module> (27)",
      },
    ]);
  });

  it("reverseContinue", async () => {
    await runtime.setBreakPoint(testFile, 14);
    await runtime.setBreakPoint(testFile, 18);
    await runtime.continue();
    await runtime.continue();
    await runtime.reverseContinue();
    const {
      frames: [{ line }],
    } = await runtime.stack();
    assert.deepEqual(line, 14);
  });

  it("step", async () => {
    await runtime.setBreakPoint(testFile, 14);
    await runtime.continue();
    await runtime.step();
    const {
      frames: [{ line }],
    } = await runtime.stack();
    assert.deepEqual(line, 16);
  });

  it("step stops at next breakpoint", async () => {
    await runtime.setBreakPoint(testFile, 14);
    await runtime.continue();
    await runtime.setBreakPoint(testFile, 7);
    await runtime.step();

    const {
      frames: [{ line }],
    } = await runtime.stack();
    // stops at breakpoint, not next step line (16)
    assert.deepEqual(line, 7);
  });

  it("stepBack", async () => {
    await runtime.setBreakPoint(testFile, 16);
    await runtime.continue();
    await runtime.stepBack();
    const {
      frames: [{ line }],
    } = await runtime.stack();
    assert.deepEqual(line, 14);
  });

  it("stepBack stops at next breakpoint", async () => {
    await runtime.setBreakPoint(testFile, 16);
    await runtime.continue();
    await runtime.setBreakPoint(testFile, 7);
    await runtime.stepBack();

    const {
      frames: [{ line }],
    } = await runtime.stack();
    // stops at breakpoint, not next step line (14)
    assert.deepEqual(line, 7);
  });

  it("stepIn", async () => {
    await runtime.stepIn();
    const {
      frames: [{ line }],
    } = await runtime.stack();
    assert.deepEqual(line, 14);
  });

  it("stepOut", async () => {
    await runtime.stepIn();
    await runtime.stepOut();
    const {
      frames: [{ line }],
    } = await runtime.stack();
    assert.deepEqual(line, 27);
  });
});
