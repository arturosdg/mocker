// Marcas de escenario: un mock con `sets` activa marcas al casar, y otros
// mocks del mismo escenario cambian según ellas — `when`/`unless` a nivel de
// mock deciden si casa, `$when`/`$unless` dentro de un objeto de un array del
// response deciden si ese elemento sale. Las marcas viven en
// chrome.storage.session por escenario y se borran al activarlo.

export type FlagList = string | string[] | undefined

export type ScenarioFlags = Record<string, string[]>

export const FLAGS_KEY = 'flags'

export function toFlagList(value: FlagList): string[] {
  if (value === undefined || value === null) return []
  return (Array.isArray(value) ? value : [value]).map(String)
}

export function conditionsMet(
  when: FlagList,
  unless: FlagList,
  flags: readonly string[],
): boolean {
  const required = toFlagList(when)
  const excluded = toFlagList(unless)
  return (
    required.every((flag) => flags.includes(flag)) &&
    !excluded.some((flag) => flags.includes(flag))
  )
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

// Recorre el response: quita las claves $when/$unless y descarta los
// elementos de array cuyas condiciones no se cumplen.
export function applyItemConditions(
  value: unknown,
  flags: readonly string[],
): unknown {
  if (Array.isArray(value)) {
    return value
      .filter(
        (item) =>
          !isPlainObject(item) ||
          conditionsMet(
            item.$when as FlagList,
            item.$unless as FlagList,
            flags,
          ),
      )
      .map((item) => applyItemConditions(item, flags))
  }
  if (isPlainObject(value)) {
    const result: Record<string, unknown> = {}
    for (const [key, child] of Object.entries(value)) {
      if (key === '$when' || key === '$unless') continue
      result[key] = applyItemConditions(child, flags)
    }
    return result
  }
  return value
}

export function addFlags(
  current: ScenarioFlags,
  scenarioId: string,
  added: readonly string[],
): ScenarioFlags {
  const existing = current[scenarioId] ?? []
  const merged = [...existing, ...added.filter((flag) => !existing.includes(flag))]
  if (merged.length === existing.length) return current
  return { ...current, [scenarioId]: merged }
}

export function removeScenarioFlags(
  current: ScenarioFlags,
  scenarioIds: readonly string[],
): ScenarioFlags {
  if (!scenarioIds.some((id) => id in current)) return current
  const result = { ...current }
  for (const id of scenarioIds) delete result[id]
  return result
}
