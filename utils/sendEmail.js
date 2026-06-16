import nodemailer from "nodemailer";

const sendEmail = async ({ to, subject, text, html }) => {
  
  const transporter = nodemailer.createTransport({
    service: "Gmail", // Or SMTP details
    auth: {
      user: process.env.EMAIL_USER,
      pass: process.env.EMAIL_PASS,
    },
  });

  const mailOptions = {
    from: `"${process.env.APP_NAME}" <${process.env.EMAIL_USER}>`,
    to,
    subject,
    text,
    html,
  };

  await transporter.sendMail(mailOptions);
};

export default sendEmail;
