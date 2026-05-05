import { NextRequest, NextResponse } from 'next/server';
import { verifyDPOPayment } from '@/lib/payments/dpo';
import { SubscriptionManager } from '@/lib/payments/subscription-manager';

/**
 * Webhook handler for DPO Pay (Botswana BWP).
 * Receives notifications for Orange Money, VISA, Mastercard, and EFT.
 */
export async function POST(req: NextRequest) {
  try {
    const { searchParams } = new URL(req.url);
    const transToken = searchParams.get('TransToken');

    if (!transToken) {
      return NextResponse.json({ error: 'Missing TransToken' }, { status: 400 });
    }

    const verification = await verifyDPOPayment(transToken);

    if (verification.Result === '000') {
      // Payment Successful
      // Update Org subscription status using CompanyRef (which we passed during token creation)
      const companyRef = verification.CompanyRef;
      
      // await prisma.organization.update({ ... })
      
      return NextResponse.json({ status: 'success', ref: companyRef });
    } else {
      // Payment Failed
      // Trigger subscription manager failure flow
      // await SubscriptionManager.handlePaymentFailure(orgId, 1);
      
      return NextResponse.json({ status: 'failed', result: verification.Result });
    }
  } catch (error) {
    console.error('DPO Webhook Error:', error);
    return NextResponse.json({ error: 'Internal Server Error' }, { status: 500 });
  }
}
