const userModel = require('../models/userModel');

// GET /users
exports.getAllUsers = async (req, res) => {
  try {
    const users = await userModel.getAllUsers();
    res.json(users);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Failed to fetch users' });
  }
};

// GET /users/:id
exports.getUserById = async (req, res) => {
  try {
    const user = await userModel.getUserById(req.params.id);

    if (!user) {
      return res.status(404).json({ error: 'User not found' });
    }

    res.json(user);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Failed to fetch user' });
  }
};

// POST /users
exports.createUser = async (req, res) => {
  try {
    const { first_name, last_name, email, password_hash, role } = req.body;

    const newUser = await userModel.createUser(
      first_name,
      last_name,
      password_hash,
      email,
      role
    );

    res.status(201).json(newUser);
  } catch (err) {
    console.error(err);

    // Example: handle duplicate email
    if (err.code === '23505') {
      return res.status(400).json({ error: 'Email already exists' });
    }

    res.status(500).json({ error: 'Failed to create user' });
  }
};

// PUT /users/:id
exports.updateUser = async (req, res) => {
  try {
    const { first_name, last_name, email, password_hash, role, school_id, is_verified } = req.body;

    const updatedUser = await userModel.updateUser(
      req.params.id,
      first_name,
      last_name,
      email,
      password_hash,
      role,
      school_id,
      is_verified
    );

    if (!updatedUser) {
      return res.status(404).json({ error: 'User not found' });
    }

    res.json(updatedUser);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Failed to update user' });
  }
};

// DELETE /users/:id
exports.deleteUser = async (req, res) => {
  try {
    const deletedUser = await userModel.deleteUser(req.params.id);

    if (!deletedUser) {
      return res.status(404).json({ error: 'User not found' });
    }

    res.json({ message: 'User deleted', user: deletedUser });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Failed to delete user' });
  }
};