/**
 * Type declarations for iyzipay Node.js SDK.
 * The iyzipay package ships no TypeScript types, so we declare the shapes
 * we actually use in the OtelAI billing integration.
 *
 * Source: node_modules/iyzipay/lib/resources/
 */

declare module 'iyzipay' {
  interface IyzipayConfig {
    apiKey: string;
    secretKey: string;
    uri: string;
  }

  interface IyzipayResponse {
    status: 'success' | 'failure';
    errorCode?: string;
    errorMessage?: string;
    locale?: string;
    systemTime?: number;
    conversationId?: string;
  }

  interface SubscriptionCheckoutFormInitResponse extends IyzipayResponse {
    checkoutFormContent?: string;
    token?: string;
    tokenExpireTime?: number;
    subscriptionReferenceCode?: string;
  }

  interface SubscriptionUpgradeResponse extends IyzipayResponse {
    subscriptionStatus?: string;
    newPricingPlanReferenceCode?: string;
  }

  interface SubscriptionCheckoutFormParams {
    locale?: string;
    conversationId?: string;
    pricingPlanReferenceCode: string;
    subscriptionInitialStatus?: string;
    callbackUrl: string;
    customer: {
      name: string;
      surname: string;
      email: string;
      gsmNumber?: string;
      identityNumber?: string;
      billingAddress?: {
        contactName: string;
        city: string;
        country: string;
        address: string;
        zipCode?: string;
      };
    };
  }

  interface SubscriptionUpgradeParams {
    subscriptionReferenceCode: string;
    newPricingPlanReferenceCode: string;
    upgradePeriod?: 'NOW' | 'NEXT_PERIOD';
    locale?: string;
    conversationId?: string;
  }

  interface SubscriptionCheckoutForm {
    initialize(
      params: SubscriptionCheckoutFormParams,
      callback: (err: unknown, result: SubscriptionCheckoutFormInitResponse) => void,
    ): void;
  }

  interface SubscriptionResource {
    upgrade(
      params: SubscriptionUpgradeParams,
      callback: (err: unknown, result: SubscriptionUpgradeResponse) => void,
    ): void;
  }

  class Iyzipay {
    constructor(config: IyzipayConfig);
    subscriptionCheckoutForm: SubscriptionCheckoutForm;
    subscription: SubscriptionResource;

    static LOCALE: { TR: 'tr'; EN: 'en' };
    static CURRENCY: Record<string, string>;
  }

  export = Iyzipay;
}
