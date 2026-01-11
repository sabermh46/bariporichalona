// utils/accessCache.js
class AccessCache {
  constructor() {
    this.userCache = new Map();
    this.userHousesCache = new Map();
    this.TTL = 5 * 60 * 1000; // 5 minutes
  }

  async getUserWithRole(userId, db) {
    const cacheKey = `user_${userId}`;
    const cached = this.userCache.get(cacheKey);
    
    if (cached && (Date.now() - cached.timestamp < this.TTL)) {
      return cached.data;
    }

    const user = await db('user as u')
      .where('u.id', userId)
      .leftJoin('role as r', 'u.roleId', 'r.id')
      .select('u.*', 'r.slug as role_slug')
      .first();

    this.userCache.set(cacheKey, {
      data: user,
      timestamp: Date.now()
    });

    return user;
  }

  async getUserAccessibleHouses(userId, db, HouseController, CaretakerPermissionService) {
    const cacheKey = `user_houses_${userId}`;
    const cached = this.userHousesCache.get(cacheKey);
    
    if (cached && (Date.now() - cached.timestamp < this.TTL)) {
      return cached.data;
    }

    const user = await this.getUserWithRole(userId, db);
    
    if (!user) {
      this.userHousesCache.set(cacheKey, {
        data: [],
        timestamp: Date.now()
      });
      return [];
    }

    let accessibleHouses = [];

    if (user.role_slug === 'web_owner') {
      const houses = await db('house').select('id');
      accessibleHouses = houses.map(h => h.id);
    } else if (user.role_slug === 'house_owner') {
      const houses = await db('house')
        .where('ownerId', userId)
        .select('id');
      accessibleHouses = houses.map(h => h.id);
    } else if (user.role_slug === 'staff') {
      // Get all houses where the staff manages the owner
      const ownedHouses = await db('house').select('id', 'ownerId');
      
      for (const house of ownedHouses) {
        const hasAccess = await HouseController.checkUserHierarchy(userId, house.ownerId);
        if (hasAccess) {
          accessibleHouses.push(house.id);
        }
      }
    } else if (user.role_slug === 'caretaker') {
      accessibleHouses = await CaretakerPermissionService.getCaretakerHouses(userId);
    }

    this.userHousesCache.set(cacheKey, {
      data: accessibleHouses,
      timestamp: Date.now()
    });

    return accessibleHouses;
  }

  async checkHouseAccess(userId, houseId, db, HouseController, CaretakerPermissionService) {
    try {
      const accessibleHouses = await this.getUserAccessibleHouses(
        userId, db, HouseController, CaretakerPermissionService
      );
      return accessibleHouses.includes(parseInt(houseId));
    } catch (error) {
      console.error('Error in cached checkHouseAccess:', error);
      return false;
    }
  }

  clearUserCache(userId) {
    this.userCache.delete(`user_${userId}`);
    this.userHousesCache.delete(`user_houses_${userId}`);
  }

  clearAllCache() {
    this.userCache.clear();
    this.userHousesCache.clear();
  }
}

module.exports = new AccessCache();