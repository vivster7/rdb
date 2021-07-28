import { RDBRuntime } from "./RDBRuntime";

var assert = require("assert");

// Test File - sampleWorkspace/test.py
// 01  from goet.tracer.sql import SqlTracer
// 02  from goet.lib.db.sqlite import connection
// 03  from helpers import add
// 04
// 05
// 06  class A:
// 07      def __init__(self, x):
// 08          self.x = x
// 09
// 10      def __repr__(self) -> str:
// 11          return f"A(x={getattr(self, 'x', None)})"
// 12
// 13
// 14  def fn():
// 15      A(1)
// 16      a = add(1, 2)
// 17      b = 1 + 1
// 18      c = a + b
// 19      # comment
// 20      return c
// 21
// 22
// 23  def fn2():
// 24      a = 3
// 25      return a
// 26
// 27
// 28  with SqlTracer(connection) as t:
// 29      fn()

const testDB = "/Users/vivek/Code/rdb/tests/data/test1.sqlite3";
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
    assert.deepEqual(line, 29);
  });

  it("continue", async () => {
    await runtime.setBreakPoint(testFile, 8);
    await runtime.continue();
    const {
      frames: [{ line }],
    } = await runtime.stack();
    assert.deepEqual(line, 8);
  });

  it("has a locals scope + variables", async () => {
    await runtime.setBreakPoint(testFile, 8);
    await runtime.continue();
    const {
      frames: [topFrame],
    } = await runtime.stack();
    assert.deepEqual(topFrame.line, 8);
    const [scope] = await runtime.scopes(topFrame.index);
    const [var1, var2] = await runtime.variables(scope.variablesReference);
    assert.deepEqual(var1.name, "self");
    assert.deepEqual(var1.value, "{}");
    assert.deepEqual(var2.name, "x");
    assert.deepEqual(var2.value, "1");
  });

  it("stack", async () => {
    await runtime.setBreakPoint(testFile, 8);
    await runtime.continue();
    const { frames, count } = await runtime.stack();
    assert.deepEqual(count, 3);
    assert.deepEqual(frames, [
      {
        file: testFile,
        index: 3,
        line: 8,
        name: "__init__ (8)",
      },
      {
        file: testFile,
        index: 2,
        line: 15,
        name: "fn (15)",
      },
      {
        file: testFile,
        index: 1,
        line: 29,
        name: "<module> (29)",
      },
    ]);
  });

  it("reverseContinue", async () => {
    await runtime.setBreakPoint(testFile, 15);
    await runtime.setBreakPoint(testFile, 18);
    await runtime.continue();
    await runtime.continue();
    await runtime.reverseContinue();
    const {
      frames: [{ line }],
    } = await runtime.stack();
    assert.deepEqual(line, 15);
  });

  it("step", async () => {
    await runtime.setBreakPoint(testFile, 15);
    await runtime.continue();
    await runtime.step();
    const {
      frames: [{ line }],
    } = await runtime.stack();
    assert.deepEqual(line, 16);
  });

  it("step stops at next breakpoint", async () => {
    await runtime.setBreakPoint(testFile, 15);
    await runtime.continue();
    await runtime.setBreakPoint(testFile, 8);
    await runtime.step();

    const {
      frames: [{ line }],
    } = await runtime.stack();
    // stops at breakpoint, not next step line (16)
    assert.deepEqual(line, 8);
  });

  it("stepBack", async () => {
    await runtime.setBreakPoint(testFile, 16);
    await runtime.continue();
    await runtime.stepBack();
    const {
      frames: [{ line }],
    } = await runtime.stack();
    assert.deepEqual(line, 15);
  });

  it("stepBack stops at next breakpoint", async () => {
    await runtime.setBreakPoint(testFile, 16);
    await runtime.continue();
    await runtime.setBreakPoint(testFile, 8);
    await runtime.stepBack();

    const {
      frames: [{ line }],
    } = await runtime.stack();
    // stops at breakpoint, not next step line (14)
    assert.deepEqual(line, 8);
  });

  it("stepIn", async () => {
    await runtime.stepIn();
    const {
      frames: [{ line }],
    } = await runtime.stack();
    assert.deepEqual(line, 15);
  });

  it("stepOut", async () => {
    await runtime.stepIn();
    await runtime.stepOut();
    const {
      frames: [{ line }],
    } = await runtime.stack();
    assert.deepEqual(line, 29);
  });
});
