const africastalking = require('africastalking')({
  apiKey: process.env.AFRICASTALKING_API_KEY,
  username: process.env.AFRICASTALKING_USERNAME || 'sandbox',
});

const sms = africastalking.SMS;

export const sendSMS = async (params: {
  to: string | string[];
  message: string;
  from?: string; // Optional shortcode
}) => {
  try {
    const result = await sms.send({
      to: params.to,
      message: params.message,
      from: params.from,
    });
    return result;
  } catch (error) {
    console.error('SMS Send Error:', error);
    throw error;
  }
};
