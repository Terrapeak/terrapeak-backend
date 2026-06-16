import express from "express";
import {
  getAllUsers,
  approveUser,
  updateUser,
  deleteUser,
  rejectUser,
} from "../controllers/userController.js";
import isAdmin from "../middleware/isAdmin.js"

const router = express.Router();

router.get("/", isAdmin, getAllUsers);
router.put("/:id/approve", isAdmin, approveUser);
router.put("/:id/reject", isAdmin, rejectUser);
router.put("/:id", isAdmin, updateUser);
router.delete("/:id", isAdmin, deleteUser);

export default router;
