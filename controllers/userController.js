const UserModel = require('../models/userModel');

async function listUsers(req, res) {
    try {
        const users = await UserModel.getAllUsers();
        res.json(users)
    }
    catch (err) {
        res.status(500).json({
            error: 'Failed to fetch users.'
        })
    }
}

module.exports = { listUsers }