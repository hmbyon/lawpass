// 관리자 계정 판별. settings-modal과 app-shell이 공유한다
export const ADMIN_EMAIL = 'hmbyon97@gmail.com'

export function isAdminEmail(email: string | null | undefined): boolean {
  return email === ADMIN_EMAIL
}
