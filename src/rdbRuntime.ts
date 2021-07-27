import { EventEmitter } from "events";
import { Database as sql3Driver } from "sqlite3";
import { Database, open } from "sqlite";
import { Handles, Scope, Variable } from "vscode-debugadapter";

export interface FileAccessor {
  readFile(path: string): Promise<string>;
}

export interface IRDBBreakpoint {
  id: number;
  line: number;
  verified: boolean;
}

interface IStackFrame {
  index: number;
  name: string;
  file: string;
  line: number;
  column?: number;
}

interface IStack {
  count: number;
  frames: IStackFrame[];
}

class GoetFrame {
  constructor(
    public fId: number,
    public fBackId: number,
    public fFilename: string,
    public fLocals: { [key: string]: any },
    public fLineno: number
  ) {}

  static fromRow(row: any): GoetFrame {
    return new GoetFrame(
      row.f_id,
      row.f_back_id,
      row.f_filename,
      JSON.parse(row.f_locals),
      row.f_lineno
    );
  }

  toStackFrame(): IStackFrame {
    return {
      index: this.fId,
      name: `${this.fId}(${this.fId})(${this.fLineno})`,
      file: "/Users/vivek/Code/rdb/sampleWorkspace/test.py",
      line: this.fLineno,
    };
  }
}

/**
 * A RDB runtime with minimal debugger functionality.
 */
export class RDBRuntime extends EventEmitter {
  // the initial (and one and only) file we are 'debugging'
  private _sourceFile: string = "";
  public get sourceFile() {
    return this._sourceFile;
  }

  // the contents (= lines) of the one and only file
  private _sourceLines: string[] = [];

  // This is the next line that will be 'executed'
  private _currentLine = 0;
  private _currentColumn: number | undefined;

  // maps from sourceFile to array of RDB breakpoints
  private _breakPoints = new Map<string, IRDBBreakpoint[]>();

  // since we want to send breakpoint events, we will assign an id to every event
  // so that the frontend can match events with breakpoints.
  private _breakpointId = 1;

  private _breakAddresses = new Set<string>();

  // private _noDebug = false;

  // private _namedException: string | undefined;
  // private _otherExceptions = false;

  // TODO: figure out where to initialize this.
  private _db: Database = null as unknown as Database;
  private _frame: GoetFrame | undefined;
  private _lastFId = 0;

  private _variableHandles = new Handles<string>();

  constructor(private _fileAccessor: FileAccessor) {
    super();
  }

  /**
   * Start executing the given program.
   */
  public async start(
    program: string,
    stopOnEntry: boolean,
    noDebug: boolean
  ): Promise<void> {
    // this._noDebug = noDebug;

    this._db = await open({
      filename: "/Users/vivek/Code/rdb/test.rdb.sqlite3",
      driver: sql3Driver,
    });

    const row = await this._db.get("select max(f_id) from frames");
    this._lastFId = row["max(f_id)"];

    await this.loadSource(program);
    this._currentLine = -1;

    if (stopOnEntry) {
      // we step once
      await this.step();
    } else {
      // we just start to run until we hit a breakpoint or an exception
      this.continue();
    }
  }

  public async continue() {
    // Handle first step
    if (!this._frame) {
      await this.jumpToFrame(1);
      this.sendEvent("stopOnStep");
      return;
    }

    const getNextFrameIdByContinueSql = `
      WITH 
        breakpoints(filename, lineno) AS (VALUES ${this.getBreakpointsAsSqlValues()}),
        forward_frames(f_id, f_filename, f_lineno, f_back_id) AS (SELECT f_id, f_filename, f_lineno, f_back_id FROM frames WHERE f_id > $fId),
        last_frame(f_id) AS (SELECT f_id FROM frames ORDER BY f_id DESC LIMIT 1)
      SELECT f_id FROM (
        SELECT f_id FROM last_frame
        UNION
        SELECT f_id FROM forward_frames, breakpoints
        WHERE f_filename = breakpoints.filename AND f_lineno = breakpoints.lineno)
      ORDER BY f_id
      LIMIT 1
    `;

    const row = await this._db.get(getNextFrameIdByContinueSql, {
      $fId: this._frame.fId,
    });

    // End session if theres no next row.
    if (row === undefined) {
      // this.sendEvent("end");
      return;
    }

    await this.jumpToFrame(row.f_id);
    this.sendEvent("stopOnStep");
    return;
  }

