/**
 * iyzico payment client and subscription helpers.
 *
 * Used for Turkish market billing (country === 'TR').
 * iyzico handles subscription checkout via hosted form and recurring payments.
 *
 * Source: .planning/phases/06-billing/06-02-PLAN.md
 */

import Iyzipay from 'iyzipay';
import { createHmac, timingSafeEqual } from 'crypto';

// ---------------------------------------------------------------------------
// Client singleton
// ---------------------------------------------------------------------------

/**
 * iyzipay client singleton.
 *
 * Uses sandbox URI in non-production environments.
 * Initialized once at module load time — safe for Next.js serverless.
 */
export const iyzipayClient = new Iyzipay({
  apiKey: process.env.IYZIPAY_API_KEY!,
  secretKey: process.env.IYZIPAY_SECRET_KEY!,
  uri:
    process.env.NODE_ENV === 'production'
      ? 'https://api.iyzipay.com'
      : 'https://sandbox-api.iyzipay.com',
});

// ---------------------------------------------------------------------------
// Plan reference code mapping
// ---------------------------------------------------------------------------

const IYZICO_PLAN_REFS: Record<string, string | undefined> = {
  starter: process.env.IYZICO_PLAN_STARTER_REF,
  pro: process.env.IYZICO_PLAN_PRO_REF,
  enterprise: process.env.IYZICO_PLAN_ENTERPRISE_REF,
};

/**
 * Returns the iyzico pricing plan reference code for the given OtelAI plan name.
 * Throws if the env var is not configured — configuration error, not a user error.
 */
export function getIyzicoPlanRef(planName: string): string {
  const ref = IYZICO_PLAN_REFS[planName];
  if (!ref) throw new Error(`No iyzico plan ref for: ${planName}`);
  return ref;
}

// ---------------------------------------------------------------------------
// Checkout form initialization
// ---------------------------------------------------------------------------

export interface CheckoutFormCustomer {
  name: string;
  surname: string;
  email: string;
  gsmNumber?: string;
  /** Turkish National Identity Number (TC Kimlik No) */
  identityNumber?: string;
  billingAddress?: {
    contactName: string;
    city: string;
    country: string;
    address: string;
    zipCode?: string;
  };
}

export interface InitCheckoutFormParams {
  pricingPlanReferenceCode: string;
  callbackUrl: string;
  customer: CheckoutFormCustomer;
}

export interface CheckoutFormResult {
  status: string;
  checkoutFormContent?: string;
  token?: string;
  tokenExpireTime?: number;
  subscriptionReferenceCode?: string;
  errorCode?: string;
  errorMessage?: string;
}

/**
 * Initializes an iyzico subscription checkout form.
 *
 * Returns a Promise that resolves with the iyzico response — callers receive
 * either `checkoutFormContent` (HTML) or a `token` to build the form URL.
 *
 * subscriptionInitialStatus is set to 'ACTIVE' per plan spec.
 * locale is set to 'tr' (Turkish market).
 */
export function initSubscriptionCheckoutForm(
  params: InitCheckoutFormParams,
): Promise<CheckoutFormResult> {
  return new Promise((resolve, reject) => {
    iyzipayClient.subscriptionCheckoutForm.initialize(
      {
        locale: 'tr',
        pricingPlanReferenceCode: params.pricingPlanReferenceCode,
        subscriptionInitialStatus: 'ACTIVE',
        callbackUrl: params.callbackUrl,
        customer: params.customer,
      },
      (err, result) => {
        if (err) {
          reject(err);
        } else {
          resolve(result as CheckoutFormResult);
        }
      },
    );
  });
}

// ---------------------------------------------------------------------------
// Subscription upgrade
// ---------------------------------------------------------------------------

export interface UpgradeSubscriptionParams {
  subscriptionReferenceCode: string;
  newPricingPlanReferenceCode: string;
  upgradePeriod?: 'NOW' | 'NEXT_PERIOD';
}

export interface UpgradeSubscriptionResult {
  status: string;
  subscriptionStatus?: string;
  newPricingPlanReferenceCode?: string;
  errorCode?: string;
  errorMessage?: string;
}

/**
 * Upgrades (or downgrades) an existing iyzico subscription to a new pricing plan.
 *
 * Implementation note: The iyzipay Node library exposes `subscription.upgrade`
 * directly (lib/resources/Subscription.js — UPGRADE method calling
 * /v2/subscription/subscriptions/{ref}/upgrade). No raw fetch needed.
 */
export function upgradeIyzicoSubscription(
  params: UpgradeSubscriptionParams,
): Promise<UpgradeSubscriptionResult> {
  return new Promise((resolve, reject) => {
    iyzipayClient.subscription.upgrade(
      {
        locale: 'tr',
        subscriptionReferenceCode: params.subscriptionReferenceCode,
        newPricingPlanReferenceCode: params.newPricingPlanReferenceCode,
        upgradePeriod: params.upgradePeriod ?? 'NOW',
      },
      (err, result) => {
        if (err) {
          reject(err);
        } else {
          resolve(result as UpgradeSubscriptionResult);
        }
      },
    );
  });
}

// ---------------------------------------------------------------------------
// Webhook signature validation
// ---------------------------------------------------------------------------

/**
 * Validates the X-IYZ-SIGNATURE-V3 HMAC header from an iyzico webhook.
 *
 * iyzico computes: HMAC-SHA256(
 *   merchantId + secretKey + iyziEventType + subscriptionReferenceCode +
 *   orderReferenceCode + customerReferenceCode
 * )
 *
 * Uses crypto.timingSafeEqual to prevent timing attacks.
 *
 * @returns true if signature is valid, false otherwise
 */
export function validateIyzicoSignature(
  iyziEventType: string,
  subscriptionReferenceCode: string,
  orderReferenceCode: string,
  customerReferenceCode: string,
  providedSignature: string,
): boolean {
  const merchantId = process.env.IYZIPAY_MERCHANT_ID ?? '';
  const secretKey = process.env.IYZIPAY_SECRET_KEY ?? '';

  const data =
    merchantId +
    secretKey +
    iyziEventType +
    subscriptionReferenceCode +
    orderReferenceCode +
    customerReferenceCode;

  const expectedHex = createHmac('sha256', secretKey).update(data).digest('hex');

  try {
    const expectedBuf = Buffer.from(expectedHex, 'utf8');
    const providedBuf = Buffer.from(providedSignature, 'utf8');

    if (expectedBuf.length !== providedBuf.length) return false;

    return timingSafeEqual(expectedBuf, providedBuf);
  } catch {
    return false;
  }
}
