import { Resend } from 'resend';

const resend = new Resend(process.env.RESEND_API_KEY);

export const sendEmail = async (params: {
  to: string | string[];
  subject: string;
  html: string;
  from?: string;
  attachments?: any[];
}) => {
  return await resend.emails.send({
    from: params.from || 'PeoplePulse <no-reply@peoplepulse.bw>',
    to: params.to,
    subject: params.subject,
    html: params.html,
    attachments: params.attachments,
  });
};
