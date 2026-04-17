/**
 * V2 Razorpay checkout flow.
 * 
 * Full flow:
 *   1. Call paymentsApi.createOrder() → get Razorpay order_id + payment_record_id
 *   2. Open Razorpay checkout modal
 *   3. On success, call paymentsApi.verify() → grants access in DB
 */

import { paymentsApi } from "@/lib/api";

export type RazorpaySuccessResponse = {
  razorpay_order_id: string;
  razorpay_payment_id: string;
  razorpay_signature: string;
};

type RazorpayFailureResponse = {
  error?: {
    description?: string;
    reason?: string;
    source?: string;
    step?: string;
    code?: string;
  };
};

type RazorpayInstance = {
  open: () => void;
  on: (event: "payment.failed", handler: (response: RazorpayFailureResponse) => void) => void;
};

export type RazorpayOptions = {
  key: string;
  amount: number;
  currency: string;
  name: string;
  description: string;
  order_id: string;
  prefill?: Record<string, string>;
  notes?: Record<string, string>;
  theme?: { color?: string };
  modal?: { ondismiss?: () => void };
  handler: (response: RazorpaySuccessResponse) => void | Promise<void>;
};

declare global {
  interface Window {
    Razorpay?: new (options: RazorpayOptions) => RazorpayInstance;
  }
}

let razorpayLoader: Promise<void> | null = null;

export function loadRazorpayCheckout(): Promise<void> {
  if (typeof window === "undefined") {
    return Promise.reject(new Error("Razorpay checkout is only available in the browser."));
  }
  if (window.Razorpay) return Promise.resolve();
  if (razorpayLoader) return razorpayLoader;

  razorpayLoader = new Promise<void>((resolve, reject) => {
    const existing = document.querySelector<HTMLScriptElement>('script[data-razorpay-checkout="true"]');
    if (existing) {
      existing.addEventListener("load", () => resolve(), { once: true });
      existing.addEventListener("error", () => reject(new Error("Failed to load Razorpay checkout.")), { once: true });
      return;
    }
    const script = document.createElement("script");
    script.src = "https://checkout.razorpay.com/v1/checkout.js";
    script.async = true;
    script.dataset.razorpayCheckout = "true";
    script.onload = () => resolve();
    script.onerror = () => reject(new Error("Failed to load Razorpay checkout."));
    document.body.appendChild(script);
  }).catch((err) => {
    razorpayLoader = null;
    throw err;
  });

  return razorpayLoader;
}

// ── Full V2 purchase flow ─────────────────────────────────────────────────────

export type PurchaseItemType = "test_series" | "premium_collection" | "subscription_plan";

export interface InitiatePurchaseOptions {
  item_type: PurchaseItemType;
  item_id: number | string;
  /** Display name in Razorpay modal */
  name: string;
  description: string;
  /** User email for prefill */
  user_email?: string;
  user_name?: string;
  user_phone?: string;
  /** Called on successful payment + backend verification */
  onSuccess: (payment_id: number) => void;
  /** Called if user dismisses or payment fails */
  onError?: (message: string) => void;
}

/**
 * Full purchase flow:
 *  createOrder (backend) → open Razorpay → verify (backend) → onSuccess
 */
export async function initiatePurchase(opts: InitiatePurchaseOptions): Promise<void> {
  // 1. Create order via new backend
  const order = await paymentsApi.createOrder({
    item_type: opts.item_type,
    item_id: opts.item_id,
  });

  // 2. Load Razorpay script
  await loadRazorpayCheckout();

  if (!window.Razorpay) {
    opts.onError?.("Razorpay failed to load. Please refresh and try again.");
    return;
  }

  // 3. Open checkout modal
  const rzp = new window.Razorpay({
    key: order.key_id,
    amount: order.amount,
    currency: order.currency,
    name: opts.name,
    description: opts.description,
    order_id: order.order_id,
    prefill: {
      email: opts.user_email ?? "",
      name: opts.user_name ?? "",
      contact: opts.user_phone ?? "",
    },
    theme: { color: "#6366f1" },
    modal: {
      ondismiss: () => opts.onError?.("Payment cancelled"),
    },
    handler: async (response: RazorpaySuccessResponse) => {
      // 4. Verify with backend → grants access in DB
      try {
        const result = await paymentsApi.verify({
          razorpay_order_id: response.razorpay_order_id,
          razorpay_payment_id: response.razorpay_payment_id,
          razorpay_signature: response.razorpay_signature,
          payment_record_id: order.payment_record_id,
        });
        opts.onSuccess(result.payment_id);
      } catch {
        opts.onError?.("Payment succeeded but verification failed. Please contact support.");
      }
    },
  });

  rzp.on("payment.failed", (resp: RazorpayFailureResponse) => {
    opts.onError?.(resp.error?.description ?? "Payment failed");
  });

  rzp.open();
}
