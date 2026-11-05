// ============================================================
// Turn claim：只允许当前 generation 的 turn 提交一次终结状态
// 对照 Grok TurnReportSlot 的 Free/Held/Reported 与 epoch 校验
// ============================================================

export type TurnClaimKind = "report" | "gate";

export interface TurnClaimToken {
  epoch: number;
  runId: string;
  turnId: string;
  /** 独立 claim id：同一 turn 的槽位持有者可被审计/去重。 */
  claimId: string;
}

interface ActiveClaim {
  epoch: number;
  runId: string;
  turnId: string;
  claimId: string;
  reported: boolean;
  held: boolean;
  released: boolean;
}

export class TurnClaimRegistry {
  private epoch = 0;
  private claimSeq = 0;
  private active: ActiveClaim | null = null;

  begin(runId: string, turnId: string): TurnClaimToken {
    const epoch = ++this.epoch;
    const claimId = `${epoch}:${++this.claimSeq}`;
    this.active = {
      epoch,
      runId,
      turnId,
      claimId,
      reported: false,
      held: false,
      released: false,
    };
    return { epoch, runId, turnId, claimId };
  }

  private matches(active: ActiveClaim, token: TurnClaimToken): boolean {
    return (
      active.epoch === token.epoch &&
      active.runId === token.runId &&
      active.turnId === token.turnId &&
      active.claimId === token.claimId
    );
  }

  /** 取得槽位：Free → Held；只有当前 epoch/run/turn/claimId 且未释放、未报告时成功。 */
  tryClaim(token: TurnClaimToken, _kind: TurnClaimKind = "report"): boolean {
    const active = this.active;
    if (!active || active.released || active.reported || active.held) return false;
    if (!this.matches(active, token)) return false;
    active.held = true;
    return true;
  }

  /** 一次性提交：Held/Free → Reported；重复提交或旧 token 返回 false。 */
  commit(token: TurnClaimToken, _kind: TurnClaimKind = "report"): boolean {
    const active = this.active;
    if (!active || active.released || active.reported) return false;
    if (!this.matches(active, token)) return false;
    active.held = false;
    active.reported = true;
    return true;
  }

  release(token: TurnClaimToken): void {
    const active = this.active;
    if (!active) return;
    if (this.matches(active, token)) {
      active.released = true;
      this.active = null;
    }
  }

  currentEpoch(): number {
    return this.epoch;
  }

  /** 诊断：当前槽位是否被持有/已报告。 */
  inspect(): { held: boolean; reported: boolean; claimId: string | null } {
    return {
      held: Boolean(this.active?.held),
      reported: Boolean(this.active?.reported),
      claimId: this.active?.claimId ?? null,
    };
  }
}