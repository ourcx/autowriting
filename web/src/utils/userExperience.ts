export type GuidePage = "dashboard" | "editor" | "publish"

const GUIDE_VERSION = "v2"
const SETUP_VERSION = "v1"

function scopedKey(prefix: string, userId: string, suffix: string): string {
  return `dashy:${prefix}:${userId}:${suffix}`
}

export function getFirstSetupKey(userId: string): string {
  return scopedKey("first-setup", userId, SETUP_VERSION)
}

export function hasCompletedFirstSetup(userId: string): boolean {
  return localStorage.getItem(getFirstSetupKey(userId)) === "complete"
}

export function completeFirstSetup(userId: string): void {
  localStorage.setItem(getFirstSetupKey(userId), "complete")
}

export function getSetupSessionKey(userId: string): string {
  return scopedKey("first-setup-session", userId, SETUP_VERSION)
}

export function getGuideKey(userId: string, page: GuidePage): string {
  return scopedKey("guide", userId, `${GUIDE_VERSION}:${page}`)
}

export function hasCompletedGuide(userId: string, page: GuidePage): boolean {
  return localStorage.getItem(getGuideKey(userId, page)) === "complete"
}

export function completeGuide(userId: string, page: GuidePage): void {
  localStorage.setItem(getGuideKey(userId, page), "complete")
}