  public async reverseContinue() {
    // Cannot step back from first frame.
    if (!this._frame || this._frame.fId === 1) {
      return;
    }

    const getNextFrameIdByContinueSql = `
      WITH 
        breakpoints(filename, lineno) AS (VALUES ${this.getBreakpointsAsSqlValues()}),
        backward_frames(f_id, f_filename, f_lineno, f_back_id) AS (SELECT f_id, f_filename, f_lineno, f_back_id FROM frames WHERE f_id < $fId),
        first_frame(f_id) AS (SELECT f_id FROM frames ORDER BY f_id LIMIT 1)
      SELECT f_id FROM (
        SELECT f_id FROM first_frame
        UNION
        SELECT f_id FROM backward_frames, breakpoints
        WHERE f_filename = breakpoints.filename AND f_lineno = breakpoints.lineno)
      ORDER BY f_id DESC
      LIMIT 1
    `;

    const row = await this._db.get(getNextFrameIdByContinueSql, {
      $fId: this._frame.fId,
    });

    // End session if theres no next row.
    if (row === undefined) {
      // this.sendEvent("end");
      return;
    }

    await this.jumpToFrame(row.f_id);
    this.sendEvent("stopOnStep");
    return;
  }

  private async jumpToFrame(frameId: number): Promise<void> {
    // Cannot jump past last frame
    const fId = Math.min(this._lastFId + 1, frameId);
    if (fId > this._lastFId) {
      return;
    }

    const getFrameByIdSql = `select * from frames where f_id = $fId`;
    const row = await this._db.get(getFrameByIdSql, { $fId: fId });
    this._frame = GoetFrame.fromRow(row);
  }

  public async step() {
    // Handle first step
    if (!this._frame) {
      await this.jumpToFrame(1);
      this.sendEvent("stopOnStep");
      return;
    }

    const getNextFrameIdByStepSql = `
      WITH 
        breakpoints(filename, lineno) AS (VALUES ${this.getBreakpointsAsSqlValues()}),
        forward_frames(f_id, f_filename, f_lineno, f_back_id) AS (SELECT f_id, f_filename, f_lineno, f_back_id FROM frames WHERE f_id > $fId)
      SELECT f_id FROM (
        SELECT f_id FROM forward_frames
        WHERE f_back_id <= $fBackId
        UNION
        SELECT f_id FROM forward_frames, breakpoints
        WHERE f_filename = breakpoints.filename AND f_lineno = breakpoints.lineno)
      ORDER BY f_id
      LIMIT 1
    `;

    const row = await this._db.get(getNextFrameIdByStepSql, {
      $fId: this._frame.fId,
      $fBackId: this._frame.fBackId,
    });

    // End session if theres no next row.
    if (row === undefined) {
      // this.sendEvent("end");
      return;
    }

    await this.jumpToFrame(row.f_id);
    this.sendEvent("stopOnStep");
    return;
  }

