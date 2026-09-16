"use client";

import { useEffect } from "react";

let lockCount = 0;
let safetyBound = false;

function isBrowser() {
  return typeof document !== "undefined";
}

function clearOverflow() {
  if (!isBrowser()) return;
  document.documentElement.style.overflow = "";
  document.body.style.overflow = "";
}

function applyOverflowLock() {
  if (!isBrowser()) return;
  document.documentElement.style.overflow = "hidden";
  document.body.style.overflow = "hidden";
}

export function forceUnlockBodyScrollIfIdle() {
  if (lockCount > 0) return;
  clearOverflow();
}

function bindSafetyListeners() {
  if (safetyBound || typeof window === "undefined") return;
  safetyBound = true;

  window.addEventListener("pageshow", (event) => {
    if (!event.persisted) return;
    lockCount = 0;
    clearOverflow();
  });

  document.addEventListener("visibilitychange", () => {
    if (document.visibilityState === "visible") {
      forceUnlockBodyScrollIfIdle();
    }
  });
}

export function lockBodyScroll() {
  bindSafetyListeners();
  if (lockCount === 0) applyOverflowLock();
  lockCount += 1;

  return () => {
    lockCount = Math.max(0, lockCount - 1);
    if (lockCount === 0) clearOverflow();
  };
}

export function useBodyScrollLock(active: boolean) {
  useEffect(() => {
    bindSafetyListeners();
    if (!active) return;
    return lockBodyScroll();
  }, [active]);
}

export function BodyScrollLockGuard() {
  useEffect(() => {
    bindSafetyListeners();
    forceUnlockBodyScrollIfIdle();
  }, []);

  return null;
}
