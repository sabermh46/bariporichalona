// routes/house.routes.js
const express = require('express');
const router = express.Router();
const HouseController = require('../controllers/house.controller');
const authMiddleware = require('../middleware/auth.middleware');
const roleMiddleware = require('../middleware/role.middleware');

// All routes require authentication
router.use(authMiddleware);

// House CRUD routes
router.post('/houses', 
    roleMiddleware(['web_owner', 'staff', 'house_owner']),
    HouseController.createHouse
);

router.get('/houses', 
    roleMiddleware(['web_owner', 'staff', 'house_owner']),
    HouseController.getHouses
);

router.get('/houses/stats', 
    roleMiddleware(['web_owner', 'staff', 'house_owner']),
    HouseController.getHouseStats
);

router.get('/houses/:id', 
    roleMiddleware(['web_owner', 'staff', 'house_owner']),
    HouseController.getHouseDetails
);

router.put('/houses/:id', 
    roleMiddleware(['web_owner', 'staff', 'house_owner']),
    HouseController.updateHouse
);

router.delete('/houses/:id', 
    roleMiddleware(['web_owner', 'staff', 'house_owner']),
    HouseController.deleteHouse
);

module.exports = router;