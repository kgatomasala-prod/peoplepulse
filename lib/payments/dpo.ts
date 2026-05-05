import axios from 'axios';
import { XMLBuilder, XMLParser } from 'fast-xml-parser';

const DPO_URL = process.env.NODE_ENV === 'production' 
  ? 'https://secure.3gdirectpay.com/API/v6/' 
  : 'https://secure1.sandbox.directpay.online/API/v6/';

const COMPANY_TOKEN = process.env.DPO_PAY_TOKEN;

const builder = new XMLBuilder();
const parser = new XMLParser();

/**
 * Creates a DPO payment token for a subscription.
 * Supports BWP (Botswana Pula) for SMEs.
 */
export const createDPOToken = async (params: {
  amount: number;
  currency: string;
  companyRef: string;
  redirectUrl: string;
  backUrl: string;
}) => {
  const xmlObj = {
    API3G: {
      CompanyToken: COMPANY_TOKEN,
      Request: 'createToken',
      Transaction: {
        PaymentAmount: params.amount,
        PaymentCurrency: params.currency,
        CompanyRef: params.companyRef,
        RedirectURL: params.redirectUrl,
        BackURL: params.backUrl,
        TransactionConfig: 1,
      },
      Services: {
        Service: {
          ServiceType: '51851', // SaaS Service Type
          ServiceDescription: 'PeoplePulse Subscription',
          ServiceDate: new Date().toISOString().split('T')[0].replace(/-/g, '/'),
        }
      }
    }
  };

  const xmlData = builder.build(xmlObj);
  const response = await axios.post(DPO_URL, xmlData, {
    headers: { 'Content-Type': 'application/xml' }
  });

  const result = parser.parse(response.data);
  
  if (result.API3G.Result !== '000') {
    throw new Error(result.API3G.ResultExplanation || 'DPO Token Creation Failed');
  }

  return {
    transToken: result.API3G.TransToken,
    transRef: result.API3G.TransRef,
    paymentUrl: `https://secure.3gdirectpay.com/payv2.php?ID=${result.API3G.TransToken}`
  };
};

export const verifyDPOPayment = async (transToken: string) => {
  const xmlObj = {
    API3G: {
      CompanyToken: COMPANY_TOKEN,
      Request: 'verifyToken',
      TransactionToken: transToken
    }
  };

  const xmlData = builder.build(xmlObj);
  const response = await axios.post(DPO_URL, xmlData, {
    headers: { 'Content-Type': 'application/xml' }
  });

  const result = parser.parse(response.data);
  return result.API3G;
};
