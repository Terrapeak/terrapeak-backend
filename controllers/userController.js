import User from "../models/user.js";
import sendEmail from "../utils/sendEmail.js";

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
export const approveUser = async (req, res) => {
  try {
    const userId = req.params.id;
    const user = await User.findById(userId);

    if (!user) return res.status(404).json({ message: "User not found" });

    user.isApproved = true;
    await user.save();

    // Send email to user
    await sendEmail({
      to: user.email,
      subject: "Your Account Has Been Verified 🎉",
      text: `Hi ${user.name || "User"}, your account has been successfully verified. You can now log in and start using our platform.`,
      html: `
        <div style="font-family: Arial, sans-serif; line-height: 1.6; color: #333;">
          <h2 style="color: #4CAF50;">Account Verified ✅</h2>
          <p>Hi <b>${user.name || "User"}</b>,</p>
          <p>Your account has been successfully <b>verified</b>. You can now log in and start using all features of <b>MyApp</b>.</p>
          <a href="${process.env.FRONTEND_URL}/auth" 
             style="display: inline-block; padding: 10px 20px; margin-top: 15px; background: #4CAF50; color: #fff; text-decoration: none; border-radius: 5px;">
            Login Now
          </a>
          <p style="margin-top: 20px;">If you didn’t request this, please ignore this email.</p>
          <p>Thanks,<br>The ${process.env.APP_NAME} Team</p>
        </div>
      `,
    });

    res
      .status(200)
      .json({ message: "User approved and email sent successfully" });
  } catch (err) {
    console.error("Error approving user:", err);
    res.status(500).json({ message: err.message });
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
    const updateFields = req.body;

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
