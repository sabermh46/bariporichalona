import db from "../config/knex";
import CaretakerPermissionService from "../services/CaretakerPermission.service";
const HouseController = require("../controllers/house.controller");

export async function canAccessFlat(user, flatId, permissionKey = null) {
  const flat = await db("flat").where("id", flatId).first();
  
  if (!flat) return false;
  
  // Check house access first
  
  const canAccessHouse = await HouseController.canAccessHouse(user, flat.house_id);
  
  if (!canAccessHouse) return false;
  
  // If specific permission is requested, check it
  if (permissionKey && user.role.slug === 'caretaker') {
    return CaretakerPermissionService.hasCaretakerPermission(
      user.id,
      flat.house_id,
      permissionKey
    );
  }
  
  return true;
}