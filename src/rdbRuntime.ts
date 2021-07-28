import { EventEmitter } from "events";
import { Database as sql3Driver } from "sqlite3";
import { Database, open } from "sqlite";
import { Handles, Scope, Variable } from "vscode-debugadapter";

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
    public fBackId: number | null,
    public fFilename: string,
    public fFuncname: string,
    public fLocals: { [key: string]: any },
    public fLineno: number
  ) {}

  static fromRow(row: any): GoetFrame {
    return new GoetFrame(
      row.f_id,
      row.f_back_id,
      row.f_filename,
      row.f_funcname,
      JSON.parse(row.f_locals),
      row.f_lineno
    );
  }

  toStackFrame(): IStackFrame {
    return {
      index: this.fId,
      name: `${this.fFuncname} (${this.fLineno})`,
      file: this.fFilename,
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
  // private _sourceLines: string[] = [];

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

  constructor(private _dbPath: string) {
    super();
  }

  /**
   * Start executing the given program.
   */
  public async start(): Promise<void> {
    // this._noDebug = noDebug;

    this._db = await open({
      filename: this._dbPath,
      driver: sql3Driver,
    });

    const row = await this._db.get("select max(f_id) from frames");
    this._lastFId = row["max(f_id)"];

    // step once at the beginning
    await this.step();
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
      $fBackId: this._frame.fBackId ?? 0,
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
      $fBackId: this._frame.fBackId ?? 0,
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
    if (!this._frame || !this._frame.fBackId) {
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
      $fBackId: this._frame.fBackId ?? 0,
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

  // TODO: ADD FUNCTION NAME TO FRAME `f_code.co_name`
  // TODO: ADD FUNCTION NAME TO FRAME `f_code.co_name`
  // TODO: ADD FUNCTION NAME TO FRAME `f_code.co_name`
  // TODO: ADD FUNCTION NAME TO FRAME `f_code.co_name`
  // TODO: ADD FUNCTION NAME TO FRAME `f_code.co_name`

  public async stack(): Promise<IStack> {
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
      $fBackId: this._frame.fBackId ?? 0,
    });
    const frames = [this._frame, ...rows.map(GoetFrame.fromRow)];
    return {
      frames: frames.map((f) => f.toStackFrame()),
      count: frames.length,
    };
  }

  // public getBreakpoints(path: string, line: number): number[] {
  //   const l = this._sourceLines[line];

  //   let sawSpace = true;
  //   const bps: number[] = [];
  //   for (let i = 0; i < l.length; i++) {
  //     if (l[i] !== " ") {
  //       if (sawSpace) {
  //         bps.push(i);
  //         sawSpace = false;
  //       }
  //     } else {
  //       sawSpace = true;
  //     }
  //   }

  //   return bps;
  // }

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

  /*
   * Clear all data breakpoints.
   */
  public clearAllDataBreakpoints(): void {
    this._breakAddresses.clear();
  }

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
      return `('', -1)`;
    }
    return Array.from(this._breakPoints.entries())
      .map(([filename, breakpoints]) =>
        breakpoints.map(({ line }) => `('${filename}', ${line})`)
      )
      .reduce((acc, x) => acc.concat(x), [])
      .join(", ");
  }
}
