// Errors-as-values helper used across the gateway: business logic returns a
// discriminated Result instead of throwing (SKILL_GENERAL.md section 5).
export type Result<ValueType, ReasonType = string> =
  | { ok: true; value: ValueType }
  | { ok: false; reason: ReasonType };

export const ok = <ValueType>(value: ValueType): { ok: true; value: ValueType } => ({
  ok: true,
  value,
});

export const err = <ReasonType = string>(reason: ReasonType): { ok: false; reason: ReasonType } => ({
  ok: false,
  reason,
});
