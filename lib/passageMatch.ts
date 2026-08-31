/**
 * 지문이 같은 문제인지 보는 규칙. 한곳에만 둔다.
 *
 * 예전에는 store.ts(병합)와 parseReview.ts(중복 배지)에 같은 판정이 따로 적혀 있었고,
 * 주석에 "규칙을 바꿀 일이 생기면 두 곳을 함께 고쳐야 한다"고 쓰여 있었다. 한쪽만 고치면
 * 병합은 되는데 배지는 안 붙는(또는 그 반대) 상태가 되므로 아예 갈라지지 않게 모았다.
 *
 * pools.ts 의 fingerprintOf 는 여기 오지 않는다. 그 해시는 이미 Firestore 에 저장돼 있어
 * 정규화를 바꾸면 지금까지 발행된 문제집의 지문 지문이 전부 어긋난다.
 */

// 시험지마다 붙는 상투구 괄호. 이것만 지운다.
// 괄호를 전부 지우면 "(2020년 개정 기준)"처럼 문제를 가르는 조건까지 사라져
// 서로 다른 문제가 같아 보인다 — 글자를 지우는 정규화는 여기까지가 한계다
const BOILERPLATE_PAREN = /[(（][^)）]*(?:다툼|판례|이견|통설|학설)[^)）]*[)）]/g

// 끝에서 열리기만 하고 닫히지 않은 괄호. 청크 경계가 괄호 안을 지나면 생기는 조각이다.
// 이것을 남겨두면 잘린 판본이 "…옳은 것은? (다툼이"로 끝나 온전한 판본의 앞부분이 아니게 되고,
// 접두어 병합이 깨진다 — 상투구 괄호를 지우기 시작하면서 새로 생긴 자리다
const DANGLING_PAREN = /[(（][^)）]*$/

/**
 * 비교용 정규화. 공백을 '줄이지' 않고 전부 없앤다.
 *
 * 예전에는 여러 공백을 하나로 줄이기만 해서, OCR 이 띄어쓰기 하나를 놓치면
 * ("자신의 X토지" → "자신의X토지") 다른 문자열이 되어 같은 문제가 두 번 저장됐다.
 *
 * 글자 자체는 절대 건드리지 않는다. "3년"을 "5년"과 같게 만드는 정규화는 금지다 —
 * 법 문제는 한 글자가 정답을 뒤집는다
 */
export function normalizePassage(passage: string): string {
  return passage.replace(BOILERPLATE_PAREN, '').replace(DANGLING_PAREN, '').replace(/\s+/g, '')
}

// 청크 경계에서 잘린 판본을 온전한 판본과 잇기 위한 하한.
// 이보다 짧은 조각은 우연히 앞부분이 겹칠 수 있어 접두어 비교를 하지 않는다
export const MIN_PASSAGE_FOR_PREFIX = 40

/** 두 지문이 같은 문제의 것인가. 완전 일치이거나, 짧은 쪽이 긴 쪽의 앞부분이면 같다 */
export function isSamePassage(a: string, b: string): boolean {
  const pa = normalizePassage(a)
  const pb = normalizePassage(b)
  if (pa === pb) return true
  const [shorter, longer] = pa.length <= pb.length ? [pa, pb] : [pb, pa]
  return shorter.length >= MIN_PASSAGE_FOR_PREFIX && longer.startsWith(shorter)
}

/**
 * 편집 거리. cap 을 넘는 것이 확실해지면 즉시 그만두고 cap+1 을 돌려준다.
 * 정확한 거리가 필요한 게 아니라 "가까운가"만 보면 되므로, 먼 쌍에 시간을 쓰지 않는다
 */
export function editDistance(a: string, b: string, cap: number): number {
  if (Math.abs(a.length - b.length) > cap) return cap + 1
  let prev = Array.from({ length: b.length + 1 }, (_, j) => j)
  for (let i = 1; i <= a.length; i++) {
    const cur: number[] = [i]
    let rowMin = i
    for (let j = 1; j <= b.length; j++) {
      cur[j] = Math.min(prev[j] + 1, cur[j - 1] + 1, prev[j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1))
      if (cur[j] < rowMin) rowMin = cur[j]
    }
    if (rowMin > cap) return cap + 1
    prev = cur
  }
  return prev[b.length]
}

/**
 * 이 길이의 지문에서 "가깝다"고 볼 편집 거리의 상한.
 *
 * 고정값을 쓰면 안 된다. 2글자는 300자 지문에서 0.7%지만 15자 지문에서는 13%다 —
 * 짧은 지문일수록 한두 글자가 문제 전체를 가른다("가능/불가능", "甲/乙").
 * 그래서 길이에 비례시키되, 아주 짧은 지문에도 최소한의 여지는 두고(2),
 * 아주 긴 지문에서 후보가 무한정 늘어나지 않게 상한을 둔다(12)
 */
export function nearThreshold(length: number): number {
  return Math.min(12, Math.max(2, Math.round(length * 0.1)))
}

/**
 * 두 지문이 '비슷한가'. 같다고 판정되는 것은 여기 오지 않는다 —
 * 이미 병합되므로 후보로 보여줄 이유가 없다.
 *
 * 여기서 참이어도 **자동으로 합치지 않는다.** "상계/예약"(거리 2)이나
 * "동시이행/물권"(거리 4)처럼 가까우면서 전혀 다른 문제가 실제로 있다.
 * 후보를 좁히는 데만 쓰고 판단은 사람이 한다
 */
export function passageDistance(a: string, b: string): number | null {
  const pa = normalizePassage(a)
  const pb = normalizePassage(b)
  if (pa.length === 0 || pb.length === 0) return null
  const cap = nearThreshold(Math.min(pa.length, pb.length))
  const d = editDistance(pa, pb, cap)
  return d <= cap ? d : null
}
