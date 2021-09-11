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
const helpersFile = "/Users/vivek/Code/rdb/sampleWorkspace/helpers.py";

describe("RDBRuntime", async () => {
  let runtime: RDBRuntime;

  beforeEach(async () => {
    runtime = new RDBRuntime(testDB);
    await runtime.start();
  });

  it("starts on the first line", async () => {
    const [{ fLineno }] = await runtime.stack();
    assert.deepEqual(fLineno, 29);
  });

  it("continue", async () => {
    await runtime.setBreakPoint(testFile, 8);
    await runtime.continue();
    const [{ fLineno }] = await runtime.stack();
    assert.deepEqual(fLineno, 8);
  });

  it("has a locals scope + variables", async () => {
    await runtime.setBreakPoint(testFile, 8);
    await runtime.continue();
    const [topFrame] = await runtime.stack();
    assert.deepEqual(topFrame.fLineno, 8);
    const [scope] = await runtime.scopes(topFrame.fId);
    const [var1, var2] = await runtime.variables(scope.variablesReference);
    assert.deepEqual(var1.name, "self");
    assert.deepEqual(var1.value, "{}");
    assert.deepEqual(var2.name, "x");
    assert.deepEqual(var2.value, "1");
  });

  it("stack", async () => {
    await runtime.setBreakPoint(testFile, 8);
    await runtime.continue();
    const frames = await runtime.stack();
    assert.deepEqual(frames.length, 3);
    assert.deepEqual(frames, [
      {
        fBackId: 2,
        fFilename: "/Users/vivek/Code/rdb/sampleWorkspace/test.py",
        fFuncname: "__init__",
        fId: 3,
        fLineno: 8,
        fLocals: {
          self: {},
          x: 1,
        },
      },
      {
        fBackId: 1,
        fFilename: "/Users/vivek/Code/rdb/sampleWorkspace/test.py",
        fFuncname: "fn",
        fId: 2,
        fLineno: 15,
        fLocals: {},
      },
      {
        fBackId: null,
        fFilename: "/Users/vivek/Code/rdb/sampleWorkspace/test.py",
        fFuncname: "<module>",
        fId: 1,
        fLineno: 29,
        fLocals: {
          A: "<class '__main__.A'>",
          SqlTracer: "<class 'goet.tracer.sql.SqlTracer'>",
          __annotations__: {},
          __builtins__: "<module 'builtins' (built-in)>",
          __cached__: null,
          __doc__: null,
          __file__: "/Users/vivek/Code/rdb/sampleWorkspace/test.py",
          __loader__: {
            name: "__main__",
            path: "/Users/vivek/Code/rdb/sampleWorkspace/test.py",
          },
          __name__: "__main__",
          __package__: null,
          __spec__: null,
          add: "<function add>",
          connection: {},
          fn: "<function fn>",
          fn2: "<function fn2>",
          t: null,
        },
      },
    ]);
  });

  it("evaluate", async () => {
    await runtime.setBreakPoint(testFile, 18);
    await runtime.continue();

    assert.deepEqual(await runtime.evaluate("a"), "3");
    assert.deepEqual(await runtime.evaluate("c"), "");

    // `add` is defined in parent frame
    assert.deepEqual(await runtime.evaluate("add"), "<function add>");
  });

  it("reverseContinue", async () => {
    await runtime.setBreakPoint(testFile, 15);
    await runtime.setBreakPoint(testFile, 18);
    await runtime.continue();
    await runtime.continue();
    await runtime.reverseContinue();
    const [{ fLineno }] = await runtime.stack();
    assert.deepEqual(fLineno, 15);
  });

  it("step", async () => {
    await runtime.setBreakPoint(testFile, 15);
    await runtime.continue();
    await runtime.step();
    const [{ fLineno }] = await runtime.stack();
    assert.deepEqual(fLineno, 16);
  });

  it("step stops at next breakpoint", async () => {
    await runtime.setBreakPoint(testFile, 15);
    await runtime.continue();
    await runtime.setBreakPoint(testFile, 8);
    await runtime.step();

    const [{ fLineno }] = await runtime.stack();
    // stops at breakpoint, not next step line (16)
    assert.deepEqual(fLineno, 8);
  });

  it("stepBack", async () => {
    await runtime.setBreakPoint(testFile, 16);
    await runtime.continue();
    await runtime.stepBack();
    const [{ fLineno }] = await runtime.stack();
    assert.deepEqual(fLineno, 15);
  });

  it("stepBack stops at next breakpoint", async () => {
    await runtime.setBreakPoint(testFile, 16);
    await runtime.continue();
    await runtime.setBreakPoint(testFile, 8);
    await runtime.stepBack();

    const [{ fLineno }] = await runtime.stack();
    // stops at breakpoint, not next step line (14)
    assert.deepEqual(fLineno, 8);
  });

  it("stepIn", async () => {
    await runtime.stepIn();
    const [{ fLineno }] = await runtime.stack();
    assert.deepEqual(fLineno, 15);
  });

  it("stepOut", async () => {
    await runtime.stepIn();
    await runtime.stepOut();
    const [{ fLineno }] = await runtime.stack();
    assert.deepEqual(fLineno, 29);
  });

  it("can follow imports", async () => {
    await runtime.setBreakPoint(helpersFile, 2);
    await runtime.continue();
    const [{ fFilename, fLineno }] = await runtime.stack();
    assert.deepEqual(fFilename, helpersFile);
    assert.deepEqual(fLineno, 2);
  });
});
