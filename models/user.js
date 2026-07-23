import mongoose from "mongoose";
import bcrypt from "bcrypt";
import { PLATFORM_ROLES } from "../utils/roleSeparation.js";
import {
  assertPlatformAccessAssignmentAllowed,
  extractPlatformAccessUpdate,
  grantsPlatformAccess,
} from "../utils/platformAccessGuard.js";

const userSchema = new mongoose.Schema(
  {
    name: { type: String, required: true },
    email: { type: String, unique: true, required: true },
    phone: { type: String, unique: true, required: true },
    password: { type: String, required: true },
    country: { type: String, required: false },
    companyName: { type: String, required: false },
    isAdmin: { type: Boolean, default: false },
    role: {
      type: String,
      enum: ["user", "admin"],
      default: "user",
      required: true,
    },
    platformRole: {
      type: String,
      enum: PLATFORM_ROLES,
      default: "none",
    },
    isApproved: { type: Boolean, default: false },
    accountStatus: {
      type: String,
      enum: ["pending", "active", "suspended", "removed"],
      default: "active",
    },
    invitationStatus: {
      type: String,
      enum: ["not_invited", "pending", "accepted", "expired"],
      default: "not_invited",
    },
    invitationTokenHash: { type: String, default: null },
    invitationExpiresAt: { type: Date, default: null },
    invitationSentAt: { type: Date, default: null },
    passwordResetTokenHash: { type: String, default: null },
    passwordResetExpiresAt: { type: Date, default: null },
    passwordResetSentAt: { type: Date, default: null },
    isGoogleOauth: { type: Boolean, default: false },
    googleRefreshToken: { type: String },
    googleAccessToken: { type: String },
  },
  { timestamps: true }
);

userSchema.pre("save", async function (next) {
  if (!this.isModified("password")) return next();
  const salt = await bcrypt.genSalt(10);
  this.password = await bcrypt.hash(this.password, salt);
  next();
});

userSchema.pre("validate", async function guardPlatformAccess() {
  const accessChanged =
    this.isNew ||
    this.isModified("platformRole") ||
    this.isModified("isAdmin");

  if (
    !accessChanged ||
    !grantsPlatformAccess({
      platformRole: this.platformRole || "none",
      isAdmin: this.isAdmin === true,
    })
  ) {
    return;
  }

  await assertPlatformAccessAssignmentAllowed({
    userId: this._id,
    platformRole: this.platformRole || "none",
    isAdmin: this.isAdmin === true,
  });
});

const guardPlatformAccessQuery = async function guardQuery() {
  const intent = extractPlatformAccessUpdate(this.getUpdate());
  const grantsAccess =
    (intent.touchesPlatformRole &&
      intent.platformRole !== "none") ||
    (intent.touchesIsAdmin && intent.isAdmin === true);

  if (!grantsAccess) return;

  const users = await this.model
    .find(this.getQuery())
    .select("_id")
    .lean();
  const candidateIds = users.map((user) => user._id);
  const queryId = this.getQuery()?._id;
  const upsertId =
    queryId && typeof queryId === "object" && queryId.$eq
      ? queryId.$eq
      : queryId;
  if (
    this.getOptions().upsert &&
    upsertId &&
    !candidateIds.some((id) => id.toString() === upsertId.toString())
  ) {
    candidateIds.push(upsertId);
  }

  await assertPlatformAccessAssignmentAllowed({
    userIds: candidateIds,
    platformRole:
      intent.touchesPlatformRole ? intent.platformRole : "none",
    isAdmin: intent.touchesIsAdmin ? intent.isAdmin : false,
  });
};

userSchema.pre("updateOne", guardPlatformAccessQuery);
userSchema.pre("updateMany", guardPlatformAccessQuery);
userSchema.pre("findOneAndUpdate", guardPlatformAccessQuery);
userSchema.pre("replaceOne", guardPlatformAccessQuery);
userSchema.pre("findOneAndReplace", guardPlatformAccessQuery);

userSchema.pre("insertMany", function guardInsertedUsers(next, docs) {
  Promise.resolve()
    .then(async () => {
      for (const user of docs) {
        if (
          grantsPlatformAccess({
            platformRole: user.platformRole || "none",
            isAdmin: user.isAdmin === true,
          })
        ) {
          await assertPlatformAccessAssignmentAllowed({
            userId: user._id,
            platformRole: user.platformRole || "none",
            isAdmin: user.isAdmin === true,
          });
        }
      }
    })
    .then(() => next(), next);
});

userSchema.pre("bulkWrite", function guardBulkAccess(next, operations) {
  Promise.resolve()
    .then(async () => {
      for (const operation of operations) {
        if (operation.insertOne?.document) {
          const user = operation.insertOne.document;
          await assertPlatformAccessAssignmentAllowed({
            userId: user._id,
            platformRole: user.platformRole || "none",
            isAdmin: user.isAdmin === true,
          });
          continue;
        }

        const mutation =
          operation.updateOne ||
          operation.updateMany ||
          operation.replaceOne;
        if (!mutation) continue;

        const intent = extractPlatformAccessUpdate(
          mutation.update || mutation.replacement
        );
        const grantsAccess =
          (intent.touchesPlatformRole &&
            intent.platformRole !== "none") ||
          (intent.touchesIsAdmin && intent.isAdmin === true);
        if (!grantsAccess) continue;

        const users = await this.find(mutation.filter)
          .select("_id")
          .lean();
        const candidateIds = users.map((user) => user._id);
        const filterId = mutation.filter?._id;
        const upsertId =
          filterId && typeof filterId === "object" && filterId.$eq
            ? filterId.$eq
            : filterId;
        if (
          mutation.upsert &&
          upsertId &&
          !candidateIds.some(
            (id) => id.toString() === upsertId.toString()
          )
        ) {
          candidateIds.push(upsertId);
        }
        await assertPlatformAccessAssignmentAllowed({
          userIds: candidateIds,
          platformRole:
            intent.touchesPlatformRole ? intent.platformRole : "none",
          isAdmin: intent.touchesIsAdmin ? intent.isAdmin : false,
        });
      }
    })
    .then(() => next(), next);
});

userSchema.methods.matchPassword = async function (enteredPassword) {
  return bcrypt.compare(enteredPassword, this.password);
};

const User = mongoose.model("User", userSchema);

export default User;