  public async stepBack(event = "stopOnStep"): Promise<void> {
    // Cannot step back from first frame.
    if (!this._frame || this._frame.fId === 1) {
      return;
    }

    const getPrevFrameIdByStepSql = `
      WITH 
        breakpoints(filename, lineno) AS (VALUES ${this.getBreakpointsAsSqlValues()}),
        backward_frames(f_id, f_filename, f_lineno, f_back_id) AS (SELECT f_id, f_filename, f_lineno, f_back_id FROM frames WHERE f_id < $fId)
      SELECT f_id FROM (
        SELECT f_id FROM backward_frames
        WHERE f_back_id <= $fBackId
        UNION
        SELECT f_id FROM backward_frames, breakpoints
        WHERE f_filename = breakpoints.filename AND f_lineno = breakpoints.lineno)
      ORDER BY f_id DESC
      LIMIT 1
    `;

    const row = await this._db.get(getPrevFrameIdByStepSql, {
      $fId: this._frame.fId,
      $fBackId: this._frame.fBackId,
    });

    // Cannot step back from first frame.
    if (row === undefined) {
      console.error(
        "Expected fn to early exit before trying to run `stepBack` on first frame."
      );
      return;
    }

    await this.jumpToFrame(row.f_id);
    this.sendEvent("stopOnStep");
    return;
  }

  /**
   * "Step into" for RDB debug means: go to next character
   */
  public async stepIn() {
    // Stepping past last frame ends the debugging session.
    if (this._frame?.fId === this._lastFId) {
      // this.sendEvent("end");
      return;
    }

    const fId = (this._frame?.fId ?? 0) + 1;
    await this.jumpToFrame(fId);
    this.sendEvent("stopOnStep");
  }

  /**
   * "Step out" for RDB debug means: go to previous character
   */
  public async stepOut() {
    // Cannot step out to the 0th frame.
    if (!this._frame || this._frame.fBackId === 0) {
      return;
    }

    const getPrevFrameIdByStepOutSql = `
      SELECT f_id FROM frames
      WHERE f_id < $fId AND (f_back_id < $fBackId OR f_back_id IS NULL)
      ORDER BY f_id DESC
      LIMIT 1
    `;

    const row = await this._db.get(getPrevFrameIdByStepOutSql, {
      $fId: this._frame.fId,
      $fBackId: this._frame.fBackId,
    });

    // Cannot step back from first frame.
    if (row === undefined) {
      console.error(
        "Expected fn to early exit before trying to run `stepOut` on first frame."
      );
      return;
    }

    await this.jumpToFrame(row.f_id);
    this.sendEvent("stopOnStep");
    return;
  }

  private isObjectOrArrayWithContent(item) {
    return (
      typeof item === "object" && item !== null && Object.keys(item).length > 0
    );
  }

  public async scopes(frameId: number): Promise<Scope[]> {
    const getFrameByIdSql = `
    SELECT * FROM frames
    WHERE f_id = $fId`;

    const row = await this._db.get(getFrameByIdSql, {
      $fId: frameId,
    });
    const frame = GoetFrame.fromRow(row);
    return [
      new Scope(
        `frame_${frame.fId}_locals`,
        this._variableHandles.create(JSON.stringify(frame.fLocals))
      ),
    ];
  }

  public async variables(variablesReference: number): Promise<Variable[]> {
    const variablesJson = this._variableHandles.get(variablesReference);
    if (!variablesJson) {
      return [];
    }

    const variables = JSON.parse(variablesJson);

    return Object.entries(variables).map(([key, val]) => {
      const ref = this.isObjectOrArrayWithContent(val)
        ? this._variableHandles.create(JSON.stringify(val))
        : 0;
      return new Variable(key, JSON.stringify(val), ref);
    });
  }

  public async stack2(): Promise<IStack> {
    if (!this._frame) {
      return { frames: [], count: 0 };
    }

    const stacktraceSql = `
    WITH RECURSIVE
    stacktrace(f) AS (
        VALUES($fBackId)
        UNION ALL
        SELECT f_back_id FROM frames, stacktrace
        WHERE frames.f_id = stacktrace.f
    )
    SELECT * FROM frames
    WHERE f_id IN stacktrace
    ORDER BY f_back_ID DESC;`;

    const rows = await this._db.all(stacktraceSql, {
      $fBackId: this._frame.fBackId,
    });
    const frames = [this._frame, ...rows.map(GoetFrame.fromRow)];
    return {
      frames: frames.map((f) => f.toStackFrame()),
      count: frames.length,
    };
  }

