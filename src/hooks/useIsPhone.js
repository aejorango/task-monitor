// src/hooks/useIsPhone.js — is this a phone-width screen (≤720px)?
//
// At that width the app renders the phone app (src/mobile) instead of the
// desktop shell. 720px is the breakpoint the desktop shell already collapsed
// its rail at, so nothing between the two is left to a third layout.

import { useEffect, useState } from 'react';

export const PHONE_QUERY = '(max-width: 720px)';

function matches() {
  return typeof window !== 'undefined' && !!window.matchMedia?.(PHONE_QUERY).matches;
}

export function useIsPhone() {
  const [phone, setPhone] = useState(matches);
  useEffect(() => {
    const mq = window.matchMedia?.(PHONE_QUERY);
    if (!mq) return undefined;
    const on = () => setPhone(mq.matches);
    on();
    mq.addEventListener?.('change', on);
    return () => mq.removeEventListener?.('change', on);
  }, []);
  return phone;
}
