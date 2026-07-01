import mongoose from "mongoose";
import dotenv from "dotenv";
import readline from "readline";

import User from "../models/user.js";
import Company from "../models/company.js";
import CompanyMembership from "../models/companyMembership.js";
import ChatbotSettings from "../models/chatbotSettings.js";
import App from "../models/app.js";
import installApps from "../installers/installApps.js";

dotenv.config();

const rl = readline.createInterface({
  input: process.stdin,
  output: process.stdout,
});

function ask(question) {
  return new Promise((resolve) => {
    rl.question(question, (answer) => resolve(answer.trim()));
  });
}

function slugify(text) {
  return text
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

function makeReferencePrefix(companyName) {
  return companyName
    .split(" ")
    .map((word) => word[0])
    .join("")
    .toUpperCase()
    .slice(0, 5);
}

async function chooseInstalledApps() {
  const apps = await App.find({
    isVisible: true,
    isComingSoon: false,
  }).sort({ sortOrder: 1 });

  const coreApps = apps.filter((app) => app.isCore);
  const optionalApps = apps.filter((app) => !app.isCore);

  const installedApps = coreApps.map((app) => app.slug);

  console.log("");
  console.log("Available apps:");
  console.log("");

  optionalApps.forEach((app, index) => {
    console.log(`${index + 1}. ${app.name} - ${app.description}`);
  });

  console.log("");

  for (const app of optionalApps) {
    const answer = await ask(`Install ${app.name}? yes/no (default no): `);

    if (
      answer.toLowerCase() === "yes" ||
      answer.toLowerCase() === "y"
    ) {
      installedApps.push(app.slug);
    }
  }

  return installedApps;
}

async function collectCustomerInput() {
  console.log("");
  console.log("=== Pearlbot Customer Onboarding ===");
  console.log("");

  const ownerName = await ask("Owner name: ");
  const ownerEmail = await ask("Owner email: ");
  const ownerPhone = await ask("Owner phone: ");
  const ownerPassword = await ask("Temporary password: ");
  const country = await ask("Country (default PH): ");
  const companyName = await ask("Company name: ");
  const suggestedSlug = slugify(companyName);
  const companySlugInput = await ask(`Company slug (default ${suggestedSlug}): `);
  const suggestedPrefix = makeReferencePrefix(companyName);
  const referencePrefixInput = await ask(
    `Reference prefix (default ${suggestedPrefix}): `
  );

  const companySlug = companySlugInput || suggestedSlug;
  const referencePrefix = referencePrefixInput || suggestedPrefix;

  return {
    ownerName,
    ownerEmail,
    ownerPhone,
    ownerPassword,
    country: country || "PH",

    companyName,
    companySlug,
    displayName: companyName,
    referencePrefix,

    reservationBusinessSlug: companySlug,
  };
}

async function onboardCustomer() {
  try {
    const CUSTOMER = await collectCustomerInput();

    await mongoose.connect(process.env.MONGO_URI);
    console.log("MongoDB connected");

    CUSTOMER.installedApps = await chooseInstalledApps();

    let user = await User.findOne({ email: CUSTOMER.ownerEmail });

    if (!user) {
      user = new User({
        name: CUSTOMER.ownerName,
        email: CUSTOMER.ownerEmail,
        phone: CUSTOMER.ownerPhone,
        password: CUSTOMER.ownerPassword,
        country: CUSTOMER.country,
        companyName: CUSTOMER.companyName,
        isAdmin: false,
        role: "user",
        isApproved: true,
      });

      await user.save();
      console.log("Created user:", user.email);
    } else {
      console.log("User already exists:", user.email);
    }

    let company = await Company.findOne({ slug: CUSTOMER.companySlug });

    if (!company) {
      company = new Company({
      name: CUSTOMER.companyName,
      displayName: CUSTOMER.displayName,
      slug: CUSTOMER.companySlug,
      referencePrefix: CUSTOMER.referencePrefix,
      reservationBusinessSlug: CUSTOMER.reservationBusinessSlug,
      installedApps: CUSTOMER.installedApps,
       plan: "starter",
      maxUsers: 1,
      ownerUserId: user._id,
      isActive: true,
    });

      await company.save();
      console.log("Created company:", company.name);
    } else {
      console.log("Company already exists:", company.name);
    }

    await CompanyMembership.findOneAndUpdate(
      {
        companyId: company._id,
        userId: user._id,
      },
      {
        companyId: company._id,
        userId: user._id,
        role: "owner",
        isActive: true,
      },
      {
        upsert: true,
        new: true,
      }
    );

    console.log("Created/updated company membership");

    const installResults = await installApps({
      company,
      user,
      installedApps: CUSTOMER.installedApps,
    });

const chatbotSettings = installResults["ai-assistant"];

    console.log("");
    console.log("ONBOARDING COMPLETE");
    console.log("-------------------");
    console.log("User email:", user.email);
    console.log("Company:", company.name);
    console.log("Company ID:", company._id.toString());
    console.log("Chatbot ID:", chatbotSettings._id.toString());
    console.log("API Key:", chatbotSettings.apiKey);
    console.log("");

    rl.close();
    process.exit(0);
  } catch (error) {
    console.error("Onboarding failed:", error);
    rl.close();
    process.exit(1);
  }
}

onboardCustomer();