  /**
   * Returns a stacktrace, starting at `this._frame`
   */
  public async stack(startFrame: number, endFrame: number): Promise<IStack> {
    const words = this._sourceLines[this._currentLine].trim().split(/\s+/);

    const frames = new Array<IStackFrame>();
    // every word of the current line becomes a stack frame.
    for (let i = startFrame; i < Math.min(endFrame, words.length); i++) {
      const name = words[i]; // use a word of the line as the stackframe name
      const stackFrame: IStackFrame = {
        index: i,
        name: `${name}(${i})`,
        file: this._sourceFile,
        line: this._currentLine,
      };
      if (typeof this._currentColumn === "number") {
        stackFrame.column = this._currentColumn;
      }
      frames.push(stackFrame);
    }
    return {
      frames: frames,
      count: words.length,
    };
  }

  public getBreakpoints(path: string, line: number): number[] {
    const l = this._sourceLines[line];

    let sawSpace = true;
    const bps: number[] = [];
    for (let i = 0; i < l.length; i++) {
      if (l[i] !== " ") {
        if (sawSpace) {
          bps.push(i);
          sawSpace = false;
        }
      } else {
        sawSpace = true;
      }
    }

    return bps;
  }

  /*
   * Set breakpoint in file with given line.
   */
  public async setBreakPoint(
    path: string,
    line: number
  ): Promise<IRDBBreakpoint> {
    const bp: IRDBBreakpoint = {
      verified: true,
      line,
      id: this._breakpointId++,
    };
    let bps = this._breakPoints.get(path);
    if (!bps) {
      bps = new Array<IRDBBreakpoint>();
      this._breakPoints.set(path, bps);
    }
    bps.push(bp);

    return bp;
  }

  /*
   * Clear breakpoint in file with given line.
   */
  public clearBreakPoint(
    path: string,
    line: number
  ): IRDBBreakpoint | undefined {
    const bps = this._breakPoints.get(path);
    if (bps) {
      const index = bps.findIndex((bp) => bp.line === line);
      if (index >= 0) {
        const bp = bps[index];
        bps.splice(index, 1);
        return bp;
      }
    }
    return undefined;
  }

  /*
   * Clear all breakpoints for file.
   */
  public clearBreakpoints(path: string): void {
    this._breakPoints.delete(path);
  }

  /*
   * Set data breakpoint.
   */
  public setDataBreakpoint(address: string): boolean {
    if (address) {
      this._breakAddresses.add(address);
      return true;
    }
    return false;
  }

  // public setExceptionsFilters(
  //   namedException: string | undefined,
  //   otherExceptions: boolean
  // ): void {
  //   this._namedException = namedException;
  //   this._otherExceptions = otherExceptions;
  // }

  /*
   * Clear all data breakpoints.
   */
  public clearAllDataBreakpoints(): void {
    this._breakAddresses.clear();
  }

  // private methods

  private async loadSource(file: string): Promise<void> {
    if (this._sourceFile !== file) {
      this._sourceFile = file;
      const contents = await this._fileAccessor.readFile(file);
      this._sourceLines = contents.split(/\r?\n/);
    }
  }

  /**
   * Run through the file.
   * If stepEvent is specified only run a single step and emit the stepEvent.
   */
  // private run(stepEvent?: string) {
  //   for (let ln = this._currentLine + 1; ln < this._sourceLines.length; ln++) {
  //     if (this.fireEventsForLine(ln, stepEvent)) {
  //       this._currentLine = ln;
  //       this._currentColumn = undefined;
  //       return true;
  //     }
  //   }
  //   // no more lines: run to end
  //   // this.sendEvent("end");
  // }

