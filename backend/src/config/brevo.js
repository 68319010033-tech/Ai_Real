const Brevo = require('@getbrevo/brevo');

function getBrevoApi() {
  const TransactionalApi = Brevo.TransactionalEmailsApi || Brevo.default?.TransactionalEmailsApi;
  if (!TransactionalApi) {
    throw new Error('Brevo SDK is unavailable: TransactionalEmailsApi not found');
  }

  const api = new TransactionalApi();
  const apiKey = process.env.BREVO_API_KEY;
  if (!apiKey) {
    throw new Error('BREVO_API_KEY is missing');
  }

  const apiKeys = Brevo.TransactionalEmailsApiApiKeys || Brevo.default?.TransactionalEmailsApiApiKeys;
  if (!apiKeys) {
    throw new Error('Brevo API key config is missing');
  }

  api.setApiKey(apiKeys.apiKey, apiKey);
  return api;
}

const sendOTPEmail = async (toEmail, otpCode) => {
  const senderEmail = process.env.BREVO_SENDER_EMAIL;
  if (!senderEmail) {
    throw new Error('BREVO_SENDER_EMAIL is missing');
  }

  const apiInstance = getBrevoApi();
  const SendSmtpEmailClass = Brevo.SendSmtpEmail || Brevo.default?.SendSmtpEmail;
  if (!SendSmtpEmailClass) {
    throw new Error('Brevo SDK is unavailable: SendSmtpEmail not found');
  }

  const sendSmtpEmail = new SendSmtpEmailClass();
  sendSmtpEmail.subject = 'รหัส OTP สำหรับรีเซ็ตรหัสผ่าน - ระบบจัดตารางสอน';
  sendSmtpEmail.htmlContent = `
    <div style="font-family: Arial, sans-serif; padding: 20px;">
      <h2>คำขอรีเซ็ตรหัสผ่าน</h2>
      <p>รหัส OTP ของคุณคือ: <strong>${otpCode}</strong></p>
    </div>
  `;
  sendSmtpEmail.sender = {
    name: process.env.BREVO_SENDER_NAME || 'Timetable System',
    email: senderEmail,
  };
  sendSmtpEmail.to = [{ email: toEmail }];

  try {
    const result = await apiInstance.sendTransacEmail(sendSmtpEmail);
    return result;
  } catch (error) {
    console.error('Brevo sendTransacEmail failed:', {
      message: error?.message,
      response: error?.response?.data,
      status: error?.response?.status,
      senderEmail,
      toEmail,
    });
    throw error;
  }
};

module.exports = { sendOTPEmail };