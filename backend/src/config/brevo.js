const Brevo = require('@getbrevo/brevo');

const getBrevoApi = () => {
  const TransactionalApi = Brevo.TransactionalEmailsApi || Brevo.default?.TransactionalEmailsApi;
  const api = new TransactionalApi();
  if (process.env.BREVO_API_KEY) {
    const apiKeys = Brevo.TransactionalEmailsApiApiKeys || Brevo.default?.TransactionalEmailsApiApiKeys;
    api.setApiKey(apiKeys.apiKey, process.env.BREVO_API_KEY);
  }
  return api;
};

const sendOTPEmail = async (toEmail, otpCode) => {
  const apiInstance = getBrevoApi();
  const SendSmtpEmailClass = Brevo.SendSmtpEmail || Brevo.default?.SendSmtpEmail;
  const sendSmtpEmail = new SendSmtpEmailClass();

  sendSmtpEmail.subject = "รหัส OTP สำหรับรีเซ็ตรหัสผ่าน - ระบบจัดตารางสอน";
  sendSmtpEmail.htmlContent = `
    <div style="font-family: Arial, sans-serif; padding: 20px;">
      <h2>คำขอรีเซ็ตรหัสผ่าน</h2>
      <p>รหัส OTP ของคุณคือ: <strong>${otpCode}</strong></p>
    </div>
  `;
  sendSmtpEmail.sender = {
    name: process.env.BREVO_SENDER_NAME || "Timetable System",
    email: process.env.BREVO_SENDER_EMAIL
  };
  sendSmtpEmail.to = [{ email: toEmail }];

  return await apiInstance.sendTransacEmail(sendSmtpEmail);
};

module.exports = { sendOTPEmail };