import { createHmac, timingSafeEqual } from "node:crypto";
import type { BillingPlan } from "@/lib/types";

const stripeApiBase = "https://api.stripe.com/v1";

export type StripeCheckoutSession = {
  id: string;
  url: string | null;
};
export type StripePortalSession = {
  id: string;
  url: string;
};
export type StripeWebhookEvent = {
  id: string;
  type: string;
  data: {
    object: StripeEventObject;
  };
};
export type StripeEventObject = {
  customer?: string;
  id?: string;
  metadata?: Record<string, string | undefined>;
  mode?: string;
  status?: string;
  subscription?: string;
  items?: {
    data?: Array<{
      price?: {
        id?: string;
      };
    }>;
  };
};

export function isStripeConfigured() {
  return Boolean(process.env.STRIPE_SECRET_KEY);
}

export async function createCheckoutSession(input: {
  businessId: string;
  customerEmail: string;
  customerId?: string | null;
  planId: BillingPlan["id"];
  priceId: string;
  returnUrl: string;
}) {
  const params = new URLSearchParams({
    mode: "subscription",
    success_url: `${input.returnUrl}?billing=success`,
    cancel_url: `${input.returnUrl}?billing=cancelled`,
    "line_items[0][price]": input.priceId,
    "line_items[0][quantity]": "1",
    "metadata[businessId]": input.businessId,
    "metadata[planId]": input.planId,
    "subscription_data[metadata][businessId]": input.businessId,
    "subscription_data[metadata][planId]": input.planId,
  });

  if (input.customerId) {
    params.set("customer", input.customerId);
  } else {
    params.set("customer_email", input.customerEmail);
  }

  return stripeRequest<StripeCheckoutSession>("/checkout/sessions", params);
}

export async function createPortalSession(input: {
  customerId: string;
  returnUrl: string;
}) {
  return stripeRequest<StripePortalSession>(
    "/billing_portal/sessions",
    new URLSearchParams({
      customer: input.customerId,
      return_url: input.returnUrl,
    }),
  );
}

export function constructStripeWebhookEvent(
  payload: string,
  signature: string | null,
) {
  const secret = process.env.STRIPE_WEBHOOK_SECRET;

  if (!secret) {
    throw new Error("STRIPE_WEBHOOK_SECRET is required for Stripe webhooks.");
  }

  if (!signature) {
    throw new Error("Missing Stripe signature.");
  }

  if (!isValidStripeSignature(payload, signature, secret)) {
    throw new Error("Invalid Stripe signature.");
  }

  return JSON.parse(payload) as StripeWebhookEvent;
}

async function stripeRequest<T>(path: string, body: URLSearchParams) {
  const secretKey = process.env.STRIPE_SECRET_KEY;

  if (!secretKey) {
    throw new Error("STRIPE_SECRET_KEY is not configured.");
  }

  const response = await fetch(`${stripeApiBase}${path}`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${secretKey}`,
      "Content-Type": "application/x-www-form-urlencoded",
    },
    body,
  });
  const json = (await response.json()) as T & { error?: { message?: string } };

  if (!response.ok) {
    throw new Error(json.error?.message ?? "Stripe request failed.");
  }

  return json;
}

function isValidStripeSignature(
  payload: string,
  signatureHeader: string,
  secret: string,
) {
  const entries = signatureHeader.split(",").map((entry) => entry.split("="));
  const timestamp = entries.find(([key]) => key === "t")?.[1];
  const signatures = entries
    .filter(([key]) => key === "v1")
    .map(([, value]) => value)
    .filter(Boolean);

  if (!timestamp || signatures.length === 0) {
    return false;
  }

  const expected = createHmac("sha256", secret)
    .update(`${timestamp}.${payload}`)
    .digest("hex");

  return signatures.some((signature) => safeEqual(signature, expected));
}

function safeEqual(actual: string, expected: string) {
  const actualBuffer = Buffer.from(actual);
  const expectedBuffer = Buffer.from(expected);

  return (
    actualBuffer.length === expectedBuffer.length &&
    timingSafeEqual(actualBuffer, expectedBuffer)
  );
}