  // private reverseRun(stepEvent?: string) {
  //   for (let ln = this._currentLine - 1; ln >= 0; ln--) {
  //     if (this.fireEventsForLine(ln, stepEvent)) {
  //       this._currentLine = ln;
  //       this._currentColumn = undefined;
  //       return;
  //     }
  //   }
  //   // no more lines: stop at first line
  //   this._currentLine = 0;
  //   this._currentColumn = undefined;
  //   this.sendEvent("stopOnEntry");
  // }

  /**
   * Fire events if line has a breakpoint or the word 'exception' or 'exception(...)' is found.
   * Returns true if execution needs to stop.
   */
  // private fireEventsForLine(ln: number, stepEvent?: string): boolean {
  //   if (this._noDebug) {
  //     return false;
  //   }

  //   const line = this._sourceLines[ln].trim();

  //   // if 'log(...)' found in source -> send argument to debug console
  //   const matches = /log\((.*)\)/.exec(line);
  //   if (matches && matches.length === 2) {
  //     this.sendEvent("output", matches[1], this._sourceFile, ln, matches.index);
  //   }

  //   // if a word in a line matches a data breakpoint, fire a 'dataBreakpoint' event
  //   const words = line.split(" ");
  //   for (const word of words) {
  //     if (this._breakAddresses.has(word)) {
  //       this.sendEvent("stopOnDataBreakpoint");
  //       return true;
  //     }
  //   }

  //   // if pattern 'exception(...)' found in source -> throw named exception
  //   const matches2 = /exception\((.*)\)/.exec(line);
  //   if (matches2 && matches2.length === 2) {
  //     const exception = matches2[1].trim();
  //     if (this._namedException === exception) {
  //       this.sendEvent("stopOnException", exception);
  //       return true;
  //     } else {
  //       if (this._otherExceptions) {
  //         this.sendEvent("stopOnException", undefined);
  //         return true;
  //       }
  //     }
  //   } else {
  //     // if word 'exception' found in source -> throw exception
  //     if (line.indexOf("exception") >= 0) {
  //       if (this._otherExceptions) {
  //         this.sendEvent("stopOnException", undefined);
  //         return true;
  //       }
  //     }
  //   }

  //   // is there a breakpoint?
  //   const breakpoints = this._breakPoints.get(this._sourceFile);
  //   if (breakpoints) {
  //     const bps = breakpoints.filter((bp) => bp.line === ln);
  //     if (bps.length > 0) {
  //       // send 'stopped' event
  //       this.sendEvent("stopOnBreakpoint");

  //       // the following shows the use of 'breakpoint' events to update properties of a breakpoint in the UI
  //       // if breakpoint is not yet verified, verify it now and send a 'breakpoint' update event
  //       if (!bps[0].verified) {
  //         bps[0].verified = true;
  //         this.sendEvent("breakpointValidated", bps[0]);
  //       }
  //       return true;
  //     }
  //   }

  //   // non-empty line
  //   if (stepEvent && line.length > 0) {
  //     this.sendEvent(stepEvent);
  //     return true;
  //   }

  //   // nothing interesting found -> continue
  //   return false;
  // }

  private sendEvent(event: string, ...args: any[]) {
    setImmediate((_) => {
      this.emit(event, ...args);
    });
  }

  /**
   * Returns breakpoints as a SQL `values` construct.
   *
   * @example
   * >> getBreakpointsAsSqlValues()
   * (('/Users/vivek/filename.py', 7), ('/Users/vivek/filename.py', 8))
   *
   * // In SQL
   * `SELECT * FROM (VALUES ${this.getBreakpointsAsSqlValues()})`
   */
  private getBreakpointsAsSqlValues(): string {
    if (this._breakPoints.size === 0) {
      return `'', ''`;
    }
    return Array.from(this._breakPoints.entries())
      .map(([filename, breakpoints]) =>
        breakpoints.map(({ line }) => `('${filename}', ${line})`)
      )
      .reduce((acc, x) => acc.concat(x), [])
      .join(", ");
  }
}
