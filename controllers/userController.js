import User from "../models/user.js";
import App from "../models/app.js";
import sendEmail from "../utils/sendEmail.js";
import onboardCustomerEnvironment from "../services/customerOnboardingService.js";

const EDITABLE_USER_FIELDS = [
  "name",
  "email",
  "phone",
  "country",
  "companyName",
  "isApproved",
];

// Admin: Get all users
// Admin: Get all users with pagination + filters
export const getAllUsers = async (req, res) => {
  try {
    const {
      page = 1,
      limit = 10,
      search = "",
      status = "all",
    } = req.query;

    const query = {isAdmin:false};

    // 🔍 Search filter (name/email/phone)
    if (search) {
      query.$or = [
        { name: { $regex: search, $options: "i" } },
        { email: { $regex: search, $options: "i" } },
        { phone: { $regex: search, $options: "i" } },
      ];
    }

    // ✅ Status filter
    if (status === "approved") {
      query.isApproved = true;
    } else if (status === "pending") {
      query.isApproved = false;
    }

    // 📄 Pagination
    const skip = (Number(page) - 1) * Number(limit);

    const [users, total] = await Promise.all([
      User.find(query).skip(skip).limit(Number(limit)),
      User.countDocuments(query),
    ]);

    res.status(200).json({
      users,
      total,
      page: Number(page),
      totalPages: Math.ceil(total / limit),
    });
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
};


// Admin: Approve user
// Admin: Approve user and create the complete customer environment
export const approveUser = async (req, res) => {
  try {
    const userId = req.params.id;
    const user = await User.findById(userId);

    if (!user) {
      return res.status(404).json({
        success: false,
        message: "User not found",
      });
    }

    if (!user.companyName?.trim()) {
      return res.status(400).json({
        success: false,
        message:
          "The user must have a company name before onboarding can be completed.",
      });
    }

    /*
     * App Registry is the source of truth.
     *
     * Core apps are always installed.
     * Optional apps may be supplied later by the Platform Admin UI as:
     * req.body.installedApps = ["reservations", ...]
     */
    const requestedOptionalApps = Array.isArray(
      req.body?.installedApps
    )
      ? req.body.installedApps
      : [];

    const registryApps = await App.find({
      isVisible: true,
      isComingSoon: false,
    }).select(
      "slug isCore allowInstall"
    );

    const coreAppSlugs = registryApps
      .filter((app) => app.isCore)
      .map((app) => app.slug);

    const allowedOptionalSlugs = new Set(
      registryApps
        .filter(
          (app) =>
            !app.isCore &&
            app.allowInstall !== false
        )
        .map((app) => app.slug)
    );

    const validOptionalApps =
      requestedOptionalApps.filter((slug) =>
        allowedOptionalSlugs.has(slug)
      );

    const installedApps = Array.from(
      new Set([
        ...coreAppSlugs,
        ...validOptionalApps,
      ])
    );

    /*
     * The reusable onboarding service creates or reuses:
     * - User
     * - Company
     * - Owner membership
     * - Company app installations
     * - App-specific initialization
     * - Linked AI Assistant settings
     */
    const onboarding =
      await onboardCustomerEnvironment({
        owner: {
          name: user.name,
          email: user.email,
          phone: user.phone,
          country: user.country || "PH",
        },
        company: {
          name: user.companyName,
          displayName: user.companyName,
          plan: "starter",
          maxUsers: 1,
        },
        installedApps,
      });

    const onboardingComplete =
      onboarding.validation.userReady &&
      onboarding.validation.companyReady &&
      onboarding.validation.membershipReady &&
      onboarding.validation.aiAssistantReady !==
        false;

    if (!onboardingComplete) {
      return res.status(500).json({
        success: false,
        message:
          "Customer onboarding validation failed.",
        validation: onboarding.validation,
      });
    }

    /*
     * Send approval only after the full customer
     * environment has been created successfully.
     */
    await sendEmail({
      to: user.email,
      subject:
        "Your Terrapeak account is ready 🎉",
      text: `Hi ${
        user.name || "User"
      }, your account and company environment are ready. You can now log in and start using the Terrapeak platform.`,
      html: `
        <div style="font-family: Arial, sans-serif; line-height: 1.6; color: #333;">
          <h2 style="color: #4CAF50;">
            Your Terrapeak account is ready ✅
          </h2>

          <p>
            Hi <b>${user.name || "User"}</b>,
          </p>

          <p>
            Your account and company environment for
            <b>${onboarding.company.displayName || onboarding.company.name}</b>
            have been successfully created.
          </p>

          <p>
            You can now log in and use the apps enabled for your company.
          </p>

          <a
            href="${process.env.FRONTEND_URL}/auth"
            style="display: inline-block; padding: 10px 20px; margin-top: 15px; background: #4CAF50; color: #fff; text-decoration: none; border-radius: 5px;"
          >
            Login Now
          </a>

          <p style="margin-top: 20px;">
            Thanks,<br>
            The ${process.env.APP_NAME || "Terrapeak"} Team
          </p>
        </div>
      `,
    });

    return res.status(200).json({
      success: true,
      message:
        "User approved and customer environment created successfully.",
      onboarding: {
        userId: onboarding.user._id,
        companyId: onboarding.company._id,
        companyName:
          onboarding.company.displayName ||
          onboarding.company.name,
        installedApps:
          onboarding.installedApps,
        chatbotId:
          onboarding.chatbotSettings?._id ||
          null,
        validation: onboarding.validation,
      },
    });
  } catch (err) {
    console.error(
      "Error approving and onboarding user:",
      err
    );

    return res.status(500).json({
      success: false,
      message:
        err.message ||
        "User approval and onboarding failed.",
    });
  }
};

export const rejectUser = async (req, res) => {
  try {
    const userId = req.params.id;
    const user = await User.findById(userId);

    if (!user) return res.status(404).json({ message: "User not found" });

    // Mark user as rejected (or you can delete if required)
    user.isApproved = false;
    user.isRejected = true; // optional field if you have it in schema
    await user.save();

    // Send rejection email
    await sendEmail({
      to: user.email,
      subject: "Your Account Verification Request ❌",
      text: `Hi ${user.name || "User"}, unfortunately your account verification request has been rejected. Please contact support for more details.`,
      html: `
        <div style="font-family: Arial, sans-serif; line-height: 1.6; color: #333;">
          <h2 style="color: #E53935;">Account Rejected ❌</h2>
          <p>Hi <b>${user.name || "User"}</b>,</p>
          <p>We regret to inform you that your account verification request has been <b>rejected</b>.</p>
          <p>If you believe this was a mistake or would like to try again, please contact our support team.</p>
          <a href="${process.env.FRONTEND_URL}/support" 
             style="display: inline-block; padding: 10px 20px; margin-top: 15px; background: #E53935; color: #fff; text-decoration: none; border-radius: 5px;">
            Contact Support
          </a>
          <p style="margin-top: 20px;">We’re here to help you resolve this.</p>
          <p>Thanks,<br>The ${process.env.APP_NAME} Team</p>
        </div>
      `,
    });

    res
      .status(200)
      .json({ message: "User rejected and email sent successfully" });
  } catch (err) {
    console.error("Error rejecting user:", err);
    res.status(500).json({ message: err.message });
  }
};


// Admin: Update user
export const updateUser = async (req, res) => {
  try {
    const userId = req.params.id;
    const updateFields = {};

    EDITABLE_USER_FIELDS.forEach((field) => {
      if (req.body?.[field] !== undefined) {
        updateFields[field] = req.body[field];
      }
    });

    if (updateFields.email !== undefined) {
      updateFields.email = String(updateFields.email).trim().toLowerCase();
    }

    if (updateFields.phone !== undefined) {
      updateFields.phone = String(updateFields.phone).trim();
    }

    for (const field of ["name", "country", "companyName"]) {
      if (updateFields[field] !== undefined) {
        updateFields[field] = String(updateFields[field]).trim();
      }
    }

    if (!Object.keys(updateFields).length) {
      return res.status(400).json({
        message: "No editable user fields were provided",
      });
    }

    const updatedUser = await User.findByIdAndUpdate(userId, updateFields, {
      new: true,
      runValidators: true,
    });

    if (!updatedUser)
      return res.status(404).json({ message: "User not found" });

    res
      .status(200)
      .json({ message: "User updated successfully", user: updatedUser });
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
};

// Admin: Delete user
export const deleteUser = async (req, res) => {
  try {
    const userId = req.params.id;

    const deletedUser = await User.findByIdAndDelete(userId);
    if (!deletedUser)
      return res.status(404).json({ message: "User not found" });

    res.status(200).json({ message: "User deleted successfully" });
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
};
