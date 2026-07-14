import mongoose from "mongoose";
import dotenv from "dotenv";
import readline from "readline";

import App from "../models/app.js";
import onboardCustomerEnvironment from "../services/customerOnboardingService.js";

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

    CUSTOMER.installedApps =
      await chooseInstalledApps();

    const result =
      await onboardCustomerEnvironment({
        owner: {
          name: CUSTOMER.ownerName,
          email: CUSTOMER.ownerEmail,
          phone: CUSTOMER.ownerPhone,
          password: CUSTOMER.ownerPassword,
          country: CUSTOMER.country,
        },
        company: {
          name: CUSTOMER.companyName,
          displayName: CUSTOMER.displayName,
          slug: CUSTOMER.companySlug,
          referencePrefix:
            CUSTOMER.referencePrefix,
          reservationBusinessSlug:
            CUSTOMER.reservationBusinessSlug,
          plan: "starter",
          maxUsers: 1,
        },
        installedApps: CUSTOMER.installedApps,
      });

    console.log("");
    console.log("ONBOARDING COMPLETE");
    console.log("-------------------");
    console.log(
      "User email:",
      result.user.email
    );
    console.log(
      "Company:",
      result.company.name
    );
    console.log(
      "Company ID:",
      result.company._id.toString()
    );

    if (result.contract) {
  console.log(
    "Contract:",
    result.contract.status
  );

  console.log(
    "Contract Ends:",
    result.contract.endDate
  );
}

    if (result.chatbotSettings) {
      console.log(
        "Chatbot ID:",
        result.chatbotSettings._id.toString()
      );
      console.log(
        "API Key:",
        result.chatbotSettings.apiKey
      );
    } else {
      console.log(
        "AI Assistant:",
        "Not installed"
      );
    }

    console.log(
      "Validation:",
      result.validation
    );
    console.log("");

    await mongoose.disconnect();
    rl.close();
    process.exit(0);
  } catch (error) {
    console.error(
      "Onboarding failed:",
      error.message
    );

    await mongoose.disconnect().catch(() => {});
    rl.close();
    process.exit(1);
  }
}

onboardCustomer();