import asyncHandler from "express-async-handler";
import SupportNotification from "../models/supportNotification.js";
import SupportTask from "../models/supportTask.js";

const createOverdueNotifications = async (userId) => {
  const overdueTasks = await SupportTask.find({
    assignedToUserId: userId,
    dueAt: { $lt: new Date(new Date().setHours(0, 0, 0, 0)) },
    status: { $nin: ["done", "cancelled"] },
  }).select("_id conversationId title dueAt");

  await Promise.all(overdueTasks.map((task) =>
    SupportNotification.updateOne(
      {
        recipientUserId: userId,
        type: "task_overdue",
        taskId: task._id,
      },
      {
        $setOnInsert: {
          recipientUserId: userId,
          type: "task_overdue",
          title: "Support task overdue",
          body: task.title,
          conversationId: task.conversationId,
          taskId: task._id,
        },
      },
      { upsert: true }
    )
  ));
};

export const listMySupportNotifications = asyncHandler(async (req, res) => {
  await createOverdueNotifications(req.userId);

  const notifications = await SupportNotification.find({ recipientUserId: req.userId })
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
    { new: true }
  );
  if (!notification) {
    return res.status(404).json({ success: false, message: "Notification not found." });
  }
  res.json({ success: true, notification });
});

export const markAllSupportNotificationsRead = asyncHandler(async (req, res) => {
  await SupportNotification.updateMany(
    { recipientUserId: req.userId, readAt: null },
    { $set: { readAt: new Date() } }
  );
  res.json({ success: true });
});
