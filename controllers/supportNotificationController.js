import asyncHandler from "express-async-handler";
import SupportConversation from "../models/supportConversation.js";
import SupportNotification from "../models/supportNotification.js";
import SupportTask from "../models/supportTask.js";

const upsertNotification = async ({
  recipientUserId,
  type,
  title,
  body,
  conversationId = null,
  taskId = null,
  sourceUpdatedAt = null,
  reopenOnNewSource = false,
}) => {
  const query = { recipientUserId, type, conversationId, taskId };
  const existing = await SupportNotification.findOne(query)
    .select("_id updatedAt")
    .lean();

  if (!existing) {
    return SupportNotification.create({
      recipientUserId,
      type,
      title,
      body,
      conversationId,
      taskId,
    });
  }

  const update = { title, body };
  if (
    reopenOnNewSource &&
    sourceUpdatedAt &&
    (!existing.updatedAt || new Date(sourceUpdatedAt) > new Date(existing.updatedAt))
  ) {
    update.readAt = null;
  }

  return SupportNotification.updateOne({ _id: existing._id }, { $set: update });
};

const syncActionableNotifications = async (userId, platformRole) => {
  const canSeeUnassigned = ["platform-owner", "platform-admin"].includes(
    platformRole,
  );

  const conversationAssignmentFilter = canSeeUnassigned
    ? {
        $or: [
          { assignedToUserId: userId },
          { assignedToUserId: null },
          { assignedToUserId: { $exists: false } },
        ],
      }
    : { assignedToUserId: userId };

  const [assignedConversations, assignedTasks] = await Promise.all([
    SupportConversation.find({
      ...conversationAssignmentFilter,
      status: { $ne: "resolved" },
    }).select("_id subject status messages assignedToUserId"),
    SupportTask.find({
      assignedToUserId: userId,
      status: { $nin: ["done", "cancelled"] },
    }).select("_id conversationId title dueAt"),
  ]);

  const notifications = [];

  assignedConversations.forEach((conversation) => {
    const isAssignedToCurrentUser =
      conversation.assignedToUserId?.toString() === userId?.toString();

    if (isAssignedToCurrentUser) {
      notifications.push(
        upsertNotification({
          recipientUserId: userId,
          type: "conversation_assigned",
          title: "Support conversation assigned to you",
          body: conversation.subject,
          conversationId: conversation._id,
        }),
      );
    }

    const lastMessage = conversation.messages?.at(-1);
    if (
      conversation.status === "needs_reply" &&
      lastMessage?.senderType === "customer"
    ) {
      notifications.push(
        upsertNotification({
          recipientUserId: userId,
          type: "customer_reply",
          title: isAssignedToCurrentUser
            ? "Customer replied to your support conversation"
            : "Unassigned support conversation needs a reply",
          body: conversation.subject,
          conversationId: conversation._id,
          sourceUpdatedAt: lastMessage.createdAt,
          reopenOnNewSource: true,
        }),
      );
    }
  });

  assignedTasks.forEach((task) => {
    notifications.push(
      upsertNotification({
        recipientUserId: userId,
        type: "task_assigned",
        title: "Support task assigned to you",
        body: task.title,
        conversationId: task.conversationId,
        taskId: task._id,
      }),
    );

    if (
      task.dueAt &&
      task.dueAt < new Date(new Date().setHours(0, 0, 0, 0))
    ) {
      notifications.push(
        upsertNotification({
          recipientUserId: userId,
          type: "task_overdue",
          title: "Support task overdue",
          body: task.title,
          conversationId: task.conversationId,
          taskId: task._id,
        }),
      );
    }
  });

  await Promise.all(notifications);
};

export const listMySupportNotifications = asyncHandler(async (req, res) => {
  await syncActionableNotifications(req.userId, req.platformRole);

  const notifications = await SupportNotification.find({
    recipientUserId: req.userId,
  })
    .sort({ createdAt: -1 })
    .limit(100)
    .lean();
  const unreadCount = await SupportNotification.countDocuments({
    recipientUserId: req.userId,
    readAt: null,
  });

  res.json({ success: true, notifications, unreadCount });
});

export const markSupportNotificationRead = asyncHandler(async (req, res) => {
  const notification = await SupportNotification.findOneAndUpdate(
    { _id: req.params.notificationId, recipientUserId: req.userId },
    { $set: { readAt: new Date() } },
    { new: true },
  );
  if (!notification) {
    return res
      .status(404)
      .json({ success: false, message: "Notification not found." });
  }
  res.json({ success: true, notification });
});

export const markAllSupportNotificationsRead = asyncHandler(
  async (req, res) => {
    await SupportNotification.updateMany(
      { recipientUserId: req.userId, readAt: null },
      { $set: { readAt: new Date() } },
    );
    res.json({ success: true });
  },
);
