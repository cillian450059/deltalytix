import 'server-only'

import Stripe from "stripe";

// Lazy-init to prevent build-time crash when STRIPE_SECRET_KEY is not set
let _stripe: Stripe | null = null
export function getStripe(): Stripe {
  if (!_stripe) {
    _stripe = new Stripe(process.env.STRIPE_SECRET_KEY as string, {
      apiVersion: "2025-10-29.clover",
    })
  }
  return _stripe
}

// Keep backward-compat export (safe because server-only, never called at module-eval time)
export const stripe: Stripe = new Proxy({} as Stripe, {
  get(_target, prop) {
    return (getStripe() as any)[prop]
  },
})