/** 404 handler for unknown routes - always answers with JSON, never HTML */
const notFound = (req, res) => {
  res.status(404).json({ message: `Route not found: ${req.method} ${req.originalUrl}` });
};

/** Central error handler - turns Mongoose errors into clean 400/409 responses */
const errorHandler = (err, req, res, next) => { // eslint-disable-line no-unused-vars
  // Invalid ObjectId
  if (err.name === 'CastError') {
    return res.status(400).json({ message: `Invalid value for ${err.path}` });
  }
  // Schema validation
  if (err.name === 'ValidationError') {
    const errors = Object.values(err.errors).map((e) => e.message);
    return res.status(400).json({ message: errors[0] || 'Validation failed', errors });
  }
  // Duplicate key
  if (err.code === 11000) {
    const field = Object.keys(err.keyValue || {})[0] || 'field';
    const message =
      field === 'email'
        ? 'An account with this email already exists'
        : 'This record already exists';
    return res.status(409).json({ message });
  }
  const status = err.statusCode || 500;
  if (status >= 500) console.error(err);
  res.status(status).json({ message: err.message || 'Server error' });
};

/** Small helper for throwing errors with a status code */
class ApiError extends Error {
  constructor(statusCode, message) {
    super(message);
    this.statusCode = statusCode;
  }
}

module.exports = { notFound, errorHandler, ApiError };
